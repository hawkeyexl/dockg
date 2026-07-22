/** Provider abstraction for the AI fill feature (ported from docevals). */

export interface CompleteJSONRequest {
  system: string;
  user: string;
  /** JSON Schema the response must satisfy. */
  schema: Record<string, unknown>;
  temperature: number;
}

export interface CompleteJSONResponse {
  json: unknown;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface LlmProvider {
  /** Stable provider id — feeds the cache key. */
  provider(): string;
  /** Model id — feeds the cache key. */
  modelName(): string;
  completeJSON(req: CompleteJSONRequest): Promise<CompleteJSONResponse>;
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
}

export type ExecFn = (
  cmd: string[],
  opts?: {
    cwd?: string;
    /** Overrides on the ambient environment; `undefined` *unsets* a variable. */
    env?: Record<string, string | undefined>;
    timeoutMs?: number;
  },
) => Promise<ExecResult>;
