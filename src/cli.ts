/** dockg CLI entry point. */
import { Command } from "commander";
import pc from "picocolors";
import { DockgError } from "./types.js";
import { toolVersion } from "./core/pkg.js";
import { runBuild } from "./commands/build.js";
import { renderCheck, runCheck } from "./commands/check.js";
import { renderQuery, runQuery } from "./commands/query.js";
import { renderValidate, runValidate } from "./commands/validate.js";
import { renderFill, runFill } from "./commands/fill.js";
import { runInit } from "./commands/init.js";
import { renderStats, runStats } from "./commands/stats.js";

const program = new Command();

program
  .name("dockg")
  .description(
    "Deterministic knowledge graphs derived from documentation frontmatter and formatting.",
  )
  .version(toolVersion(import.meta.url));

function fail(e: unknown): never {
  if (e instanceof DockgError) {
    console.error(pc.red(`dockg: ${e.message}`));
    process.exit(2);
  }
  throw e;
}

program
  .command("init")
  .description("Create a starter dockg.config.yaml in the current directory")
  .action(() => {
    try {
      console.log(`Created ${runInit()}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("build")
  .description("Derive the knowledge graph and write deterministic Turtle")
  .argument("[globs...]", "Input globs (default: config inputs)")
  .option("-c, --config <path>", "Path to dockg.config.yaml")
  .option("-o, --out <path>", "Output .ttl path (default: config out)")
  .action(async (globs: string[], opts: { config?: string; out?: string }) => {
    try {
      const result = await runBuild({
        globs,
        config: opts.config,
        out: opts.out,
      });
      // Warnings go to stderr so stdout stays the machine-readable summary;
      // a degraded build is still a successful one, so the exit code is 0.
      for (const warning of result.warnings) {
        console.error(pc.yellow(`dockg: ${warning}`));
      }
      console.log(
        `Wrote ${result.outPath} (${result.docs} docs, ${result.quads} triples)`,
      );
    } catch (e) {
      fail(e);
    }
  });

program
  .command("check")
  .description(
    "Validate the built graph against the dockg SHACL shapes (violations exit 1)",
  )
  .option("-c, --config <path>", "Path to dockg.config.yaml")
  .option("-g, --graph <path>", "Graph .ttl path (default: config out)")
  .option(
    "--shapes <paths...>",
    "Shapes .ttl files (default: config check.shapes, then bundled)",
  )
  .option("-f, --format <format>", "Output format: pretty | json", "pretty")
  .action(
    async (opts: {
      config?: string;
      graph?: string;
      shapes?: string[];
      format: string;
    }) => {
      try {
        const report = await runCheck(opts);
        console.log(renderCheck(report, opts.format as "pretty" | "json"));
        process.exitCode = report.exitCode;
      } catch (e) {
        fail(e);
      }
    },
  );

program
  .command("validate")
  .description("Check docs are KG-ready (frontmatter validated via docmeta)")
  .argument("[globs...]", "Input globs (default: config inputs)")
  .option("-c, --config <path>", "Path to dockg.config.yaml")
  .option("-f, --format <format>", "Output format: pretty | json", "pretty")
  .action(
    async (globs: string[], opts: { config?: string; format: string }) => {
      try {
        const result = await runValidate({ globs, config: opts.config });
        console.log(renderValidate(result, opts.format as "pretty" | "json"));
        process.exitCode = result.exitCode;
      } catch (e) {
        fail(e);
      }
    },
  );

program
  .command("fill")
  .description(
    "Propose SKOS `kg:` frontmatter fields with an LLM and write them back",
  )
  .argument("[globs...]", "Input globs (default: config inputs)")
  .option("-c, --config <path>", "Path to dockg.config.yaml")
  .option("-f, --format <format>", "Output format: pretty | json", "pretty")
  .option("--dry-run", "Report proposals without writing files")
  .option("--force", "Overwrite human-set kg fields")
  .option("--no-cache", "Bypass the proposal cache")
  .option("--no-validate-graph", "Skip the SHACL graph guardrail on proposals")
  .option("--max-cost <usd>", "Stop proposing past this cost", (v) =>
    Number.parseFloat(v),
  )
  .option(
    "--provider <name>",
    "Provider: anthropic | openai | claude-cli | mock",
  )
  .option("--model <model>", "Model override")
  .action(async (globs: string[], opts: Record<string, unknown>) => {
    try {
      const report = await runFill({
        globs,
        config: opts.config as string | undefined,
        dryRun: opts.dryRun as boolean | undefined,
        force: opts.force as boolean | undefined,
        noCache: opts.cache === false,
        noValidateGraph: opts.validateGraph === false,
        maxCost: opts.maxCost as number | undefined,
        provider: opts.provider as string | undefined,
        model: opts.model as string | undefined,
      });
      console.log(renderFill(report, opts.format as "pretty" | "json"));
      process.exitCode = report.exitCode;
    } catch (e) {
      fail(e);
    }
  });

program
  .command("query")
  .description(
    "Match triple patterns against the built graph (omit a term for wildcard)",
  )
  .option("-s, --s <term>", "Subject IRI or prefixed name")
  .option("-p, --p <term>", "Predicate IRI or prefixed name")
  .option("-o, --o <term>", "Object IRI, prefixed name, or literal value")
  .option("-c, --config <path>", "Path to dockg.config.yaml")
  .option("-g, --graph <path>", "Graph .ttl path (default: config out)")
  .option("-f, --format <format>", "Output format: pretty | json", "pretty")
  .action(
    (opts: {
      s?: string;
      p?: string;
      o?: string;
      config?: string;
      graph?: string;
      format: string;
    }) => {
      try {
        const result = runQuery(opts);
        console.log(renderQuery(result, opts.format as "pretty" | "json"));
      } catch (e) {
        fail(e);
      }
    },
  );

program
  .command("stats")
  .description("Summarize the built graph: counts, orphans, broken links, hubs")
  .option("-c, --config <path>", "Path to dockg.config.yaml")
  .option("-g, --graph <path>", "Graph .ttl path (default: config out)")
  .option("-f, --format <format>", "Output format: pretty | json", "pretty")
  .option("--check", "Exit 1 when broken internal links exist")
  .option("--top <n>", "How many most-connected docs to list", (v) =>
    Number.parseInt(v, 10),
  )
  .action(
    (opts: {
      config?: string;
      graph?: string;
      format: string;
      check?: boolean;
      top?: number;
    }) => {
      try {
        const report = runStats(opts);
        console.log(renderStats(report, opts.format as "pretty" | "json"));
        process.exitCode = report.exitCode;
      } catch (e) {
        fail(e);
      }
    },
  );

program.parse();
