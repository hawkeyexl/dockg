/**
 * `dockg validate` — KG-readiness check. Thin wrapper over docmeta's
 * programmatic API, validating discovered docs against the schemas in
 * config `validate.schemas` (default: the dockg:frontmatter:0.1 built-in).
 */
import {
  runValidate as docmetaValidate,
  render,
  type ReportFormat,
  type ValidateRun,
} from "docmeta";
import { DockgError } from "../types.js";
import { loadConfig } from "../core/config.js";

export interface ValidateOptions {
  globs?: string[];
  config?: string;
  cwd?: string;
}

export interface ValidateResult {
  run: ValidateRun;
  exitCode: 0 | 1;
}

export async function runValidate(
  opts: ValidateOptions = {},
): Promise<ValidateResult> {
  const cwd = opts.cwd ?? process.cwd();
  const config = loadConfig(opts.config, cwd);
  const inputs = opts.globs && opts.globs.length > 0 ? opts.globs : config.inputs;

  let run: ValidateRun;
  try {
    run = await docmetaValidate({
      inputs,
      cliSchemas: config.validate.schemas,
      exclude: config.exclude,
      cwd,
    });
  } catch (e) {
    // Surface docmeta operational errors as our own (exit 2).
    throw new DockgError(e instanceof Error ? e.message : String(e));
  }

  return {
    run,
    exitCode: run.summary.failed > 0 || run.summary.errors > 0 ? 1 : 0,
  };
}

export function renderValidate(
  result: ValidateResult,
  format: "pretty" | "json",
): string {
  const reportFormat: ReportFormat = format === "json" ? "json" : "pretty";
  return render(reportFormat, result.run.results, result.run.summary);
}
