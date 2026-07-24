import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runFill } from "../../src/commands/fill.js";
import { MockProvider } from "../../src/llm/providers/mock.js";

function setup(files: Record<string, string>, config = ""): string {
  const dir = mkdtempSync(join(tmpdir(), "dockg-fill-"));
  writeFileSync(
    join(dir, "dockg.config.yaml"),
    `version: 1\ninputs: ["*.md"]\n${config}`,
  );
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

const PROPOSAL = {
  prefLabel: "Query Syntax",
  altLabels: ["query language"],
  related: ["Search Operators"],
  subjects: ["search"],
  // Above the 0.7 default gate so these fields are written (ADR 01015).
  confidence: {
    prefLabel: 0.95,
    altLabels: 0.9,
    related: 0.85,
    subjects: 0.9,
  },
};

/** Restrict fill to the four SKOS fields the pre-confidence tests assumed. */
const SKOS_FIELDS =
  "fill:\n  fields: [prefLabel, altLabels, related, subjects]\n";

/** A mock response for `json`, with high confidence auto-added for every
 *  value field so it clears the confidence gate (ADR 01015). */
function conf(json: Record<string, unknown>): {
  json: Record<string, unknown>;
} {
  const confidence: Record<string, number> = {};
  for (const k of Object.keys(json)) confidence[k] = 0.95;
  return { json: { ...json, confidence } };
}

describe("runFill", () => {
  it("writes proposed fields into frontmatter", async () => {
    const dir = setup({ "a.md": "---\ntitle: Query Syntax\n---\n\n# Q\n" });
    const provider = new MockProvider([{ json: PROPOSAL }]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    expect(report.exitCode).toBe(0);
    expect(report.results[0]).toMatchObject({ status: "filled" });
    const written = readFileSync(join(dir, "a.md"), "utf8");
    expect(written).toContain("prefLabel: Query Syntax");
    expect(written).toContain("related: [ Search Operators ]");
    expect(written.endsWith("# Q\n")).toBe(true);
  });

  it("--dry-run reports but does not write", async () => {
    const original = "---\ntitle: T\n---\n\n# Q\n";
    const dir = setup({ "a.md": original });
    const provider = new MockProvider([{ json: PROPOSAL }]);
    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      dryRun: true,
    });
    expect(report.results[0]).toMatchObject({ status: "proposed" });
    expect(readFileSync(join(dir, "a.md"), "utf8")).toBe(original);
  });

  it("skips docs whose requested fields are all present", async () => {
    const dir = setup(
      {
        "a.md":
          "---\nkg:\n  prefLabel: X\n  altLabels: [y]\n  related: [z]\n  subjects: [s]\n---\n",
      },
      SKOS_FIELDS,
    );
    const provider = new MockProvider([{ json: PROPOSAL }]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    expect(report.results[0]).toMatchObject({ status: "complete" });
    expect(provider.requests).toHaveLength(0);
  });

  it("caches proposals: identical content never re-asks the provider", async () => {
    const dir = setup({ "a.md": "---\ntitle: T\n---\n\n# Q\n" });
    const provider = new MockProvider([{ json: PROPOSAL }]);
    await runFill({ cwd: dir, providerInstance: provider, dryRun: true });
    await runFill({ cwd: dir, providerInstance: provider, dryRun: true });
    expect(provider.requests).toHaveLength(1);
  });

  it("stops proposing when the cost budget is exhausted", async () => {
    const dir = setup({
      "a.md": "---\ntitle: A\n---\n",
      "b.md": "---\ntitle: B\n---\n",
    });
    // huge usage so the first call exceeds any budget; model name must be
    // priced in the cost table for the budget to accrue
    const provider = new MockProvider(
      [
        {
          json: PROPOSAL,
          usage: { inputTokens: 10_000_000, outputTokens: 1_000_000 },
        },
      ],
      "claude-sonnet-4-5",
    );
    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      dryRun: true,
      maxCost: 0.01,
      noCache: true,
    });
    expect(report.results.map((r) => r.status)).toEqual([
      "proposed",
      "skipped-budget",
    ]);
    expect(provider.requests).toHaveLength(1);
  });

  it("reports schema-invalid proposals as errors with exit 1", async () => {
    const dir = setup({ "a.md": "---\ntitle: T\n---\n" });
    const provider = new MockProvider([{ json: { prefLabel: 42 } }]);
    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      noCache: true,
    });
    expect(report.results[0]).toMatchObject({ status: "error" });
    expect(report.exitCode).toBe(1);
  });

  it("writes kg.provenance naming the model and filled fields, in the same write", async () => {
    const dir = setup({ "a.md": "---\ntitle: T\n---\n\n# T\n" });
    const provider = new MockProvider([{ json: PROPOSAL }], "test-model");
    const report = await runFill({ cwd: dir, providerInstance: provider });
    expect(report.results[0]).toMatchObject({ status: "filled" });
    const written = readFileSync(join(dir, "a.md"), "utf8");
    expect(written).toContain("provenance:");
    expect(written).toContain("generatedBy: test-model");
    expect(written).toMatch(
      /fields: \[ altLabels, prefLabel, related, subjects \]/,
    );
    expect(written.endsWith("# T\n")).toBe(true); // body still byte-preserved
    // provenance is metadata, not a reported filled field
    expect(report.results[0]?.fields).not.toContain("provenance");
  });

  it("keeps per-model provenance entries so a second model never claims the first's fields", async () => {
    const dir = setup(
      { "a.md": "---\ntitle: T\n---\n" },
      "fill:\n  fields: [prefLabel]\n",
    );
    await runFill({
      cwd: dir,
      providerInstance: new MockProvider([conf({ prefLabel: "X" })], "m1"),
    });
    // second run with a broader field set fills subjects too — different model
    const { writeFileSync: write } = await import("node:fs");
    write(
      join(dir, "dockg.config.yaml"),
      'version: 1\ninputs: ["*.md"]\nfill:\n  fields: [prefLabel, subjects]\n',
    );
    await runFill({
      cwd: dir,
      providerInstance: new MockProvider([conf({ subjects: ["s"] })], "m2"),
    });
    const written = readFileSync(join(dir, "a.md"), "utf8");
    // one entry per model, each attributing only its own fields
    expect(written).toMatch(/generatedBy: m1[\s\S]*?fields: \[ prefLabel \]/);
    expect(written).toMatch(/generatedBy: m2[\s\S]*?fields: \[ subjects \]/);
  });

  it("moves a field's attribution when --force re-fills it with another model", async () => {
    const dir = setup(
      { "a.md": "---\ntitle: T\n---\n" },
      "fill:\n  fields: [prefLabel]\n",
    );
    await runFill({
      cwd: dir,
      providerInstance: new MockProvider([conf({ prefLabel: "X" })], "m1"),
    });
    await runFill({
      cwd: dir,
      force: true,
      providerInstance: new MockProvider([conf({ prefLabel: "Y" })], "m2"),
    });
    const written = readFileSync(join(dir, "a.md"), "utf8");
    expect(written).toContain("prefLabel: Y");
    expect(written).toMatch(/generatedBy: m2[\s\S]*?fields: \[ prefLabel \]/);
    expect(written).not.toContain("m1"); // m1's emptied entry is dropped
  });

  it("skips provenance write-back when writeProvenance is false", async () => {
    const dir = setup(
      { "a.md": "---\ntitle: T\n---\n" },
      "fill:\n  writeProvenance: false\n",
    );
    const provider = new MockProvider([{ json: PROPOSAL }]);
    await runFill({ cwd: dir, providerInstance: provider });
    expect(readFileSync(join(dir, "a.md"), "utf8")).not.toContain("provenance");
  });

  it("does not treat an existing provenance entry as a fillable field", async () => {
    const dir = setup(
      {
        "a.md":
          "---\nkg:\n  prefLabel: X\n  altLabels: [y]\n  related: [z]\n  subjects: [s]\n  provenance:\n    generatedBy: old\n    fields: [prefLabel]\n---\n",
      },
      SKOS_FIELDS,
    );
    const provider = new MockProvider([{ json: PROPOSAL }]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    expect(report.results[0]).toMatchObject({ status: "complete" });
    expect(provider.requests).toHaveLength(0);
  });

  it("reports TOML-frontmatter docs as per-doc errors without corrupting them", async () => {
    const toml = '+++\ntitle = "Hugo"\n+++\n\n# Hugo doc\n';
    const dir = setup({ "a.md": toml, "b.md": "---\ntitle: OK\n---\n" });
    const provider = new MockProvider([{ json: PROPOSAL }]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    const a = report.results.find((r) => r.path === "a.md");
    expect(a).toMatchObject({ status: "error" });
    expect(a?.error).toMatch(/YAML frontmatter/);
    expect(readFileSync(join(dir, "a.md"), "utf8")).toBe(toml); // untouched
    // the rest of the run continued
    expect(report.results.find((r) => r.path === "b.md")).toMatchObject({
      status: "filled",
    });
    expect(report.exitCode).toBe(1);
  });

  it("contains per-doc frontmatter errors instead of aborting the run", async () => {
    const dir = setup({
      "a.md": "---\ntitle: unterminated\n", // no closing fence
      "b.md": "---\nkg: not-a-map\n---\n",
      "c.md": "---\ntitle: fine\n---\n",
    });
    const provider = new MockProvider([{ json: PROPOSAL }]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    const statuses = Object.fromEntries(
      report.results.map((r) => [r.path, r.status]),
    );
    expect(statuses["a.md"]).toBe("error");
    expect(statuses["b.md"]).toBe("error");
    expect(statuses["c.md"]).toBe("filled");
  });

  it("needs no provider credentials when every doc is complete", async () => {
    const dir = setup(
      { "a.md": "---\nkg:\n  prefLabel: X\n---\n" },
      "fill:\n  provider: anthropic\n  fields: [prefLabel]\n",
    );
    delete process.env["ANTHROPIC_API_KEY"];
    // no providerInstance: the factory would throw if constructed eagerly
    const report = await runFill({ cwd: dir });
    expect(report.results[0]).toMatchObject({ status: "complete" });
  });

  it("re-asks the provider when a cached proposal is schema-invalid", async () => {
    const dir = setup({ "a.md": "---\ntitle: T\n---\n" });
    const good = new MockProvider([{ json: PROPOSAL }]);
    await runFill({ cwd: dir, providerInstance: good, dryRun: true });
    // corrupt the cache entry on disk
    const cacheDir = join(dir, ".dockg", "cache");
    const { readdirSync, writeFileSync: write } = await import("node:fs");
    const entry = readdirSync(cacheDir)[0]!;
    write(join(cacheDir, entry), JSON.stringify({ prefLabel: 42 }));
    const second = new MockProvider([{ json: PROPOSAL }]);
    const report = await runFill({
      cwd: dir,
      providerInstance: second,
      dryRun: true,
    });
    expect(second.requests).toHaveLength(1); // cache invalid -> re-asked
    expect(report.results[0]).toMatchObject({
      status: "proposed",
      cached: false,
    });
  });

  it("never writes relation fields without a prefLabel", async () => {
    const dir = setup({ "a.md": "---\ntitle: T\n---\n" });
    const provider = new MockProvider([
      conf({ altLabels: ["x"], related: ["y"], subjects: ["s"] }),
    ]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    // altLabels/related require prefLabel (0.1 dependentRequired) — dropped
    expect(report.results[0]?.fields).toEqual(["subjects"]);
    const written = readFileSync(join(dir, "a.md"), "utf8");
    expect(written).not.toContain("altLabels");
    expect(written).toContain("subjects: [ s ]");
  });

  it("rejects proposals with duplicate array entries (uniqueItems)", async () => {
    const dir = setup({ "a.md": "---\ntitle: T\n---\n" });
    const provider = new MockProvider([{ json: { subjects: ["s", "s"] } }]);
    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      noCache: true,
    });
    expect(report.results[0]).toMatchObject({ status: "error" });
  });

  it("respects config fill.fields (asks only for missing, allowed fields)", async () => {
    const dir = setup(
      { "a.md": "---\nkg:\n  prefLabel: Kept\n---\n" },
      "fill:\n  fields: [prefLabel, subjects]\n",
    );
    const provider = new MockProvider([conf({ subjects: ["search"] })]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    expect(report.results[0]).toMatchObject({
      status: "filled",
      fields: ["subjects"],
    });
    const written = readFileSync(join(dir, "a.md"), "utf8");
    expect(written).toContain("prefLabel: Kept");
    // provider was only asked for the missing field
    expect(provider.requests[0]!.user).toContain("subjects");
    expect(provider.requests[0]!.user).not.toContain("prefLabel,");
  });
});

describe("runFill confidence gate (ADR 01015)", () => {
  it("writes high-confidence fields and reports low-confidence ones without writing", async () => {
    const dir = setup({ "a.md": "---\ntitle: T\n---\n\n# T\n" }, SKOS_FIELDS);
    const provider = new MockProvider([
      {
        json: {
          prefLabel: "Config",
          subjects: ["search"],
          confidence: { prefLabel: 0.95, subjects: 0.3 },
          reasoning: { subjects: "only tangentially about search" },
        },
      },
    ]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    // Normal operation: low-confidence drops do not fail the run.
    expect(report.exitCode).toBe(0);
    const r = report.results[0]!;
    expect(r.status).toBe("filled");
    expect(r.fields).toEqual(["prefLabel"]);
    expect(r.lowConfidence).toEqual([
      {
        field: "subjects",
        confidence: 0.3,
        reasoning: "only tangentially about search",
      },
    ]);
    const written = readFileSync(join(dir, "a.md"), "utf8");
    expect(written).toContain("prefLabel: Config");
    expect(written).not.toContain("subjects");
  });

  it("records per-field confidence in kg.provenance", async () => {
    const dir = setup({ "a.md": "---\ntitle: T\n---\n" }, SKOS_FIELDS);
    const provider = new MockProvider(
      [{ json: { prefLabel: "Config", confidence: { prefLabel: 0.91 } } }],
      "m1",
    );
    await runFill({ cwd: dir, providerInstance: provider });
    const written = readFileSync(join(dir, "a.md"), "utf8");
    expect(written).toMatch(/generatedBy: m1/);
    expect(written).toMatch(/confidence:[\s\S]*?prefLabel: 0\.91/);
  });

  it("a field with no confidence score is never written", async () => {
    const dir = setup({ "a.md": "---\ntitle: T\n---\n" }, SKOS_FIELDS);
    // prefLabel proposed but unscored — the model must score to write.
    const provider = new MockProvider([{ json: { prefLabel: "Config" } }]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    expect(report.results[0]?.status).toBe("nothing-proposed");
    expect(report.results[0]?.lowConfidence?.[0]?.field).toBe("prefLabel");
  });

  it("--min-confidence overrides the config threshold", async () => {
    const dir = setup({ "a.md": "---\ntitle: T\n---\n" }, SKOS_FIELDS);
    const provider = new MockProvider([
      { json: { prefLabel: "Config", confidence: { prefLabel: 0.8 } } },
    ]);
    // Raise the bar above 0.8: the field is now dropped.
    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      minConfidence: 0.9,
    });
    expect(report.results[0]?.status).toBe("nothing-proposed");
    expect(readFileSync(join(dir, "a.md"), "utf8")).not.toContain("prefLabel");
  });

  it("fills an iiRDS field (topicType) at high confidence", async () => {
    const dir = setup(
      { "a.md": "---\ntitle: Install Guide\n---\n\n# Install\n" },
      "fill:\n  fields: [topicType]\n",
    );
    const provider = new MockProvider([
      { json: { topicType: "task", confidence: { topicType: 0.9 } } },
    ]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    expect(report.results[0]?.status).toBe("filled");
    expect(readFileSync(join(dir, "a.md"), "utf8")).toContain(
      "topicType: task",
    );
  });

  it("the guardrail rejects a variant proposed as both applicable and not-applicable", async () => {
    const dir = setup(
      { "a.md": "---\ntitle: T\nkg:\n  appliesTo: [SP-X1]\n---\n\n# T\n" },
      "fill:\n  fields: [notApplicableTo]\n  minConfidence: 0\n",
    );
    // The model (over)proposes excluding the same variant the doc applies to.
    const provider = new MockProvider([
      { json: { notApplicableTo: ["SP-X1"] } },
    ]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    expect(report.results[0]?.rejected).toContain("notApplicableTo");
    expect(readFileSync(join(dir, "a.md"), "utf8")).not.toContain(
      "notApplicableTo",
    );
  });
});

describe("runFill graph guardrail (fill.validateGraph)", () => {
  // Confidence gate disabled here (minConfidence 0) so these tests exercise the
  // structural SHACL guardrail in isolation; the bare proposals carry no scores.
  const HIERARCHY_CONFIG =
    "fill:\n  fields: [prefLabel, broader, related]\n  minConfidence: 0\n";

  it("rejects a broader proposal that would create a cycle", async () => {
    const dir = setup(
      {
        // Human-set hierarchy: Alpha is below Beta.
        "a.md":
          "---\ntitle: A\nkg:\n  prefLabel: Alpha\n  broader: [Beta]\n---\n\n# A\n",
        "b.md": "---\ntitle: B\n---\n\n# B\n",
      },
      HIERARCHY_CONFIG,
    );
    // Model proposes the inverse for b.md — a two-node cycle.
    const provider = new MockProvider([
      { json: { prefLabel: "Beta", broader: ["Alpha"] } },
    ]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    expect(report.exitCode).toBe(0);
    const result = report.results.find((r) => r.path === "b.md");
    expect(result).toMatchObject({ status: "filled", fields: ["prefLabel"] });
    expect(result!.rejected).toContain("broader");
    const written = readFileSync(join(dir, "b.md"), "utf8");
    expect(written).toContain("prefLabel: Beta");
    expect(written).not.toContain("broader");
  });

  it("accumulates accepted proposals so two docs cannot jointly form a cycle", async () => {
    const dir = setup(
      {
        "c.md": "---\ntitle: C\n---\n\n# C\n",
        "d.md": "---\ntitle: D\n---\n\n# D\n",
      },
      HIERARCHY_CONFIG,
    );
    const provider = new MockProvider([
      { json: { prefLabel: "C", broader: ["D"] } },
      { json: { prefLabel: "D", broader: ["C"] } },
    ]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    const first = report.results.find((r) => r.path === "c.md");
    const second = report.results.find((r) => r.path === "d.md");
    expect(first).toMatchObject({ fields: ["prefLabel", "broader"] });
    expect(second!.rejected).toContain("broader");
    expect(readFileSync(join(dir, "d.md"), "utf8")).not.toContain("broader");
  });

  it("rejects a prefLabel that collides with an existing concept spelling", async () => {
    const dir = setup(
      {
        "a.md": "---\ntitle: A\ntags: [Setup]\n---\n\n# A\n",
        "b.md": "---\ntitle: B\n---\n\n# B\n",
      },
      HIERARCHY_CONFIG,
    );
    // Same slug, different spelling — would put two prefLabels on one concept.
    const provider = new MockProvider([{ json: { prefLabel: "setup" } }]);
    const original = readFileSync(join(dir, "b.md"), "utf8");
    const report = await runFill({ cwd: dir, providerInstance: provider });
    const result = report.results.find((r) => r.path === "b.md");
    expect(result!.rejected).toContain("prefLabel");
    expect(result).toMatchObject({ status: "nothing-proposed" });
    expect(readFileSync(join(dir, "b.md"), "utf8")).toBe(original);
  });

  it("accepts a prefLabel that reuses the existing spelling exactly", async () => {
    const dir = setup(
      {
        "a.md": "---\ntitle: A\ntags: [Setup]\n---\n\n# A\n",
        "b.md": "---\ntitle: B\n---\n\n# B\n",
      },
      HIERARCHY_CONFIG,
    );
    const provider = new MockProvider([{ json: { prefLabel: "Setup" } }]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    expect(report.results.find((r) => r.path === "b.md")).toMatchObject({
      status: "filled",
      fields: ["prefLabel"],
    });
  });

  it("guards against the whole corpus even when filling a subset glob", async () => {
    const dir = setup(
      {
        "a.md":
          "---\ntitle: A\nkg:\n  prefLabel: Alpha\n  broader: [Beta]\n---\n\n# A\n",
        "b.md": "---\ntitle: B\n---\n\n# B\n",
      },
      HIERARCHY_CONFIG,
    );
    const provider = new MockProvider([
      { json: { prefLabel: "Beta", broader: ["Alpha"] } },
    ]);
    // Only b.md is in scope — the cycle partner a.md is not — but the
    // guard must still see a.md's hierarchy.
    const report = await runFill({
      cwd: dir,
      globs: ["b.md"],
      providerInstance: provider,
    });
    const result = report.results.find((r) => r.path === "b.md");
    expect(result!.rejected).toContain("broader");
    expect(readFileSync(join(dir, "b.md"), "utf8")).not.toContain("broader");
  });

  it("fill.validateGraph: false writes the cycle anyway", async () => {
    const dir = setup(
      {
        "a.md":
          "---\ntitle: A\nkg:\n  prefLabel: Alpha\n  broader: [Beta]\n---\n\n# A\n",
        "b.md": "---\ntitle: B\n---\n\n# B\n",
      },
      "fill:\n  fields: [prefLabel, broader, related]\n  validateGraph: false\n  minConfidence: 0\n",
    );
    const provider = new MockProvider([
      { json: { prefLabel: "Beta", broader: ["Alpha"] } },
    ]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    expect(report.results.find((r) => r.path === "b.md")).toMatchObject({
      status: "filled",
      fields: ["prefLabel", "broader"],
    });
    expect(readFileSync(join(dir, "b.md"), "utf8")).toContain("broader");
  });

  it("noValidateGraph option overrides config", async () => {
    const dir = setup(
      {
        "a.md":
          "---\ntitle: A\nkg:\n  prefLabel: Alpha\n  broader: [Beta]\n---\n\n# A\n",
        "b.md": "---\ntitle: B\n---\n\n# B\n",
      },
      HIERARCHY_CONFIG,
    );
    const provider = new MockProvider([
      { json: { prefLabel: "Beta", broader: ["Alpha"] } },
    ]);
    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      noValidateGraph: true,
    });
    expect(readFileSync(join(dir, "b.md"), "utf8")).toContain("broader");
    expect(
      report.results.find((r) => r.path === "b.md")!.rejected,
    ).toBeUndefined();
  });
});
