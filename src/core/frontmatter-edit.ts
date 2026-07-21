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

/** Set `value` on the kg map; arrays render flow-style: [a, b]. */
function setField(doc: Document, kg: YAMLMap, field: string, value: unknown): void {
  const node = doc.createNode(value);
  if (node instanceof YAMLSeq) node.flow = true;
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
  options: { force?: boolean } = {},
): KgApplyResult {
  const entries = Object.entries(values).filter(
    ([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0),
  );
  if (entries.length === 0) return { content, applied: [], skipped: [] };

  const split = splitYamlFrontmatter(content, path);

  if (split === null) {
    // No frontmatter — create a block holding only the kg key.
    const eol: "\n" | "\r\n" = content.includes("\r\n") ? "\r\n" : "\n";
    const doc = new Document({ kg: Object.fromEntries(entries) });
    const kg = doc.get("kg", true);
    if (isMap(kg)) {
      for (const item of kg.items) {
        if (item.value instanceof YAMLSeq) item.value.flow = true;
      }
    }
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
  for (const [field, value] of entries) {
    if (kgMap.has(field) && !options.force) {
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
