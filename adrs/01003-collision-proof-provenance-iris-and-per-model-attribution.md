---
status: accepted
date: 2026-07-21
decision-makers: [hawkeyexl, Claude]
---

# Collision-proof provenance IRIs and per-model fill attribution

## Context and Problem Statement

Code review confirmed two contract defects in the day-old provenance
features. (1) Provenance fragment IRIs (`#generation`, `#kg-fill`,
`#attribution-{agent}`) shared the fragment namespace with heading slugs — a
mundane `## Generation` heading merged with the generation activity into one
dual-typed corrupt node (reproduced end-to-end). (2) `kg.provenance` was a
single object whose `generatedBy` each fill run overwrote while `fields`
unioned, so a second model absorbed attribution for the first model's fields —
false provenance from the feature whose purpose is truthful attribution.

## Decision Drivers

- Provenance must never lie; attribution must survive multi-model fills.
- No blank nodes; deterministic IRIs; heading slugs are author-controlled.
- Both features shipped hours ago unreleased — IRI/shape changes are still cheap.

## Considered Options

1. Reserve/escape colliding heading slugs; keep single-object provenance.
2. Prefix provenance fragments with a slug-impossible separator; make
   `kg.provenance` an array with one entry per model (chosen).
3. Hash-based fragment IRIs.

## Decision Outcome

Chosen option 2. Fragments use `.` separators, which github-slugger can never
emit: `#prov.generation`, `#prov.kg-fill.{modelSlug}`,
`#prov.attribution.{agentSlug}`, and association nodes
`{activity}.assoc.{agentSlug}` (the agent slug also prevents two agents on
one activity merging). Schema 0.4 (`schemas/frontmatter-0.4.json`, now the
bundled validate default) makes `kg.provenance` an array of
`{generatedBy, fields}` entries; the 0.2/0.3 single-object form remains
accepted and is normalized on read. `dockg fill` unions fields only within
the current model's entry, preserves other models' entries, and under
`--force` moves a re-filled field's attribution to the model that rewrote it.
derive emits one `#prov.kg-fill.{model}` activity per entry, so
`prov:generated`/`dockg:filledField` triples associate with the model that
actually proposed them.

### Consequences

- Good: heading collisions are structurally impossible; attribution stays
  truthful across any number of models; per-model activities make "which
  model proposed X" a direct query.
- Bad: provenance IRIs changed shape a day after shipping (accepted:
  unreleased); readers of 0.2/0.3-era docs see the legacy object until the
  next fill rewrites it.

### Confirmation

Derive tests assert a `## Generation` heading stays a Section while the
activity lives at `#prov.generation`; fill tests assert per-model entries and
`--force` attribution moves; schema-sync test guards the 0.4 provenance enum.

## Pros and Cons of the Options

- **Reserved slugs** — breaks on every new provenance fragment; authors can
  still collide with the reserved list.
- **Dot-separated fragments + array entries** (chosen) — structural guarantee
  from slugger's own character set; schema shape matches the actual data.
- **Hash IRIs** — collision-proof but opaque and hostile to golden diffs.
