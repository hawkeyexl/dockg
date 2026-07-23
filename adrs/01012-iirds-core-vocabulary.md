---
status: accepted
date: 2026-07-23
decision-makers: [hawkeyexl, Claude]
---

# Adopt iiRDS Core (and the Software domain) for topic typing and product applicability

## Context and Problem Statement

DESIGN.md commits dockg to speaking the technical-communication industry's RDF
dialect where a term fits, rather than minting `dockg:` terms. iiRDS (the
intelligent information Request and Delivery Standard, tekom) is that dialect.
This phase adds the highest-value mappings — **topic typing** and **product /
variant applicability** — plus the **iiRDS Software domain**, the first change
that grows the emitted graph and its published SHACL contract.

Research against the official `iirds-consortium/models` repository (every IRI
below byte-verified from the raw RDF, not a summary) settled the facts and
corrected two prior assumptions:

- Namespace `http://iirds.tekom.de/iirds#` is **stable across versions** (new
  versions add terms, never renamespace) — safe to hardcode.
- iiRDS is licensed **CC BY-ND 4.0**. Referencing the published IRIs is
  ordinary use; re-serializing, trimming, or merging the vocabulary is a
  prohibited derivative.
- iiRDS models its controlled values (e.g. `iirds:GenericTask`) as **instances
  typed by iiRDS classes, not `skos:Concept`**, and the Software-domain values
  carry `rdfs:label`, not `skos:prefLabel`.
- An official **Software domain exists** (`.../domain/software#`, iiRDS 1.2) —
  DESIGN.md wrongly assumed none did. Its 9 values are **not uniform**: 6 are
  product-lifecycle phases, 3 are information subjects, reached by two
  different predicates.
- **No official SHACL shapes** are published (RDFS only), so dockg authors its
  own, as it already does.

## Decision Drivers

- Prefer external standard vocabularies over the minimal `dockg:` namespace.
- Stay license-clean: reference IRIs, never vendor or re-serialize the
  vocabulary.
- Determinism and the closed-shapes contract are unchanged obligations.
- The mapping must be faithful to how iiRDS actually models these values, not a
  convenient approximation.

## Considered Options

For topic-type emission:
1. **Reference the iiRDS instance IRIs directly** (`<doc> iirds:has-topic-type
   iirds:GenericTask`).
2. Also type each doc `a iirds:Topic` / `a iirds:InformationUnit`.
3. Mirror the types as local `skos:Concept` nodes (uniform with dockg's
   existing concept emission).

For the Software domain:
1. Adopt it now, split across its two real predicates.
2. Adopt only Core now, defer the Software domain.
3. Fold the 9 values into one flat frontmatter key.

## Decision Outcome

**Topic types: option 1 — reference the published instance IRIs directly.** A
closed enum of the 6 Core topic types (`task`, `concept`, `reference`,
`learning`, `troubleshooting`, `form`) maps `kg.topicType` →
`iirds:has-topic-type` → the matching `iirds:Generic*` IRI. dockg does not
re-type or redefine those IRIs (option 3 would diverge from iiRDS's own
modeling and risks a CC BY-ND derivative; option 2 layers extra classes onto
nodes already typed `dockg:Document`/`prov:Entity` and drags in the
Package/Fragment hierarchy for no present benefit).

**Product applicability: mint local `iirds:ProductVariant` nodes.**
`kg.appliesTo: [label]` → `<doc> iirds:relates-to-product-variant
<{base}product/{slug}>`, the node typed `iirds:ProductVariant` with a
`dcterms:title` label. Variant nodes are corpus-specific, so unlike the
controlled values they are minted (deterministic slugged IRIs in a `product/`
segment, distinct from `concept/` so a shared label cannot collide).
`dcterms:title` labels the node — it is already in the prefix set and
domain-agnostic; `skos:prefLabel` would be wrong since the node is not a
`skos:Concept`.

**Software domain: option 1 — adopt now, split across two predicates.** The 9
values are two dimensions with two attachment predicates, byte-confirmed from
the wrapper elements in `iirds-software.rdf`:

- 6 **product-lifecycle phases** (`iirds:Use`/`PuttingToUse`/`AfterUse` →
  `iirds:ProductLifeCyclePhase`): Administration, Customization, Update,
  Deployment, Integration, Deinstallation — reached by
  `iirds:relates-to-product-lifecycle-phase`.
- 3 **information subjects** (`iirds:TechnicalOverview`/`TechnicalData` →
  `iirds:InformationSubject`): Architecture, Interface, SystemRequirement —
  reached by `iirds:has-subject`.

Two frontmatter keys mirror the two predicates: `kg.softwareLifecyclePhase`
and `kg.softwareSubject`, both list-valued (both predicates are `[0..*]`, and
one doc can carry both dimensions). Option 3 (one flat key) was rejected: it
would force the emitter to reverse-map every value to its predicate and hides
the modeling. Both keys reference the published `iirdsSft:` instance IRIs
directly — no minting, no re-typing.

Enum keys are lowercase-kebab (consistent with `kg.topicType`); the upstream
`@en` labels are inconsistently cased, so the iiRDS **local names** are the
stable map targets.

### Consequences

- Good: dockg graphs carry industry-standard topic types, product
  applicability, and software classification that downstream iiRDS-aware tools
  understand, with zero growth of the `dockg:` namespace.
- Good: license-clean — only IRIs are referenced; the vocabulary is never
  bundled or altered.
- Bad: every emitted graph gains two `@prefix` lines (`iirds:`, `iirdsSft:`)
  even when no iiRDS term is used, because the emitter emits a fixed header.
  Consistent with the existing design; the golden regenerates once.
- Bad: the closed Document shape must learn four new predicates
  (`shapes/dockg-0.2.ttl`); until it does, `dockg check` fails on them — the
  intended gate, not a regression.
- Neutral: `kg.appliesTo` mints nodes; `softwareLifecyclePhase`/`Subject` and
  `topicType` reference published IRIs. Two mechanisms, because variants are
  corpus-specific and the others are a fixed controlled vocabulary.

### Confirmation

Every IRI is byte-verified against the raw `iirds-core.rdf` /
`iirds-software.rdf`. `test/unit/schema-sync.test.ts` pins each schema enum to
its `src/core/iirds.ts` map so they cannot drift. `test/unit/derive.test.ts`
asserts the emitted predicate/object for each field and that an absent `kg`
key emits no iiRDS triples. `dockg validate` rejects out-of-enum values.
`dockg build` can only ever emit the published IRIs, so the `sh:in` gate is
exercised at the shapes layer instead: `test/unit/shacl.test.ts` validates a
hand-built graph with an out-of-set topic-type IRI and asserts a violation
(and a conforming iiRDS graph with no findings), while
`test/integration/check.test.ts` confirms the clean corpus still exits 0
against `dockg-0.2.ttl`. The determinism gates (double-build,
version-normalized golden, n3 round-trip) cover the new triples.

## Pros and Cons of the Options

### Reference instance IRIs directly

- Good: faithful to iiRDS modeling; license-clean; minimal surface.
- Bad: dockg asserts a link to an IRI whose definition lives upstream —
  consumers must dereference the vocabulary to resolve its meaning (true of any
  external-term reference).

### Also type the doc `a iirds:Topic`

- Good: more complete iiRDS information-unit modeling.
- Bad: multiple `rdf:type`s per node; invites Package/Fragment questions;
  more shapes for no present consumer.

### Mirror as local `skos:Concept`

- Good: uniform with dockg's existing concept emission.
- Bad: diverges from iiRDS's own typing and edges toward re-publishing a
  modified form of a CC BY-ND vocabulary.

### One flat software key

- Good: one field to author.
- Bad: two predicates hidden behind one key; emitter must reverse-map; harder
  to validate with `sh:in`.
