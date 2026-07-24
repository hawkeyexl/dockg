/**
 * Fill prompt and proposal schema. The proposal schema is restricted to the
 * fields being requested for the specific doc, so a provider physically
 * cannot propose fields the run should not touch. Alongside the field values,
 * the model returns a per-field `confidence` (0..1) and `reasoning`; the fill
 * command gates on confidence (ADR 01015).
 */
import type { FillField } from "../core/config.js";
import type { DocModel } from "../types.js";

/** Bump when the prompt changes — invalidates the fill cache. */
export const PROMPT_VERSION = 2;

const TOPIC_TYPES = [
  "task",
  "concept",
  "reference",
  "learning",
  "troubleshooting",
  "form",
];
const LIFECYCLE_PHASES = [
  "administration",
  "customization",
  "update",
  "deployment",
  "integration",
  "deinstallation",
];
const SOFTWARE_SUBJECTS = ["architecture", "interface", "system-requirement"];

const labelArray = (description: string) => ({
  type: "array",
  items: { type: "string", minLength: 1 },
  uniqueItems: true,
  description,
});
const enumArray = (values: string[], description: string) => ({
  type: "array",
  items: { enum: values },
  uniqueItems: true,
  description,
});

/** Exported for the schema-sync drift guard (test/unit/schema-sync.test.ts). */
export const FIELD_SCHEMAS: Record<FillField, Record<string, unknown>> = {
  prefLabel: {
    type: "string",
    minLength: 1,
    description:
      "Preferred label of the single concept this document is primarily about.",
  },
  altLabels: labelArray(
    "Alternative labels: synonyms, abbreviations, common variants.",
  ),
  broader: labelArray("Labels of broader (parent) concepts."),
  narrower: labelArray("Labels of narrower (child) concepts."),
  related: labelArray("Labels of associatively related concepts."),
  subjects: labelArray("Subject labels for the document, like tags."),
  topicType: {
    enum: TOPIC_TYPES,
    description:
      "iiRDS topic type — the functional kind of this page. Only if the page clearly fits one.",
  },
  appliesTo: labelArray(
    "Product/variant names this page applies to. ONLY names the text explicitly states; never guess product names.",
  ),
  softwareLifecyclePhase: enumArray(
    LIFECYCLE_PHASES,
    "Software lifecycle phases this page covers, only if clearly evidenced.",
  ),
  softwareSubject: enumArray(
    SOFTWARE_SUBJECTS,
    "Software information subjects this page is about, only if clearly evidenced.",
  ),
  notApplicableTo: labelArray(
    "Product/variant names the text EXPLICITLY says this page does NOT apply to. Only with explicit textual evidence.",
  ),
  notSoftwareSubject: enumArray(
    SOFTWARE_SUBJECTS,
    "Software subjects the text EXPLICITLY says this page is NOT about. Only with explicit textual evidence.",
  ),
};

export function proposalSchema(fields: FillField[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const confidence: Record<string, unknown> = {};
  const reasoning: Record<string, unknown> = {};
  for (const field of fields) {
    properties[field] = FIELD_SCHEMAS[field];
    confidence[field] = { type: "number", minimum: 0, maximum: 1 };
    reasoning[field] = { type: "string" };
  }
  properties["confidence"] = {
    type: "object",
    additionalProperties: false,
    properties: confidence,
    description:
      "For every field you propose a value for, a confidence 0..1 that the value is correct.",
  };
  properties["reasoning"] = {
    type: "object",
    additionalProperties: false,
    properties: reasoning,
    description:
      "For every field you propose a value for, a one-sentence justification grounded in the page text.",
  };
  return {
    type: "object",
    additionalProperties: false,
    properties,
  };
}

export const SYSTEM_PROMPT = [
  "You classify documentation pages into a controlled metadata vocabulary",
  "(SKOS concepts and iiRDS typing). For each requested field, first reason",
  "about whether the page's own text supports a value; propose a value only",
  "when it clearly does, and omit the field otherwise. Reuse the document's",
  "own terminology; do not invent concepts, product names, or classifications",
  "the document does not discuss.",
  "",
  "For every field you propose a value for, include a `confidence` (0..1) and",
  "a one-sentence `reasoning` grounded in the text. Score honestly and",
  "conservatively. Product/variant fields (appliesTo, notApplicableTo) and the",
  "negative fields (notApplicableTo, notSoftwareSubject) require EXPLICIT",
  "textual evidence — score them low and prefer to omit unless the page states",
  "them outright. A field with no value needs no confidence or reasoning.",
].join("\n");

const EXCERPT_CHARS = 2000;

export function buildUserPrompt(
  doc: DocModel,
  body: string,
  fields: FillField[],
): string {
  const title =
    (typeof doc.frontmatter["title"] === "string" &&
      doc.frontmatter["title"]) ||
    doc.firstH1 ||
    "(untitled)";
  const tags = doc.frontmatter["tags"] ?? doc.frontmatter["keywords"];
  const outline = doc.sections
    .map((s) => `${"  ".repeat(Math.max(0, s.level - 1))}- ${s.title}`)
    .join("\n");

  return [
    `Propose the following frontmatter fields for this documentation page, with per-field confidence and reasoning: ${fields.join(", ")}.`,
    "",
    `Path: ${doc.path}`,
    `Title: ${title}`,
    Array.isArray(tags) && tags.length > 0
      ? `Existing tags: ${tags.join(", ")}`
      : "",
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
