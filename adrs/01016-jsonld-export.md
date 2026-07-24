---
status: accepted
date: 2026-07-24
decision-makers: [manuel.r.b.silva]
---

# JSON-LD export via a deterministic hand-rolled serializer

## Context and Problem Statement

dockg's graph reaches consumers only as Turtle. Turtle is the canonical
git-diff form (`src/core/emit.ts`), but the wider web — answer engines, search
crawlers, JSON tooling — consumes RDF as **JSON-LD**. Because dockg already
emits `schema.org` terms, a JSON-LD rendering of the same graph is directly
usable by that audience with no lossy remapping. The roadmap's export arc
(Phase 6) starts here: a `dockg export --format jsonld` command that
reserializes the built graph as JSON-LD.

The question is not _whether_ to emit JSON-LD but _how_ to keep it inside
dockg's determinism contract: two exports over the same graph must be
byte-identical, with no wall clock and no blank nodes, exactly as the Turtle
emitter guarantees.

## Decision Drivers

- **Determinism is the product contract.** JSON-LD output must be byte-stable
  and regression-gated by a golden, like the Turtle output.
- **Losslessness.** The endgame is a GraphRAG index; an export that silently
  drops triples would corrupt any round-trip. Every triple must survive.
- **No new heavy dependencies.** dockg has no `jsonld` library and deliberately
  hand-rolls its Turtle emitter so formatting is controlled, not incidental
  library behavior.
- **Stable flag surface.** The `--format` flag should name the formats the
  export arc will grow into (iiRDS package is Phase 6b) without shipping them
  half-done.

## Considered Options

1. **Hand-rolled deterministic JSON-LD serializer** mirroring the Turtle
   emitter — group by subject, compact CURIE keys, sort everything, build
   objects in sorted key order, `JSON.stringify(_, null, 2)`.
2. **The `jsonld` npm library** (`jsonld.toRDF`/`fromRDF`/`compact`). Its
   output order and formatting are library-defined and not guaranteed stable
   across versions; pinning determinism would mean post-processing its output
   anyway.
3. **Emit JSON-LD as an extra `build` output** rather than a standalone
   command.

## Decision Outcome

Chosen: **option 1** — a hand-rolled `emitJsonLd(quads)` in
`src/core/emit-jsonld.ts`, delivered through a standalone
`dockg export --format jsonld` command (`src/commands/export.ts`) that reads the
built graph the same way `stats` and `check` do.

Output shape: `{ "@context": <PREFIXES table>, "@graph": [ …nodes ] }`. Nodes
are grouped by subject; `rdf:type` folds into `@type` (compacted class IRIs);
other predicates use compacted CURIE keys (`compactIri`); IRI objects become
`{ "@id": … }`, plain literals the bare string, typed literals
`{ "@value": …, "@type": "xsd:…" }`. Single-valued predicates emit a scalar,
multi-valued a sorted array — a cardinality-driven rule that is still fully
deterministic. dockg emits no blank nodes and no language-tagged literals, so
neither needs handling.

Determinism: `@graph` sorted by `@id`; within a node, predicate keys sorted and
each value array sorted; `@type` sorted; objects built in sorted key order so
`JSON.stringify` is byte-stable. The only variable is the `dockg:version`
literal, normalized in the golden exactly as for Turtle.

`--format` recognizes `iirds` but returns a `DockgError` ("not yet supported
(Phase 6b)") so the flag surface is stable while the iiRDS package serializer is
built out separately.

### Consequences

- Good: web-native, lossless export with zero new runtime dependencies and the
  same determinism guarantees as Turtle.
- Good: the `export` command generalizes — Phase 6b adds `iirds` behind the same
  flag.
- Neutral: a second serializer to maintain. Mitigated by a golden regression
  gate and an n-triples-count equivalence check against the source graph.
- Bad: the cardinality-driven scalar/array rule means a predicate's JSON shape
  depends on how many values a given node has. This is standard compacted
  JSON-LD and consumers handle both, but it is worth stating.

### Confirmation

- Unit test over a hand-built quad set: `@type` folding, IRI/plain/typed
  literal rendering, `@context` presence, sorting, valid JSON.
- Integration test: `dockg export --format jsonld` over the corpus matches a
  version-normalized golden `test/fixtures/golden/graph.jsonld`; double-export
  byte-identical; `@graph` node count equals the graph's distinct-subject count;
  `--format iirds` and a missing graph both exit 2.
- The Turtle golden is untouched.

## Pros and Cons of the Options

### Option 1 — hand-rolled serializer

- Good: total control over byte output → determinism by construction.
- Good: no new dependency; mirrors the established Turtle-emitter philosophy.
- Bad: we own the escaping/compaction logic (already own it for Turtle).

### Option 2 — `jsonld` library

- Good: spec-complete, handles framing/expansion we don't need.
- Bad: output ordering/formatting is not a stability contract; determinism
  would require post-processing its output — most of option 1's work plus a
  dependency.

### Option 3 — extra `build` output

- Good: one command produces every artifact.
- Bad: couples format proliferation to the build path; `stats`/`check` already
  establish the "read the built graph" command pattern that export follows.
