/**
 * Graph guardrail for `dockg fill`: before a proposal is written to
 * frontmatter, simulate it in the derived graph and drop any field that
 * would violate the SHACL shapes contract — broader/narrower cycles,
 * related⨯broaderTransitive conflicts, prefLabel collisions. Accepted
 * proposals fold into the guard's state so two docs in one run cannot
 * jointly corrupt the graph.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DataFactory, Store } from "n3";
import type { DocModel } from "../types.js";
import { analyzeDoc } from "./analyze.js";
import type { DeriveSource, DockgConfig } from "./config.js";
import { deriveGraph, type Quad } from "./derive.js";
import { applyKgFields } from "./frontmatter-edit.js";
import { validateGraph, type CheckFinding } from "./shacl.js";
import { NS } from "./vocab.js";

const { namedNode, literal, quad } = DataFactory;

/** Proposal fields the guard simulates; others cannot break the shapes. */
const GUARDED_FIELDS = ["prefLabel", "broader", "narrower", "related"] as const;

/** Concept edges only: the guard cares about the SKOS subgraph, and keeping
 * sections/links/provenance out keeps per-doc simulation cheap and git-free. */
const GUARD_SOURCES: DeriveSource[] = ["frontmatter", "tags"];

function toStore(quads: Quad[]): Store {
  const store = new Store();
  for (const q of quads) {
    store.addQuad(
      quad(
        namedNode(q.s),
        namedNode(q.p),
        q.o.kind === "iri"
          ? namedNode(q.o.value)
          : literal(
              q.o.value,
              q.o.datatype ? namedNode(q.o.datatype) : undefined,
            ),
      ),
    );
  }
  return store;
}

export interface VetResult {
  /** The proposal minus rejected fields. */
  values: Record<string, unknown>;
  /** Rejected field names with the finding that condemned them. */
  rejected: Array<{ field: string; reason: string }>;
}

export class FillGuard {
  private readonly models = new Map<string, DocModel>();
  private baselineKeys: Set<string> | null = null;

  private constructor(
    private readonly allPaths: Set<string>,
    private readonly routes: DockgConfig["routes"],
    private readonly baseIri: string,
    private readonly sources: DeriveSource[],
    private readonly shapesPaths: string[],
    private readonly force: boolean,
  ) {}

  /** Read and analyze the whole corpus once, up front. */
  static create(
    files: string[],
    cwd: string,
    config: DockgConfig,
    shapesPaths: string[],
    force: boolean,
  ): FillGuard {
    const sources = config.build.derive.filter((s) =>
      GUARD_SOURCES.includes(s),
    );
    const guard = new FillGuard(
      new Set(files),
      config.routes,
      config.baseIri,
      sources,
      shapesPaths,
      force,
    );
    for (const path of files) {
      guard.models.set(
        path,
        analyzeDoc(
          readFileSync(resolve(cwd, path), "utf8"),
          path,
          guard.allPaths,
          {
            routes: config.routes,
          },
        ),
      );
    }
    return guard;
  }

  private buildStore(override?: { path: string; model: DocModel }): Store {
    const models: DocModel[] = [];
    for (const [path, model] of this.models) {
      models.push(override && path === override.path ? override.model : model);
    }
    return toStore(
      deriveGraph(models, { baseIri: this.baseIri, derive: this.sources }),
    );
  }

  private static key(f: CheckFinding): string {
    return `${f.severity}|${f.focusNode}|${f.path ?? ""}|${f.message}`;
  }

  /** Findings already present before any proposal — never blamed on one. */
  private async baseline(): Promise<Set<string>> {
    if (this.baselineKeys === null) {
      const findings = await validateGraph(this.buildStore(), this.shapesPaths);
      this.baselineKeys = new Set(findings.map(FillGuard.key));
    }
    return this.baselineKeys;
  }

  /** Fields a finding condemns, restricted to what the proposal contains. */
  private static offendingFields(
    finding: CheckFinding,
    proposed: Set<string>,
  ): string[] {
    const hierarchy = ["broader", "narrower"].filter((f) => proposed.has(f));
    if (finding.path === `${NS.skos}prefLabel`) {
      return proposed.has("prefLabel") ? ["prefLabel"] : [];
    }
    if (finding.message.includes("cycle")) return hierarchy;
    if (finding.path === `${NS.skos}broader`) return hierarchy;
    if (finding.path === `${NS.skos}narrower`) return hierarchy;
    if (finding.path === `${NS.skos}related`) {
      return proposed.has("related") ? ["related"] : [];
    }
    return []; // unattributable — caller rejects everything guarded
  }

  /**
   * Simulate `values` applied to the doc and drop fields until the graph
   * stays clean. New violations always reject; new prefLabel warnings
   * reject the proposed prefLabel (an LLM must not introduce a second
   * spelling of an existing concept).
   */
  async vet(
    path: string,
    content: string,
    values: Record<string, unknown>,
  ): Promise<VetResult> {
    const current = { ...values };
    const rejected: Array<{ field: string; reason: string }> = [];
    const guarded = (): string[] =>
      GUARDED_FIELDS.filter((f) => current[f] !== undefined);
    if (guarded().length === 0) return { values: current, rejected };

    const baseline = await this.baseline();
    // Each pass drops at least one field, so this terminates.
    while (guarded().length > 0) {
      const applied = applyKgFields(content, path, current, {
        force: this.force,
      });
      const model = analyzeDoc(applied.content, path, this.allPaths, {
        routes: this.routes,
      });
      const findings = await validateGraph(
        this.buildStore({ path, model }),
        this.shapesPaths,
      );
      const introduced = findings.filter(
        (f) => !baseline.has(FillGuard.key(f)),
      );
      const bad = introduced.filter(
        (f) =>
          f.severity === "violation" ||
          (f.severity === "warning" && f.path === `${NS.skos}prefLabel`),
      );
      if (bad.length === 0) break;

      const proposed = new Set(guarded());
      const condemned = new Map<string, string>();
      for (const f of bad) {
        for (const field of FillGuard.offendingFields(f, proposed)) {
          if (!condemned.has(field)) condemned.set(field, f.message);
        }
      }
      if (condemned.size === 0) {
        // Can't pin the new violation on a specific field — reject the
        // whole guarded proposal rather than write a graph that fails check.
        for (const field of guarded()) {
          condemned.set(field, bad[0]!.message);
        }
      }
      for (const [field, reason] of condemned) {
        rejected.push({ field, reason });
        delete current[field];
      }
    }

    rejected.sort((a, b) => a.field.localeCompare(b.field));
    return { values: current, rejected };
  }

  /** Fold an accepted (written or would-be-written) doc into guard state. */
  commit(path: string, content: string): void {
    this.models.set(
      path,
      analyzeDoc(content, path, this.allPaths, { routes: this.routes }),
    );
    this.baselineKeys = null;
  }
}
