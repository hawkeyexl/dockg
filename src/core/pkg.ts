/**
 * Locate the package root from a compiled (dist/*) or source (src/**) file,
 * for assets that ship with the package: package.json, schemas/.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Package root for a module URL (dist is one level down, src/* two). */
export function packageRoot(moduleUrl: string): string {
  const here = dirname(fileURLToPath(moduleUrl));
  for (const candidate of [join(here, ".."), join(here, "..", "..")]) {
    if (existsSync(join(candidate, "package.json"))) return candidate;
  }
  return here;
}

/** dockg's own version — stamped on the build agent by the provenance source. */
export function toolVersion(moduleUrl: string): string {
  const pkg = join(packageRoot(moduleUrl), "package.json");
  if (!existsSync(pkg)) return "unknown";
  return (JSON.parse(readFileSync(pkg, "utf8")) as { version: string }).version;
}

/** Absolute path of the bundled frontmatter schema `dockg validate` defaults to. */
export function bundledSchemaPath(moduleUrl: string): string {
  return join(packageRoot(moduleUrl), "schemas", "frontmatter-0.4.json");
}
