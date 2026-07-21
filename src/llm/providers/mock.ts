/**
 * Mock provider for tests and offline development. Responds with scripted
 * results in order, cycling when exhausted. Exported from the public API so
 * downstream consumers can test their own pipelines without a live provider.
 */
import type {
  CompleteJSONRequest,
  CompleteJSONResponse,
  LlmProvider,
} from "../types.js";

export type MockResponse =
  | { json: unknown; usage?: { inputTokens: number; outputTokens: number } }
  | { error: string };

export class MockProvider implements LlmProvider {
  private calls = 0;
  public readonly requests: CompleteJSONRequest[] = [];

  constructor(
    private readonly responses: MockResponse[],
    private readonly model = "mock-model",
  ) {
    if (responses.length === 0) {
      throw new Error("MockProvider needs at least one scripted response");
    }
  }

  provider(): string {
    return "mock";
  }

  modelName(): string {
    return this.model;
  }

  completeJSON(req: CompleteJSONRequest): Promise<CompleteJSONResponse> {
    this.requests.push(req);
    const response = this.responses[this.calls % this.responses.length]!;
    this.calls += 1;
    if ("error" in response) {
      return Promise.reject(new Error(response.error));
    }
    return Promise.resolve({
      json: response.json,
      usage: response.usage ?? { inputTokens: 500, outputTokens: 100 },
    });
  }
}
