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

export type ProviderName = "anthropic" | "openai" | "claude-cli" | "mock";

export type DeriveSource =
  | "frontmatter"
  | "sections"
  | "links"
  | "tags"
  | "images"
  | "code"
  | "provenance";

export type FillField =
  | "prefLabel"
  | "altLabels"
  | "broader"
  | "narrower"
  | "related"
  | "subjects";

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
  provenance: {
    /** Stamp the build activity with the corpus HEAD committer date. */
    gitTime: boolean;
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
    /** Record kg.provenance on filled docs. */
    writeProvenance: boolean;
    pricing?: Pricing;
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
    throw new DockgError(`Invalid config in ${configPath}: root must be an object`);
  }
  if (!validateConfig(raw)) {
    const details = (validateConfig.errors ?? [])
      .map((e) => `  ${e.instancePath || "/"}: ${e.message}`)
      .join("\n");
    throw new DockgError(`Invalid config in ${configPath}:\n${details}`);
  }

  const r = raw as Record<string, any>;
  const abs = resolve(configPath);
  const dir = dirname(abs);

  return {
    version: 1,
    baseIri: resolveBaseIri(r.baseIri),
    inputs: r.inputs ?? ["**/*.md"],
    exclude: r.exclude ?? ["**/node_modules/**"],
    out: r.out ?? "kg/graph.ttl",
    routes: ((r.routes ?? []) as Array<Record<string, any>>).map((m) => ({
      basePath: normalizeBasePath(m.basePath ?? "/"),
      root: String(m.root).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, ""),
      extensions: m.extensions ?? [...DEFAULT_LINK_EXTENSIONS],
      indexFiles: m.indexFiles ?? [...DEFAULT_INDEX_FILES],
    })),
    build: {
      derive: r.build?.derive ?? [...ALL_DERIVE_SOURCES],
    },
    validate: {
      // Empty means: use the schema bundled with dockg (schemas/frontmatter-0.2.json).
      schemas: r.validate?.schemas ?? [],
    },
    provenance: {
      gitTime: r.provenance?.gitTime ?? false,
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
      fields: r.fill?.fields ?? ["prefLabel", "altLabels", "related", "subjects"],
      writeProvenance: r.fill?.writeProvenance ?? true,
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
