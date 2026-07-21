/**
 * Cost tracking: token usage priced from a small static table, overridable in
 * config `fill.pricing`. Unknown models cost 0 (unknown), never a guess.
 */
import type { Pricing } from "../core/config.js";

/** USD per million tokens. Keep entries pinned-model-specific. */
const PRICE_TABLE: Record<string, Pricing> = {
  "claude-sonnet-4-5": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
  "claude-opus-4-8": { inputPerMTok: 15, outputPerMTok: 75 },
  "gpt-4o-mini": { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  "gpt-4o": { inputPerMTok: 2.5, outputPerMTok: 10 },
};

export function pricingFor(
  model: string,
  override?: Pricing,
): Pricing | undefined {
  if (override) return override;
  if (PRICE_TABLE[model]) return PRICE_TABLE[model];
  // Match pinned variants like claude-sonnet-4-5-20250929.
  const base = Object.keys(PRICE_TABLE).find((k) => model.startsWith(k));
  return base ? PRICE_TABLE[base] : undefined;
}

export function costOfUsage(
  usage: { inputTokens: number; outputTokens: number } | undefined,
  pricing: Pricing | undefined,
): number {
  if (!usage || !pricing) return 0;
  return (
    (usage.inputTokens / 1_000_000) * pricing.inputPerMTok +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMTok
  );
}
