/**
 * `dockg build` — derive the knowledge graph from discovered docs and write
 * deterministic Turtle. Running twice over unchanged inputs produces
 * byte-identical output.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DockgError } from "../types.js";
import { analyzeDoc } from "../core/analyze.js";
import { loadConfig } from "../core/config.js";
import { deriveGraph } from "../core/derive.js";
import { discoverFiles } from "../core/discover.js";
import { emitTurtle } from "../core/emit.js";
import { collectGitHistory } from "../core/git.js";
import { toolVersion } from "../core/pkg.js";

export interface BuildOptions {
  /** Positional globs; override config `inputs` when non-empty. */
  globs?: string[];
  /** Explicit config file path. */
  config?: string;
  /** Output path override (default: config `out`). */
  out?: string;
  cwd?: string;
}

export interface BuildResult {
  outPath: string;
  docs: number;
  quads: number;
}

export async function runBuild(opts: BuildOptions = {}): Promise<BuildResult> {
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

  const allPaths = new Set(files);
  const docs = files.map((path) =>
    analyzeDoc(readFileSync(resolve(cwd, path), "utf8"), path, allPaths, {
      routes: config.routes,
    }),
  );

  const quads = deriveGraph(docs, {
    baseIri: config.baseIri,
    derive: config.build.derive,
    toolVersion: toolVersion(import.meta.url),
    // The git pass only feeds the provenance derive source — skip the
    // subprocess entirely when that source is disabled.
    gitHistory:
      config.provenance.git && config.build.derive.includes("provenance")
        ? await collectGitHistory(cwd)
        : undefined,
    qualified: config.provenance.qualified,
  });
  const turtle = emitTurtle(quads);

  const outPath = resolve(cwd, opts.out ?? config.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, turtle, "utf8");

  return { outPath, docs: docs.length, quads: quads.length };
}
