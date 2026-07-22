import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { bundledSchemaPath } from "../../src/core/pkg.js";
import { FIELD_SCHEMAS } from "../../src/llm/prompt.js";
import { COVERAGE_FIELD_NAMES } from "../../src/core/coverage.js";

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
