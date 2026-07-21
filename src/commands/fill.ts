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
  frontmatterKind,
} from "../core/frontmatter-edit.js";
import { DockgError } from "../types.js";
import { FillCache, cacheKey } from "../llm/cache.js";
import { costOfUsage, pricingFor } from "../llm/cost.js";
import { SYSTEM_PROMPT, buildUserPrompt, proposalSchema } from "../llm/prompt.js";
import { makeProvider, resolveProviderIdentity } from "../llm/providers/index.js";
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
const RELATION_FIELDS = ["altLabels", "broader", "narrower", "related"] as const;

export async function runFill(opts: FillOptions = {}): Promise<FillReport> {
  const cwd = opts.cwd ?? process.cwd();
  const config = loadConfig(opts.config, cwd);
  const inputs = opts.globs && opts.globs.length > 0 ? opts.globs : config.inputs;

  const files = discoverFiles(inputs, config.exclude, cwd);
  if (files.length === 0) {
    throw new DockgError(`No input files matched: ${inputs.join(", ")} (cwd: ${cwd})`);
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
  const cache = new FillCache(resolve(cwd, config.fill.cacheDir), !opts.noCache);
  const pricing = pricingFor(identity.model, config.fill.pricing);
  const maxCostUsd = opts.maxCost ?? config.fill.maxCostUsd;

  const allPaths = new Set(files);
  const results: FillDocResult[] = [];
  let costUsd = 0;

  for (const path of files) {
    try {
      results.push(await fillOne(path));
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

  async function fillOne(path: string): Promise<FillDocResult> {
    const absPath = resolve(cwd, path);
    const content = readFileSync(absPath, "utf8");

    if (frontmatterKind(content) === "unsupported") {
      throw new DockgError(
        "only YAML frontmatter can be edited (found a TOML/JSON fence) — exclude this file or convert its frontmatter",
      );
    }

    const present = new Set(existingKgFields(content));
    const missing = opts.force ? fields : fields.filter((f) => !present.has(f));
    if (missing.length === 0) {
      return { path, status: "complete", fields: [], preserved: [], cached: false };
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
      const doc = analyzeDoc(content, path, allPaths, { routes: config.routes });
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
    const willHavePrefLabel =
      present.has("prefLabel") ||
      (typeof narrowed["prefLabel"] === "string" && narrowed["prefLabel"].length > 0);
    if (!willHavePrefLabel) {
      for (const field of RELATION_FIELDS) delete narrowed[field];
    }

    const applied = applyKgFields(content, path, narrowed, { force: opts.force });

    if (applied.applied.length === 0) {
      return {
        path,
        status: "nothing-proposed",
        fields: [],
        preserved: applied.skipped,
        cached,
      };
    }

    if (!opts.dryRun) writeFileSync(absPath, applied.content, "utf8");
    return {
      path,
      status: opts.dryRun ? "proposed" : "filled",
      fields: applied.applied,
      preserved: applied.skipped,
      cached,
    };
  }
}

export function renderFill(report: FillReport, format: "pretty" | "json"): string {
  if (format === "json") return JSON.stringify(report, null, 2);
  const lines: string[] = [];
  for (const r of report.results) {
    switch (r.status) {
      case "filled":
        lines.push(`filled    ${r.path} (${r.fields.join(", ")})${r.cached ? " [cached]" : ""}`);
        break;
      case "proposed":
        lines.push(`proposed  ${r.path} (${r.fields.join(", ")})${r.cached ? " [cached]" : ""} — dry run, not written`);
        break;
      case "complete":
        lines.push(`complete  ${r.path}`);
        break;
      case "nothing-proposed":
        lines.push(`no-op     ${r.path} (model proposed nothing new)`);
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
