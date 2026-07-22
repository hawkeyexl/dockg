---
status: accepted
date: 2026-07-21
decision-makers: [hawkeyexl, Claude]
---

# Enforce the quality standards mechanically, in hooks and CI

## Context and Problem Statement

CLAUDE.md declares the repo's standards — Conventional Commits with a
lower-case subject, the `typecheck && build && test` verification loop, Node
>= 24 — but almost none of them were actually enforced. Only the commit-msg
hook existed, and a git hook is advisory by construction: `--no-verify`, the
GitHub web editor, or simply a clone that never ran `npm install` all bypass
it silently.

The commit-message gap is the sharpest one. semantic-release derives every
version bump from commit messages, so a malformed message does not merely look
untidy — it mis-versions a published release, and nothing downstream notices.

Separately, the repo had no linter or formatter at all, so style and a class of
latent defects were governed by reviewer attention alone. Two such defects were
sitting on `main` when the linter was first run: an unused import in
`test/unit/git.test.ts` marking a missing assertion, and three literal NUL
bytes in `src/commands/query.ts` that made git classify a source file as
binary.

## Decision Drivers

- A standard that is documented but unenforced is a standard that erodes.
- Enforcement must not be bypassable by accident; CI is the only binding gate.
- Determinism is the product contract — no gate may perturb emitted bytes.
- Fast feedback locally; the authoritative check in CI.
- Keep the toolchain small and conventional.

## Considered Options

1. Leave enforcement to review discipline and the existing commit-msg hook.
2. Hooks only — add pre-commit/pre-push, no CI changes.
3. CI only — drop hooks, gate everything in GitHub Actions.
4. Layered: fast hooks locally, CI as the authoritative backstop (chosen).

## Decision Outcome

Chosen option 4. Enforcement is layered by cost:

- **pre-commit** (seconds, no build): lint-staged runs Prettier and ESLint over
  the *staged blobs*, then a whole-project `typecheck`. Staged rather than
  working-tree is deliberate: a repo-wide `prettier --check` passes when a file
  is clean on disk but was staged dirty, committing unformatted content.
- **pre-push** (full loop): `typecheck && build && test`, `build` before `test`
  because the integration suite executes `dist/cli.js`, not `src/`.
- **CI** re-runs all of the above and adds a commitlint check across the PR's
  commit range, so a bypassed hook fails the PR instead of reaching `main`.

ESLint (flat config, `typescript-eslint` recommended) and Prettier are adopted,
with `eslint-config-prettier` so lint never argues with formatting. Prettier's
ignore list is the load-bearing part: `test/fixtures/` and `schemas/` are
excluded because the corpus feeds the determinism gate, the golden graph is the
byte-exact regression baseline, and published frontmatter schemas are immutable
once released. Markdown is excluded because the prose is hand-wrapped and
CHANGELOG.md is generated.

`.gitattributes` gains `* text=auto eol=lf`, making LF the line-ending policy
for every contributor and CI rather than a per-machine `core.autocrlf` setting
that does not travel. The existing `-text` exemptions stay *below* that rule,
since the last matching line wins.

`.npmrc` sets `engine-strict=true`, making the declared `engines.node >= 24`
binding at install time rather than advisory.

### Consequences

- Good: the documented standards are now the enforced standards. Commit
  messages — which drive versioning — are validated somewhere unbypassable.
- Good: the linter immediately surfaced two real defects already on `main`.
- Bad: a one-time reformat across the codebase, which inflates `git blame` for
  that commit.
- Bad: pre-push runs the full suite, adding roughly a minute to each push;
  `--no-verify` remains available for emergencies, at the cost of a failed PR
  instead of a failed push.
- Bad: `engine-strict` applies to dependencies too, so a transitive package
  declaring an engines range that excludes Node 24 will hard-fail `npm
  install`. Since CI and release both use `npm install` rather than `npm ci`,
  that can appear without any change to this repo.
- Neutral: three more devDependency trees (ESLint, Prettier, lint-staged).

### Confirmation

The reformat was verified behavior-neutral against the product contract, not
merely the test suite: the full suite passes, the double-build byte comparison
passes, and output still matches the golden graph (version-normalized).
`test/fixtures/` and `schemas/` were confirmed untouched by Prettier. Hook
wiring was confirmed by an actual rejected commit. `feat: PROV-O support` is
rejected and `feat: prov-o support` accepted, matching the rule CLAUDE.md
documents. The `.gitattributes` exemptions were verified in a scratch repo: a
CRLF file at the exempted path kept its CRLF bytes while an ordinary source
file was normalized to LF.

## Pros and Cons of the Options

- **Review discipline** — zero tooling cost, but it had already failed: two
  defects reached `main` that a linter catches in one run.
- **Hooks only** — fast, but hooks are advisory; the one standard whose
  violation is silently expensive (commit messages) would stay unguarded.
- **CI only** — unbypassable, but pushes a two-character formatting mistake
  through a full remote cycle before telling you.
- **Layered** (chosen) — duplicates each check in two places, which is the
  point: the local copy is for speed, the CI copy is for authority.
