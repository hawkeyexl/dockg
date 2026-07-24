/**
 * Loads and validates `dockg.config.yaml`. Validation is JSON Schema (2020-12)
 * via Ajv; defaults are applied in code afterward so the resolved shape is
 * fully typed. Mirrors the docevals config pattern.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { Ajv2020 } from "ajv/dist/2020.js";
import configSchema from "./config-schema.json" with { type: "json" };
import { DockgError } from "../types.js";
import { resolveBaseIri } from "./iri.js";
import { COVERAGE_FIELD_NAMES } from "./coverage.js";

export type ProviderName = "anthropic" | "openai" | "claude-cli" | "mock";

export type DeriveSource =
  | "frontmatter"
  | "sections"
  | "links"
  | "tags"
  | "images"
  | "code"
  | "provenance";

/**
 * How hard `provenance.git` insists: derive-where-possible (`"auto"`),
 * required (`true`), or off (`false`). See ADR 01010.
 */
export type GitMode = boolean | "auto";

export type FillField =
  // SKOS concept fields
  | "prefLabel"
  | "altLabels"
  | "broader"
  | "narrower"
  | "related"
  | "subjects"
  // iiRDS typing + negative scope (ADR 01015)
  | "topicType"
  | "appliesTo"
  | "softwareLifecyclePhase"
  | "softwareSubject"
  | "notApplicableTo"
  | "notSoftwareSubject";

/** Every fillable field, in a stable order — the default `fill.fields`. */
export const ALL_FILL_FIELDS: FillField[] = [
  "prefLabel",
  "altLabels",
  "broader",
  "narrower",
  "related",
  "subjects",
  "topicType",
  "appliesTo",
  "softwareLifecyclePhase",
  "softwareSubject",
  "notApplicableTo",
  "notSoftwareSubject",
];

export interface Pricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

/** Maps published-site routes back to source files. */
export interface RouteMapping {
  /** Site prefix, normalized: leading `/`, no trailing `/`; `""` = site root. */
  basePath: string;
  /** Repo-relative directory routes resolve into (no trailing slash). */
  root: string;
  /** Extensions to try when the route names a page without one. */
  extensions: string[];
  /** Basenames to try for directory routes (`/docs/actions/`). */
  indexFiles: string[];
}

export interface DockgConfig {
  version: 1;
  /** Normalized base IRI (trailing slash for http(s); `urn:dockg:` default). */
  baseIri: string;
  inputs: string[];
  exclude: string[];
  /** Output path of the built Turtle file, relative to configDir. */
  out: string;
  routes: RouteMapping[];
  build: { derive: DeriveSource[] };
  validate: { schemas: string[] };
  /** Graph-level SHACL validation (`dockg check`). */
  check: {
    /** Shapes .ttl paths; empty = the shapes bundled with dockg. */
    shapes: string[];
  };
  provenance: {
    /**
     * Gate for ALL git-derived provenance: per-file dates/authors, rename →
     * prov:wasRevisionOf edges, and the build activity's prov:endedAtTime
     * (HEAD committer date). Deterministic per commit; never the wall clock.
     *
     * `"auto"` (default) derives it wherever git can run and degrades with a
     * warning where it cannot; `true` requires it, so an unavailable git is an
     * operational error; `false` skips the subprocess entirely.
     */
    git: GitMode;
    /** Emit qualified attribution/association nodes with roles. */
    qualified: boolean;
  };
  fill: {
    provider: ProviderName;
    /** Model override; null = provider default. */
    model: string | null;
    /** Env var NAME holding the API key; null = provider default. */
    apiKeyEnv: string | null;
    baseUrl: string;
    /** Executable for the claude-cli provider. */
    command: string;
    temperature: number;
    maxCostUsd: number | null;
    cacheDir: string;
    fields: FillField[];
    /**
     * Minimum model self-confidence (0..1) to write a proposed field; below
     * this it is reported but not written (ADR 01015). Default 0.7.
     */
    minConfidence: number;
    /** Record kg.provenance on filled docs. */
    writeProvenance: boolean;
    /** Reject proposals that would violate the SHACL shapes contract. */
    validateGraph: boolean;
    pricing?: Pricing;
  };
  stats: {
    /**
     * Per-field minimum coverage percentages (0–100) enforced under
     * `stats --check`. Resolved shape is always a map; a uniform number in the
     * config expands across every measured field. Default `{}` gates nothing.
     * See ADR 01011.
     */
    coverageThreshold: Record<string, number>;
  };
  /** Absolute path of the loaded config file. */
  configPath: string;
  /** Directory containing the config file; relative paths resolve against it. */
  configDir: string;
}

export const DEFAULT_CONFIG_FILENAME = "dockg.config.yaml";

export const ALL_DERIVE_SOURCES: DeriveSource[] = [
  "frontmatter",
  "sections",
  "links",
  "tags",
  "images",
  "code",
  "provenance",
];

/** Default candidates for extensionless link targets (routes AND relative links). */
export const DEFAULT_LINK_EXTENSIONS = [".md", ".mdx"];
export const DEFAULT_INDEX_FILES = ["index", "README"];

/** `/docs/` -> `/docs`; `/` or `` -> `` (site root). */
function normalizeBasePath(basePath: string): string {
  let out = basePath.trim();
  if (!out.startsWith("/")) out = `/${out}`;
  out = out.replace(/\/+$/, "");
  return out;
}

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
const validateConfig = ajv.compile(configSchema);

/**
 * Normalize `stats.coverageThreshold` to a per-field map. Ajv has already
 * validated the input as a number, an object of known fields, or absent; a
 * uniform number expands across every measured field so the resolved shape is
 * always a map (default `{}`).
 */
function resolveCoverageThreshold(
  raw: number | Record<string, number> | undefined,
): Record<string, number> {
  if (raw == null) return {};
  if (typeof raw === "number")
    return Object.fromEntries(COVERAGE_FIELD_NAMES.map((f) => [f, raw]));
  return { ...raw };
}

/** Parse and validate config YAML text. `configPath` is used for messages and path resolution. */
export function parseConfig(text: string, configPath: string): DockgConfig {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    throw new DockgError(
      `Invalid YAML in ${configPath}: ${e instanceof Error ? e.message : "parse error"}`,
    );
  }
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DockgError(
      `Invalid config in ${configPath}: root must be an object`,
    );
  }
  if (!validateConfig(raw)) {
    const details = (validateConfig.errors ?? [])
      .map((e) => `  ${e.instancePath || "/"}: ${e.message}`)
      .join("\n");
    throw new DockgError(`Invalid config in ${configPath}:\n${details}`);
  }

  // Past this point Ajv has validated `raw` against config-schema.json, so the
  // shape is known-good and reading fields off it is safe. `unknown` would buy
  // nothing here but a cast at every access.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as Record<string, any>;
  const abs = resolve(configPath);
  const dir = dirname(abs);

  return {
    version: 1,
    baseIri: resolveBaseIri(r.baseIri),
    inputs: r.inputs ?? ["**/*.md"],
    exclude: r.exclude ?? ["**/node_modules/**"],
    out: r.out ?? "kg/graph.ttl",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    routes: ((r.routes ?? []) as Array<Record<string, any>>).map((m) => ({
      basePath: normalizeBasePath(m.basePath ?? "/"),
      root: String(m.root)
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .replace(/\/+$/, ""),
      extensions: m.extensions ?? [...DEFAULT_LINK_EXTENSIONS],
      indexFiles: m.indexFiles ?? [...DEFAULT_INDEX_FILES],
    })),
    build: {
      derive: r.build?.derive ?? [...ALL_DERIVE_SOURCES],
    },
    validate: {
      // Empty means: use the newest schema bundled with dockg (see bundledSchemaPath).
      schemas: r.validate?.schemas ?? [],
    },
    check: {
      // Empty means: use the shapes bundled with dockg (see bundledShapesPath).
      shapes: r.check?.shapes ?? [],
    },
    provenance: {
      git: r.provenance?.git ?? "auto",
      qualified: r.provenance?.qualified ?? true,
    },
    stats: {
      coverageThreshold: resolveCoverageThreshold(r.stats?.coverageThreshold),
    },
    fill: {
      provider: r.fill?.provider ?? "anthropic",
      model: r.fill?.model ?? null,
      apiKeyEnv: r.fill?.apiKeyEnv ?? null,
      baseUrl: r.fill?.baseUrl ?? "https://api.openai.com/v1",
      command: r.fill?.command ?? "claude",
      temperature: r.fill?.temperature ?? 0,
      maxCostUsd: r.fill?.maxCostUsd === undefined ? 5 : r.fill.maxCostUsd,
      cacheDir: r.fill?.cacheDir ?? ".dockg/cache",
      fields: r.fill?.fields ?? [...ALL_FILL_FIELDS],
      minConfidence: r.fill?.minConfidence ?? 0.7,
      writeProvenance: r.fill?.writeProvenance ?? true,
      validateGraph: r.fill?.validateGraph ?? true,
      pricing: r.fill?.pricing,
    },
    configPath: abs,
    configDir: dir,
  };
}

/**
 * Load config from an explicit path, or find `dockg.config.yaml` in the
 * working directory. With no config file present, built-in defaults apply.
 */
export function loadConfig(path?: string, cwd = process.cwd()): DockgConfig {
  if (path) {
    const abs = isAbsolute(path) ? path : resolve(cwd, path);
    if (!existsSync(abs)) {
      throw new DockgError(`Config file not found: ${abs}`);
    }
    return parseConfig(readFileSync(abs, "utf8"), abs);
  }
  const candidate = resolve(cwd, DEFAULT_CONFIG_FILENAME);
  if (existsSync(candidate)) {
    return parseConfig(readFileSync(candidate, "utf8"), candidate);
  }
  return parseConfig("version: 1\n", candidate);
}
