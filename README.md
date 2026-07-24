# dockg

Deterministic knowledge graphs derived from documentation frontmatter and formatting, saved as Turtle.

`dockg` reads your docs — Markdown first — and derives an RDF knowledge graph from what is already there: frontmatter fields, heading structure, links between pages, tags, images, and code blocks. The build is **deterministic**: stable IRIs, sorted serialization, byte-identical rebuilds. The emitted `.ttl` diffs cleanly in git, so the graph can live next to the docs it describes.

It pairs with [docmeta](https://github.com/hawkeyexl/docmeta) (which powers `dockg validate`) and follows the same CLI conventions as [docevals](https://github.com/hawkeyexl/docevals). dockg's frontmatter schema is published in this repo at [`schemas/frontmatter-0.7.json`](schemas/frontmatter-0.7.json) — point any JSON Schema tool at it, e.g. `docmeta validate --schema node_modules/dockg/schemas/frontmatter-0.7.json docs/`.

## What the graph is (and isn't)

The graph is an **index and governance layer** over your docs — not a replacement
for them, and not a retrieval corpus ([ADR 01008](adrs/01008-graph-as-index-not-corpus.md)).
Prose never enters the graph; only metadata does. Consume it in two halves:

- **The graph routes, filters, audits, and attributes.** Scope questions ("what
  applies to this variant?"), impact analysis ("what references this doc?"),
  compliance audit (`dockg check`), and provenance are graph jobs — the work a
  typed graph does better than similarity search over text.
- **The files carry the content.** Every Document and Section IRI resolves to an
  exact span on disk: `dockg:path` gives the file, and a Section IRI's fragment
  is the GitHub-style heading slug. Route with the graph, then read the text.

**What isn't in the graph is invisible to anything querying the graph alone.** A
fact that lives only in prose does not exist for a graph-only consumer — so a
retrieval system built on dockg must read the files the graph points at rather
than answering from triples. The more you lift into frontmatter, the more the
graph can route and govern; [`dockg stats`](#metadata-coverage) reports how much
you have lifted so the gaps are a number you can see.

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
dockg check           # graph-level SHACL validation
```

Exit codes: `0` ok · `1` findings (validation failures, `check` violations, `stats --check` broken links, `fill` errors) · `2` operational error.

## What gets derived

Standard vocabularies wherever a term exists — Dublin Core (`dcterms:`), SKOS (`skos:`), schema.org (`schema:`), FOAF (`foaf:`), and iiRDS (`iirds:`, `iirdsSft:`) for technical-documentation semantics — plus a minimal custom namespace `dockg: <https://dockg.dev/ns#>` (2 classes, 8 properties).

| Source | Triples |
|---|---|
| every doc | `<doc> a dockg:Document ; dockg:path "docs/x.md"` |
| `title` (fallback: first H1) | `dcterms:title` |
| `description` / `author(s)` / `date` / `updated` / `lang` | `dcterms:description` / `dcterms:creator` / `dcterms:created`^^xsd:date / `dcterms:modified` / `dcterms:language` |
| `tags` / `keywords` | `<doc> dcterms:subject <concept>` ; concept nodes are `skos:Concept` with `skos:prefLabel` and `skos:inScheme` |
| headings | `dockg:Section` nodes with `dcterms:title`, `dockg:level`, `dockg:order`, nested via `dcterms:hasPart` |
| internal links | `dcterms:references` to the target doc (or its section when the anchor resolves). Extensionless relative links try `.md`/`.mdx` and index files. Site-root-absolute routes (`/docs/x/`) resolve via [route mappings](#route-mappings); without a mapping they are skipped |
| broken internal links | `dockg:brokenLink "target.md"` (surfaced by `stats`) |
| broken `kg.sections` refs | `dockg:brokenSectionRef "slug"` — a section key naming no heading (surfaced by `stats`) |
| external links | `dcterms:references <url>` |
| images | `schema:image` |
| code fence languages | `dockg:codeLanguage "python"` |
| `kg.topicType` | `iirds:has-topic-type` → the matching iiRDS Core instance (`iirds:GenericTask`, …) |
| `kg.appliesTo` | `iirds:relates-to-product-variant` → minted `iirds:ProductVariant` nodes (`dcterms:title` label) |
| `kg.softwareLifecyclePhase` / `kg.softwareSubject` | iiRDS Software domain — `iirds:relates-to-product-lifecycle-phase` / `iirds:has-subject` → published `iirdsSft:` instances |
| `kg.notApplicableTo` / `kg.notSoftwareSubject` | explicit negative scope — `dockg:notApplicableToVariant` / `dockg:notSoftwareSubject`, `sh:disjoint` from the positive edge |
| `kg:` frontmatter | see below |

Note: the emitted `schema:` prefix is `https://schema.org/` (the current recommendation); merge legacy `http://schema.org/` data with `owl:sameAs` handling if you need to.

## The `kg:` frontmatter key

**Naming:** the *frontmatter key* is `kg:`; the *RDF namespace prefix* is `dockg:`. The `kg` key holds the SKOS fields dockg owns plus iiRDS typing, validated by the JSON Schema published in this repo (`schemas/frontmatter-0.7.json`). Docs without a `kg` key are fine — everything above still derives.

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
  # iiRDS typing (all optional; values are closed controlled vocabularies):
  topicType: reference            # task|concept|reference|learning|troubleshooting|form
  appliesTo: [SP-X100, SP-X200]   # -> iirds:ProductVariant nodes this doc applies to
  softwareLifecyclePhase: [deployment]  # administration|customization|update|deployment|integration|deinstallation
  softwareSubject: [interface]    # architecture|interface|system-requirement
---
```

The iiRDS values reference published iiRDS instance IRIs directly — dockg never
bundles or alters the iiRDS vocabulary (it is CC BY-ND). `topicType` is a single
value; the other three are lists. See [ADR 01012](adrs/01012-iirds-core-vocabulary.md).

### Per-section metadata (`kg.sections`)

The same iiRDS typing (plus `subjects`) can attach to an individual heading
section, keyed by its GitHub-style slug — the same slug used in section IRIs and
link anchors ([ADR 01013](adrs/01013-section-level-metadata.md)):

```yaml
kg:
  topicType: concept          # the document as a whole
  sections:
    installation:             # matches `## Installation`
      topicType: task
      appliesTo: [SP-X200]
    rest-api:                 # matches `## REST API`
      softwareSubject: [interface]
      subjects: [http]
```

Section metadata is **explicit-only** — a section gets exactly what its block
declares, nothing inherited from the document. A key that matches no heading
(e.g. after a heading is renamed) derives `<doc> dockg:brokenSectionRef "slug"`,
surfaced by [`dockg stats`](#metadata-coverage) and gated by `stats --check`,
just like a broken link — so the metadata is never silently lost.

### Negative scope (`kg.notApplicableTo`, `kg.notSoftwareSubject`)

Content can also assert what it explicitly does **not** apply to — the RDF-safe
form of an interlock ([ADR 01014](adrs/01014-negative-scope.md)). Both fields
work at document and section level and mirror their positive counterparts:

```yaml
kg:
  appliesTo: [SP-X100, SP-X200]
  notApplicableTo: [SP-X300]      # -> dockg:notApplicableToVariant
  softwareSubject: [interface]
  notSoftwareSubject: [architecture]  # -> dockg:notSoftwareSubject
```

A variant or subject listed as both applicable and not-applicable on the **same**
node is a contradiction — `dockg check` fails it via `sh:disjoint`.

**Consumer contract (this matters for retrieval).** RDF is open-world: the
*absence* of an `appliesTo` edge means **unknown**, not "does not apply." A
retrieval interlock that wants to exclude content must query the **negative**
edge (`dockg:notApplicableToVariant`) — it must never infer exclusion from a
missing positive edge. That distinction is what lets a graph-driven assistant
stay correctly silent instead of guessing across a variant boundary. dockg mints
these two `dockg:` predicates because no standard term exists and the OWL
negative-assertion idiom requires blank nodes (which dockg never emits).

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

**Git history (`provenance.git`, `auto` by default):** one `git log` pass
per build adds per-file facts — creation/modification committer dates as
fallbacks where frontmatter has none (`dcterms:created`/`modified`,
`prov:generatedAtTime`), git authors as agent nodes (names only; emails are
never emitted), renames as `prov:wasRevisionOf` edges to the historical-path
entities (best-effort, git's `-M` heuristic), and `prov:endedAtTime` on the
build activity from the **HEAD committer date**. Frontmatter always wins over
git. Shallow clones yield partial history silently.

The setting has three states:

| Value | Behavior |
|---|---|
| `auto` (default) | Derive git provenance where git can run; where it can't (no repo, no commits, no `git` on PATH), warn on stderr and build without it |
| `true` | Require it — an unavailable git is an operational error (exit 2) |
| `false` | Skip git entirely; no subprocess runs |

**Qualified provenance (`provenance.qualified`, on by default):** adds
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

These fields are validated by **`schemas/frontmatter-0.7.json`** (bundled with
the package; the default for `dockg validate`). Earlier versions
(`frontmatter-0.1.json` through `frontmatter-0.6.json`) remain published
alongside it.

## Graph validation (SHACL)

`dockg check` validates the **assembled graph** — the thing `dockg validate` structurally cannot see, because per-file JSON Schema runs before N docs merge into shared nodes:

```bash
dockg build && dockg check
```

The rules live in a published SHACL shapes contract, [`shapes/dockg-0.4.ttl`](shapes/dockg-0.4.ttl), bundled with the package (override with `check.shapes` or `--shapes`). Like the frontmatter schemas, published shapes files are immutable — the contract evolves by adding a new version file. Point any SHACL tool at it to validate your own merged graphs against the same rules.

What it catches:

| Finding | Severity |
|---|---|
| `skos:broader`/`skos:narrower` cycles (a concept as its own ancestor) | violation |
| `skos:related` conflicting with `skos:broaderTransitive` (SKOS S27) | violation |
| concepts missing `skos:prefLabel` or `skos:inScheme`; untyped relation targets | violation |
| unexpected predicates on Document/Section/Concept/agent nodes (`sh:closed` — the graph-side `additionalProperties: false`) | violation |
| broken PROV wiring (activities without types, agents without `foaf:name`) | violation |
| one concept carrying two `prefLabel` spellings (slug convergence, e.g. `Configuration` + `configuration`) | warning |
| `dcterms:subject` pointing at a non-`skos:Concept` node | warning |

Violations exit `1`; warnings are reported but exit `0` (spelling convergence is a designed feature — the warning tells you to settle on one spelling, not that the build is broken). Every finding is mapped back to the doc file(s) responsible:

```
violation: concept/beta skos:broader — skos:broader cycle through concept/alpha, concept/beta — a concept cannot be its own ancestor [docs/alpha.md, docs/beta.md]
warning: concept/shared-term skos:prefLabel — concept carries multiple prefLabels … [docs/alpha.md, docs/gamma.md]

1 violation, 1 warning
```

Cycle detection and the transitive SKOS checks run in dockg itself (core SHACL cannot express them); everything else is the shapes file. The same rules power the `dockg fill` guardrail, so LLM hierarchy proposals are verified on write.

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
- `broader`/`narrower` are **off by default** (`fill.fields`): hierarchy proposals hallucinate most. When you opt in, the graph guardrail (below) verifies every proposal before it is written.
- Every proposal is simulated against the [SHACL shapes contract](#graph-validation-shacl) before writing (`fill.validateGraph`, on by default; `--no-validate-graph` to skip): fields that would create a `broader` cycle, a `related`/`broader` conflict, or a second spelling of an existing concept are dropped and reported as `[graph check rejected: …]`. Accepted proposals accumulate within the run, so two docs can't jointly form a cycle.
- Human-set fields always win unless `--force`.

## Commands

| Command | Purpose |
|---|---|
| `dockg init` | Scaffold a starter `dockg.config.yaml` |
| `dockg build [globs]` | Derive the graph and write deterministic Turtle |
| `dockg validate [globs]` | Check KG frontmatter via docmeta (bundled `schemas/frontmatter-0.7.json`) |
| `dockg check` | Validate the built graph against the SHACL shapes (bundled `shapes/dockg-0.4.ttl`) |
| `dockg fill [globs]` | Propose SKOS `kg:` fields with an LLM and write them back |
| `dockg query` | Triple-pattern match: `-s`/`-p`/`-o`, omit for wildcard |
| `dockg stats` | Counts, orphan docs, broken links, most-connected docs, metadata coverage; `--check` gates CI |

Shared flags: `-c/--config`, `-f/--format pretty|json`; `build` takes `-o/--out`; `query`/`stats`/`check` take `-g/--graph`; `check` takes `--shapes`; `stats` takes `--coverage-threshold <pct>`. SPARQL is a planned upgrade behind `query`.

### Metadata coverage

`dockg stats` reports, for each of seven per-document fields (`title`,
`description`, `creator`, `created`, `modified`, `subject`, `prefLabel`), the
share of docs that carry it. Because the graph is an index over your docs
([ADR 01008](adrs/01008-graph-as-index-not-corpus.md)), a field you never lift is
invisible to anything querying the graph — coverage turns that gap into a number.
It is measured against the graph, so a date dockg derived from git history counts
as covered. `stats.coverageThreshold` (or `--coverage-threshold <pct>` for a
uniform value) makes `stats --check` exit 1 when a gated field falls short; unset,
coverage is reported but never gates.

## Configuration

dockg is **opinionated by default** ([ADR 01009](adrs/01009-opinionated-defaults.md)):
anything it can derive from the files already on disk is on out of the box, and a
default-on feature that can't run in your setup degrades with a warning rather
than failing the build. Anything that needs the network or spends money — today
that is `dockg fill` — is never triggered by a default; you invoke it explicitly.
Every default remains overridable below.

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
  git: auto          # auto | true | false — per-file git dates/authors, rename revisions, build endedAtTime
  qualified: true    # qualified attribution/association nodes with roles
stats:
  # Minimum metadata coverage under `stats --check`. A number applies to every
  # field; a map gates named fields only. Default {} gates nothing.
  coverageThreshold:
    title: 100
    description: 50
# validate.schemas defaults to the bundled schemas/frontmatter-0.7.json
# check.shapes defaults to the bundled shapes/dockg-0.4.ttl
fill:
  provider: anthropic
  temperature: 0
  maxCostUsd: 5
  cacheDir: .dockg/cache
  fields: [prefLabel, altLabels, related, subjects]
  validateGraph: true    # reject proposals that would violate the shapes
```

## Related standards

Beyond the vocabularies dockg already emits (Dublin Core, SKOS, PROV-O,
schema.org, FOAF):

- **[iiRDS](https://iirds.org/)** — the intelligent information Request and
  Delivery Standard (tekom): the technical-communication industry's RDF
  vocabulary for documentation semantics. Namespace
  `http://iirds.tekom.de/iirds#` (Core, stable across versions) plus the
  Software domain `http://iirds.tekom.de/iirds/domain/software#`. dockg emits
  Core topic typing and product-variant applicability, and the Software
  domain's lifecycle-phase and subject classifications (see the `kg:` section).
  Only published IRIs are *referenced* — the spec is CC BY-ND, so the
  vocabulary is never vendored, re-serialized, or modified in this repo.
- **DIN SPEC 91526** — "Knowledge Graphs for Language Models and Language
  Models for Knowledge Graphs" (DIN Media, 2025): a general pre-standardization
  spec on grounding LLMs with knowledge graphs. It is *not* an iiRDS document
  and does not integrate iiRDS into the Asset Administration Shell (that is the
  separate IDTA iiRDS Submodel, IDTA 02063-1-0). Tracked as conceptual backdrop
  for the graph-grounds-LLM thesis, not a contract dockg conforms to.
- **[QUDT](https://qudt.org/)** — quantities, units, and dimensions. Relevant
  if dockg ever lifts quantitative properties (sizes, tolerances) into the
  graph.

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
