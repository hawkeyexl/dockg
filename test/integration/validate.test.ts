import { execFileSync } from "node:child_process";
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

  it("fails on malformed kg frontmatter with exit 1 and named errors", () => {
    const { stdout, status } = run(
      ["validate"],
      join(root, "test", "fixtures", "invalid"),
    );
    expect(status).toBe(1);
    expect(stdout).toMatch(/prefLabel/);
    expect(stdout).toMatch(/bogus/);
  });
});
