---
status: accepted
date: 2026-07-22
decision-makers: [hawkeyexl, Claude]
---

# The graph is an index and governance layer, not a retrieval corpus

## Context and Problem Statement

dockg derives RDF metadata from docs; the prose itself never enters the graph.
Downstream consumers — especially RAG and GraphRAG pipelines — have to decide
what role the graph plays at retrieval time, and nothing in dockg tells them.

Published industry experience with standards-typed documentation graphs
(Natsuki Wakabayashi, "Architecting certainty: A hands-on guide to iiRDS-driven
AI governance", tcworld magazine, June 2026, parts 1–3) documents the failure
mode that follows from getting this wrong. In their proof of concept, a
graph-governed assistant flatly denied that a "5 mm hex wrench" was specified,
even though the manual text said so, because the size existed only in prose and
never became a graph node. The system treated the graph as the sole authorized
truth surface, so everything outside it evaporated. The same series documents
the converse failure — packed, prose-heavy chunks let a vector-similarity
retriever cross product-variant boundaries and recommend the wrong tool
("edge contamination").

dockg is more exposed to the first failure than that project was. Its graph is
deliberately low-resolution — frontmatter, heading structure, links, concepts,
provenance — so a consumer that queried the graph alone would lose nearly all
of the documentation's substance.

What is the graph's contracted role, and what must dockg tell consumers about
how to use it?

## Decision Drivers

- The same body of work shows where documentation graphs are irreplaceable:
  scope and variant governance, impact analysis (reverse traversal), and
  compliance audit — while flat retrieval over text is adequate for ordinary
  question answering. dockg already has early forms of exactly those jobs in
  `query`, `stats`, and `check`.
- Lifting body text into the graph would duplicate content that markdown files
  already store canonically next to the graph in git, inflate every diff, and
  grow the vocabulary far past the minimal-namespace policy.
- Every node is already text-addressable: `dockg:path` plus the GitHub-style
  heading slug in a Section IRI's fragment resolves to an exact span on disk.
  The join a consumer needs is cheap and already supported.
- Silence about the contract is not neutral. The first consumer to assume
  "graph = corpus" rediscovers information evaporation in production.

## Considered Options

1. **Index-and-governance contract.** The graph routes, filters, audits, and
   attributes; consumers fetch content from the files the graph points at
   (hybrid consumption). State this as the product contract.
2. **Graph as full corpus.** Lift body text into the graph (e.g. `schema:text`
   on every Section) so the graph alone can answer questions.
3. **Say nothing** and let each consumer infer a role.

## Decision Outcome

Chosen option 1: the graph is an index and governance layer over the docs, not
a replacement for them. Prose stays in the files; the graph describes, types,
connects, and governs it.

Two consequences bind the rest of the roadmap:

- **Retrieval features built on dockg must pair graph routing with file-content
  resolution** and must never answer from the graph alone. This constrains the
  planned traversal, `ask`, and MCP work: a content resolver (IRI → path →
  heading span → text) is a prerequisite, not an optimization.
- **Coverage of lifted metadata becomes a first-class, measurable concern.**
  Because what is not lifted is invisible to graph-side consumers, dockg owes
  users a number rather than a silence. That is the motivation for the metadata
  coverage reporting scheduled next.

### Consequences

- Good: the graph stays small, diffable, and deterministic; markdown remains
  the single source of content truth, with no duplication to keep in sync.
- Good: dockg's differentiation aligns with the jobs graphs actually win —
  governance, impact analysis, audit — instead of competing with vector search
  at plain question answering, which flat retrieval already handles well.
- Good: the contract is stated in terms consumers can act on, including the
  exact join (`dockg:path` + section slug).
- Bad: consumers wanting one self-contained artifact must implement that join;
  the README has to teach it.
- Bad: metadata gaps become a product concern rather than purely a user choice,
  which adds reporting surface (and, later, fill work) that would not exist if
  the graph were merely "whatever the user tagged".

### Confirmation

The README states the contract in a "What the graph is (and isn't)" section,
including the join and the explicit warning that unlifted facts are invisible
to graph-only consumers. The forthcoming coverage report in `dockg stats` makes
the lifted/unlifted boundary observable in the tool users already run. No
emitter or vocabulary change is needed to confirm this ADR — it constrains
future work rather than altering current output.

## Pros and Cons of the Options

### Index-and-governance contract

- Good: matches the published evidence for where documentation graphs beat flat
  retrieval, and for how graph-only retrieval fails.
- Good: preserves determinism, artifact size, and the minimal namespace.
- Bad: requires consumers to implement a (simple, documented) join.

### Graph as full corpus

- Good: one artifact answers everything; no join.
- Bad: duplicates canonical content and doubles the maintenance surface.
- Bad: every prose edit churns the graph, wrecking the clean-diff property.
- Bad: invites precisely the graph-only retrieval pattern whose failure mode
  motivated this ADR, while still never being complete enough to be safe.

### Say nothing

- Good: no work now.
- Bad: consumers guess; the guess that fails is silent and looks like the
  documentation simply lacking the fact.
