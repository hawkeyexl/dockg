/**
 * `dockg export` — reserialize the built graph into a consumer format. Reads
 * the graph the same way `stats`/`check` do (loadGraph over the config `out`,
 * missing graph → exit 2) and writes a deterministic rendering. `jsonld` ships
 * now; `iirds` is a recognized flag value that fails with a Phase-6b pointer so
 * the surface is stable while that serializer is built out separately.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Store } from "n3";
import { DockgError } from "../types.js";
import { loadConfig } from "../core/config.js";
import type { Quad, Term } from "../core/derive.js";
import { emitJsonLd } from "../core/emit-jsonld.js";
import { loadGraph } from "../core/load.js";
import { NS } from "../core/vocab.js";

const XSD_STRING = `${NS.xsd}string`;

export type ExportFormat = "jsonld" | "iirds";

export interface ExportOptions {
  config?: string;
  /** Graph .ttl path (default: config `out`). */
  graph?: string;
  format: ExportFormat;
  /** Output path (default: the graph path with the format's extension). */
  out?: string;
  cwd?: string;
}

export interface ExportResult {
  outPath: string;
  format: ExportFormat;
  /** Number of subject nodes in the emitted graph. */
  nodes: number;
}

/** File extension each format writes to. */
const EXTENSION: Record<ExportFormat, string> = {
  jsonld: ".jsonld",
  iirds: ".zip",
};

/** Convert an in-memory N3 store back to dockg's internal quad shape. */
function storeToQuads(store: Store): Quad[] {
  return store.getQuads(null, null, null, null).map((q) => {
    const o = q.object;
    let term: Term;
    if (o.termType === "Literal") {
      const dt = o.datatype.value;
      term =
        dt && dt !== XSD_STRING
          ? { kind: "literal", value: o.value, datatype: dt }
          : { kind: "literal", value: o.value };
    } else {
      term = { kind: "iri", value: o.value };
    }
    return { s: q.subject.value, p: q.predicate.value, o: term };
  });
}

/** Replace a path's extension (or append one) with `.jsonld`-style ext. */
function withExtension(path: string, ext: string): string {
  return path.replace(/\.[^./\\]*$/, "") + ext;
}

export async function runExport(opts: ExportOptions): Promise<ExportResult> {
  const cwd = opts.cwd ?? process.cwd();

  if (opts.format === "iirds") {
    throw new DockgError(
      "export --format iirds is not yet supported (Phase 6b).",
    );
  }
  if (opts.format !== "jsonld") {
    throw new DockgError(
      `Unknown export format: ${opts.format} (expected: jsonld).`,
    );
  }

  const config = loadConfig(opts.config, cwd);
  const graphPath = resolve(cwd, opts.graph ?? config.out);
  const store = loadGraph(graphPath);
  const quads = storeToQuads(store);

  const serialized = emitJsonLd(quads);
  const nodes = new Set(quads.map((q) => q.s)).size;

  const outPath = opts.out
    ? resolve(cwd, opts.out)
    : withExtension(graphPath, EXTENSION[opts.format]);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, serialized, "utf8");

  return { outPath, format: opts.format, nodes };
}
