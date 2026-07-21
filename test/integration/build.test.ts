import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { Parser } from "n3";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(root, "dist", "cli.js");
const corpus = join(root, "test", "fixtures", "corpus");
const golden = join(root, "test", "fixtures", "golden", "graph.ttl");

function build(outPath: string): string {
  return execFileSync(process.execPath, [cli, "build", "--out", outPath], {
    encoding: "utf8",
    cwd: corpus,
  });
}

describe("dockg build (integration)", () => {
  it("matches the golden output byte-for-byte", () => {
    const out = join(mkdtempSync(join(tmpdir(), "dockg-build-")), "graph.ttl");
    build(out);
    expect(readFileSync(out, "utf8")).toBe(readFileSync(golden, "utf8"));
  });

  it("is byte-identical across two runs (determinism gate)", () => {
    const dir = mkdtempSync(join(tmpdir(), "dockg-build-"));
    const a = join(dir, "a.ttl");
    const b = join(dir, "b.ttl");
    build(a);
    build(b);
    expect(readFileSync(a, "utf8")).toBe(readFileSync(b, "utf8"));
  });

  it("round-trips through the n3 Turtle parser (escaping/syntax gate)", () => {
    const quads = new Parser({ format: "text/turtle" }).parse(
      readFileSync(golden, "utf8"),
    );
    // must equal the triple count `build` reports for the corpus
    expect(quads.length).toBe(94);
  });

  it("reports docs and triples on stdout", () => {
    const out = join(mkdtempSync(join(tmpdir(), "dockg-build-")), "graph.ttl");
    const stdout = build(out);
    expect(stdout).toMatch(/4 docs, \d+ triples/);
  });

  it("exits 2 when no inputs match", () => {
    const empty = mkdtempSync(join(tmpdir(), "dockg-empty-"));
    let status = 0;
    try {
      execFileSync(process.execPath, [cli, "build"], { encoding: "utf8", cwd: empty });
    } catch (e) {
      status = (e as { status?: number }).status ?? -1;
    }
    expect(status).toBe(2);
  });
});
