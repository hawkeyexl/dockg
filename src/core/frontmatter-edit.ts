/**
 * Surgical YAML edits (ported from docevals). Only the frontmatter block is
 * re-serialized via the `yaml` Document API — the page body is carried over
 * byte-for-byte, and untouched YAML keeps its comments and ordering. When a
 * file has no frontmatter, a new block holding only the `kg` key is created.
 * YAML frontmatter only; TOML/JSON frontmatter cannot be edited in place.
 */
import { Document, YAMLMap, YAMLSeq, isMap, parseDocument } from "yaml";
import { DockgError } from "../types.js";

interface Split {
  /** The opening fence line including its newline (plus any BOM). */
  open: string;
  /** Raw YAML between the fences. */
  block: string;
  /** Everything from the closing fence to EOF, byte-identical. */
  suffix: string;
  /** Line ending style of the file. */
  eol: "\n" | "\r\n";
}

/**
 * What kind of frontmatter block a file opens with. docmeta reads TOML (+++)
 * and JSON (;;;) fences too, but only YAML is editable in place — callers
 * must not treat "unsupported" as "absent" or they will stack a second block.
 */
export function frontmatterKind(content: string): "yaml" | "unsupported" | "none" {
  const body = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  if (/^---(\r?\n)/.test(body)) return "yaml";
  if (/^(\+\+\+|;;;)(\r?\n)/.test(body)) return "unsupported";
  return "none";
}

function splitYamlFrontmatter(content: string, path: string): Split | null {
  const bom = content.charCodeAt(0) === 0xfeff ? content[0]! : "";
  const body = bom ? content.slice(1) : content;
  const openMatch = /^---(\r?\n)/.exec(body);
  if (!openMatch) return null;
  const eol: "\n" | "\r\n" = openMatch[1] === "\r\n" ? "\r\n" : "\n";
  const lines = body.split(/(?<=\n)/); // keep line endings
  let offset = lines[0]!.length;
  for (let i = 1; i < lines.length; i++) {
    const stripped = lines[i]!.replace(/\r?\n$/, "");
    if (stripped === "---" || stripped === "...") {
      const blockEnd = offset;
      return {
        open: bom + lines[0]!,
        block: body.slice(lines[0]!.length, blockEnd),
        suffix: body.slice(blockEnd),
        eol,
      };
    }
    offset += lines[i]!.length;
  }
  throw new DockgError(`${path}: unterminated frontmatter block`);
}

export interface KgApplyResult {
  content: string;
  /** Fields written. */
  applied: string[];
  /** Fields left alone because a human-set value exists (and no force). */
  skipped: string[];
}

/** Render every sequence under `node` flow-style: [a, b]. */
function flowSeqs(node: unknown): void {
  if (node instanceof YAMLSeq) {
    node.flow = true;
    for (const item of node.items) flowSeqs(item);
  } else if (node instanceof YAMLMap) {
    for (const item of node.items) flowSeqs(item.value);
  }
}

/** Set `value` on the kg map; arrays (incl. nested) render flow-style. */
function setField(doc: Document, kg: YAMLMap, field: string, value: unknown): void {
  const node = doc.createNode(value);
  flowSeqs(node);
  kg.set(field, node);
}

/**
 * Apply proposed values to the top-level `kg` map of a doc's frontmatter.
 * Existing field values win unless `force`. The body after the closing fence
 * is byte-identical to the input.
 */
export function applyKgFields(
  content: string,
  path: string,
  values: Record<string, unknown>,
  options: { force?: boolean; alwaysOverwrite?: string[] } = {},
): KgApplyResult {
  const entries = Object.entries(values).filter(
    ([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0),
  );
  if (entries.length === 0) return { content, applied: [], skipped: [] };

  if (frontmatterKind(content) === "unsupported") {
    throw new DockgError(
      `${path}: only YAML frontmatter can be edited (found a TOML/JSON fence)`,
    );
  }

  const split = splitYamlFrontmatter(content, path);

  if (split === null) {
    // No frontmatter — create a block holding only the kg key.
    const eol: "\n" | "\r\n" = content.includes("\r\n") ? "\r\n" : "\n";
    const doc = new Document({ kg: Object.fromEntries(entries) });
    const kg = doc.get("kg", true);
    if (isMap(kg)) flowSeqs(kg);
    let block = doc.toString();
    if (eol === "\r\n") block = block.replace(/(?<!\r)\n/g, "\r\n");
    return {
      content: `---${eol}${block}---${eol}${eol}${content}`,
      applied: entries.map(([k]) => k),
      skipped: [],
    };
  }

  const doc = parseDocument(split.block);
  if (doc.errors.length > 0) {
    throw new DockgError(
      `${path}: cannot edit frontmatter — ${doc.errors[0]?.message ?? "parse error"}`,
    );
  }

  let kg = doc.get("kg", true);
  if (kg !== undefined && !isMap(kg)) {
    throw new DockgError(`${path}: frontmatter key "kg" is not a map`);
  }
  if (kg === undefined) {
    kg = doc.createNode({});
    doc.set("kg", kg);
  }
  const kgMap = kg as YAMLMap;

  const applied: string[] = [];
  const skipped: string[] = [];
  const alwaysOverwrite = new Set(options.alwaysOverwrite ?? []);
  for (const [field, value] of entries) {
    if (kgMap.has(field) && !options.force && !alwaysOverwrite.has(field)) {
      skipped.push(field);
      continue;
    }
    setField(doc, kgMap, field, value);
    applied.push(field);
  }

  if (applied.length === 0) {
    return { content, applied, skipped };
  }

  let newBlock = doc.toString();
  if (split.eol === "\r\n") newBlock = newBlock.replace(/(?<!\r)\n/g, "\r\n");
  return { content: split.open + newBlock + split.suffix, applied, skipped };
}

export interface ProvenanceEntry {
  generatedBy: string;
  fields: string[];
}

/**
 * The doc's existing kg.provenance entries (for merging across runs).
 * Schema 0.4 stores an array (one entry per model); the earlier
 * single-object form is normalized into a one-entry array.
 */
export function existingProvenance(content: string): ProvenanceEntry[] {
  const split = splitYamlFrontmatter(content, "");
  if (split === null) return [];
  const doc = parseDocument(split.block);
  if (doc.errors.length > 0) return [];
  const plain = (doc.toJS() as { kg?: { provenance?: unknown } } | null)?.kg?.provenance;
  const raw = Array.isArray(plain) ? plain : plain ? [plain] : [];
  const entries: ProvenanceEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record["generatedBy"] !== "string") continue;
    entries.push({
      generatedBy: record["generatedBy"],
      fields: Array.isArray(record["fields"])
        ? record["fields"].filter((f): f is string => typeof f === "string")
        : [],
    });
  }
  return entries;
}

/** Fields already present on the doc's `kg` map ([] when none). */
export function existingKgFields(content: string): string[] {
  const split = splitYamlFrontmatter(content, "");
  if (split === null) return [];
  const doc = parseDocument(split.block);
  if (doc.errors.length > 0) return [];
  const kg = doc.get("kg", true);
  if (!isMap(kg)) return [];
  return kg.items
    .map((item) => String((item.key as { value?: unknown })?.value ?? ""))
    .filter((k) => k.length > 0);
}
