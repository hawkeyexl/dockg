/** Provider factory driven by config `fill` settings and CLI overrides. */
import { DockgError } from "../../types.js";
import type { DockgConfig } from "../../core/config.js";
import type { LlmProvider } from "../types.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAICompatProvider } from "./openai-compat.js";
import { ClaudeCliProvider } from "./claude-cli.js";
import { MockProvider } from "./mock.js";

export interface ProviderOptions {
  provider?: string;
  model?: string;
}

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o-mini",
  "claude-cli": "claude-sonnet-4-5",
  mock: "mock-model",
};

export function makeProvider(
  config: DockgConfig,
  options: ProviderOptions = {},
): LlmProvider {
  const name = options.provider ?? config.fill.provider;
  const model =
    options.model ?? config.fill.model ?? DEFAULT_MODELS[name] ?? "unknown";

  switch (name) {
    case "anthropic":
      return new AnthropicProvider(
        model,
        config.fill.apiKeyEnv ?? "ANTHROPIC_API_KEY",
      );
    case "openai":
      return new OpenAICompatProvider(
        config.fill.baseUrl,
        model,
        config.fill.apiKeyEnv ?? "OPENAI_API_KEY",
      );
    case "claude-cli":
      return new ClaudeCliProvider(model);
    case "mock":
      // Offline smoke-testing seam: proposes nothing.
      return new MockProvider([{ json: {} }]);
    default:
      throw new DockgError(
        `Unknown provider "${name}". Available: anthropic, openai, claude-cli, mock.`,
      );
  }
}
