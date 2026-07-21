import { describe, expect, it } from "vitest";
import { applyKgFields, existingKgFields } from "../../src/core/frontmatter-edit.js";

const BODY = "\n# Title\n\nBody text stays untouched.\n";

describe("applyKgFields", () => {
  it("adds a kg map to existing frontmatter, preserving body byte-for-byte", () => {
    const content = `---\ntitle: T\ntags: [x] # keep me\n---${BODY}`;
    const result = applyKgFields(content, "a.md", {
      prefLabel: "Config",
      subjects: ["reference"],
    });
    expect(result.applied.sort()).toEqual(["prefLabel", "subjects"]);
    expect(result.content.endsWith(BODY)).toBe(true);
    expect(result.content).toContain("# keep me"); // YAML comment survives
    expect(result.content).toContain("prefLabel: Config");
    expect(result.content).toContain("subjects: [ reference ]");
  });

  it("creates a frontmatter block when the file has none", () => {
    const content = "# No frontmatter\n";
    const result = applyKgFields(content, "a.md", { prefLabel: "Topic" });
    expect(result.content.startsWith("---\n")).toBe(true);
    expect(result.content).toContain("kg:");
    expect(result.content).toContain("prefLabel: Topic");
    expect(result.content.endsWith("# No frontmatter\n")).toBe(true);
  });

  it("preserves human-set fields unless forced", () => {
    const content = `---\nkg:\n  prefLabel: Human Choice\n---${BODY}`;
    const soft = applyKgFields(content, "a.md", { prefLabel: "Model Choice" });
    expect(soft.applied).toEqual([]);
    expect(soft.skipped).toEqual(["prefLabel"]);
    expect(soft.content).toBe(content); // untouched

    const forced = applyKgFields(
      content,
      "a.md",
      { prefLabel: "Model Choice" },
      { force: true },
    );
    expect(forced.applied).toEqual(["prefLabel"]);
    expect(forced.content).toContain("prefLabel: Model Choice");
  });

  it("keeps CRLF line endings", () => {
    const content = "---\r\ntitle: Win\r\n---\r\n\r\n# H\r\n";
    const result = applyKgFields(content, "a.md", { prefLabel: "Topic" });
    expect(result.content).toContain("\r\n");
    expect(result.content).not.toMatch(/(?<!\r)\n.*prefLabel/);
    expect(result.content.endsWith("# H\r\n")).toBe(true);
  });

  it("drops empty and null values", () => {
    const content = `---\ntitle: T\n---${BODY}`;
    const result = applyKgFields(content, "a.md", {
      prefLabel: "X",
      altLabels: [],
      related: null,
    });
    expect(result.applied).toEqual(["prefLabel"]);
    expect(result.content).not.toContain("altLabels");
  });
});

describe("existingKgFields", () => {
  it("lists fields present on the kg map", () => {
    const content = `---\nkg:\n  prefLabel: X\n  subjects: [a]\n---\n`;
    expect(existingKgFields(content).sort()).toEqual(["prefLabel", "subjects"]);
  });

  it("returns [] without frontmatter or kg key", () => {
    expect(existingKgFields("# nothing\n")).toEqual([]);
    expect(existingKgFields("---\ntitle: T\n---\n")).toEqual([]);
  });
});
