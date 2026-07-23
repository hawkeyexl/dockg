/**
 * `dockg stats` — graph health summary: node/edge counts, orphan docs
 * (no incoming or outgoing references), broken internal links, the
 * most-connected docs, and metadata coverage. `--check` exits 1 when broken
 * links exist or a coverage threshold is unmet.
 */
import { resolve } from "node:path";
import { DataFactory, type Store } from "n3";
import { loadConfig } from "../core/config.js";
import { compactIri, loadGraph } from "../core/load.js";
import { NS, RDF_TYPE } from "../core/vocab.js";
import { COVERAGE_FIELDS } from "../core/coverage.js";

const { namedNode } = DataFactory;

export interface StatsOptions {
  config?: string;
  graph?: string;
  cwd?: string;
  /** Exit 1 when broken links exist or a coverage threshold is unmet. */
  check?: boolean;
  /** How many most-connected docs to list. */
  top?: number;
  /**
   * Uniform minimum coverage percentage, overriding config across every field.
   * The per-field map form is config-only.
   */
  coverageThreshold?: number;
}

/** One row of the metadata coverage report. */
export interface CoverageRow {
  field: string;
  predicate: string;
  /** Documents carrying the predicate. */
  docs: number;
  /** Percentage of documents covered, rounded to one decimal. */
  pct: number;
}

export interface StatsReport {
  triples: number;
  docs: number;
  sections: number;
  concepts: number;
  references: number;
  /** dockg:path of docs with no in/out dcterms:references. */
  orphans: string[];
  brokenLinks: Array<{ doc: string; target: string }>;
  mostConnected: Array<{ doc: string; degree: number }>;
  /** Per-field metadata coverage, in report order. */
  coverage: CoverageRow[];
  /** Fields whose coverage is below their configured threshold. */
  coverageFindings: Array<{ field: string; pct: number; threshold: number }>;
  exitCode: 0 | 1;
}

function subjectsOfType(store: Store, typeIri: string): string[] {
  return store
    .getQuads(null, namedNode(RDF_TYPE), namedNode(typeIri), null)
    .map((q) => q.subject.value)
    .sort();
}

/** Strip a fragment so section references count toward their doc. */
function base(iri: string): string {
  const hash = iri.indexOf("#");
  return hash === -1 ? iri : iri.slice(0, hash);
}

/** Round a percentage to one decimal place for display. */
function round1(pct: number): number {
  return Math.round(pct * 10) / 10;
}

export function runStats(opts: StatsOptions = {}): StatsReport {
  const cwd = opts.cwd ?? process.cwd();
  const config = loadConfig(opts.config, cwd);
  const store = loadGraph(resolve(cwd, opts.graph ?? config.out));
  const top = opts.top ?? 5;

  const docIris = subjectsOfType(store, `${NS.dockg}Document`);
  const docSet = new Set(docIris);
  // One indexed scan for all paths instead of a per-doc lookup.
  const pathOf = new Map<string, string>(docIris.map((d) => [d, d]));
  for (const quad of store.getQuads(
    null,
    namedNode(`${NS.dockg}path`),
    null,
    null,
  )) {
    pathOf.set(quad.subject.value, quad.object.value);
  }

  const refQuads = store.getQuads(
    null,
    namedNode(`${NS.dcterms}references`),
    null,
    null,
  );
  const degree = new Map<string, number>(docIris.map((d) => [d, 0]));
  for (const quad of refQuads) {
    const from = quad.subject.value;
    const to = base(quad.object.value);
    if (docSet.has(from)) degree.set(from, (degree.get(from) ?? 0) + 1);
    if (docSet.has(to) && to !== from)
      degree.set(to, (degree.get(to) ?? 0) + 1);
  }

  const orphans = docIris
    .filter((d) => (degree.get(d) ?? 0) === 0)
    .map((d) => pathOf.get(d)!)
    .sort();

  const brokenLinks = store
    .getQuads(null, namedNode(`${NS.dockg}brokenLink`), null, null)
    .map((q) => ({
      doc: pathOf.get(q.subject.value) ?? q.subject.value,
      target: q.object.value,
    }))
    .sort((a, b) => (a.doc + a.target < b.doc + b.target ? -1 : 1));

  const mostConnected = [...degree.entries()]
    .filter(([, deg]) => deg > 0)
    .map(([doc, deg]) => ({ doc: pathOf.get(doc)!, degree: deg }))
    .sort((a, b) => b.degree - a.degree || (a.doc < b.doc ? -1 : 1))
    .slice(0, top);

  // Coverage: one indexed scan per field over Document subjects. Measured
  // against the graph, so git-derived values count (ADR 01008/01011). A
  // zero-document graph is vacuously 100% — no divide-by-zero, no false gate.
  const total = docIris.length;
  const coverage: CoverageRow[] = COVERAGE_FIELDS.map(({ field, iri }) => {
    let docs = 0;
    for (const d of docIris) {
      if (store.countQuads(namedNode(d), namedNode(iri), null, null) > 0)
        docs++;
    }
    const ratio = total === 0 ? 100 : (docs / total) * 100;
    // Report the rounded value; gate on the raw ratio (below) so a corpus at
    // 79.96% does not clear an 80 threshold on the strength of display rounding.
    return { field, predicate: compactIri(iri), docs, pct: round1(ratio) };
  });

  // A uniform --coverage-threshold overrides the resolved config map. Bind it
  // to a local first so the null-narrowing survives the .map() closure.
  const uniform = opts.coverageThreshold;
  const thresholds =
    uniform != null
      ? Object.fromEntries(coverage.map((c) => [c.field, uniform]))
      : config.stats.coverageThreshold;
  const coverageFindings = coverage
    .filter(
      (c) =>
        c.field in thresholds &&
        (total === 0 ? 100 : (c.docs / total) * 100) < thresholds[c.field]!,
    )
    .map((c) => ({
      field: c.field,
      pct: c.pct,
      threshold: thresholds[c.field]!,
    }));

  const failed =
    !!opts.check && (brokenLinks.length > 0 || coverageFindings.length > 0);

  return {
    triples: store.size,
    docs: docIris.length,
    // countQuads avoids materializing + sorting arrays used only for counting.
    sections: store.countQuads(
      null,
      namedNode(RDF_TYPE),
      namedNode(`${NS.dockg}Section`),
      null,
    ),
    concepts: store.countQuads(
      null,
      namedNode(RDF_TYPE),
      namedNode(`${NS.skos}Concept`),
      null,
    ),
    references: refQuads.length,
    orphans,
    brokenLinks,
    mostConnected,
    coverage,
    coverageFindings,
    exitCode: failed ? 1 : 0,
  };
}

export function renderStats(
  report: StatsReport,
  format: "pretty" | "json",
): string {
  if (format === "json") {
    const { exitCode: _exitCode, ...rest } = report;
    return JSON.stringify(rest, null, 2);
  }
  const lines = [
    `Triples:    ${report.triples}`,
    `Documents:  ${report.docs}`,
    `Sections:   ${report.sections}`,
    `Concepts:   ${report.concepts}`,
    `References: ${report.references}`,
  ];
  lines.push("", "Most connected:");
  if (report.mostConnected.length === 0) lines.push("  (none)");
  for (const { doc, degree } of report.mostConnected) {
    lines.push(`  ${doc} (${degree})`);
  }
  lines.push("", `Orphan docs (${report.orphans.length}):`);
  for (const orphan of report.orphans) lines.push(`  ${orphan}`);
  if (report.orphans.length === 0) lines.push("  (none)");
  lines.push("", `Broken internal links (${report.brokenLinks.length}):`);
  for (const { doc, target } of report.brokenLinks) {
    lines.push(`  ${doc} -> ${target}`);
  }
  if (report.brokenLinks.length === 0) lines.push("  (none)");

  const belowThreshold = new Set(report.coverageFindings.map((f) => f.field));
  const width = Math.max(...report.coverage.map((c) => c.field.length));
  lines.push("", "Coverage:");
  for (const { field, docs, pct } of report.coverage) {
    const flag = belowThreshold.has(field) ? "  ! below threshold" : "";
    lines.push(
      `  ${field.padEnd(width)}  ${docs}/${report.docs}  ${pct.toFixed(1)}%${flag}`,
    );
  }
  return lines.join("\n");
}
