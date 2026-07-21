# Claude Code Configuration

Repo-wide guidance for AI agents working on dockg. Conventions here are ported from
[doc-detective](https://github.com/doc-detective/doc-detective)'s repo guidance, adapted to this
codebase.

## Environment setup (required)

**Rebase onto `main` before doing anything else.** In a fresh worktree or stale checkout:

```bash
git fetch origin
git rebase origin/main
```

**Install dependencies.** dockg consumes [docmeta](https://www.npmjs.com/package/docmeta)
from the npm registry (`^1.3.0`), so a clean checkout needs nothing but:

```bash
npm ci
```

CI mirrors this exactly. There is no sibling-checkout step: dockg depended on
`file:../docmeta` while docmeta's `extractFrontmatter` export was unreleased, and that
dependency is gone — never reintroduce a `file:`/`link:` spec, since npm publishes them
verbatim and `prepublishOnly` (scripts/check-publishable.mjs) now refuses to.

Don't reach for `--no-verify` when a husky hook fails — install the missing deps or fix the
message instead.

## Persistent knowledge: repo instructions, not Claude memory (required)

Do **not** use Claude Code's auto-memory for dockg knowledge. When you learn something durable — a
gotcha, a decision, a convention — record it **in the repo, in the same change**:

| Kind of knowledge | Home |
|---|---|
| Behavior decisions, contracts, trade-offs | [adrs/](adrs) (MADR, see below) |
| Repo-wide agent workflow rules | This file |
| User-facing behavior, config, commands | [README.md](README.md) |
| Ephemeral working notes | `.tmp/` (gitignored) — never committed |

## Invariants of this codebase (required reading)

- **Determinism is the product contract.** `dockg build` twice over unchanged inputs must be
  byte-identical: canonically sorted Turtle from the custom emitter (`src/core/emit.ts`), no wall
  clock anywhere (git committer dates only, behind an opt-in flag), no blank nodes ever (every
  node gets a deterministic IRI), IRIs sanitized so output always parses. The corpus golden
  (`test/fixtures/golden/graph.ttl`) is the regression gate — update it only deliberately, after
  inspecting the diff line by line. Golden comparisons normalize the `dockg:version` literal.
- **Naming:** the *frontmatter key* is `kg:`; the *RDF namespace prefix* is `dockg:`
  (`https://dockg.dev/ns#`). Never conflate them. The custom namespace stays minimal — prefer
  dcterms/skos/prov/schema.org/foaf terms wherever one exists.
- **Schemas are self-hosted.** dockg's frontmatter JSON Schemas live in [schemas/](schemas) and
  ship in the npm package; `dockg validate` defaults to the bundled newest version by file path.
  Never add dockg schemas to docmeta's built-in registry — that pattern was deliberately removed.
  Published schema files are immutable; evolve by adding a new version file.
- **Exit codes:** `0` ok · `1` findings (validation failures, `stats --check` broken links, fill
  errors) · `2` operational error (`DockgError`). `cli.ts fail()` rethrows non-DockgError.
- **No network in tests.** LLM code paths are tested through `MockProvider`
  (`src/llm/providers/mock.ts`), exported publicly for downstream use. The exec seam is
  injectable for git/CLI subprocess tests.
- `test/fixtures/corpus/docs/windows-notes.md` is CRLF **on purpose**, pinned by
  `.gitattributes`. Don't normalize it.

## Branches and pull requests (required)

Changes land on `main` via a branch and a pull request, not direct pushes.
Branch names follow the release channels (`feat/**` gets its own npm
dist-tag; `fix/**`, `docs/**`, etc. for the rest). The PR body carries the
docs-impact statement and links any ADRs. CI must be green before merge.

## Development workflow (required)

Always **red → green** TDD: write the failing test first, run it to confirm it fails for the
expected reason, write the minimum code, confirm green, refactor. The verification loop is:

```bash
npm run typecheck && npm run build && npm test
```

**Build before test** — integration tests execute `dist/cli.js`, not `src/`.

## Architecture Decision Records (required)

Every **behavior change** ships with an ADR in [MADR](https://adr.github.io/madr/) format under
[adrs/](adrs), written before or alongside the code:

- **Format:** MADR 4.0.0 — YAML front matter (`status`, `date`, `decision-makers`) plus *Context
  and Problem Statement*, *Decision Drivers*, *Considered Options*, *Decision Outcome*
  (*Consequences*, *Confirmation*), *Pros and Cons of the Options*.
- **Filename:** `NNNNN-kebab-case-title.md`, 5-digit zero-padded, numbering **starts at `01000`**.
  `00001`–`00999` is reserved for backfilling pre-existing decisions.
- **Scope:** decisions (behavior, contracts, trade-offs), not mechanical changes. Refactors,
  dependency bumps, and doc/typo fixes don't need one.

## Feature coverage (required)

Unit tests are necessary but not sufficient. A **user-facing feature** (new derive source, config
key, CLI flag, output shape) also needs:

- **Corpus/fixture coverage of every meaningful permutation** — each value shape, each toggle
  state including the off/no-op form, precedence between config and CLI, and the guard paths
  (missing git repo, unsupported frontmatter, broken targets).
- **The determinism gates:** double-build byte comparison, golden comparison (version-normalized),
  and an n3 parser round-trip of emitted Turtle.
- Integration tests live in `test/integration/` and run the built CLI against
  `test/fixtures/corpus/` or per-test `mkdtempSync` directories.

## Documentation impact (required)

Behavior change → answer explicitly: does this add, change, or remove something a user can see,
run, configure, or rely on? **If yes, the docs are part of the change's definition-of-done**:
README (vocabulary table, config sample, commands table), the `dockg init` starter template, and
command `--help` text all land in the same commit. If no (pure refactor, internal-only), say so
in the commit body. Rule of thumb: a change that warrants an ADR has docs impact.

## Commit messages (required)

[Conventional Commits](https://www.conventionalcommits.org/), enforced by the husky `commit-msg`
hook ([commitlint.config.cjs](commitlint.config.cjs)). Types from `@commitlint/config-conventional`.
Breaking changes: `!` after type/scope or a `BREAKING CHANGE:` footer.

**Subject must be lower-case** — the `subject-case` rule rejects `feat: PROV-O support`; write
`feat: prov-o support`.

## How version selection works

Releases are fully automated by **semantic-release** ([.releaserc.json](.releaserc.json)):

| Commit type | Version bump |
|---|---|
| `fix:` | patch |
| `feat:` | minor |
| `feat!:` / `BREAKING CHANGE:` | major |
| `chore:`, `docs:`, `ci:`, `style:`, `test:`, `refactor:`, `build:`, `perf:` | no release |

## Release channels

| Branch | npm dist-tag |
|---|---|
| `main` | `latest` |
| `next` | `next` |
| `feat/**` | `<slug>` (lowercased branch suffix) |

## Don't

- Don't hand-edit `version` in `package.json` — semantic-release owns it.
- Don't create `v*` git tags manually or run `npm publish` locally.
- Don't use `--no-verify` to skip the commit-msg hook.
- Don't add commitizen, standard-version, release-please, or changesets.
- Don't emit wall-clock time, blank nodes, or unsorted output from the emitter — ever.
- Don't write dockg knowledge to Claude auto-memory — put it in this repo.

## Testing behavior

Keep transient files inside the worktree: scratch output, saved command logs, throwaway build
targets go under `.tmp/` at the repo root (gitignored), not `%TEMP%`/`/tmp`. (Per-test isolation
via `mkdtempSync(tmpdir(), ...)` inside tests is fine — vitest cleans those paths' relevance up
with the run.) To inspect long output, save it once and read the file:

```bash
mkdir -p .tmp && npm test > .tmp/test-output.txt 2>&1
```

## Config keys ↔ CLI flags (required pattern)

Every user-facing knob lives in `dockg.config.yaml`, schema-first. Knobs that vary
per invocation (output paths, dry-run, cost caps, provider overrides) also get CLI
flags that override the resolved config; corpus-defining settings (routes,
provenance, derive sources) may be config-only. Command cores read the merged
result, never raw argv. Adding a knob:

1. **Schema first:** add the field to [src/core/config-schema.json](src/core/config-schema.json)
   (`additionalProperties: false` everywhere — unknown keys must fail loudly).
2. **Type + default:** extend `DockgConfig` and apply the code-side default in `parseConfig`
   ([src/core/config.ts](src/core/config.ts)) so the resolved shape is total.
3. **Commander option** in [src/cli.ts](src/cli.ts), thin `.action` delegating to the `runX` core.
4. **Override in the command core:** `opts.x ?? config.section.x` inside `src/commands/*.ts`.
5. **Red→green test per step:** config default + rejection test in `test/unit/config.test.ts`,
   behavior tests at the layer the knob affects.

Precedence: `dockg.config.yaml` → Ajv validation → CLI override → runtime.

## Related files

- [.github/workflows/ci.yml](.github/workflows/ci.yml) — CI incl. the determinism gate and the
  determinism gate
- [.releaserc.json](.releaserc.json) · [commitlint.config.cjs](commitlint.config.cjs) ·
  [.husky/commit-msg](.husky/commit-msg)
- [schemas/](schemas) — published frontmatter JSON Schemas (the validate default)
