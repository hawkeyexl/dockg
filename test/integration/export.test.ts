import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(root, "dist", "cli.js");
const corpus = join(root, "test", "fixtures", "corpus");
const golden = join(root, "test", "fixtures", "golden", "graph.jsonld");

function run(args: string[], cwd: string): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
      cwd,
    });
    return { stdout, status: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (err.stdout ?? "") + (err.stderr ?? ""),
      status: err.status ?? -1,
    };
  }
}

/** The tool version is stamped into the graph; normalize it so release
 *  version bumps don't invalidate the golden. */
function normalizeVersion(jsonld: string): string {
  return jsonld.replace(/"dockg:version": "[^"]+"/g, '"dockg:version": "X"');
}

/** Build the corpus into a fresh temp dir and return its graph path. */
function buildGraph(): { dir: string; graph: string } {
  const dir = mkdtempSync(join(tmpdir(), "dockg-export-"));
  const graph = join(dir, "graph.ttl");
  execFileSync(process.execPath, [cli, "build", "--out", graph], {
    encoding: "utf8",
    cwd: corpus,
  });
  return { dir, graph };
}

describe("dockg export (integration)", () => {
  it("matches the JSON-LD golden byte-for-byte (modulo tool version)", () => {
    const { dir, graph } = buildGraph();
    const out = join(dir, "graph.jsonld");
    const { status } = run(
      ["export", "--format", "jsonld", "--graph", graph, "--out", out],
      corpus,
    );
    expect(status).toBe(0);
    expect(normalizeVersion(readFileSync(out, "utf8"))).toBe(
      normalizeVersion(readFileSync(golden, "utf8")),
    );
  });

  it("is byte-identical across two exports (determinism gate)", () => {
    const { dir, graph } = buildGraph();
    const a = join(dir, "a.jsonld");
    const b = join(dir, "b.jsonld");
    run(["export", "-f", "jsonld", "-g", graph, "-o", a], corpus);
    run(["export", "-f", "jsonld", "-g", graph, "-o", b], corpus);
    expect(readFileSync(a, "utf8")).toBe(readFileSync(b, "utf8"));
  });

  it("emits valid JSON whose @graph node count equals distinct subjects", () => {
    const { dir, graph } = buildGraph();
    const out = join(dir, "graph.jsonld");
    const { stdout } = run(
      ["export", "-f", "jsonld", "-g", graph, "-o", out],
      corpus,
    );
    const doc = JSON.parse(readFileSync(out, "utf8"));
    expect(Array.isArray(doc["@graph"])).toBe(true);
    expect(doc["@context"].dockg).toBe("https://dockg.dev/ns#");
    const ids = doc["@graph"].map((n: { "@id": string }) => n["@id"]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(stdout).toContain(`${ids.length} node`);
  });

  it("defaults the out path to the graph path with a .jsonld extension", () => {
    const { dir, graph } = buildGraph();
    const { status } = run(["export", "-f", "jsonld", "-g", graph], corpus);
    expect(status).toBe(0);
    const defaulted = join(dir, "graph.jsonld");
    expect(() => readFileSync(defaulted, "utf8")).not.toThrow();
  });

  it("exits 2 for --format iirds with a Phase 6b pointer", () => {
    const { graph } = buildGraph();
    const { status, stdout } = run(
      ["export", "-f", "iirds", "-g", graph],
      corpus,
    );
    expect(status).toBe(2);
    expect(stdout).toContain("Phase 6b");
  });

  it("exits 2 when the graph is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "dockg-export-"));
    const { status, stdout } = run(
      ["export", "-f", "jsonld", "-g", join(dir, "nope.ttl")],
      dir,
    );
    expect(status).toBe(2);
    expect(stdout.toLowerCase()).toContain("not found");
  });
});
