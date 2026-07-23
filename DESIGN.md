# dockg long-term design: standards-typed graphs → GraphRAG

Status: living document. This is the roadmap and decision framework, not the
decisions themselves — each phase opens by making its own decisions as ADRs
(MADR, `adrs/`), doing its listed research first. Tackle **one phase at a
time**; do not start a phase while the previous one has open decisions.

## Vision

dockg becomes the standards-typed knowledge layer for documentation
repositories: a deterministic, governed RDF graph derived from docs, exported
in the formats the outside world consumes (Turtle, JSON-LD/schema.org, iiRDS
packages), and — ultimately — the substrate of a full hybrid GraphRAG system
(graph-governed retrieval + vector entry + interlocked answer synthesis),
consumable by agents via MCP.

The design is grounded in the iiRDS × knowledge-graph work published by
Natsuki Wakabayashi (tcworld, "Architecting certainty" parts 1–3, June 2026,
plus companion posts). The load-bearing findings:

- **Vector RAG suffers "edge contamination"** — semantically close chunks let
  LLMs blend content across product/variant boundaries. Graphs prevent this
  *deterministically*: an absent edge is an interlock, forcing disciplined
  silence instead of helpful fabrication.
- **Graphs are irreplaceable for governance jobs** (variant filtering, impact
  analysis, compliance audit), while flat retrieval is adequate for ordinary
  Q&A. dockg's differentiation lives in the governance jobs.
- **"Information evaporation" (the 5 mm silence)**: a system that treats the
  graph as the sole truth surface loses every fact not lifted into a node.
  The countermeasures are hybrid consumption (graph routes, files carry
  content), measurable metadata coverage, and deliberate
  resolution-deepening (LLM-assisted property lifting with audit).
- **Granularity golden rule**: content granularity must match graph node
  granularity — hence section-level metadata.
- **Exception-based auditing**: forced-reasoning generation plus
  confidence-scored verification lets humans review only flagged exceptions.

## Settled direction (decided by the maintainer; not up for re-litigation)

1. **Opinionated defaults.** Every optional *hermetic* feature is on by
   default (git provenance, qualified provenance, new derive sources,
   coverage reporting, all export formats emitted by `dockg build`). The
   boundary: anything that costs network or money (`fill`, future
   `index`/`ask`) stays an explicit invocation — with strict guardrails as
   *its* defaults. Suppression knobs remain (opinionated ≠ non-configurable).
2. **Pre-release: breaking changes are fine.** No staged major releases, no
   migration choreography. Commits still mark breakage honestly
   (`feat!:`/`BREAKING CHANGE:`) because commitlint and semantic-release
   consume them.
3. **iiRDS is in, starting with the Core vocabulary.** Adopt iiRDS Core terms
   wherever a dockg concept maps; research domain extensions (see Phase 2
   research list) before choosing more. Reference published iiRDS IRIs —
   never vendor or modify the spec (CC BY-ND).
4. **iiRDS package export is in scope** — a first-class deliverable, not
   demand-gated.
5. **Section-level metadata is in scope** — the graph already has per-section
   nodes; metadata must be able to attach to them.
6. **GraphRAG is the endgame** — dockg grows a runtime (traversal, hybrid
   entry, synthesis, MCP serving, eval harness) on top of the build tool.

## Standing invariants (unchanged by this roadmap)

- Determinism: byte-identical rebuilds, no wall clock, no blank nodes,
  sorted emission, IRI stability. Runtime features (ask/index/mcp) live
  *outside* the hermetic build; CI never touches the network (mock providers
  only).
- The golden corpus comparison stays the regression gate; goldens change only
  deliberately, diff inspected line by line.
- Published schemas and shapes are immutable; evolve by new version files.
- Custom `dockg:` namespace stays minimal; prefer external vocabularies.
- Exit-code contract: 0 ok · 1 findings · 2 operational.
- Every behavior change: ADR + docs + shapes review in the same change.

---

## Phase 0 — Positioning and hygiene — **done**

**Goal:** ratify the product frame everything else builds on.

Decided:
- **Graph-as-index contract** — ratified as proposed
  ([ADR 01008](adrs/01008-graph-as-index-not-corpus.md)): the graph is an index
  and governance layer, prose never enters it, consumers join graph → files via
  `dockg:path` + section slug. Binds the roadmap in two ways — retrieval
  features need a content resolver, and metadata coverage becomes a
  first-class measurable concern.
- **Opinionated defaults get their own umbrella ADR**
  ([ADR 01009](adrs/01009-opinionated-defaults.md)) rather than per-phase
  argument: hermetic features default on; network and spend stay explicit
  commands; strictness stays the default *inside* those commands; default-on
  features degrade rather than fail; reporting-on-by-default does not imply
  gates-on-by-default. Includes the schedule of which knob flips in which
  phase.

Delivered: both ADRs; README "What the graph is (and isn't)" and "Related
standards" sections (incl. the iiRDS no-vendoring rule); the 01004→01007 ADR
renumbering chore.

## Phase 0b — Default flips for the existing knobs — **done**

**Goal:** apply ADR 01009 to the two opt-ins that predate it. First *behavior*
change of the roadmap; deliberately separated from Phase 0's docs-only scope.

Decided ([ADR 01010](adrs/01010-provenance-defaults-and-degradation.md)):
- **`provenance.git` became tri-state** — `"auto"` (default) derives git
  provenance where git can run and degrades with a warning where it cannot,
  `true` requires it (unavailable git → exit 2), `false` skips the subprocess.
  ADR 01009's leading candidate (distinguish explicit `true` from an inherited
  default) was rejected: identical config values behaving differently by origin
  is invisible in the file and awkward to document.
- **`provenance.qualified` flipped to `true`** outright — no external
  dependency, no degradation path, stable output.
- **Builds gained a warnings channel** — `BuildResult.warnings`, rendered to
  stderr by the CLI, never affecting the exit code. dockg had no diagnostic
  path between "silent" and "fatal" before this; later phases can use it.
- **The regression corpus pins `provenance.git: false`.** Discovered during
  implementation: the build activity's `prov:endedAtTime` is HEAD's committer
  date, so a git-on golden would fail on *every commit* to this repo. The
  golden's job is derivation regression, not repo-state capture.

Delivered: config schema + defaults, degradation path, warnings channel, golden
regenerated (8 qualified-provenance triples, diff inspected), CLAUDE.md
determinism invariant amended, README provenance section + config sample +
opinionated-defaults statement, `dockg init` template.

## Phase 1 — Metadata coverage in `stats` — **done**

**Goal:** make the lifted/unlifted boundary measurable (the evaporation
countermeasure), before new vocabulary lands.

Decided ([ADR 01011](adrs/01011-metadata-coverage-in-stats.md)):
- **Seven fixed fields** — `title`, `description`, `creator`, `created`,
  `modified`, `subject`, `prefLabel` (`language` dropped as near-universally
  0% noise). Measured against the graph, so git-derived values count. A fixed
  list, not a dynamic census, so an absent-everywhere field still shows 0%.
- **Report shape**: counts + one-decimal percentages, empty graph vacuously
  100%. Pretty block + ordered JSON array.
- **Per-field thresholds** with a uniform number as shorthand; a uniform-only
  gate would be dominated by whichever field a corpus legitimately never sets
  (`prefLabel`/`creator` at 25% in the corpus). CLI `--coverage-threshold`
  sets the uniform form; the map is config-only.
- **No gate by default** (`{}`) — reporting is on, enforcement is opt-in per
  ADR 01009.

Delivered: `src/core/coverage.ts` (shared field list), coverage in `stats`
(pretty + JSON) and its `--check` gate, `stats.coverageThreshold` config knob,
`--coverage-threshold` flag, a schema-sync drift guard pinning the field list
to the config schema, corpus-exact tests, README (coverage subsection, config
sample, commands table) + `dockg init` template + `--help`. Shapes and golden
untouched — `stats` only reads the graph.

## Phase 2 — iiRDS Core (+ Software domain) vocabulary adoption — **done**

**Goal:** dockg graphs speak the tech-comm industry's RDF dialect where a
term fits.

Research findings (three parallel agents, byte-verified against
`iirds-consortium/models`) that shaped or corrected the plan:
- Namespace `http://iirds.tekom.de/iirds#` is **stable across versions** —
  hardcoded, not version-pinned.
- License is **CC BY-ND 4.0**: reference published IRIs; never vendor or
  re-serialize the vocabulary.
- A **Software domain exists** (`.../domain/software#`, iiRDS 1.2) — the earlier
  assumption that none did was wrong. Its 9 values split across two predicates
  (6 lifecycle phases, 3 subjects). Adopted this phase.
- **No official SHACL** — dockg authors its own (as it already does).
- **DIN SPEC 91526 was mischaracterized** here and in the README: it is a
  general KG-for-LLMs DIN SPEC, not iiRDS and not the AAS integration (that is
  IDTA 02063-1-0). Corrected.

Decided ([ADR 01012](adrs/01012-iirds-core-vocabulary.md)):
- **Topic types** (`kg.topicType`, closed enum of 6) → `iirds:has-topic-type`
  referencing the published `iirds:Generic*` IRIs. No `a iirds:Topic`, no
  `skos:Concept` mirror.
- **Product applicability** (`kg.appliesTo`, list) → minted
  `iirds:ProductVariant` nodes via `iirds:relates-to-product-variant`, labeled
  with `dcterms:title`.
- **Software domain** — two keys mirroring the two predicates:
  `kg.softwareLifecyclePhase` (6) → `iirds:relates-to-product-lifecycle-phase`,
  `kg.softwareSubject` (3) → `iirds:has-subject`, both referencing `iirdsSft:`
  IRIs.

Delivered: `src/core/iirds.ts` (byte-verified IRI maps), `iirds:`/`iirdsSft:`
namespaces, schema `frontmatter-0.5.json`, shapes `dockg-0.2.ttl` (four new
closed Document predicates + a ProductVariant shape, `sh:in`-constrained),
derive support, schema-sync drift guards for all three enums, corpus
permutations + regenerated golden, and the README/init/DIN-SPEC-correction
docs. Node-level `rdf:type iirds:Topic` and the information-unit hierarchy were
deliberately not adopted (see the ADR).

## Phase 3 — Section-level metadata

**Goal:** metadata attaches at the granularity the graph already models.

Decisions to make (ADRs):
- **Authoring mechanism.** Leading candidate: slug-keyed frontmatter
  (`kg.sections.<heading-slug>: {...}`) — schema-validatable, no new inline
  syntax, joins on the slugs section IRIs already use. Alternatives to weigh:
  inline directives/comments in the body; per-section files. Decide.
- Slug-drift handling (heading renamed → orphaned key): silent drop is a
  self-inflicted evaporation; a `brokenSectionRef`-style finding surfaced by
  `stats` is the leading candidate.
- Inheritance semantics: does a section inherit doc-level metadata, override
  it, or neither (explicit-only)?
- Which fields are section-assignable (all of `kg:`? only the iiRDS
  applicability/typing fields?).

Deliverables: schema + derive + shapes coverage, corpus permutations
(overrides, absent, drifted slug), docs.

## Phase 4 — Negative scope and closed-world semantics

**Goal:** make the "absent edge as interlock" pattern *expressible* in an
open-world RDF graph — explicitly, never by inference from absence.

Decisions to make (ADRs):
- Modeling: an explicit negative-applicability predicate
  (`kg.notApplicableTo` → a deliberate addition to the minimal `dockg:`
  namespace, since neither iiRDS nor schema.org has a `what_it_is_not`
  equivalent — verify in Phase 2 research) vs. documentation-only guidance
  vs. per-corpus closed-world declarations.
- SHACL: `appliesTo`/`notApplicableTo` disjointness as a `sh:Violation`.
- Consumer contract: README documents what absence means (unknown, not
  false) and how retrieval layers should implement interlocks.

## Phase 5 — Fill as resolution-deepening

**Goal:** `fill` becomes the deliberate lift-facts-into-the-graph phase, with
exception-based human review.

Decisions to make (ADRs):
- Forced reasoning in fill prompts (justify each proposal against doc +
  corpus) — cost/benefit per provider.
- Confidence scoring: per-field scores; `fill.minConfidence` gate (proposals
  below it are reported as findings, not written). Where confidence lives:
  run report only vs. `kg.provenance` (leading candidate: run report only —
  provenance already names machine-filled fields and humans delete entries
  after review).
- Whether fill learns the new Phase 2/3 fields (`topicType`, `appliesTo`,
  section metadata) and in what order of trust.

Constraints: MockProvider-only tests; the SHACL fill-guard stays the
structural gate ("certified by structure"); build determinism untouched.

## Phase 6 — Export surfaces

**Goal:** the graph reaches its consumers in their native formats; `build`
emits everything by default (per mandate).

Decisions to make (ADRs):
- **JSON-LD/schema.org export**: mapping (mostly identity — `schema:` and
  `dcterms:` pass through; decide additional typing like
  `schema:TechArticle`); deterministic serialization (stable key order via
  `byCodeUnit`); what is explicitly out of scope (e.g. `HowTo` step
  synthesis).
- **iiRDS package export**: package layout (`metadata.rdf` + content refs),
  what plays the content role for markdown sources, deterministic zip (fixed
  entry order, zeroed timestamps), conformance target (iiRDS 1.3 package
  rules), and whether the Phase 2 mapping suffices or the package needs
  more.
- Output paths and suppression knobs; whether exports are `build` outputs
  (mandated default) *and* standalone commands.
- **iiRDS ingest** (packages as a derive source): decide explicitly —
  in, out, or deferred with trigger condition.

Research first: iiRDS package conformance requirements; how existing CDPs
(content delivery portals) validate incoming packages.

## Phase 7 — Query engine and content resolver

**Goal:** the runtime foundation: real traversal over the built graph plus
node→text resolution. First phase of the GraphRAG arc.

Decisions to make (ADRs):
- Traversal API vs. SPARQL first (leading candidate: purpose-built
  deterministic walker — expand, reverse-references, variant filter,
  negative-scope check — with SPARQL as a later addition behind the same
  seam; alternatives: oxigraph WASM, Comunica over the N3 store).
- Content resolver contract: IRI → file path + heading span → text;
  behavior when files drifted from the graph (stale build detection?).
- CLI surface (`dockg traverse`? extend `query`?) and JSON output shapes.

Constraints: fully hermetic, corpus-testable, no LLM involvement.

## Phase 8 — Hybrid entry (embeddings sidecar)

**Goal:** natural-language entry points into the graph without breaking the
hermetic build.

Decisions to make (ADRs):
- `dockg index` as an explicit command (network boundary per the defaults
  mandate); provider seam through `src/llm/`; deterministic mock embedder
  for tests.
- Sidecar artifact format/location (gitignored, cache-keyed, disposable —
  the graph stays the source of truth); staleness/invalidation story.
- Chunking = section nodes (granularity golden rule) — confirm or refine.

## Phase 9 — `ask` + MCP serving

**Goal:** interlocked answer synthesis and agent-consumable serving.

Decisions to make (ADRs):
- Retrieval pipeline: vector entry (if index present) → graph traversal
  honoring `appliesTo`/negative scope → content resolution → synthesis with
  mandatory IRI citations; **no route found = refuse and say so** (the
  disciplined-silence contract).
- `dockg mcp`: which tools to expose (`ask`, `traverse`, `impact`,
  `check`-style audit); transport; auth story if any.
- Runtime never writes the graph; `fill` remains the only LLM→frontmatter
  path. Ratify as a standing invariant.

## Phase 10 — Evaluation harness

**Goal:** the GraphRAG behavior becomes a regression-gated contract, like
the golden Turtle.

Decisions to make (ADRs):
- Golden Q&A fixtures over the corpus: answerable questions with expected
  citation IRIs, *unanswerable* questions with expected refusals (the
  Test A/B/C pattern from the source research).
- CI runs with mocks only; documented recipe for live-model eval runs
  outside CI; metrics worth tracking (answerability, citation precision,
  refusal correctness).

---

## Cross-phase research backlog

Items referenced above, gathered for scheduling (research lands at the start
of the phase that needs it, not before):

| Item | Needed by |
|---|---|
| iiRDS Core term-by-term mapping survey | Phase 2 |
| Software-specific iiRDS extensions/profiles (existing or emerging); machinery extension as reference | Phase 2 |
| iiRDS/H and DIN SPEC 91526 relationship to Core; what to track vs. adopt | Phase 2 |
| Official iiRDS SHACL/validation assets | Phase 2 |
| Negative-scope precedent in iiRDS/schema.org (verify none before minting `dockg:` term) | Phase 4 |
| iiRDS 1.3 package conformance rules; CDP intake validation practices | Phase 6 |
| QUDT adoption for quantitative properties (sizes, torques) lifted by fill | Phase 5/6 |
| Embedded SPARQL options (oxigraph WASM, Comunica) vs. custom walker maintenance cost | Phase 7 |
| MCP server conventions for doc/knowledge tools | Phase 9 |

## Process per phase

1. Do the phase's research items; capture findings in the phase ADR(s).
2. Write the ADR(s); get maintainer sign-off on contested decisions.
3. Red→green TDD; corpus permutations for every user-visible behavior.
4. Schema/shapes version bumps as needed (immutable published files).
5. Docs (README, init template, `--help`) in the same change; golden diffs
   inspected line by line.
6. Full verification loop green; PR per phase (or per coherent slice).
