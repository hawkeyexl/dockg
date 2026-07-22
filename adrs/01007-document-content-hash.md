---
status: accepted
date: 2026-07-22
decision-makers: [hawkeyexl, Claude]
---

# Stamp every document node with a `dockg:contentHash` instead of embedding content

## Context and Problem Statement

The emitted graph describes documents — structure, metadata, relationships —
but says nothing about their *content*. Consumers that pair the graph with an
external store (search index, embedding/chunk store, RAG pipeline) have no way
to tell whether their copy of a document still matches the file the graph was
built from, and no stable join key beyond the mutable `dockg:path`.

The obvious alternative — embedding document bodies in the graph as literals —
was considered and rejected. How should the graph let consumers detect content
drift and join external stores to an exact source revision?

## Decision Drivers

- The golden regression gate depends on small, line-reviewable diffs; a design
  that rewrites multi-kilobyte literals on every prose edit defeats it.
- Determinism and byte-sensitivity: the corpus deliberately contains a CRLF
  file; any content-derived output must be byte-faithful and identical across
  platforms.
- The custom `dockg:` namespace stays minimal; RDF adds nothing to prose — the
  graph's value is relationships, not blob storage.
- Docs already have a canonical home (git); a second full copy drifts.

## Considered Options

1. **Embed document bodies as literals** on Document/Section nodes.
2. **Per-document sha256 content hash** as a small literal; content stays in
   the source tree.
3. **No content signal** — consumers diff files themselves.

## Decision Outcome

Chosen option: **per-document sha256 content hash**. Every `dockg:Document`
node carries exactly one `dockg:contentHash`: the lowercase sha256 hex digest
of the file's UTF-8 content, line endings included (for valid-UTF-8 files this
equals the digest of the raw bytes, so `sha256sum <file>` reproduces it). It is
intrinsic like `dockg:path` — always emitted, not gated behind a derive
source, no config knob.

Option 1 fails the golden gate, multiplies escaping/byte-sensitivity hazards
(CRLF and NUL rules), bloats every downstream pass (SHACL check, double-build
comparison, n3 round-trip), and duplicates git. Option 3 leaves external
stores unable to detect staleness without re-reading every file.

### Consequences

- Good: content drift is detectable from the graph alone; external stores get
  a revision-exact join key; diffs stay one line per changed document.
- Bad: any edit to a doc now changes one golden line per touched file — an
  acceptable, reviewable cost.
- The shapes contract changes: `shapes/dockg-0.2.ttl` (0.1 is immutable) adds
  a required, pattern-checked `Document-contentHash` to the closed Document
  shape, and becomes the bundled default for `dockg check` and the fill
  guardrail. Graphs built by older dockg versions fail the 0.2 contract until
  rebuilt; `check.shapes` can pin `shapes/dockg-0.1.ttl` in the interim.

### Confirmation

Unit tests pin the digest (including CRLF ≠ LF byte-faithfulness) and the
emitted triple; shapes tests pin the minCount/pattern violations; the golden
corpus carries the four hashes, verified against `sha256sum`; the existing
determinism gates (double build, golden, n3 round-trip) cover the rest.

## Pros and Cons of the Options

### Embed document bodies as literals

- Good: self-contained graph; retrieval needs no filesystem access.
- Bad: golden diffs become unreviewable; graph size scales with corpus text;
  escaping hazards (CRLF/NUL) land in the emitter's hot path; duplicates git
  and drifts from it.

### Per-document sha256 content hash

- Good: constant-size, deterministic, diff-friendly; standard digest any tool
  can reproduce; supports drift detection and external joins.
- Bad: consumers still need the source tree to read content (by design).

### No content signal

- Good: zero change.
- Bad: staleness is undetectable from the graph; no revision-exact join key.
