/**
 * Fill proposal cache: content-addressed JSON files. The key covers provider,
 * model, prompt version, requested fields, and the full file content — any
 * change misses.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FillField } from "../core/config.js";
import { PROMPT_VERSION } from "./prompt.js";

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function cacheKey(
  provider: string,
  model: string,
  content: string,
  fields: FillField[],
): string {
  return sha256(
    [
      provider,
      model,
      `v${PROMPT_VERSION}`,
      sha256(content),
      fields.join(","),
    ].join("|"),
  );
}

export class FillCache {
  constructor(
    private readonly dir: string,
    private readonly enabled: boolean = true,
  ) {}

  get(key: string): Record<string, unknown> | undefined {
    if (!this.enabled) return undefined;
    const path = join(this.dir, `${key}.json`);
    if (!existsSync(path)) return undefined;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      return undefined; // Corrupt cache entry — treat as a miss.
    }
  }

  set(key: string, proposal: Record<string, unknown>): void {
    if (!this.enabled) return;
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(
      join(this.dir, `${key}.json`),
      JSON.stringify(proposal, null, 2),
    );
  }
}
