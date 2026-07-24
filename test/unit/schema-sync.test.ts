import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { bundledSchemaPath, bundledShapesPath } from "../../src/core/pkg.js";
import { FIELD_SCHEMAS } from "../../src/llm/prompt.js";
import { COVERAGE_FIELD_NAMES } from "../../src/core/coverage.js";
import {
  SOFTWARE_LIFECYCLE_IRIS,
  SOFTWARE_SUBJECT_IRIS,
  TOPIC_TYPE_IRIS,
} from "../../src/core/iirds.js";

/**
 * Drift guard: fill's proposal field schemas must stay a subset of the
 * bundled frontmatter schema's kg properties, or `dockg fill` writes
 * frontmatter that `dockg validate` rejects.
 */
describe("prompt FIELD_SCHEMAS ↔ bundled schema", () => {
  const schema = JSON.parse(
    readFileSync(bundledSchemaPath(import.meta.url), "utf8"),
  ) as {
    properties: { kg: { properties: Record<string, { type?: unknown }> } };
    $defs?: {
      provenanceEntry?: {
        properties?: { fields?: { items?: { enum?: string[] } } };
      };
    };
  };
  const kgProperties = schema.properties.kg.properties;

  it("every fillable field exists in the bundled schema with a matching type", () => {
    for (const [field, fieldSchema] of Object.entries(FIELD_SCHEMAS)) {
      expect(
        kgProperties,
        `schema is missing fill field "${field}"`,
      ).toHaveProperty(field);
      expect(kgProperties[field]!.type).toBe(
        (fieldSchema as { type: unknown }).type,
      );
    }
  });

  it("the provenance fields enum covers every fillable field", () => {
    const allowed =
      schema.$defs?.provenanceEntry?.properties?.fields?.items?.enum ?? [];
    for (const field of Object.keys(FIELD_SCHEMAS)) {
      expect(allowed, `provenance enum is missing "${field}"`).toContain(field);
    }
  });
});

/**
 * Drift guard: the coverage field list and the config schema's per-field
 * coverageThreshold map must name exactly the same fields, or a threshold set
 * in config would silently gate nothing (or Ajv would reject a valid field).
 */
describe("COVERAGE_FIELD_NAMES ↔ config schema", () => {
  const configSchema = JSON.parse(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        "src",
        "core",
        "config-schema.json",
      ),
      "utf8",
    ),
  ) as {
    properties: {
      stats: {
        properties: {
          coverageThreshold: {
            anyOf: Array<{ properties?: Record<string, unknown> }>;
          };
        };
      };
    };
  };

  it("the per-field threshold map names exactly the measured fields", () => {
    const mapForm =
      configSchema.properties.stats.properties.coverageThreshold.anyOf.find(
        (s) => s.properties,
      );
    expect(mapForm, "no object form in coverageThreshold anyOf").toBeDefined();
    expect(Object.keys(mapForm!.properties!).sort()).toEqual(
      [...COVERAGE_FIELD_NAMES].sort(),
    );
  });
});

/**
 * Drift guard: each iiRDS frontmatter enum in the bundled schema must name
 * exactly the keys of its src/core/iirds.ts map, or a valid frontmatter value
 * would derive no triple (or Ajv would reject a mapped one). ADR 01012.
 */
describe("iiRDS enums ↔ bundled schema", () => {
  type Field = { enum?: string[]; items?: { enum?: string[] } };
  const parsed = JSON.parse(
    readFileSync(bundledSchemaPath(import.meta.url), "utf8"),
  ) as {
    properties: { kg: { properties: Record<string, Field> } };
    $defs: { sectionMetadata: { properties: Record<string, Field> } };
  };
  const kg = parsed.properties.kg.properties;
  const sec = parsed.$defs.sectionMetadata.properties;

  // Both the document-level fields and the section-level (sectionMetadata)
  // fields are pinned to the same iirds.ts maps, so they cannot diverge from
  // the source of truth — or from each other. ADR 01012/01013.
  it.each([
    ["kg.topicType", () => kg.topicType!.enum, TOPIC_TYPE_IRIS],
    [
      "kg.softwareLifecyclePhase",
      () => kg.softwareLifecyclePhase!.items!.enum,
      SOFTWARE_LIFECYCLE_IRIS,
    ],
    [
      "kg.softwareSubject",
      () => kg.softwareSubject!.items!.enum,
      SOFTWARE_SUBJECT_IRIS,
    ],
    ["section.topicType", () => sec.topicType!.enum, TOPIC_TYPE_IRIS],
    [
      "section.softwareLifecyclePhase",
      () => sec.softwareLifecyclePhase!.items!.enum,
      SOFTWARE_LIFECYCLE_IRIS,
    ],
    [
      "section.softwareSubject",
      () => sec.softwareSubject!.items!.enum,
      SOFTWARE_SUBJECT_IRIS,
    ],
  ] as const)("%s enum matches its IRI map keys", (_name, getEnum, map) => {
    expect([...(getEnum() ?? [])].sort()).toEqual(Object.keys(map).sort());
  });
});

/**
 * Drift guard: the README names the bundled-default schema and shapes files as
 * a user-facing fact. Each bundled-path bump left stale version numbers behind
 * (caught twice in review); pin the current-state README references to the
 * actual bundled filenames so a future bump fails here instead of shipping a
 * wrong doc.
 */
describe("README bundled-default references ↔ pkg.ts", () => {
  const readme = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "README.md"),
    "utf8",
  );
  const schemaFile = basename(bundledSchemaPath(import.meta.url));
  const shapesFile = basename(bundledShapesPath(import.meta.url));

  it("names the current bundled schema file", () => {
    expect(readme).toContain(`schemas/${schemaFile}`);
  });

  it("names the current bundled shapes file", () => {
    expect(readme).toContain(`shapes/${shapesFile}`);
  });
});
