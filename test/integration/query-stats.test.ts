import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { hermeticEnv } from "../helpers/git-env.js";

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
      brokenSectionRefs: Array<{ doc: string; slug: string }>;
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
    // getting-started.md carries a kg.sections key naming no heading.
    expect(report.brokenSectionRefs).toEqual([
      { doc: "docs/getting-started.md", slug: "missing-heading" },
    ]);
    expect(report.mostConnected[0]).toMatchObject({
      doc: "docs/configuration.md",
    });
  });

  it("reports broken section refs in pretty output", () => {
    const { stdout } = run(["stats", "-g", graph]);
    expect(stdout).toContain("Broken section refs (1):");
    expect(stdout).toContain("docs/getting-started.md -> #missing-heading");
  });

  it("--check exits 1 when broken links or section refs exist", () => {
    const { status } = run(["stats", "--check", "-g", graph]);
    expect(status).toBe(1);
  });

  it("--check exits 1 for a broken section ref on an otherwise clean corpus", () => {
    const dir = mkdtempSync(join(tmpdir(), "dockg-secref-"));
    writeFileSync(
      join(dir, "dockg.config.yaml"),
      'version: 1\ninputs: ["*.md"]\nprovenance:\n  git: false\n',
    );
    writeFileSync(
      join(dir, "a.md"),
      "---\nkg:\n  sections:\n    nope:\n      topicType: task\n---\n\n# A\n\n## Real\n",
    );
    execFileSync(
      process.execPath,
      [cli, "build", "--out", join(dir, "g.ttl")],
      {
        encoding: "utf8",
        cwd: dir,
      },
    );
    const r = spawnSync(
      process.execPath,
      [cli, "stats", "-g", join(dir, "g.ttl"), "--check"],
      { encoding: "utf8", cwd: dir },
    );
    expect(r.status).toBe(1);
  });
});

describe("dockg stats — metadata coverage", () => {
  /** A clean one-doc corpus: no broken links, so --check isolates coverage. */
  function scratch(frontmatter: string, config = ""): string {
    const dir = mkdtempSync(join(tmpdir(), "dockg-cov-"));
    writeFileSync(
      join(dir, "dockg.config.yaml"),
      `version: 1\ninputs: ["*.md"]\nprovenance:\n  git: false\n${config}`,
    );
    writeFileSync(join(dir, "a.md"), `${frontmatter}# A\n\nBody.\n`);
    execFileSync(
      process.execPath,
      [cli, "build", "--out", join(dir, "g.ttl")],
      {
        encoding: "utf8",
        cwd: dir,
      },
    );
    return dir;
  }

  function statsIn(
    dir: string,
    args: string[],
  ): { stdout: string; status: number } {
    const r = spawnSync(
      process.execPath,
      [cli, "stats", "-g", join(dir, "g.ttl"), ...args],
      { encoding: "utf8", cwd: dir },
    );
    return { stdout: r.stdout, status: r.status ?? -1 };
  }

  it("reports exact per-field coverage for the corpus", () => {
    const { stdout, status } = run(["stats", "-f", "json", "-g", graph]);
    expect(status).toBe(0);
    const report = JSON.parse(stdout) as {
      coverage: Array<{
        field: string;
        predicate: string;
        docs: number;
        pct: number;
      }>;
    };
    // 4 docs: only getting-started.md carries description/creator/dates;
    // configuration.md alone has a kg.prefLabel. Order is the report order.
    expect(report.coverage).toEqual([
      { field: "title", predicate: "dcterms:title", docs: 4, pct: 100 },
      {
        field: "description",
        predicate: "dcterms:description",
        docs: 1,
        pct: 25,
      },
      { field: "creator", predicate: "dcterms:creator", docs: 1, pct: 25 },
      { field: "created", predicate: "dcterms:created", docs: 1, pct: 25 },
      { field: "modified", predicate: "dcterms:modified", docs: 1, pct: 25 },
      { field: "subject", predicate: "dcterms:subject", docs: 2, pct: 50 },
      { field: "prefLabel", predicate: "foaf:primaryTopic", docs: 1, pct: 25 },
    ]);
  });

  it("renders a coverage block in pretty output", () => {
    const { stdout } = run(["stats", "-g", graph]);
    expect(stdout).toContain("Coverage");
    expect(stdout).toMatch(/title\s+4\/4\s+100\.0%/);
    expect(stdout).toMatch(/prefLabel\s+1\/4\s+25\.0%/);
  });

  it("--check gates on a uniform coverage threshold", () => {
    const dir = scratch("");
    // title comes from the H1 (100%), everything else is absent (0%).
    expect(statsIn(dir, ["--check", "--coverage-threshold", "50"]).status).toBe(
      1,
    );
    // A threshold only `title` clears still fails on the rest.
    expect(
      statsIn(dir, ["--check", "--coverage-threshold", "100"]).status,
    ).toBe(1);
    // No threshold: coverage never gates, and this corpus has no broken links.
    expect(statsIn(dir, ["--check"]).status).toBe(0);
  });

  it("--check honors a per-field threshold map from config", () => {
    // Gate only `title`, which the H1 satisfies; ignore the empty fields.
    const pass = scratch("", "stats:\n  coverageThreshold:\n    title: 100\n");
    expect(statsIn(pass, ["--check"]).status).toBe(0);

    const fail = scratch(
      "",
      "stats:\n  coverageThreshold:\n    description: 1\n",
    );
    expect(statsIn(fail, ["--check"]).status).toBe(1);
  });

  it("counts frontmatter-derived values as covered", () => {
    // description present -> 100% for a one-doc corpus.
    const dir = scratch("---\ndescription: Hi.\n---\n\n");
    const { stdout } = statsIn(dir, ["-f", "json"]);
    const report = JSON.parse(stdout) as {
      coverage: Array<{ field: string; pct: number }>;
    };
    expect(report.coverage.find((c) => c.field === "description")?.pct).toBe(
      100,
    );
  });

  it("counts git-derived dates as covered, with no frontmatter date", () => {
    // The ADR 01011 reason coverage measures the graph, not the frontmatter:
    // a doc with no `date`/`updated` still covers created/modified once git
    // provenance supplies them. Needs a real repo and provenance.git: true.
    const env = hermeticEnv();
    const dir = mkdtempSync(join(tmpdir(), "dockg-cov-git-"));
    writeFileSync(
      join(dir, "dockg.config.yaml"),
      'version: 1\ninputs: ["*.md"]\nprovenance:\n  git: true\n',
    );
    writeFileSync(join(dir, "a.md"), "# A\n\nNo frontmatter, no dates.\n");
    execFileSync("git", ["init", "-q"], { cwd: dir, env });
    execFileSync(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"],
      { cwd: dir, env },
    );
    execFileSync(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "i"],
      { cwd: dir, env },
    );
    execFileSync(
      process.execPath,
      [cli, "build", "--out", join(dir, "g.ttl")],
      { encoding: "utf8", cwd: dir, env },
    );

    const r = spawnSync(
      process.execPath,
      [cli, "stats", "-g", join(dir, "g.ttl"), "-f", "json"],
      { encoding: "utf8", cwd: dir, env },
    );
    const report = JSON.parse(r.stdout) as {
      coverage: Array<{ field: string; pct: number }>;
    };
    const pctOf = (f: string) =>
      report.coverage.find((c) => c.field === f)?.pct;
    // Both dates come purely from git here.
    expect(pctOf("created")).toBe(100);
    expect(pctOf("modified")).toBe(100);
    // creator is a git author, also 100%; description was never provided.
    expect(pctOf("creator")).toBe(100);
    expect(pctOf("description")).toBe(0);
  });
});
