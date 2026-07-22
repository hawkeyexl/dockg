# dockg

Deterministic knowledge graphs derived from documentation frontmatter and formatting, saved as Turtle.

`dockg` reads your docs — Markdown first — and derives an RDF knowledge graph from what is already there: frontmatter fields, heading structure, links between pages, tags, images, and code blocks. The build is **deterministic**: stable IRIs, sorted serialization, byte-identical rebuilds. The emitted `.ttl` diffs cleanly in git, so the graph can live next to the docs it describes.

It pairs with [docmeta](https://github.com/hawkeyexl/docmeta) (which powers `dockg validate`) and follows the same CLI conventions as [docevals](https://github.com/hawkeyexl/docevals). dockg's frontmatter schema is published in this repo at [`schemas/frontmatter-0.4.json`](schemas/frontmatter-0.4.json) — point any JSON Schema tool at it, e.g. `docmeta validate --schema node_modules/dockg/schemas/frontmatter-0.4.json docs/`.

## Install

```bash
npm install -g dockg
```

Requires Node.js 24+. (`dockg` depends on `docmeta` for frontmatter extraction and validation.)

## Quick start

```bash
dockg init            # scaffold dockg.config.yaml
dockg build           # derive the graph -> kg/graph.ttl
dockg stats           # counts, orphan docs, broken links, hubs
dockg query -p dcterms:references   # who links to what
dockg validate        # KG-readiness via docmeta
```

Exit codes: `0` ok · `1` findings (validation failures, `stats --check` broken links, `fill` errors) · `2` operational error.

## What gets derived

Standard vocabularies wherever a term exists — Dublin Core (`dcterms:`), SKOS (`skos:`), schema.org (`schema:`), FOAF (`foaf:`) — plus a minimal custom namespace `dockg: <https://dockg.dev/ns#>` (2 classes, 5 properties).

| Source | Triples |
|---|---|
| every doc | `<doc> a dockg:Document ; dockg:path "docs/x.md"` |
| `title` (fallback: first H1) | `dcterms:title` |
| `description` / `author(s)` / `date` / `updated` / `lang` | `dcterms:description` / `dcterms:creator` / `dcterms:created`^^xsd:date / `dcterms:modified` / `dcterms:language` |
| `tags` / `keywords` | `<doc> dcterms:subject <concept>` ; concept nodes are `skos:Concept` with `skos:prefLabel` and `skos:inScheme` |
| headings | `dockg:Section` nodes with `dcterms:title`, `dockg:level`, `dockg:order`, nested via `dcterms:hasPart` |
| internal links | `dcterms:references` to the target doc (or its section when the anchor resolves). Extensionless relative links try `.md`/`.mdx` and index files. Site-root-absolute routes (`/docs/x/`) resolve via [route mappings](#route-mappings); without a mapping they are skipped |
| broken internal links | `dockg:brokenLink "target.md"` (surfaced by `stats`) |
| external links | `dcterms:references <url>` |
| images | `schema:image` |
| code fence languages | `dockg:codeLanguage "python"` |
| `kg:` frontmatter | see below |

Note: the emitted `schema:` prefix is `https://schema.org/` (the current recommendation); merge legacy `http://schema.org/` data with `owl:sameAs` handling if you need to.

## The `kg:` frontmatter key

**Naming:** the *frontmatter key* is `kg:`; the *RDF namespace prefix* is `dockg:`. The `kg` key holds the SKOS fields dockg owns, validated by the JSON Schema published in this repo (`schemas/frontmatter-0.4.json`). Docs without a `kg` key are fine — everything above still derives.

```yaml
---
title: Configuration Reference
tags: [configuration]
kg:
  prefLabel: Configuration        # -> foaf:primaryTopic concept, skos:prefLabel
  altLabels: [config, settings]   # -> skos:altLabel
  broader: [Administration]       # -> skos:broader
  narrower: [Environment Variables]
  related: [Installation]         # -> skos:related
  subjects: [reference]           # -> dcterms:subject (like tags)
---
```

## Example output

```turtle
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix dockg: <https://dockg.dev/ns#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .

<https://example.com/kg/doc/docs/getting-started.md> a dockg:Document ;
  dcterms:hasPart <https://example.com/kg/doc/docs/getting-started.md#install> ;
  dcterms:references <https://example.com/kg/doc/docs/configuration.md> ;
  dcterms:subject <https://example.com/kg/concept/setup> ;
  dcterms:title "Getting Started" ;
  dockg:path "docs/getting-started.md" .

<https://example.com/kg/concept/setup> a skos:Concept ;
  skos:inScheme <https://example.com/kg/scheme> ;
  skos:prefLabel "setup" .
```

Determinism contract: doc IRIs are `{baseIri}doc/{repo-relative-path}` (OS-independent, percent-encoded), section IRIs use GitHub-style heading slugs, concept IRIs converge on slugified labels, no blank nodes ever, and the Turtle is canonically sorted. `dockg build` twice → identical bytes.

## Provenance (PROV-O)

The `provenance` derive source (on by default) folds W3C PROV-O into the graph:

| Source | Triples |
|---|---|
| every doc | `<doc> a prov:Entity` |
| `author`/`authors` | `dcterms:creator` and `prov:wasAttributedTo` point at `{base}agent/person/{slug}` nodes (`prov:Person` + `foaf:name`) — docs connect by shared authors. Toggle `provenance` off to restore plain creator literals |
| `date` | `prov:generatedAtTime` alongside `dcterms:created` |
| `kg.derivedFrom: [path-or-url]` | `prov:wasDerivedFrom` (unresolved paths surface as `dockg:brokenLink`) |
| `kg.revisionOf: [path-or-url]` | `prov:wasRevisionOf` — this doc supersedes an earlier one (same resolution rules as `derivedFrom`) |
| `kg.generatedBy` (or page-level `generatedBy`) | `prov:wasGeneratedBy` a generation activity `prov:wasAssociatedWith` the model as a `prov:SoftwareAgent` |
| `kg.provenance` (written by `dockg fill`) | a per-doc `#kg-fill` activity naming the model and the machine-filled fields (`dockg:filledField`); the doc's own topic concept is `prov:generated`. Shared tag concepts are never attributed — one doc's LLM must not taint a shared node |
| the build itself | `{base}graph` as a `prov:Entity`, generated by `{base}activity/build`, associated with dockg as a `prov:SoftwareAgent` (with `dockg:version`), `prov:used` every source doc |

**Git history (`provenance.git: true`, off by default):** one `git log` pass
per build adds per-file facts — creation/modification committer dates as
fallbacks where frontmatter has none (`dcterms:created`/`modified`,
`prov:generatedAtTime`), git authors as agent nodes (names only; emails are
never emitted), renames as `prov:wasRevisionOf` edges to the historical-path
entities (best-effort, git's `-M` heuristic), and `prov:endedAtTime` on the
build activity from the **HEAD committer date**. Frontmatter always wins over
git. Shallow clones yield partial history silently; outside a git repo the
build errors loudly.

**Qualified provenance (`provenance.qualified: true`, off by default):** adds
PROV qualification nodes alongside the direct properties, with deterministic
IRIs instead of blank nodes — `{doc}#prov.attribution.{agent}` (`prov:Attribution`,
`prov:hadRole dockg:authorRole`) and `{activity}.assoc.{agent}`
(`prov:Association`, roles `dockg:generatorRole` / `dockg:toolRole`).

**Timestamps and determinism:** wall-clock time never enters the graph — all
dates come from frontmatter or git committer times, so rebuilds at the same
commit stay byte-identical.

Provenance node fragments use `.` separators (`#prov.generation`,
`#prov.kg-fill.{model}`), which heading slugs can never produce — a
`## Generation` section can't collide with the generation activity.

**Agent IRIs are segmented by kind** — `{base}agent/person/{slug}`,
`{base}agent/software/{slug}`, and `{base}agent/org/{slug}`, mirroring PROV-O's
three `prov:Agent` subclasses. Without the segment, a human author named
"GPT 4" and a `generatedBy: gpt-4` model would slug alike and merge into one
node typed both `prov:Person` and `prov:SoftwareAgent`. Two people who share a
name still converge, exactly as two identical concept labels do — dockg has no
other information to tell them apart.

`dockg fill` records `kg.provenance` entries — one `{generatedBy, fields}`
entry **per model**, so multi-model fills keep truthful attribution — on every doc it
fills (disable with `fill.writeProvenance: false`). Fields accumulate across
runs; delete the entry (or fields from it) once a human has reviewed the
values, and the machine-attribution disappears from the graph. That makes
"which parts of my taxonomy did an LLM propose?" a one-liner:
`dockg query -p dockg:filledField`.

These fields are validated by **`schemas/frontmatter-0.4.json`** (bundled with
the package; the default for `dockg validate`). Earlier versions
(`frontmatter-0.1.json`, `frontmatter-0.2.json`) remain published alongside it.

## Route mappings

Doc sites (Fern, Starlight, Hugo, Docusaurus) link by *published route* (`/docs/actions/find`), not by source file. Route mappings teach dockg how routes map back to files so those links become real graph edges — and so routes under a mapped prefix with **no** matching file are reported as broken (they name pages that should exist):

```yaml
routes:
  - basePath: /docs               # site prefix this mapping covers
    root: docs/fern/pages/docs    # repo dir routes resolve into
    extensions: [.mdx, .md]       # tried when the route has no extension
    indexFiles: [index, README]   # tried for directory routes (/docs/actions/)
```

Matching is tiered and deterministic: exact path, then case-insensitive, then slug-normalized (so Fern's `/stop-record` finds `stopRecord.mdx`). Ambiguous fallback matches stay unresolved rather than guessing. Root-absolute links outside every mapped `basePath` are skipped, not broken.

On the doc-detective docs corpus (197 files), adding six route mappings took the reference graph from 165 to 720 edges and cut false orphans from 137 to 13.

## AI fill

`dockg fill` has an LLM propose `kg:` fields from each doc's title, headings, tags, and body, and writes them back — body and existing YAML preserved byte-for-byte.

```bash
dockg fill --dry-run          # see proposals without writing
dockg fill                    # write them
dockg fill --force            # overwrite human-set kg fields too
```

- Providers: **anthropic** (default, `ANTHROPIC_API_KEY`), **openai** (any OpenAI-compatible endpoint via `fill.baseUrl`), **claude-cli** (local `claude` auth, no key), **mock** (offline).
- Proposals are cached by content (`.dockg/cache/`) — unchanged docs never re-ask.
- Cost is tracked and budgeted (`fill.maxCostUsd`, `--max-cost`).
- `broader`/`narrower` are **off by default** (`fill.fields`): hierarchy proposals hallucinate most. Opt in deliberately, and review with `--dry-run` first.
- Human-set fields always win unless `--force`.

## Commands

| Command | Purpose |
|---|---|
| `dockg init` | Scaffold a starter `dockg.config.yaml` |
| `dockg build [globs]` | Derive the graph and write deterministic Turtle |
| `dockg validate [globs]` | Check KG frontmatter via docmeta (bundled `schemas/frontmatter-0.4.json`) |
| `dockg fill [globs]` | Propose SKOS `kg:` fields with an LLM and write them back |
| `dockg query` | Triple-pattern match: `-s`/`-p`/`-o`, omit for wildcard |
| `dockg stats` | Counts, orphan docs, broken links, most-connected docs; `--check` gates CI |

Shared flags: `-c/--config`, `-f/--format pretty|json`; `build` takes `-o/--out`; `query`/`stats` take `-g/--graph`. SPARQL is a planned upgrade behind `query`.

## Configuration

`dockg.config.yaml`, validated against a JSON Schema (`dockg:config:0.1`):

```yaml
version: 1
baseIri: https://example.com/kg/   # default: urn:dockg: placeholder
inputs: ["docs/**/*.md"]
exclude: ["**/node_modules/**"]
out: kg/graph.ttl
build:
  derive: [frontmatter, sections, links, tags, images, code]
provenance:
  git: false         # opt-in: per-file git dates/authors, rename revisions, build endedAtTime
  qualified: false   # opt-in: qualified attribution/association nodes with roles
# validate.schemas defaults to the bundled schemas/frontmatter-0.4.json
fill:
  provider: anthropic
  temperature: 0
  maxCostUsd: 5
  cacheDir: .dockg/cache
  fields: [prefLabel, altLabels, related, subjects]
```

## Contributing

```bash
npm install
```

Use `npm install`, not `npm ci`: the committed lock is generated on Windows and omits the Linux-side optional dependencies of rolldown's wasm binding, so a strict lock check can't pass on both platforms.

### Quality gates

Checks are layered by cost — fast ones on commit, the full loop on push, and everything again in CI, which is the authoritative gate.

| Script | What it checks |
|---|---|
| `npm run format:check` / `npm run format` | Prettier formatting |
| `npm run lint` / `npm run lint:fix` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | tsup bundle into `dist/` |
| `npm test` | vitest, unit + integration |

| Git hook | Runs |
|---|---|
| `pre-commit` | lint-staged (Prettier + ESLint on staged files), then `typecheck` |
| `pre-push` | `typecheck`, `build`, `test` |
| `commit-msg` | commitlint |

Hooks are installed by husky on `npm install`. Build before test — the integration suite executes `dist/cli.js`, not `src/`.

Prettier deliberately ignores `test/fixtures/` and `schemas/`: the corpus and golden graph are byte-exact regression baselines, and published frontmatter schemas are immutable once released. `.gitattributes` pins LF line endings everywhere except those byte-exact fixtures.

### Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), enforced by the `commit-msg` hook and re-checked across the whole PR range in CI — hooks are bypassable, and semantic-release derives every version bump from these messages. Subjects must be lower-case: `feat: prov-o support`, not `feat: PROV-O support`.

| Type | Release |
|---|---|
| `fix:` | patch |
| `feat:` | minor |
| `feat!:` or a `BREAKING CHANGE:` footer | major |
| `chore:`, `docs:`, `ci:`, `style:`, `test:`, `refactor:`, `build:`, `perf:` | none |

Releases are fully automated by semantic-release. Don't hand-edit `version` in `package.json`, create `v*` tags, or run `npm publish` locally.

## License

MIT
