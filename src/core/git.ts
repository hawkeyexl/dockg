/**
 * One-pass git history collection for provenance derivation. A single
 * `git log` subprocess covers the whole corpus: per-file creation and
 * last-modification committer dates, author names, and rename chains
 * (followed backward so history accrues to the file's current path).
 * Deterministic per commit — the wall clock never enters the result.
 *
 * Author emails are deliberately not collected into the result (privacy):
 * names only, matching frontmatter author handling.
 */
import { DockgError } from "../types.js";
import { realExec } from "../llm/exec.js";
import type { ExecFn } from "../llm/types.js";
import { normalizeDocPath } from "./iri.js";

export interface GitFileHistory {
  /** Committer ISO date of the oldest commit touching the file (or its earlier names). */
  created?: string;
  /** Committer ISO date of the newest commit touching it. */
  modified?: string;
  /** Unique author names, newest contribution first. */
  authors: string[];
  /** Earlier paths of this file, nearest rename first (git -M heuristic; best-effort). */
  renamedFrom: string[];
}

export interface GitHistory {
  /** HEAD committer ISO date — stamps the build activity's prov:endedAtTime. */
  headTime?: string;
  files: Map<string, GitFileHistory>;
}

/** Record line marker: %x01 keeps commit headers unambiguous in the stream. */
const RECORD = "\u0001";
const STATUS_LINE = /^([AMDRC])\d*\t(.+)$/;

export async function collectGitHistory(
  cwd: string,
  exec: ExecFn = realExec,
): Promise<GitHistory> {
  const result = await exec(
    [
      "git",
      "-c",
      "core.quotepath=off",
      "log",
      `--format=${RECORD}%H%x09%an%x09%cI`,
      "--name-status",
      "-M",
    ],
    { cwd, timeoutMs: 60000 },
  );
  if (result.code !== 0 || result.stdout.trim() === "") {
    throw new DockgError(
      `provenance.git is enabled but git history could not be read (is ${cwd} a git repo with at least one commit?)`,
    );
  }

  const files = new Map<string, GitFileHistory>();
  /** Maps a historical path to the file's current (newest) path. */
  const currentName = new Map<string, string>();
  let headTime: string | undefined;
  let commitAuthor = "";
  let commitTime = "";

  const entry = (path: string): GitFileHistory => {
    let file = files.get(path);
    if (!file) {
      file = { authors: [], renamedFrom: [] };
      files.set(path, file);
    }
    return file;
  };

  /** Register that the commit being parsed touched `path` (as known at that time). */
  const touch = (pathThen: string): GitFileHistory => {
    const path = normalizeDocPath(pathThen);
    const current = currentName.get(path) ?? path;
    currentName.set(path, current);
    const file = entry(current);
    // Walking newest→oldest: first touch wins `modified`, every touch pushes
    // `created` older, authors keep first-appearance (newest) order.
    file.modified ??= commitTime;
    file.created = commitTime;
    if (!file.authors.includes(commitAuthor)) file.authors.push(commitAuthor);
    return file;
  };

  for (const line of result.stdout.split("\n")) {
    if (line.startsWith(RECORD)) {
      const [, author = "", time = ""] = line.slice(1).split("\t");
      commitAuthor = author;
      commitTime = time;
      headTime ??= time;
      continue;
    }
    const match = STATUS_LINE.exec(line);
    if (!match) continue;
    const status = match[1]!;
    const rest = match[2]!;
    if (status === "R" || status === "C") {
      const [oldPath, newPath] = rest.split("\t");
      if (!oldPath || !newPath) continue;
      if (status === "C") {
        // Copies create a new file from an old one; the old file's own history
        // is separate. Record the touch on the copy only.
        touch(newPath);
        continue;
      }
      const file = touch(newPath);
      const normalizedOld = normalizeDocPath(oldPath);
      file.renamedFrom.push(normalizedOld);
      // Older commits refer to the pre-rename path; fold them into this file.
      const current = currentName.get(normalizeDocPath(newPath))!;
      currentName.set(normalizedOld, current);
    } else {
      touch(rest);
    }
  }

  return { headTime, files };
}
