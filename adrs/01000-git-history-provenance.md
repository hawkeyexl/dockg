---
status: accepted
date: 2026-07-21
decision-makers: [hawkeyexl, Claude]
---

# One-pass git history as an opt-in provenance source

## Context and Problem Statement

PROV-O v1 derived provenance only from frontmatter. Most corpora carry richer,
already-authoritative provenance in git: creation/modification dates, authors,
and renames. How should dockg incorporate git history without breaking its
determinism contract or its performance profile?

## Decision Drivers

- Byte-identical output per corpus commit; the wall clock must never enter the graph.
- One `dockg build` must not spawn a subprocess per file.
- Frontmatter is the author's explicit statement — it must win over inference.
- Author emails are personal data.

## Considered Options

1. Per-file `git log -- <path>` calls at derive time.
2. One `git log --name-status -M` pass parsed into a corpus-wide map (chosen).
3. Reading `.git` directly with a library (isomorphic-git).

## Decision Outcome

Chosen option 2: `collectGitHistory` (src/core/git.ts) runs a single
`git -c core.quotepath=off log --format=%x01%H%x09%an%x09%cI --name-status -M`
and folds the stream newest→oldest into per-file `{created, modified, authors,
renamedFrom}`, following renames backward so history accrues to the current
path. Gated by `provenance.git` (renamed from the unreleased `gitTime`, whose
scope it absorbs). Frontmatter dates always win; git fills only what is
absent. Author names are emitted through the same agent-node path as
frontmatter authors; emails are never emitted.

### Consequences

- Good: deterministic per commit; one subprocess regardless of corpus size;
  works for dates, authors, renames, and the build activity's `prov:endedAtTime`
  from a single pass.
- Bad: whole-history parsing can be slow on very large repos (opt-in; a
  bounded-depth knob is an easy later add), and shallow CI clones yield
  partial facts silently.

### Confirmation

Unit tests with a scripted exec mock plus a real tmp-repo integration test
(test/unit/git.test.ts, test/integration/git-history.test.ts); build-level
byte-stability test in test/integration/build.test.ts.

## Pros and Cons of the Options

- **Per-file git log** — simple, but N subprocesses; rejected on performance.
- **One-pass parse** — one subprocess, rename chains fall out naturally;
  requires careful stream parsing (mitigated by the injectable exec seam).
- **Library (.git reader)** — no subprocess, but a heavy dependency and a
  second implementation of git semantics; rejected for footprint.
