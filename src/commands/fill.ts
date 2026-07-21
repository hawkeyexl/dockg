/**
 * `dockg fill` — propose SKOS frontmatter fields (`kg:` sub-key) with an LLM
 * and write them back. Single-shot structured output per doc, content-hash
 * cached, cost-budgeted. Human-set fields are never overwritten without
 * `--force`; `--dry-run` reports without writing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { analyzeDoc } from "../core/analyze.js";
import { loadConfig, type FillField } from "../core/config.js";
import { discoverFiles } from "../core/discover.js";
import { applyKgFields, existingKgFields } from "../core/frontmatter-edit.js";
import { DockgError } from "../types.js";
import { FillCache, cacheKey } from "../llm/cache.js";
import { costOfUsage, pricingFor } from "../llm/cost.js";
import { SYSTEM_PROMPT, buildUserPrompt, proposalSchema } from "../llm/prompt.js";
import { makeProvider } from "../llm/providers/index.js";
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

export async function runFill(opts: FillOptions = {}): Promise<FillReport> {
  const cwd = opts.cwd ?? process.cwd();
  const config = loadConfig(opts.config, cwd);
  const inputs = opts.globs && opts.globs.length > 0 ? opts.globs : config.inputs;

  const files = discoverFiles(inputs, config.exclude, cwd);
  if (files.length === 0) {
    throw new DockgError(`No input files matched: ${inputs.join(", ")} (cwd: ${cwd})`);
  }

  const provider =
    opts.providerInstance ??
    makeProvider(config, { provider: opts.provider, model: opts.model });
  const fields = config.fill.fields;
  const schema = proposalSchema(fields);
  const validateProposal = ajv.compile(schema);
  const cache = new FillCache(
    resolve(cwd, config.fill.cacheDir),
    !opts.noCache,
  );
  const pricing = pricingFor(provider.modelName(), config.fill.pricing);
  const maxCostUsd = opts.maxCost ?? config.fill.maxCostUsd;

  const allPaths = new Set(files);
  const results: FillDocResult[] = [];
  let costUsd = 0;

  for (const path of files) {
    const absPath = resolve(cwd, path);
    const content = readFileSync(absPath, "utf8");

    const present = new Set(existingKgFields(content));
    const missing = opts.force
      ? fields
      : fields.filter((f) => !present.has(f));
    if (missing.length === 0) {
      results.push({ path, status: "complete", fields: [], preserved: [], cached: false });
      continue;
    }

    if (maxCostUsd !== null && costUsd >= maxCostUsd) {
      results.push({
        path,
        status: "skipped-budget",
        fields: [],
        preserved: [],
        cached: false,
      });
      continue;
    }

    const key = cacheKey(
      provider.provider(),
      provider.modelName(),
      content,
      missing as FillField[],
    );
    let proposal = cache.get(key);
    let cached = proposal !== undefined;

    if (!proposal) {
      const doc = analyzeDoc(content, path, allPaths, { routes: config.routes });
      try {
        const response = await provider.completeJSON({
          system: SYSTEM_PROMPT,
          user: buildUserPrompt(doc, content, missing as FillField[]),
          schema: proposalSchema(missing as FillField[]),
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
      } catch (e) {
        results.push({
          path,
          status: "error",
          fields: [],
          preserved: [],
          cached: false,
          error: e instanceof Error ? e.message : String(e),
        });
        continue;
      }
      cached = false;
    }

    // Only requested fields survive, even if the cache or provider offered more.
    const narrowed = Object.fromEntries(
      Object.entries(proposal).filter(([k]) => missing.includes(k as FillField)),
    );
    const applied = applyKgFields(content, path, narrowed, { force: opts.force });

    if (applied.applied.length === 0) {
      results.push({
        path,
        status: "nothing-proposed",
        fields: [],
        preserved: applied.skipped,
        cached,
      });
      continue;
    }

    if (!opts.dryRun) writeFileSync(absPath, applied.content, "utf8");
    results.push({
      path,
      status: opts.dryRun ? "proposed" : "filled",
      fields: applied.applied,
      preserved: applied.skipped,
      cached,
    });
  }

  const hasErrors = results.some((r) => r.status === "error");
  return { results, costUsd, exitCode: hasErrors ? 1 : 0 };
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
