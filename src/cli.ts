/** dockg CLI entry point. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import { DockgError } from "./types.js";
import { runBuild } from "./commands/build.js";

const pkg = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
    "utf8",
  ),
) as { version: string };

const program = new Command();

program
  .name("dockg")
  .description(
    "Deterministic knowledge graphs derived from documentation frontmatter and formatting.",
  )
  .version(pkg.version);

function fail(e: unknown): never {
  if (e instanceof DockgError) {
    console.error(pc.red(`dockg: ${e.message}`));
    process.exit(2);
  }
  throw e;
}

program
  .command("build")
  .description("Derive the knowledge graph and write deterministic Turtle")
  .argument("[globs...]", "Input globs (default: config inputs)")
  .option("-c, --config <path>", "Path to dockg.config.yaml")
  .option("-o, --out <path>", "Output .ttl path (default: config out)")
  .action((globs: string[], opts: { config?: string; out?: string }) => {
    try {
      const result = runBuild({ globs, config: opts.config, out: opts.out });
      console.log(
        `Wrote ${result.outPath} (${result.docs} docs, ${result.quads} triples)`,
      );
    } catch (e) {
      fail(e);
    }
  });

program.parse();
