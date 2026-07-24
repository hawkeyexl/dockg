---
status: accepted
date: 2026-07-24
decision-makers: [hawkeyexl, Claude]
---

# `dockg fill` proposes all fields, gated by model confidence

## Context and Problem Statement

`dockg fill` lifts `kg:` frontmatter with an LLM and writes it back, guarded by
the SHACL "certified by structure" gate ([ADR 01006](adrs/01006-shacl-graph-validation.md)).
Today it proposes only four SKOS fields; `broader`/`narrower` are held back by a
static allowlist because they hallucinate; and there is no confidence signal
beyond a prompt line telling the model to "omit fields you aren't sure of."

The iiRDS research frames fill as the deliberate **resolution-deepening** step,
paired with **exception-based human review**: the model reasons about each
proposal and self-scores it, low-confidence proposals surface for review instead
of being written, and a human inspects only the exceptions. That model wants
*more* fields proposed (so the graph deepens), not fewer — with confidence, not a
hard allowlist, deciding what lands.

How should fill decide what to propose and what to write, and where does
confidence live?

## Decision Drivers

- The maintainer's steer: fill should be able to propose **all** fillable fields;
  **confidence** decides what is written, not a static allowlist. Dangerous
  fields (product variants, negative scope) should earn low confidence and be
  filtered, not be forbidden.
- Strictness is the default *inside* the explicit `fill` command
  ([ADR 01009](adrs/01009-opinionated-defaults.md)).
- The SHACL guardrail stays the structural gate; confidence is an orthogonal,
  additional gate.
- No network in tests (MockProvider); determinism of `build` is untouched.
- An agent orchestrating dockg must be able to read fill's exit code correctly —
  routine low-confidence drops are **not** failures.

## Considered Options

- **What fill proposes:** a curated safe allowlist · **all fields, confidence-gated**.
- **Confidence gate default:** off (opt-in) · **on, strict (0.7)**.
- **Confidence storage:** run report only · **persisted in `kg.provenance`** (and
  the emitted graph).
- **Dropped-for-confidence exit code:** exit 1 (a finding) · **exit 0** (normal).

## Decision Outcome

**Fill proposes all doc-level fillable fields** — the six SKOS fields plus the
iiRDS fields added in Phases 2–4 (`topicType`, `appliesTo`,
`softwareLifecyclePhase`, `softwareSubject`, `notApplicableTo`,
`notSoftwareSubject`). The default `fill.fields` is the full set; the old
`broader`/`narrower`-off allowlist is retired.

**The model returns per-field `confidence` (0..1) and `reasoning`** (forced
reasoning — the reasoning is what makes the score meaningful and is shown in the
run report). `fill.minConfidence` defaults to **0.7**: a field scored below it is
**dropped and reported, not written**. The confidence gate runs *before* the
SHACL guardrail; the two are orthogonal (confidence covers every field, the guard
covers the structural subset). The prompt instructs the model to score
hallucination-prone fields (variants, negatives) low unless the text is
unambiguous — so those fields self-filter without a hard rule.

**Confidence is persisted in `kg.provenance`** (the per-model attribution entry
fill already writes) and reflected in the emitted graph: the `#kg-fill` activity
reifies each filled field into an entry node carrying `dockg:filledField` +
`dockg:confidence` (blank-node-free, deterministic). Frontmatter is the durable,
human-reviewable audit surface; the graph carries it for downstream consumers.

**A field dropped for low confidence is exit 0** — normal, expected operation.
Filling a corpus is expected to drop many low-confidence proposals; an exit-1
would read as "the command failed" to an orchestrating agent, which is wrong.
Exit 1 stays reserved for `status: "error"` (schema-invalid proposal, unsupported
frontmatter, YAML write failure); exit 2 for operational failures. This mirrors
how the guardrail's `rejected` fields are already reported without failing.

**Section-level fill is out of scope.** Fill is architecturally doc-level (one
proposal per doc); filling `kg.sections` is a structural extension for a
follow-up.

### Consequences

- Good: the graph deepens across all typed fields, with a self-filtering safety
  mechanism the research prescribes; humans review only flagged exceptions.
- Good: confidence + reasoning give a durable, inspectable audit trail; the SHACL
  guard still blocks structurally-invalid writes regardless of confidence.
- Good: the exit code stays a truthful signal — 0 for normal runs (including
  heavy dropping), 1 only for real errors.
- Bad: the response contract, the schema (`frontmatter-0.8.json`), the emitter,
  and the shapes (`dockg-0.5.ttl`) all change in one phase; the `dockg:`
  namespace grows by two properties (`filledFieldEntry`, `confidence`, 8 → 10).
- Bad: a model's self-scored confidence is not calibrated ground truth — 0.7 is a
  starting default, tunable per corpus via `fill.minConfidence`.

### Confirmation

`test/unit/fill.test.ts` (MockProvider): mixed-confidence proposal writes the
high fields and drops+reports the low ones; `minConfidence` override; confidence
recorded in the written `kg.provenance`; an iiRDS field filled at high
confidence; a disjoint `appliesTo`/`notApplicableTo` proposal rejected by the
extended guard; dropped-for-confidence keeps exit 0. `test/unit/derive.test.ts`:
a provenance entry with confidence emits the reified entry nodes +
`dockg:confidence` decimals. `test/unit/shacl.test.ts`: the entry conforms to
`dockg-0.5.ttl`. `test/unit/schema-sync.test.ts`: `FIELD_SCHEMAS` and the
provenance `fields` enum both equal the full fillable set. Determinism gates
(double-build, version-normalized golden, n3 round-trip) cover the new triples.

## Pros and Cons of the Options

### All fields, confidence-gated

- Good: deepens the graph; self-filtering; no arbitrary field bans.
- Bad: relies on the model scoring honestly; needs the confidence contract and a
  sensible default threshold.

### Curated safe allowlist

- Good: simplest; no confidence machinery.
- Bad: caps the graph at whatever list is deemed safe; the research's
  resolution-deepening never happens; the allowlist is itself a guess.

### Confidence in run report only

- Good: no schema/emitter/shapes change; graph stays lean.
- Bad: the audit trail evaporates once the run ends; a reviewer coming back later
  cannot see why a field was written or how sure the model was.

### Exit 1 for dropped-confidence

- Good: signals "review needed."
- Bad: routine, expected drops would read as command failure to an orchestrating
  agent — the exact confusion this rule exists to avoid.
