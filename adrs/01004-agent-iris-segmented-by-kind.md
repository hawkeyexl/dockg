---
status: accepted
date: 2026-07-21
decision-makers: [hawkeyexl, Claude]
---

# Agent IRIs segmented by PROV agent kind

## Context and Problem Statement

`mintAgentIri` minted `{base}agent/{slug(name)}` for every agent regardless of
kind, so identity was "slug of the display name" alone. Two different kinds of
actor whose names slug alike merged into one node: frontmatter
`author: GPT 4` plus `generatedBy: gpt-4` produced a node typed both
`prov:Person` and `prov:SoftwareAgent`, and a git author named `dockg` merged
with the build tool agent, receiving `dockg:version`. The graph stated things
that are simply false, quietly.

## Decision Drivers

- Provenance must not assert false identity.
- Deterministic, readable, diff-friendly IRIs; no blank nodes.
- IRIs become a consumer contract at first release — cheap to change now.
- PROV-O already models the distinction; dockg should not invent one.

## Considered Options

1. Detect collisions and suffix the loser (`gpt-4-1`).
2. Hash names instead of slugging them.
3. Segment the namespace by kind: `agent/person/`, `agent/software/`,
   `agent/org/` (chosen).
4. Flat sibling namespaces: `person/`, `agent/`, later `org/`.

## Decision Outcome

Chosen option 3. `mintAgentIri(base, kind, name)` mints
`{base}agent/{kind}/{slug}` where kind is `person` | `org` | `software`,
mapped from the PROV class the call site already passes (`AGENT_KIND` in
derive.ts). Cross-kind merging becomes structurally impossible rather than
merely unlikely. `org` is reserved now so `prov:Organization` — PROV's third
agent subclass — has a home the day something mints one; nothing does yet.

Option 4 was considered seriously and rejected on reflection: it reads well
today ("agents" colloquially means software), but `prov:Person` is a subclass
of `prov:Agent`, so filing people outside `agent/` fights the vocabulary
dockg emits, and a third flat sibling for organizations would leave the
actor kinds ungrouped. Renaming the concept to "actor" was also considered
and rejected — `prov:Agent` is W3C's term and not ours to rename.

### Consequences

- Good: false cross-kind identity is impossible; the tool agent is
  unambiguously `agent/software/dockg`; organizations have a reserved home.
- Bad: emitted agent IRIs changed shape (golden regenerated; a breaking
  change for graph consumers, which is why it lands pre-release), and
  `mintAgentIri`'s exported signature gained a parameter.
- Unchanged: two people sharing a name still converge, exactly as identical
  concept labels do. Git supplies emails — the natural unique key — but
  ADR 01000 rules them out on privacy grounds; a truncated email hash could
  disambiguate later without publishing the address.

### Confirmation

`test/unit/iri.test.ts` asserts per-kind minting and that a person and a
software agent sharing a slug (including "dockg") stay distinct; the corpus
golden was regenerated with a reviewed five-line diff containing only the
kind segments.

## Pros and Cons of the Options

- **Collision suffixing** — the suffix depends on traversal order, breaking
  byte-determinism unless sorted first; complexity for no gain.
- **Hashing** — destroys readability and diffability, and does not address
  cross-kind identity at all; it only reshuffles which collisions occur.
- **Kind segments** (chosen) — one parameter, structural guarantee, extends
  to organizations for free.
- **Flat siblings** — shortest IRIs, but conflicts with PROV's class
  hierarchy and scatters the actor kinds.
