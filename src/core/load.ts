/** Load a built .ttl into an in-memory N3 store for query/stats. */
import { existsSync, readFileSync } from "node:fs";
import { Parser, Store } from "n3";
import { DockgError } from "../types.js";
import { NS, PREFIXES } from "./vocab.js";

export function loadGraph(ttlPath: string): Store {
  if (!existsSync(ttlPath)) {
    throw new DockgError(
      `Graph not found: ${ttlPath} — run \`dockg build\` first.`,
    );
  }
  const parser = new Parser({ format: "text/turtle" });
  let quads;
  try {
    quads = parser.parse(readFileSync(ttlPath, "utf8"));
  } catch (e) {
    throw new DockgError(
      `Failed to parse ${ttlPath}: ${e instanceof Error ? e.message : "parse error"}`,
    );
  }
  return new Store(quads);
}

/** Expand `dcterms:references`-style prefixed names to full IRIs; pass through the rest. */
export function expandTerm(input: string): string {
  const colon = input.indexOf(":");
  if (colon > 0) {
    const prefix = input.slice(0, colon);
    const ns = (NS as Record<string, string>)[prefix];
    if (ns) return `${ns}${input.slice(colon + 1)}`;
  }
  return input;
}

/** Compact a full IRI back to a prefixed name when a known namespace matches. */
export function compactIri(iri: string): string {
  for (const [prefix, ns] of PREFIXES) {
    if (iri.startsWith(ns) && iri.length > ns.length) {
      return `${prefix}:${iri.slice(ns.length)}`;
    }
  }
  return iri;
}
