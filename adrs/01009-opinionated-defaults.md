---
status: accepted
date: 2026-07-22
decision-makers: [hawkeyexl, Claude]
---

# Opinionated defaults: hermetic features ship on; network and spend stay explicit

## Context and Problem Statement

dockg has accumulated features that are off unless asked for — git-derived
provenance, qualified provenance — and the roadmap adds many more (iiRDS
vocabulary derivation, section-level metadata, negative scope, JSON-LD and
iiRDS package export, coverage reporting). Every one of them raises the same
question at design time: does this ship on or off?

Deciding that per feature produces two problems. It burns a decision in every
phase ADR on a question whose answer should be a policy, and it yields an
inconsistent surface where the tool's best behavior depends on the user having
read enough documentation to switch it on. ADR 01008 sharpens the stakes: what
is not lifted into the graph is invisible to graph-side consumers, so a
conservative default set literally produces a poorer product for the median
user, silently.

The maintainer has set the direction — dockg should be opinionated and enable
what it can by default. What that means precisely, and where it stops, needs to
be recorded once so phase ADRs cite it instead of relitigating it.

## Decision Drivers

- A tool whose strongest configuration is opt-in teaches most users its weakest
  configuration. The graph's value compounds with what is in it.
- Defaults must not make dockg require network access or spend the user's money
  without them asking. Those are categorically different from "derive more
  triples from files you already have."
- **On by default must not mean broken by default.** A feature that cannot run
  in a given corpus must not turn a working build into a failure.
- Determinism is unaffected by the flips under consideration: git-derived dates
  are committer timestamps, stable per commit, never the wall clock.
- dockg is pre-release. There is no installed base to migrate, so the cost of
  changing defaults now is a golden regeneration and a docs pass, not an
  ecosystem event.
- Opinionated is not the same as inflexible: every default-on feature must stay
  suppressible.

## Considered Options

1. **Umbrella policy ADR now** — state the principle, the boundary, and the
   schedule of flips; phase ADRs cite it and only decide their own mechanics.
2. **Decide per phase** — each feature ADR argues its own default.
3. **Keep conservative opt-in defaults** — status quo; users opt into value.

## Decision Outcome

Chosen option 1. The policy:

**Hermetic features default to on.** Anything dockg can do with the files
already on disk — derive sources, vocabulary mappings, provenance, coverage
reporting, export formats — ships enabled. `dockg build` produces the richest
graph and the full set of export artifacts without configuration.

**Network and spend stay explicit.** Anything that calls a paid API or requires
connectivity is never triggered by a default-on path. Today that is `dockg
fill`; on the roadmap it is `dockg index`, `ask`, and `mcp`. These remain
separately invoked commands. CI never touches the network — mock providers
only — and that constraint is what keeps this boundary honest.

Three corollaries, each of which exists to stop a plausible misreading:

- **Strictness is the default inside the explicit commands.** "Opinionated"
  does not mean fill proposes more; it means fill's guardrails are on. The
  SHACL fill guard stays on by default, and hierarchy fields
  (`broader`/`narrower`) stay out of `fill.fields` by default because they
  hallucinate most (ADR 01006). Those are guardrail defaults, not
  feature-disabled defaults, and this policy does not disturb them.
- **Default-on features degrade, they do not fail.** If a default-on feature
  cannot run for a corpus (no git repo, no git binary), the build warns and
  continues without those triples. When the user has *explicitly* enabled the
  same feature in config, failing loudly remains correct — an explicit request
  that cannot be honored is an operational error (exit 2). Distinguishing
  "user wrote `true`" from "inherited the default" is mechanically available in
  `parseConfig`, and the exact semantics are the open question below.
- **Reporting is not enforcement.** Turning a measurement on by default is
  cheap and safe; turning a *gate* on by default requires a threshold value
  that is defensible for every corpus, which usually does not exist. Default-on
  applies to producing the number; gates stay opt-in unless a specific ADR
  argues a defensible default.

### Schedule of flips

Each flip lands in the phase that owns it, with that phase's tests, golden
diff, and docs — not here.

| Knob / feature | Today | Target | Lands in |
|---|---|---|---|
| `provenance.git` | off | on, degrading gracefully | Phase 0b |
| `provenance.qualified` | off | on | Phase 0b |
| Metadata coverage report | — | always reported | Phase 1 |
| Coverage threshold gate | — | opt-in unless Phase 1 finds a defensible value | Phase 1 |
| iiRDS vocabulary derive | — | on | Phase 2 |
| Section-level metadata derive | — | on | Phase 3 |
| Negative-scope derive | — | on | Phase 4 |
| JSON-LD and iiRDS package emission from `build` | — | on | Phase 6 |
| `fill`, `index`, `ask`, `mcp` | — | explicit invocation, never automatic | their phases |

### Open question for Phase 0b

Whether "explicitly enabled" and "inherited the default" should produce
different failure behavior for `provenance.git` (leading candidate: yes —
explicit `true` errors as it does today; inherited default warns and skips), or
whether a single behavior for both is simpler to explain. Phase 0b decides and
implements; until then no default has actually changed.

### Consequences

- Good: one policy replaces N default debates; phase ADRs cite it and move on.
- Good: the median user gets dockg's full hermetic capability without reading
  the configuration reference.
- Good: the network/spend boundary is stated in a form that is testable — CI's
  no-network rule enforces it.
- Bad: `dockg build` will do more work per run once the flips land (git history
  pass, extra derivations, extra artifacts). Acceptable for documentation-sized
  corpora; if it stops being acceptable, that is a performance ADR, not a
  reason to hide features.
- Bad: richer defaults mean bigger emitted graphs and bigger golden diffs;
  every flip requires deliberate golden regeneration.
- Bad: the degradation corollary adds a warning path that must be tested per
  feature, and warnings that nobody reads are a real failure mode.
- Neutral: CLAUDE.md's determinism invariant currently describes git dates as
  living "behind an opt-in flag". When Phase 0b lands, that clause must be
  amended to state the source-of-truth rule (frontmatter, then git committer
  dates, never the wall clock) rather than the default. That amendment belongs
  to Phase 0b, not here.

### Confirmation

This ADR changes no code and no defaults on its own; it is confirmed by the
phase ADRs that cite it and by their tests. Each flip is confirmed by a config
default assertion in `test/unit/config.test.ts`, a golden diff reviewed line by
line, and (where degradation applies) a test proving the default-on path warns
and continues on a corpus that cannot support the feature. The boundary is
confirmed continuously: CI runs with mock providers only, so any default that
reached for the network would fail the build.

## Pros and Cons of the Options

### Umbrella policy ADR now

- Good: decides once, cites everywhere; keeps the surface coherent as the
  roadmap adds a dozen knobs.
- Good: forces the boundary and the degradation rule to be stated before the
  first flip, which is when they are cheapest to get right.
- Bad: a policy written ahead of most of its applications can prove wrong in a
  specific case; it then needs superseding rather than a local decision.

### Decide per phase

- Good: maximum context per decision; no premature generalization.
- Bad: relitigates the same question repeatedly and drifts into an inconsistent
  default surface, which is exactly what users experience as arbitrary.

### Keep conservative opt-in defaults

- Good: smallest graphs, fastest builds, no behavior surprises.
- Bad: ships the weak configuration to everyone who does not tune it, and under
  ADR 01008 that means shipping a thinner index — the failure is silent.
