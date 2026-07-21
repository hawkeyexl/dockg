/** dockg CLI entry point. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import { DockgError } from "./types.js";

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

program.parse();
