/**
 * Process execution wrapper. Uses cross-spawn so npm shims resolve on Windows
 * without `shell: true` and its quoting hazards.
 */
import spawn from "cross-spawn";
import type { ExecFn, ExecResult } from "./types.js";

/**
 * Merge overrides onto the ambient environment, treating an explicit
 * `undefined` as "unset this variable". Callers need that to neutralize
 * inherited state they must not see — notably git's GIT_DIR/GIT_INDEX_FILE,
 * which git exports to every hook subprocess and which would otherwise
 * redirect a child `git` away from the cwd it was given.
 */
function buildEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...overrides })) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

export const realExec: ExecFn = (cmd, opts = {}) => {
  const [bin, ...args] = cmd;
  if (!bin) {
    return Promise.resolve<ExecResult>({
      code: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      spawnError: "Empty command",
    });
  }
  return new Promise<ExecResult>((resolvePromise) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: buildEnv(opts.env),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timeoutMs = opts.timeoutMs ?? 60000;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    const settle = (result: ExecResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };

    // setEncoding routes chunks through a StringDecoder, so multi-byte UTF-8
    // characters straddling pipe-chunk boundaries decode correctly; a raw
    // per-chunk Buffer.toString() would corrupt them nondeterministically.
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (d: string) => (stdout += d));
    child.stderr?.on("data", (d: string) => (stderr += d));
    child.on("error", (e) =>
      settle({ code: null, stdout, stderr, timedOut, spawnError: e.message }),
    );
    child.on("close", (code) => settle({ code, stdout, stderr, timedOut }));
  });
};
