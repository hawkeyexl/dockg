/**
 * Anthropic provider: structured output via a single forced tool call whose
 * input schema is the proposal schema — the model cannot answer any other way.
 */
import Anthropic from "@anthropic-ai/sdk";
import { DockgError } from "../../types.js";
import type {
  CompleteJSONRequest,
  CompleteJSONResponse,
  LlmProvider,
} from "../types.js";

const TOOL_NAME = "record_proposal";

export class AnthropicProvider implements LlmProvider {
  private readonly client: Anthropic;

  constructor(
    private readonly model: string,
    apiKeyEnv: string,
  ) {
    const apiKey = process.env[apiKeyEnv];
    if (!apiKey) {
      throw new DockgError(
        `Anthropic provider needs ${apiKeyEnv} set (or choose another provider)`,
      );
    }
    this.client = new Anthropic({ apiKey });
  }

  provider(): string {
    return "anthropic";
  }

  modelName(): string {
    return this.model;
  }

  async completeJSON(req: CompleteJSONRequest): Promise<CompleteJSONResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      temperature: req.temperature,
      system: req.system,
      messages: [{ role: "user", content: req.user }],
      tools: [
        {
          name: TOOL_NAME,
          description: "Record the structured SKOS field proposal.",
          input_schema: req.schema as Anthropic.Tool["input_schema"],
        },
      ],
      tool_choice: { type: "tool", name: TOOL_NAME },
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (!toolUse) {
      throw new Error("Anthropic response contained no tool_use block");
    }
    return {
      json: toolUse.input,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
