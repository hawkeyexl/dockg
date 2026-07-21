import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(root, "dist", "cli.js");

/** Run the built CLI; returns { stdout, status }. Never throws on nonzero exit. */
export function runCli(args: string[], opts: { cwd?: string } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
      cwd: opts.cwd ?? root,
    });
    return { stdout, status: 0 };
  } catch (e) {
    const err = e as { stdout?: string; status?: number };
    return { stdout: err.stdout ?? "", status: err.status ?? -1 };
  }
}

describe("dockg CLI", () => {
  it("--help exits 0 and names the tool", () => {
    const { stdout, status } = runCli(["--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("dockg");
  });

  it("--version exits 0", () => {
    const { status } = runCli(["--version"]);
    expect(status).toBe(0);
  });
});
