---
status: accepted
date: 2026-07-21
decision-makers: [hawkeyexl, Claude]
---

# Publish a SHACL shapes contract, add `dockg check`, and guard `dockg fill` with it

## Context and Problem Statement

`dockg validate` checks docs one file at a time against a JSON Schema. But
dockg's most fragile invariants are emergent — they only exist after `derive`
has merged N docs into shared nodes, and nothing validated them:

- Concept IRIs deliberately converge on slugified labels, so `tags: [Set Up]`
  in one doc and `kg.prefLabel: setup` in another land on one IRI with two
  `skos:prefLabel` values. The regression corpus already carried two such
  collisions, invisible to every existing check.
- `skos:broader` cycles and `skos:related`⨯`skos:broaderTransitive` conflicts
  (SKOS S27). `fill.fields` keeps `broader`/`narrower` off by default because
  hierarchy proposals hallucinate most — there was no gate that would make
  turning them on safe.
- Half-built nodes: subjects without `rdf:type skos:Concept`, concepts without
  `skos:inScheme`, agents without `foaf:name` — exactly what a downstream
  consumer trips over after merging the emitted Turtle into their store.

How should dockg validate the *assembled graph*, and what standing should
those rules have?

## Decision Drivers

- The emitted graph is a published artifact; consumers need a machine-readable
  statement of what a valid dockg graph looks like, not just a README table.
- `dockg fill` needs a correctness gate strong enough to flip hierarchy fill
  from "don't use this" to "verified on write".
- No network in tests; no new exit-code semantics; determinism everywhere.
- Concept-IRI convergence is a documented feature — validation must not
  declare the design itself broken.

## Considered Options

1. SHACL shapes as a **published, immutable contract** (`shapes/dockg-0.1.ttl`
   shipped in the npm package, versioned like `schemas/`), consumed by a new
   `dockg check` command and by a `dockg fill` guardrail.
2. SHACL as an **internal lint** — shapes private to the repo, changeable at
   will, not part of the package surface.
3. More hand-rolled TypeScript checks in `stats` (no SHACL at all).

## Decision Outcome

Chosen option 1. The shapes file ships in the package `files`, is immutable
once published (evolve via `shapes/dockg-0.2.ttl`), and uses named shape IRIs
throughout so it diffs cleanly. `dockg check` validates the built graph
against it (default; `check.shapes` / `--shapes` override) and maps every
finding back to the doc paths responsible. `dockg fill` simulates each
proposal against the same shapes before writing frontmatter and drops
violating fields (`fill.validateGraph`, on by default; `--no-validate-graph`).

Three subsidiary decisions:

- **Cycle detection lives in TypeScript, not SHACL-SPARQL.** Core SHACL
  cannot express "no `skos:broader` cycles" and `rdf-validate-shacl` does not
  implement SHACL-SPARQL. A deterministic Tarjan walk in the check core
  covers cycles and transitive related/broader disjointness; the shapes file
  covers everything cardinality/type/closed-shaped. Findings merge into one
  report.
- **prefLabel collisions are Warnings, not Violations.** Convergence of
  spellings onto one concept is dockg's documented design; failing the build
  over it would condemn the feature. `dockg check` surfaces the collision
  (exit 0), while the fill guardrail still rejects *new* second spellings an
  LLM proposes — humans may converge, machines may not add spellings.
- **Severity maps onto the existing exit-code contract**: `sh:Violation` (or
  a TS-detected cycle/conflict) → exit 1, `sh:Warning`/`sh:Info` → reported,
  exit 0, operational failure (`DockgError`) → exit 2.

### Consequences

- Good: the vocabulary README table now has an enforceable, machine-readable
  counterpart; downstream consumers can validate merged graphs against the
  same contract dockg tests itself with.
- Good: closed shapes (`sh:closed true` on Document/Section/Concept/agents)
  make an unexpected predicate from a future derive source fail loudly — the
  graph-side analogue of `additionalProperties: false`.
- Good: `fill.fields: [broader, narrower, …]` is now a defensible opt-in; the
  guardrail also accumulates accepted proposals within a run, so two docs
  cannot jointly form a cycle.
- Bad: any change to what `derive` emits now requires a shapes review (and a
  new shapes version when the published contract changes) — a deliberate new
  definition-of-done step recorded in CLAUDE.md.
- Bad: the guardrail re-derives and re-validates the SKOS subgraph per
  guarded proposal (O(docs) per doc). Acceptable for documentation corpora;
  scoped to `frontmatter`+`tags` derive sources to keep it cheap and git-free.

### Confirmation

`test/unit/shacl.test.ts` (one failing case per shape family, cycle/conflict
walks, blame reporter, determinism), `test/integration/check.test.ts` (clean
regression corpus exits 0; `test/fixtures/check-violations/` corpus exits 1
naming offending docs; byte-identical double runs; missing shapes/graph exit
2), and the guardrail cases in `test/unit/fill.test.ts` (cycle rejected,
joint-cycle rejected across docs, second-spelling rejected, exact-spelling
accepted, both off-switches).

## Pros and Cons of the Options

### Published SHACL contract + check command + fill guardrail

- Good: one rule set serves three audiences — CI (`check`), the LLM pipeline
  (`fill`), and downstream consumers (shipped file).
- Good: standard vocabulary (SHACL) instead of a bespoke rule format.
- Bad: immutability commitment; contract changes require versioned files.

### Internal lint only

- Good: no compatibility commitment, free to iterate.
- Bad: consumers can't validate against it; the README table stays the only
  (unenforceable) statement of the graph's shape.

### More hand-rolled TypeScript in `stats`

- Good: no new dependency.
- Bad: every rule is imperative code; nothing is publishable or reusable;
  `stats` drifts into an ad-hoc validator dockg already decided SHACL
  expresses better.
