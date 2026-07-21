# dockg

Deterministic knowledge graphs derived from documentation frontmatter and formatting, saved as Turtle.

`dockg` reads your docs — Markdown first — and derives an RDF knowledge graph from what is already there: frontmatter fields, heading structure, links between pages, tags, images, and code blocks. The build is **deterministic**: stable IRIs, sorted serialization, byte-identical rebuilds. The emitted `.ttl` diffs cleanly in git, so the graph can live next to the docs it describes.

It pairs with [docmeta](https://github.com/hawkeyexl/docmeta) (which ships the `dockg:frontmatter:0.1` schema as a built-in, so `docmeta validate` can check KG-readiness) and follows the same CLI conventions as [docevals](https://github.com/hawkeyexl/docevals).

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
| internal links | `dcterms:references` to the target doc (or its section when the anchor resolves). Site-root-absolute routes (`/docs/x/`) are skipped — they name published pages, not repo files |
| broken internal links | `dockg:brokenLink "target.md"` (surfaced by `stats`) |
| external links | `dcterms:references <url>` |
| images | `schema:image` |
| code fence languages | `dockg:codeLanguage "python"` |
| `kg:` frontmatter | see below |

Note: the emitted `schema:` prefix is `https://schema.org/` (the current recommendation); merge legacy `http://schema.org/` data with `owl:sameAs` handling if you need to.

## The `kg:` frontmatter key

**Naming:** the *frontmatter key* is `kg:`; the *RDF namespace prefix* is `dockg:`. The `kg` key holds the SKOS fields dockg owns, validated by the docmeta built-in schema `dockg:frontmatter:0.1`. Docs without a `kg` key are fine — everything above still derives.

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
| `dockg validate [globs]` | Check KG frontmatter via docmeta (`dockg:frontmatter:0.1`) |
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
validate:
  schemas: ["dockg:frontmatter:0.1"]
fill:
  provider: anthropic
  temperature: 0
  maxCostUsd: 5
  cacheDir: .dockg/cache
  fields: [prefLabel, altLabels, related, subjects]
```

## License

MIT
