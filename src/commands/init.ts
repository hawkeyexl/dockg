/** `dockg init` — scaffold a starter dockg.config.yaml. Refuses to overwrite. */
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DockgError } from "../types.js";
import { DEFAULT_CONFIG_FILENAME } from "../core/config.js";

const STARTER = `version: 1

# Base IRI for every minted node. Set this to a namespace you control;
# without it, IRIs fall back to the urn:dockg: placeholder.
# baseIri: https://example.com/kg/

inputs:
  - "docs/**/*.md"
exclude:
  - "**/node_modules/**"

# Output of \`dockg build\`.
out: kg/graph.ttl

# Map published-site routes back to source files so route-style links
# (/docs/actions/find) become graph edges. Uncomment and adjust:
# routes:
#   - basePath: /docs
#     root: docs
#     extensions: [.md, .mdx]
#     indexFiles: [index, README]

# What to derive triples from. Remove entries to opt out.
build:
  derive: [frontmatter, sections, links, tags, images, code, provenance]

# PROV-O settings.
# git: derive per-file provenance from git history (creation/modification
#   dates as fallbacks, author agents, rename -> prov:wasRevisionOf) and
#   stamp the build activity with the HEAD committer date. Deterministic
#   per commit; wall-clock time never enters the graph.
#   "auto" (default) derives it wherever git can run and warns where it
#   cannot; true requires git, so an unavailable one fails the build; false
#   skips git entirely.
# qualified: emit prov:qualifiedAttribution/qualifiedAssociation nodes
#   with roles alongside the direct properties.
provenance:
  git: auto
  qualified: true

# Schemas \`dockg validate\` checks via docmeta. Default: the frontmatter
# schema bundled with dockg (schemas/frontmatter-0.8.json). Override with
# file paths, URLs, or docmeta built-in ids:
# validate:
#   schemas: ["./my-schema.json"]

# SHACL shapes \`dockg check\` validates the built graph against. Default:
# the shapes contract bundled with dockg (shapes/dockg-0.5.ttl).
# check:
#   shapes: ["./my-shapes.ttl"]

# Metadata coverage gate for \`dockg stats --check\`. A number applies to
# every measured field; a map gates named fields only. Unset gates nothing.
# stats:
#   coverageThreshold:
#     title: 100
#     description: 50

# LLM settings for \`dockg fill\` (SKOS frontmatter proposals).
fill:
  provider: anthropic          # anthropic | openai | claude-cli | mock
  # model: claude-sonnet-4-5   # provider default when omitted
  # apiKeyEnv: ANTHROPIC_API_KEY
  temperature: 0
  maxCostUsd: 5
  cacheDir: .dockg/cache
  # fill proposes every field; confidence (0..1 per field) gates what is
  # written. Fields scored below minConfidence are reported, not written.
  minConfidence: 0.7
  # fields: defaults to every fillable field — uncomment to restrict.
  # Record kg.provenance (model + fields + confidence) on filled docs.
  writeProvenance: true
  # Reject proposals that would violate the SHACL shapes contract
  # (broader/narrower cycles, conflicting labels).
  validateGraph: true
`;

export function runInit(cwd = process.cwd()): string {
  const path = resolve(cwd, DEFAULT_CONFIG_FILENAME);
  if (existsSync(path)) {
    throw new DockgError(
      `${DEFAULT_CONFIG_FILENAME} already exists — not overwriting.`,
    );
  }
  writeFileSync(path, STARTER, "utf8");
  return path;
}
