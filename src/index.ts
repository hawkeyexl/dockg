/** dockg public API. */
export * from "./types.js";
export {
  loadConfig,
  parseConfig,
  type DockgConfig,
  type DeriveSource,
  type FillField,
  type GitMode,
  type Pricing,
} from "./core/config.js";
export {
  COVERAGE_FIELDS,
  COVERAGE_FIELD_NAMES,
  type CoverageField,
} from "./core/coverage.js";
export { discoverFiles } from "./core/discover.js";
export {
  SOFTWARE_LIFECYCLE_IRIS,
  SOFTWARE_SUBJECT_IRIS,
  TOPIC_TYPE_IRIS,
} from "./core/iirds.js";
export {
  conceptSlug,
  encodeSegment,
  mintAgentIri,
  type AgentKind,
  mintBuildActivityIri,
  mintConceptIri,
  mintDocIri,
  mintGraphIri,
  mintProductIri,
  mintSchemeIri,
  mintSectionIri,
  normalizeDocPath,
  resolveBaseIri,
} from "./core/iri.js";
export { analyzeDoc } from "./core/analyze.js";
export {
  deriveGraph,
  type DeriveOptions,
  type Quad,
  type Term,
} from "./core/derive.js";
export {
  collectGitHistory,
  type GitFileHistory,
  type GitHistory,
} from "./core/git.js";
export { emitTurtle } from "./core/emit.js";
export { loadGraph, expandTerm, compactIri } from "./core/load.js";
export {
  applyKgFields,
  existingKgFields,
  existingProvenance,
  frontmatterKind,
  type KgApplyResult,
  type ProvenanceEntry,
} from "./core/frontmatter-edit.js";
export { NS, PREFIXES } from "./core/vocab.js";
export {
  runBuild,
  type BuildOptions,
  type BuildResult,
} from "./commands/build.js";
export {
  runValidate,
  type ValidateOptions,
  type ValidateResult,
} from "./commands/validate.js";
export {
  runQuery,
  type QueryOptions,
  type QueryResult,
} from "./commands/query.js";
export {
  runStats,
  type CoverageRow,
  type StatsOptions,
  type StatsReport,
} from "./commands/stats.js";
export {
  runFill,
  type FillOptions,
  type FillReport,
  type FillDocResult,
} from "./commands/fill.js";
export type {
  LlmProvider,
  CompleteJSONRequest,
  CompleteJSONResponse,
} from "./llm/types.js";
export { MockProvider, type MockResponse } from "./llm/providers/mock.js";
