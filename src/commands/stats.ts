/**
 * `dockg stats` — graph health summary: node/edge counts, orphan docs
 * (no incoming or outgoing references), broken internal links, and the
 * most-connected docs. `--check` exits 1 when broken links exist.
 */
import { resolve } from "node:path";
import { DataFactory, type Store } from "n3";
import { loadConfig } from "../core/config.js";
import { loadGraph } from "../core/load.js";
import { NS, RDF_TYPE } from "../core/vocab.js";

const { namedNode } = DataFactory;

export interface StatsOptions {
  config?: string;
  graph?: string;
  cwd?: string;
  /** Exit 1 when broken links exist. */
  check?: boolean;
  /** How many most-connected docs to list. */
  top?: number;
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

export function runStats(opts: StatsOptions = {}): StatsReport {
  const cwd = opts.cwd ?? process.cwd();
  const config = loadConfig(opts.config, cwd);
  const store = loadGraph(resolve(cwd, opts.graph ?? config.out));
  const top = opts.top ?? 5;

  const docIris = subjectsOfType(store, `${NS.dockg}Document`);
  const docSet = new Set(docIris);
  // One indexed scan for all paths instead of a per-doc lookup.
  const pathOf = new Map<string, string>(docIris.map((d) => [d, d]));
  for (const quad of store.getQuads(null, namedNode(`${NS.dockg}path`), null, null)) {
    pathOf.set(quad.subject.value, quad.object.value);
  }

  const refQuads = store.getQuads(null, namedNode(`${NS.dcterms}references`), null, null);
  const degree = new Map<string, number>(docIris.map((d) => [d, 0]));
  for (const quad of refQuads) {
    const from = quad.subject.value;
    const to = base(quad.object.value);
    if (docSet.has(from)) degree.set(from, (degree.get(from) ?? 0) + 1);
    if (docSet.has(to) && to !== from) degree.set(to, (degree.get(to) ?? 0) + 1);
  }

  const orphans = docIris
    .filter((d) => (degree.get(d) ?? 0) === 0)
    .map((d) => pathOf.get(d)!)
    .sort();

  const brokenLinks = store
    .getQuads(null, namedNode(`${NS.dockg}brokenLink`), null, null)
    .map((q) => ({ doc: pathOf.get(q.subject.value) ?? q.subject.value, target: q.object.value }))
    .sort((a, b) => (a.doc + a.target < b.doc + b.target ? -1 : 1));

  const mostConnected = [...degree.entries()]
    .filter(([, deg]) => deg > 0)
    .map(([doc, deg]) => ({ doc: pathOf.get(doc)!, degree: deg }))
    .sort((a, b) => b.degree - a.degree || (a.doc < b.doc ? -1 : 1))
    .slice(0, top);

  return {
    triples: store.size,
    docs: docIris.length,
    sections: subjectsOfType(store, `${NS.dockg}Section`).length,
    concepts: subjectsOfType(store, `${NS.skos}Concept`).length,
    references: refQuads.length,
    orphans,
    brokenLinks,
    mostConnected,
    exitCode: opts.check && brokenLinks.length > 0 ? 1 : 0,
  };
}

export function renderStats(report: StatsReport, format: "pretty" | "json"): string {
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
  return lines.join("\n");
}
