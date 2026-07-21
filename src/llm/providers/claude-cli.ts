/**
 * Claude CLI provider: shells out to the `claude` CLI using its local
 * authentication — no API key needed. Token usage is not reported, so cost
 * shows as unknown.
 */
import { realExec } from "../exec.js";
import { extractJson } from "./openai-compat.js";
import type {
  CompleteJSONRequest,
  CompleteJSONResponse,
  ExecFn,
  LlmProvider,
} from "../types.js";

export class ClaudeCliProvider implements LlmProvider {
  constructor(
    private readonly model: string,
    private readonly command: string = "claude",
    private readonly exec: ExecFn = realExec,
  ) {}

  provider(): string {
    return "claude-cli";
  }

  modelName(): string {
    return this.model;
  }

  async completeJSON(req: CompleteJSONRequest): Promise<CompleteJSONResponse> {
    const prompt = [
      req.user,
      "",
      "Respond with ONLY a JSON object conforming to this JSON Schema — no",
      "prose, no markdown fences:",
      JSON.stringify(req.schema),
    ].join("\n");

    const result = await this.exec(
      [
        this.command,
        "-p",
        prompt,
        "--append-system-prompt",
        req.system,
        "--output-format",
        "json",
        "--model",
        this.model,
      ],
      { timeoutMs: 180000 },
    );

    if (result.spawnError) {
      throw new Error(
        `Failed to run ${this.command}: ${result.spawnError} (is the Claude CLI installed?)`,
      );
    }
    if (result.timedOut) throw new Error("Claude CLI timed out");
    if (result.code !== 0) {
      throw new Error(
        `Claude CLI exited ${result.code}: ${result.stderr.trim().slice(-300)}`,
      );
    }

    // --output-format json wraps the answer: { result: "...", ... }
    const wrapper = JSON.parse(result.stdout) as { result?: string };
    if (typeof wrapper.result !== "string") {
      throw new Error("Claude CLI returned no result field");
    }
    return { json: extractJson(wrapper.result) };
  }
}
