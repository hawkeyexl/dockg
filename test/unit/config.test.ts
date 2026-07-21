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
    ]);
    expect(c.validate.schemas).toEqual(["dockg:frontmatter:0.1"]);
    expect(c.fill.provider).toBe("anthropic");
    expect(c.fill.temperature).toBe(0);
    expect(c.fill.maxCostUsd).toBe(5);
    expect(c.fill.cacheDir).toBe(".dockg/cache");
    expect(c.fill.fields).toEqual(["prefLabel", "altLabels", "related", "subjects"]);
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
    expect(() => parseConfig("version: [1\n", "/tmp/dockg.config.yaml")).toThrow(
      DockgError,
    );
  });

  it("rejects an unknown fill provider", () => {
    expect(() =>
      parseConfig("version: 1\nfill:\n  provider: gemini\n", "/tmp/dockg.config.yaml"),
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
    writeFileSync(join(dir, "dockg.config.yaml"), "version: 1\nout: graph.ttl\n");
    const c = loadConfig(undefined, dir);
    expect(c.out).toBe("graph.ttl");
  });

  it("throws for an explicit missing path", () => {
    expect(() => loadConfig("Z:/nope/dockg.config.yaml")).toThrow(DockgError);
  });
});
