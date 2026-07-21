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
};

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
    const dir = setup({
      "a.md":
        "---\nkg:\n  prefLabel: X\n  altLabels: [y]\n  related: [z]\n  subjects: [s]\n---\n",
    });
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
      [{ json: PROPOSAL, usage: { inputTokens: 10_000_000, outputTokens: 1_000_000 } }],
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
    const statuses = Object.fromEntries(report.results.map((r) => [r.path, r.status]));
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
    const report = await runFill({ cwd: dir, providerInstance: second, dryRun: true });
    expect(second.requests).toHaveLength(1); // cache invalid -> re-asked
    expect(report.results[0]).toMatchObject({ status: "proposed", cached: false });
  });

  it("never writes relation fields without a prefLabel", async () => {
    const dir = setup({ "a.md": "---\ntitle: T\n---\n" });
    const provider = new MockProvider([
      { json: { altLabels: ["x"], related: ["y"], subjects: ["s"] } },
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
    const report = await runFill({ cwd: dir, providerInstance: provider, noCache: true });
    expect(report.results[0]).toMatchObject({ status: "error" });
  });

  it("respects config fill.fields (asks only for missing, allowed fields)", async () => {
    const dir = setup(
      { "a.md": "---\nkg:\n  prefLabel: Kept\n---\n" },
      "fill:\n  fields: [prefLabel, subjects]\n",
    );
    const provider = new MockProvider([{ json: { subjects: ["search"] } }]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    expect(report.results[0]).toMatchObject({ status: "filled", fields: ["subjects"] });
    const written = readFileSync(join(dir, "a.md"), "utf8");
    expect(written).toContain("prefLabel: Kept");
    // provider was only asked for the missing field
    expect(provider.requests[0]!.user).toContain("subjects");
    expect(provider.requests[0]!.user).not.toContain("prefLabel,");
  });
});
