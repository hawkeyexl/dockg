import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, parseConfig } from "../../src/core/config.js";
import { DockgError } from "../../src/types.js";

describe("parseConfig", () => {
  it("applies defaults for a minimal config", () => {
    const c = parseConfig("version: 1\n", "/tmp/dockg.config.yaml");
    expect(c.baseIri).toBe("urn:dockg:");
    expect(c.inputs).toEqual(["**/*.md"]);
    expect(c.exclude).toEqual(["**/node_modules/**"]);
    expect(c.out).toBe("kg/graph.ttl");
    expect(c.build.derive).toEqual([
      "frontmatter",
      "sections",
      "links",
      "tags",
      "images",
      "code",
      "provenance",
    ]);
    // empty = use the schema bundled with dockg (schemas/frontmatter-0.2.json)
    expect(c.validate.schemas).toEqual([]);
    // empty = use the shapes bundled with dockg (shapes/dockg-0.1.ttl)
    expect(c.check.shapes).toEqual([]);
    expect(c.fill.validateGraph).toBe(true);
    // Opinionated defaults (ADR 01009/01010): hermetic provenance ships on;
    // "auto" runs git where it can and degrades with a warning where it can't.
    expect(c.provenance).toEqual({ git: "auto", qualified: true });
    expect(c.fill.writeProvenance).toBe(true);
    expect(c.fill.provider).toBe("anthropic");
    expect(c.fill.temperature).toBe(0);
    expect(c.fill.maxCostUsd).toBe(5);
    expect(c.fill.cacheDir).toBe(".dockg/cache");
    expect(c.fill.fields).toEqual([
      "prefLabel",
      "altLabels",
      "related",
      "subjects",
    ]);
  });

  it("normalizes baseIri with a trailing slash", () => {
    const c = parseConfig(
      "version: 1\nbaseIri: https://example.com/kg\n",
      "/tmp/dockg.config.yaml",
    );
    expect(c.baseIri).toBe("https://example.com/kg/");
  });

  it("rejects unknown top-level keys", () => {
    expect(() =>
      parseConfig("version: 1\nbogus: true\n", "/tmp/dockg.config.yaml"),
    ).toThrow(DockgError);
  });

  it("rejects a wrong version", () => {
    expect(() => parseConfig("version: 2\n", "/tmp/dockg.config.yaml")).toThrow(
      DockgError,
    );
  });

  it("rejects invalid YAML", () => {
    expect(() =>
      parseConfig("version: [1\n", "/tmp/dockg.config.yaml"),
    ).toThrow(DockgError);
  });

  it("parses check.shapes and fill.validateGraph overrides", () => {
    const c = parseConfig(
      "version: 1\ncheck:\n  shapes: [my-shapes.ttl]\nfill:\n  validateGraph: false\n",
      "/tmp/dockg.config.yaml",
    );
    expect(c.check.shapes).toEqual(["my-shapes.ttl"]);
    expect(c.fill.validateGraph).toBe(false);
  });

  it("rejects unknown check keys", () => {
    expect(() =>
      parseConfig(
        "version: 1\ncheck:\n  bogus: true\n",
        "/tmp/dockg.config.yaml",
      ),
    ).toThrow(DockgError);
  });

  it("rejects an unknown fill provider", () => {
    expect(() =>
      parseConfig(
        "version: 1\nfill:\n  provider: gemini\n",
        "/tmp/dockg.config.yaml",
      ),
    ).toThrow(DockgError);
  });

  it("parses route mappings with defaults and normalization", () => {
    const c = parseConfig(
      "version: 1\nroutes:\n  - basePath: /docs/\n    root: docs/pages/\n",
      "/tmp/dockg.config.yaml",
    );
    expect(c.routes).toEqual([
      {
        basePath: "/docs",
        root: "docs/pages",
        extensions: [".md", ".mdx"],
        indexFiles: ["index", "README"],
      },
    ]);
  });

  it("defaults routes to an empty list and requires root per mapping", () => {
    expect(parseConfig("version: 1\n", "/tmp/c.yaml").routes).toEqual([]);
    expect(() =>
      parseConfig("version: 1\nroutes:\n  - basePath: /docs\n", "/tmp/c.yaml"),
    ).toThrow(DockgError);
  });

  it("parses fill.writeProvenance overrides", () => {
    const c = parseConfig(
      "version: 1\nfill:\n  writeProvenance: false\n",
      "/tmp/dockg.config.yaml",
    );
    expect(c.fill.writeProvenance).toBe(false);
  });

  it("parses provenance flags and rejects the retired gitTime key", () => {
    const c = parseConfig(
      "version: 1\nprovenance:\n  git: true\n  qualified: true\n",
      "/tmp/dockg.config.yaml",
    );
    expect(c.provenance).toEqual({ git: true, qualified: true });
    expect(() =>
      parseConfig(
        "version: 1\nprovenance:\n  gitTime: true\n",
        "/tmp/dockg.config.yaml",
      ),
    ).toThrow(DockgError);
  });

  it("parses all three provenance.git modes and rejects other strings", () => {
    for (const mode of ["auto", true, false] as const) {
      const c = parseConfig(
        `version: 1\nprovenance:\n  git: ${JSON.stringify(mode)}\n`,
        "/tmp/dockg.config.yaml",
      );
      expect(c.provenance.git).toBe(mode);
    }
    expect(() =>
      parseConfig(
        "version: 1\nprovenance:\n  git: maybe\n",
        "/tmp/dockg.config.yaml",
      ),
    ).toThrow(DockgError);
  });

  it("rejects an unknown derive source", () => {
    expect(() =>
      parseConfig(
        "version: 1\nbuild:\n  derive: [frontmatter, telepathy]\n",
        "/tmp/dockg.config.yaml",
      ),
    ).toThrow(DockgError);
  });
});

describe("loadConfig", () => {
  it("falls back to defaults when no config file exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "dockg-config-"));
    const c = loadConfig(undefined, dir);
    expect(c.baseIri).toBe("urn:dockg:");
  });

  it("loads dockg.config.yaml from cwd", () => {
    const dir = mkdtempSync(join(tmpdir(), "dockg-config-"));
    writeFileSync(
      join(dir, "dockg.config.yaml"),
      "version: 1\nout: graph.ttl\n",
    );
    const c = loadConfig(undefined, dir);
    expect(c.out).toBe("graph.ttl");
  });

  it("throws for an explicit missing path", () => {
    expect(() => loadConfig("Z:/nope/dockg.config.yaml")).toThrow(DockgError);
  });
});
