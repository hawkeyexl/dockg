/**
 * `dockg fill` — propose SKOS frontmatter fields (`kg:` sub-key) with an LLM
 * and write them back. Single-shot structured output per doc, content-hash
 * cached, cost-budgeted. Human-set fields are never overwritten without
 * `--force`; `--dry-run` reports without writing. Any per-doc failure is
 * recorded as a result, never aborts the run.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { analyzeDoc } from "../core/analyze.js";
import { loadConfig, type FillField } from "../core/config.js";
import { discoverFiles } from "../core/discover.js";
import {
  applyKgFields,
  existingKgFields,
  existingProvenance,
  frontmatterKind,
} from "../core/frontmatter-edit.js";
import { FillGuard } from "../core/fill-guard.js";
import { bundledShapesPath } from "../core/pkg.js";
import { DockgError } from "../types.js";
import { FillCache, cacheKey } from "../llm/cache.js";
import { costOfUsage, pricingFor } from "../llm/cost.js";
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  proposalSchema,
} from "../llm/prompt.js";
import {
  makeProvider,
  resolveProviderIdentity,
} from "../llm/providers/index.js";
import type { LlmProvider } from "../llm/types.js";

export interface FillOptions {
  globs?: string[];
  config?: string;
  cwd?: string;
  dryRun?: boolean;
  force?: boolean;
  noCache?: boolean;
  maxCost?: number;
  provider?: string;
  model?: string;
  /** Disable the graph guardrail (`--no-validate-graph`). */
  noValidateGraph?: boolean;
  /** Injection seam for tests: bypasses the provider factory. */
  providerInstance?: LlmProvider;
}

export type FillStatus =
  | "filled"
  | "proposed" // dry run: would write
  | "complete" // nothing missing
  | "nothing-proposed"
  | "skipped-budget"
  | "error";

export interface FillDocResult {
  path: string;
  status: FillStatus;
  /** Fields written (or that would be written under --dry-run). */
  fields: string[];
  /** Human-set fields the proposal was not allowed to touch. */
  preserved: string[];
  /** Fields dropped by the graph guardrail (fill.validateGraph). */
  rejected?: string[];
  cached: boolean;
  error?: string;
}

export interface FillReport {
  results: FillDocResult[];
  costUsd: number;
  exitCode: 0 | 1;
}

const ajv = new Ajv2020({ allErrors: true });

/** SKOS relation fields that require a prefLabel to attach to. */
const RELATION_FIELDS = [
  "altLabels",
  "broader",
  "narrower",
  "related",
] as const;

export async function runFill(opts: FillOptions = {}): Promise<FillReport> {
  const cwd = opts.cwd ?? process.cwd();
  const config = loadConfig(opts.config, cwd);
  const inputs =
    opts.globs && opts.globs.length > 0 ? opts.globs : config.inputs;

  const files = discoverFiles(inputs, config.exclude, cwd);
  if (files.length === 0) {
    throw new DockgError(
      `No input files matched: ${inputs.join(", ")} (cwd: ${cwd})`,
    );
  }

  // Identity (for cache keys and pricing) is resolvable without constructing
  // the provider; construction — which may demand an API key — is deferred to
  // the first actual LLM call, so complete/cached runs need no credentials.
  const identity = opts.providerInstance
    ? {
        provider: opts.providerInstance.provider(),
        model: opts.providerInstance.modelName(),
      }
    : resolveProviderIdentity(config, {
        provider: opts.provider,
        model: opts.model,
      });
  let provider: LlmProvider | undefined = opts.providerInstance;
  const getProvider = (): LlmProvider =>
    (provider ??= makeProvider(config, {
      provider: opts.provider,
      model: opts.model,
    }));

  const fields = config.fill.fields;
  const validateProposal = ajv.compile(proposalSchema(fields));
  const cache = new FillCache(
    resolve(cwd, config.fill.cacheDir),
    !opts.noCache,
  );
  const pricing = pricingFor(identity.model, config.fill.pricing);
  const maxCostUsd = opts.maxCost ?? config.fill.maxCostUsd;

  const allPaths = new Set(files);
  const results: FillDocResult[] = [];
  let costUsd = 0;

  // Graph guardrail: simulate each proposal against the SHACL shapes before
  // writing it. Off via fill.validateGraph: false or --no-validate-graph.
  // The guard's base state is the FULL configured corpus, not the positional
  // glob subset — a proposal for one doc can cycle with hierarchy that lives
  // in a doc outside the subset being filled.
  const shapesPaths =
    config.check.shapes.length > 0
      ? config.check.shapes.map((p) => resolve(cwd, p))
      : [bundledShapesPath(import.meta.url)];
  const guardFiles = [
    ...new Set([
      ...discoverFiles(config.inputs, config.exclude, cwd),
      ...files,
    ]),
  ];
  const guard =
    !opts.noValidateGraph && config.fill.validateGraph
      ? FillGuard.create(
          guardFiles,
          cwd,
          config,
          shapesPaths,
          opts.force ?? false,
        )
      : undefined;

  for (const path of files) {
    // Read failures are operational (deleted file, permissions) — abort the
    // whole run with exit 2 rather than burning LLM budget on the rest.
    const absPath = resolve(cwd, path);
    let content: string;
    try {
      content = readFileSync(absPath, "utf8");
    } catch (e) {
      throw new DockgError(
        `cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    try {
      results.push(await fillOne(path, absPath, content));
    } catch (e) {
      results.push({
        path,
        status: "error",
        fields: [],
        preserved: [],
        cached: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const hasErrors = results.some((r) => r.status === "error");
  return { results, costUsd, exitCode: hasErrors ? 1 : 0 };

  async function fillOne(
    path: string,
    absPath: string,
    content: string,
  ): Promise<FillDocResult> {
    if (frontmatterKind(content) === "unsupported") {
      throw new DockgError(
        "only YAML frontmatter can be edited (found a TOML/JSON fence) — exclude this file or convert its frontmatter",
      );
    }

    const present = new Set(existingKgFields(content));
    const missing = opts.force ? fields : fields.filter((f) => !present.has(f));
    if (missing.length === 0) {
      return {
        path,
        status: "complete",
        fields: [],
        preserved: [],
        cached: false,
      };
    }

    if (maxCostUsd !== null && costUsd >= maxCostUsd) {
      return {
        path,
        status: "skipped-budget",
        fields: [],
        preserved: [],
        cached: false,
      };
    }

    const key = cacheKey(identity.provider, identity.model, content, missing);
    // Cached proposals are validated too: a stale or hand-edited cache entry
    // must not bypass the schema (treat invalid entries as a miss).
    let proposal = cache.get(key);
    if (proposal !== undefined && !validateProposal(proposal)) {
      proposal = undefined;
    }
    const cached = proposal !== undefined;

    if (proposal === undefined) {
      const doc = analyzeDoc(content, path, allPaths, {
        routes: config.routes,
      });
      const response = await getProvider().completeJSON({
        system: SYSTEM_PROMPT,
        user: buildUserPrompt(doc, content, missing),
        schema: proposalSchema(missing),
        temperature: config.fill.temperature,
      });
      costUsd += costOfUsage(response.usage, pricing);
      if (!validateProposal(response.json)) {
        const details = (validateProposal.errors ?? [])
          .map((e) => `${e.instancePath || "/"}: ${e.message}`)
          .join("; ");
        throw new Error(`Proposal failed schema validation: ${details}`);
      }
      proposal = response.json as Record<string, unknown>;
      cache.set(key, proposal);
    }

    // Only requested fields survive, even if the cache or provider offered
    // more; string arrays are deduplicated (the 0.1 schema enforces
    // uniqueItems on what we write).
    const narrowed = Object.fromEntries(
      Object.entries(proposal)
        .filter(([k]) => missing.includes(k as FillField))
        .map(([k, v]) => [k, Array.isArray(v) ? [...new Set(v)] : v]),
    );

    // The 0.1 schema requires prefLabel alongside any label/relation field
    // (dependentRequired) — never write output our own validate rejects.
    // Rechecked after the guardrail: rejecting prefLabel takes the relation
    // fields down with it.
    const gatePrefLabel = (): void => {
      const hasPrefLabel =
        present.has("prefLabel") ||
        (typeof narrowed["prefLabel"] === "string" &&
          narrowed["prefLabel"].length > 0);
      if (!hasPrefLabel) {
        for (const field of RELATION_FIELDS) delete narrowed[field];
      }
    };
    gatePrefLabel();

    // Graph guardrail: drop any field whose triples would violate the
    // shapes contract (cycles, related⨯broader conflicts, second spellings
    // of an existing concept). Cached proposals are vetted too — rejection
    // sits downstream of the cache, so a later corpus change can re-admit
    // a proposal without re-asking the LLM.
    let rejected: string[] | undefined;
    if (guard) {
      const vetted = await guard.vet(path, content, narrowed);
      if (vetted.rejected.length > 0) {
        rejected = vetted.rejected.map((r) => r.field);
        for (const field of rejected) delete narrowed[field];
        gatePrefLabel();
      }
    }

    // Which fields will actually be written (mirrors applyKgFields' filter);
    // empty means nothing to do — and no provenance entry either.
    const realFields = Object.keys(narrowed).filter((k) => {
      const v = narrowed[k];
      return (
        v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)
      );
    });
    if (realFields.length === 0) {
      return {
        path,
        status: "nothing-proposed",
        fields: [],
        preserved: [],
        ...(rejected ? { rejected } : {}),
        cached,
      };
    }

    // Record machine attribution alongside the fields, in the SAME write.
    // One entry PER MODEL (schema 0.4): the current model's entry unions its
    // own fields across runs, other models' entries are preserved — minus any
    // field this run just overwrote (--force), so attribution never lies.
    const values: Record<string, unknown> = { ...narrowed };
    if (config.fill.writeProvenance) {
      const prior = existingProvenance(content);
      const mine = prior.find((e) => e.generatedBy === identity.model);
      const others = prior
        .filter((e) => e.generatedBy !== identity.model)
        .map((e) => ({
          generatedBy: e.generatedBy,
          fields: e.fields.filter((f) => !realFields.includes(f)),
        }))
        .filter((e) => e.fields.length > 0);
      const entry = {
        generatedBy: identity.model,
        fields: [...new Set([...(mine?.fields ?? []), ...realFields])].sort(),
      };
      values["provenance"] = [...others, entry].sort((a, b) =>
        a.generatedBy < b.generatedBy ? -1 : 1,
      );
    }

    const applied = applyKgFields(content, path, values, {
      force: opts.force,
      alwaysOverwrite: ["provenance"],
    });
    const reportedFields = applied.applied.filter((f) => f !== "provenance");

    if (reportedFields.length === 0) {
      return {
        path,
        status: "nothing-proposed",
        fields: [],
        preserved: applied.skipped,
        ...(rejected ? { rejected } : {}),
        cached,
      };
    }

    if (!opts.dryRun) writeFileSync(absPath, applied.content, "utf8");
    // Fold the accepted result into the guard even on --dry-run, so the dry
    // run predicts exactly what a real run would accept and reject.
    guard?.commit(path, applied.content);
    return {
      path,
      status: opts.dryRun ? "proposed" : "filled",
      fields: reportedFields,
      preserved: applied.skipped,
      ...(rejected ? { rejected } : {}),
      cached,
    };
  }
}

export function renderFill(
  report: FillReport,
  format: "pretty" | "json",
): string {
  if (format === "json") return JSON.stringify(report, null, 2);
  const lines: string[] = [];
  for (const r of report.results) {
    const dropped =
      r.rejected && r.rejected.length > 0
        ? ` [graph check rejected: ${r.rejected.join(", ")}]`
        : "";
    switch (r.status) {
      case "filled":
        lines.push(
          `filled    ${r.path} (${r.fields.join(", ")})${r.cached ? " [cached]" : ""}${dropped}`,
        );
        break;
      case "proposed":
        lines.push(
          `proposed  ${r.path} (${r.fields.join(", ")})${r.cached ? " [cached]" : ""}${dropped} — dry run, not written`,
        );
        break;
      case "complete":
        lines.push(`complete  ${r.path}`);
        break;
      case "nothing-proposed":
        lines.push(
          `no-op     ${r.path} (model proposed nothing new)${dropped}`,
        );
        break;
      case "skipped-budget":
        lines.push(`skipped   ${r.path} (cost budget exhausted)`);
        break;
      case "error":
        lines.push(`error     ${r.path}: ${r.error}`);
        break;
    }
  }
  lines.push("", `LLM cost: $${report.costUsd.toFixed(4)}`);
  return lines.join("\n");
}
