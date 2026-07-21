import { describe, expect, it } from "vitest";
import { collectGitHistory } from "../../src/core/git.js";
import { DockgError } from "../../src/types.js";
import type { ExecFn, ExecResult } from "../../src/llm/types.js";

function mockExec(stdout: string, code = 0): ExecFn {
  return () =>
    Promise.resolve<ExecResult>({ code, stdout, stderr: "", timedOut: false });
}

const SOH = "\u0001";

/** Newest-first log: commit c3 modifies b.md; c2 renames a.md -> b.md; c1 adds a.md + docs/keep.md. */
const LOG = [
  `${SOH}c3\tCasey Editor\t2026-03-03T10:00:00+00:00`,
  "",
  "M\tb.md",
  "",
  `${SOH}c2\tJane Doe\t2026-02-02T10:00:00+00:00`,
  "",
  "R095\ta.md\tb.md",
  "",
  `${SOH}c1\tJane Doe\t2026-01-01T10:00:00+00:00`,
  "",
  "A\ta.md",
  "A\tdocs/keep.md",
  "",
].join("\n");

describe("collectGitHistory", () => {
  it("parses one pass into per-file created/modified/authors", async () => {
    const history = await collectGitHistory("/repo", mockExec(LOG));
    expect(history.headTime).toBe("2026-03-03T10:00:00+00:00");

    const keep = history.files.get("docs/keep.md")!;
    expect(keep.created).toBe("2026-01-01T10:00:00+00:00");
    expect(keep.modified).toBe("2026-01-01T10:00:00+00:00");
    expect(keep.authors).toEqual(["Jane Doe"]);
  });

  it("follows renames backward so history accrues to the current path", async () => {
    const history = await collectGitHistory("/repo", mockExec(LOG));
    const b = history.files.get("b.md")!;
    expect(b.created).toBe("2026-01-01T10:00:00+00:00"); // a.md's birth
    expect(b.modified).toBe("2026-03-03T10:00:00+00:00");
    expect(b.authors).toEqual(["Casey Editor", "Jane Doe"]); // newest first, deduped
    expect(b.renamedFrom).toEqual(["a.md"]);
    expect(history.files.has("a.md")).toBe(false); // folded into b.md
  });

  it("tracks multi-hop rename chains", async () => {
    const log = [
      `${SOH}c3\tA\t2026-03-01T00:00:00+00:00`,
      "",
      "R100\tmid.md\tnew.md",
      "",
      `${SOH}c2\tA\t2026-02-01T00:00:00+00:00`,
      "",
      "R100\told.md\tmid.md",
      "",
      `${SOH}c1\tA\t2026-01-01T00:00:00+00:00`,
      "",
      "A\told.md",
      "",
    ].join("\n");
    const history = await collectGitHistory("/repo", mockExec(log));
    const file = history.files.get("new.md")!;
    expect(file.renamedFrom).toEqual(["mid.md", "old.md"]);
    expect(file.created).toBe("2026-01-01T00:00:00+00:00");
  });

  it("throws DockgError outside a git repo", async () => {
    await expect(collectGitHistory("/repo", mockExec("", 128))).rejects.toThrow(
      DockgError,
    );
  });

  it("handles tab-free author names with unicode paths (quotepath off)", async () => {
    const log = [
      `${SOH}c1\tRené Müller\t2026-01-01T00:00:00+00:00`,
      "",
      "A\tdocs/café guide.md",
      "",
    ].join("\n");
    const history = await collectGitHistory("/repo", mockExec(log));
    expect(history.files.get("docs/café guide.md")!.authors).toEqual(["René Müller"]);
  });
});
