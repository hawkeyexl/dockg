/**
 * Fill prompt and proposal schema. The proposal schema is restricted to the
 * fields being requested for the specific doc, so a provider physically
 * cannot propose fields the run should not touch.
 */
import type { FillField } from "../core/config.js";
import type { DocModel } from "../types.js";

/** Bump when the prompt changes — invalidates the fill cache. */
export const PROMPT_VERSION = 1;

/** Exported for the schema-sync drift guard (test/unit/schema-sync.test.ts). */
export const FIELD_SCHEMAS: Record<FillField, Record<string, unknown>> = {
  prefLabel: {
    type: "string",
    minLength: 1,
    description:
      "Preferred label of the single concept this document is primarily about.",
  },
  altLabels: {
    type: "array",
    items: { type: "string", minLength: 1 },
    uniqueItems: true,
    description: "Alternative labels: synonyms, abbreviations, common variants.",
  },
  broader: {
    type: "array",
    items: { type: "string", minLength: 1 },
    uniqueItems: true,
    description: "Labels of broader (parent) concepts.",
  },
  narrower: {
    type: "array",
    items: { type: "string", minLength: 1 },
    uniqueItems: true,
    description: "Labels of narrower (child) concepts.",
  },
  related: {
    type: "array",
    items: { type: "string", minLength: 1 },
    uniqueItems: true,
    description: "Labels of associatively related concepts.",
  },
  subjects: {
    type: "array",
    items: { type: "string", minLength: 1 },
    uniqueItems: true,
    description: "Subject labels for the document, like tags.",
  },
};

export function proposalSchema(fields: FillField[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const field of fields) properties[field] = FIELD_SCHEMAS[field];
  return {
    type: "object",
    additionalProperties: false,
    properties,
  };
}

export const SYSTEM_PROMPT = [
  "You classify documentation pages into a SKOS concept vocabulary.",
  "Propose values only when the document clearly supports them; omit any",
  "field you are not confident about. Labels are short noun phrases in the",
  "document's language, reusing the document's own terminology. Do not",
  "invent concepts that the document does not discuss.",
].join("\n");

const EXCERPT_CHARS = 2000;

export function buildUserPrompt(
  doc: DocModel,
  body: string,
  fields: FillField[],
): string {
  const title =
    (typeof doc.frontmatter["title"] === "string" && doc.frontmatter["title"]) ||
    doc.firstH1 ||
    "(untitled)";
  const tags = doc.frontmatter["tags"] ?? doc.frontmatter["keywords"];
  const outline = doc.sections
    .map((s) => `${"  ".repeat(Math.max(0, s.level - 1))}- ${s.title}`)
    .join("\n");

  return [
    `Propose the following SKOS frontmatter fields for this documentation page: ${fields.join(", ")}.`,
    "",
    `Path: ${doc.path}`,
    `Title: ${title}`,
    Array.isArray(tags) && tags.length > 0 ? `Existing tags: ${tags.join(", ")}` : "",
    "",
    "Heading outline:",
    outline || "(no headings)",
    "",
    "Body excerpt:",
    body.slice(0, EXCERPT_CHARS),
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}
