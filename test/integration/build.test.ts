import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

/** The tool version is stamped into the graph; normalize it so release
 *  version bumps don't invalidate the golden. */
function normalizeVersion(ttl: string): string {
  return ttl.replace(/dockg:version "[^"]+"/g, 'dockg:version "X"');
}

describe("dockg build (integration)", () => {
  it("matches the golden output byte-for-byte (modulo tool version)", () => {
    const out = join(mkdtempSync(join(tmpdir(), "dockg-build-")), "graph.ttl");
    build(out);
    expect(normalizeVersion(readFileSync(out, "utf8"))).toBe(
      normalizeVersion(readFileSync(golden, "utf8")),
    );
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
    expect(quads.length).toBe(113);
  });

  it("reports docs and triples on stdout", () => {
    const out = join(mkdtempSync(join(tmpdir(), "dockg-build-")), "graph.ttl");
    const stdout = build(out);
    expect(stdout).toMatch(/4 docs, \d+ triples/);
  });

  it("provenance.git: errors loudly outside a git repo, is byte-stable inside one", () => {
    const dir = mkdtempSync(join(tmpdir(), "dockg-gittime-"));
    writeFileSync(
      join(dir, "dockg.config.yaml"),
      'version: 1\ninputs: ["*.md"]\nprovenance:\n  git: true\n',
    );
    writeFileSync(join(dir, "a.md"), "# A\n");

    // not a git repo -> operational error
    let status = 0;
    try {
      execFileSync(
        process.execPath,
        [cli, "build", "--out", join(dir, "g.ttl")],
        {
          encoding: "utf8",
          cwd: dir,
        },
      );
    } catch (e) {
      status = (e as { status?: number }).status ?? -1;
    }
    expect(status).toBe(2);

    // with a commit: endedAtTime appears and rebuilds are identical
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"],
      { cwd: dir },
    );
    execFileSync(
      "git",
      [
        "-c",
        "user.email=t@t",
        "-c",
        "user.name=t",
        "commit",
        "-q",
        "-m",
        "init",
      ],
      { cwd: dir },
    );
    execFileSync(
      process.execPath,
      [cli, "build", "--out", join(dir, "a.ttl")],
      {
        encoding: "utf8",
        cwd: dir,
      },
    );
    execFileSync(
      process.execPath,
      [cli, "build", "--out", join(dir, "b.ttl")],
      {
        encoding: "utf8",
        cwd: dir,
      },
    );
    const a = readFileSync(join(dir, "a.ttl"), "utf8");
    expect(a).toBe(readFileSync(join(dir, "b.ttl"), "utf8"));
    expect(a).toMatch(/prov:endedAtTime "[^"]+"\^\^xsd:dateTime/);
  });

  it("exits 2 when no inputs match", () => {
    const empty = mkdtempSync(join(tmpdir(), "dockg-empty-"));
    let status = 0;
    try {
      execFileSync(process.execPath, [cli, "build"], {
        encoding: "utf8",
        cwd: empty,
      });
    } catch (e) {
      status = (e as { status?: number }).status ?? -1;
    }
    expect(status).toBe(2);
  });
});
