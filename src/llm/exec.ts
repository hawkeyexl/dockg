/**
 * Process execution wrapper. Uses cross-spawn so npm shims resolve on Windows
 * without `shell: true` and its quoting hazards.
 */
import spawn from "cross-spawn";
import type { ExecFn, ExecResult } from "./types.js";

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
      env: { ...process.env, ...(opts.env ?? {}) },
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

    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (e) =>
      settle({ code: null, stdout, stderr, timedOut, spawnError: e.message }),
    );
    child.on("close", (code) => settle({ code, stdout, stderr, timedOut }));
  });
};
