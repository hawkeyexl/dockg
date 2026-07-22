import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(root, "dist", "cli.js");
const corpus = join(root, "test", "fixtures", "corpus");

let graph: string;

function run(args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
      cwd: corpus,
    });
    return { stdout, status: 0 };
  } catch (e) {
    const err = e as { stdout?: string; status?: number };
    return { stdout: err.stdout ?? "", status: err.status ?? -1 };
  }
}

beforeAll(() => {
  graph = join(mkdtempSync(join(tmpdir(), "dockg-qs-")), "graph.ttl");
  execFileSync(process.execPath, [cli, "build", "--out", graph], {
    encoding: "utf8",
    cwd: corpus,
  });
});

describe("dockg query", () => {
  it("matches by predicate with a prefixed name", () => {
    const { stdout, status } = run([
      "query",
      "-p",
      "dcterms:references",
      "-g",
      graph,
    ]);
    expect(status).toBe(0);
    expect(stdout).toContain("dcterms:references");
    expect(stdout).toContain("configuration.md");
  });

  it("matches by subject and returns JSON", () => {
    const { stdout, status } = run([
      "query",
      "-s",
      "https://example.com/kg/doc/docs/getting-started.md",
      "-f",
      "json",
      "-g",
      graph,
    ]);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as { matches: unknown[] };
    expect(parsed.matches.length).toBeGreaterThan(5);
  });

  it("matches literal objects", () => {
    const { stdout } = run(["query", "-o", "python", "-g", graph]);
    expect(stdout).toContain("dockg:codeLanguage");
  });

  it("reports no matches cleanly", () => {
    const { stdout, status } = run([
      "query",
      "-p",
      "dcterms:nonexistent",
      "-g",
      graph,
    ]);
    expect(status).toBe(0);
    expect(stdout).toContain("No matches.");
  });

  it("exits 2 when the graph file is missing", () => {
    const { status } = run(["query", "-g", "nope/missing.ttl"]);
    expect(status).toBe(2);
  });

  // Result ordering is user-visible and was previously unpinned, which let a
  // separator bug hide: the sort key joined fields with NUL, and any printable
  // replacement (`|`) silently reorders results because it sorts *after* most
  // characters instead of before. These two assertions fail under such a
  // separator but pass for field-wise comparison.
  it("orders matches by subject, then predicate, then object", () => {
    const { stdout, status } = run(["query", "-f", "json", "-g", graph]);
    expect(status).toBe(0);
    const { matches } = JSON.parse(stdout) as {
      matches: { s: string; p: string; o: { kind: string; value: string } }[];
    };
    expect(matches.length).toBeGreaterThan(0);

    const by = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    const expected = [...matches].sort(
      (a, b) =>
        by(a.s, b.s) ||
        by(a.p, b.p) ||
        by(a.o.kind, b.o.kind) ||
        by(a.o.value, b.o.value),
    );
    expect(matches).toEqual(expected);
  });

  it("sorts a subject before one that extends it", () => {
    const { stdout } = run(["query", "-f", "json", "-g", graph]);
    const { matches } = JSON.parse(stdout) as { matches: { s: string }[] };

    // configuration.md and its own section IRIs are the prefix pair that
    // exposes a mis-ordering separator: the document must come first. The
    // fragment prefix is derived from the matched subject rather than
    // hardcoded, so this survives a change of corpus baseIri.
    const doc = matches.findIndex((m) =>
      m.s.endsWith("/docs/configuration.md"),
    );
    const docMatch = matches[doc];
    if (!docMatch) throw new Error("configuration.md missing from matches");

    const frag = matches.findIndex((m) => m.s.startsWith(`${docMatch.s}#`));
    expect(frag).toBeGreaterThanOrEqual(0);
    expect(doc).toBeLessThan(frag);
  });
});

describe("dockg stats", () => {
  it("reports counts, orphans, and broken links", () => {
    const { stdout, status } = run(["stats", "-g", graph]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/Documents: {2}4/);
    expect(stdout).toContain("docs/no-frontmatter.md -> missing.md");
  });

  it("emits JSON with the expected shape", () => {
    const { stdout } = run(["stats", "-f", "json", "-g", graph]);
    const report = JSON.parse(stdout) as {
      docs: number;
      sections: number;
      concepts: number;
      orphans: string[];
      brokenLinks: Array<{ doc: string; target: string }>;
      mostConnected: Array<{ doc: string; degree: number }>;
    };
    expect(report.docs).toBe(4);
    expect(report.sections).toBe(8);
    expect(report.concepts).toBe(5);
    // no-frontmatter.md only references an external URL and missing.md;
    // external counts as an outgoing reference, so it is not an orphan.
    expect(report.orphans).toEqual([]);
    expect(report.brokenLinks).toEqual([
      { doc: "docs/no-frontmatter.md", target: "missing.md" },
    ]);
    expect(report.mostConnected[0]).toMatchObject({
      doc: "docs/configuration.md",
    });
  });

  it("--check exits 1 when broken links exist", () => {
    const { status } = run(["stats", "--check", "-g", graph]);
    expect(status).toBe(1);
  });
});
