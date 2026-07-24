import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(root, "dist", "cli.js");

function run(args: string[], cwd: string): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
      cwd,
    });
    return { stdout, status: 0 };
  } catch (e) {
    const err = e as { stdout?: string; status?: number };
    return { stdout: err.stdout ?? "", status: err.status ?? -1 };
  }
}

describe("dockg validate", () => {
  it("passes the corpus (valid kg keys and docs without kg)", () => {
    const { stdout, status } = run(
      ["validate"],
      join(root, "test", "fixtures", "corpus"),
    );
    expect(status).toBe(0);
    expect(stdout).toContain("4 files checked");
  });

  it("accepts kg.revisionOf via the bundled 0.3 schema, rejects malformed shapes", () => {
    const dir = mkdtempSync(join(tmpdir(), "dockg-revof-"));
    writeFileSync(
      join(dir, "dockg.config.yaml"),
      'version: 1\ninputs: ["*.md"]\n',
    );
    writeFileSync(
      join(dir, "good.md"),
      "---\nkg:\n  revisionOf: [old/guide.md]\n---\n\n# G\n",
    );
    expect(run(["validate"], dir).status).toBe(0);

    writeFileSync(
      join(dir, "bad.md"),
      "---\nkg:\n  revisionOf: old/guide.md\n---\n\n# B\n",
    );
    const bad = run(["validate"], dir);
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/revisionOf/);
  });

  it("fails on malformed kg frontmatter with exit 1 and named errors", () => {
    const { stdout, status } = run(
      ["validate"],
      join(root, "test", "fixtures", "invalid"),
    );
    expect(status).toBe(1);
    expect(stdout).toMatch(/prefLabel/);
    expect(stdout).toMatch(/bogus/);
  });

  it("accepts negative-scope fields and rejects an out-of-enum notSoftwareSubject (0.7)", () => {
    const dir = mkdtempSync(join(tmpdir(), "dockg-negscope-"));
    writeFileSync(
      join(dir, "dockg.config.yaml"),
      'version: 1\ninputs: ["*.md"]\n',
    );
    writeFileSync(
      join(dir, "good.md"),
      "---\nkg:\n  notApplicableTo: [SP-X300]\n  notSoftwareSubject: [architecture]\n---\n\n# G\n",
    );
    expect(run(["validate"], dir).status).toBe(0);

    writeFileSync(
      join(dir, "bad.md"),
      "---\nkg:\n  notSoftwareSubject: [nonsense]\n---\n\n# B\n",
    );
    const bad = run(["validate"], dir);
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/notSoftwareSubject/);
  });
});
