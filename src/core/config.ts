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
  | "code";

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

export interface DockgConfig {
  version: 1;
  /** Normalized base IRI (trailing slash for http(s); `urn:dockg:` default). */
  baseIri: string;
  inputs: string[];
  exclude: string[];
  /** Output path of the built Turtle file, relative to configDir. */
  out: string;
  build: { derive: DeriveSource[] };
  validate: { schemas: string[] };
  fill: {
    provider: ProviderName;
    /** Model override; null = provider default. */
    model: string | null;
    /** Env var NAME holding the API key; null = provider default. */
    apiKeyEnv: string | null;
    baseUrl: string;
    temperature: number;
    maxCostUsd: number | null;
    cacheDir: string;
    fields: FillField[];
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
];

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
    build: {
      derive: r.build?.derive ?? [...ALL_DERIVE_SOURCES],
    },
    validate: {
      schemas: r.validate?.schemas ?? ["dockg:frontmatter:0.1"],
    },
    fill: {
      provider: r.fill?.provider ?? "anthropic",
      model: r.fill?.model ?? null,
      apiKeyEnv: r.fill?.apiKeyEnv ?? null,
      baseUrl: r.fill?.baseUrl ?? "https://api.openai.com/v1",
      temperature: r.fill?.temperature ?? 0,
      maxCostUsd: r.fill?.maxCostUsd === undefined ? 5 : r.fill.maxCostUsd,
      cacheDir: r.fill?.cacheDir ?? ".dockg/cache",
      fields: r.fill?.fields ?? ["prefLabel", "altLabels", "related", "subjects"],
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
