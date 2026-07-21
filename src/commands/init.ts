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
  derive: [frontmatter, sections, links, tags, images, code]

# Schemas \`dockg validate\` checks via docmeta.
validate:
  schemas: ["dockg:frontmatter:0.1"]

# LLM settings for \`dockg fill\` (SKOS frontmatter proposals).
fill:
  provider: anthropic          # anthropic | openai | claude-cli | mock
  # model: claude-sonnet-4-5   # provider default when omitted
  # apiKeyEnv: ANTHROPIC_API_KEY
  temperature: 0
  maxCostUsd: 5
  cacheDir: .dockg/cache
  # broader/narrower are opt-in: hierarchy proposals hallucinate most.
  fields: [prefLabel, altLabels, related, subjects]
`;

export function runInit(cwd = process.cwd()): string {
  const path = resolve(cwd, DEFAULT_CONFIG_FILENAME);
  if (existsSync(path)) {
    throw new DockgError(`${DEFAULT_CONFIG_FILENAME} already exists — not overwriting.`);
  }
  writeFileSync(path, STARTER, "utf8");
  return path;
}
