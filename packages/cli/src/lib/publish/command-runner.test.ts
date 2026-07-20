import { describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EXIT_FLUSH_GRACE_MS } from "../exec.ts";
import { defaultCommandRunner, PUBLISH_IDLE_TIMEOUT_MS } from "./command-runner.ts";

// A tiny helper to write an executable shell script into a temp dir.
function writeScript(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pmd-cmdrun-"));
  const p = join(dir, "script.sh");
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}

describe("defaultCommandRunner idle timeout (audit B2)", () => {
  it("kills a child that produces no output within timeoutMs", async () => {
    // Sleeps far longer than the timeout and prints nothing.
    const script = writeScript("sleep 30");
    const start = Date.now();
    let err: unknown;
    try {
      await defaultCommandRunner("/bin/sh", [script], { timeoutMs: 150 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("no output");
    // Should reject promptly (well under the 30s sleep), proving the SIGKILL.
    expect(Date.now() - start).toBeLessThan(5000);
  });

  it("does NOT kill a child that keeps producing output (idle timer resets)", async () => {
    // Prints every 50ms for ~400ms, then exits — never idle for the full 200ms.
    const script = writeScript(
      "i=0; while [ $i -lt 8 ]; do echo tick; sleep 0.05; i=$((i+1)); done",
    );
    const lines: string[] = [];
    const res = await defaultCommandRunner("/bin/sh", [script], {
      timeoutMs: 200,
      onOutput: (l) => lines.push(l),
    });
    expect(res.code).toBe(0);
    expect(lines.filter((l) => l.trim() === "tick").length).toBeGreaterThanOrEqual(1);
  });

  it("timeoutMs: 0 explicitly disables the idle timeout", async () => {
    const spy = spyOn(globalThis, "setTimeout");
    spy.mockClear();
    try {
      const script = writeScript("echo hi");
      const res = await defaultCommandRunner("/bin/sh", [script], { timeoutMs: 0 });
      expect(res.code).toBe(0);
      expect(res.stdout).toContain("hi");
      expect(spy.mock.calls.map((c) => c[1])).not.toContain(PUBLISH_IDLE_TIMEOUT_MS);
    } finally {
      spy.mockRestore();
    }
  });

  it("arms the default idle timeout when timeoutMs is omitted", async () => {
    // Call sites that forget timeoutMs (e.g. commandExists probes) must not
    // silently regain hang-forever behavior — the runner itself defaults it.
    const spy = spyOn(globalThis, "setTimeout");
    spy.mockClear();
    try {
      const script = writeScript("echo hi");
      await defaultCommandRunner("/bin/sh", [script]);
      const delays = spy.mock.calls.map((c) => c[1]);
      expect(delays).toContain(PUBLISH_IDLE_TIMEOUT_MS);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("defaultCommandRunner stdio flush (exit vs close)", () => {
  // Both scripts synchronize on a "$0.started" flag file so the parent shell
  // only exits after the backgrounded subshell has provably started (and thus
  // holds the inherited stdout pipe). Without this the test races the fork:
  // on a cold run 'close' can fire immediately and the test measures nothing.

  it("captures output still in the pipe when 'exit' fires (grandchild writes late)", async () => {
    // The SWA CLI pattern: the direct child exits while a grandchild that
    // inherited the stdio pipes is still writing. Settling on 'exit' loses
    // that output; the runner must wait for 'close' (stdio flushed). The
    // grandchild's 0.05s delay is far inside the 2s flush grace.
    const script = writeScript(
      [
        `sync="$0.started"`,
        `( : > "$sync"; sleep 0.05; echo late-output ) &`,
        `while [ ! -e "$sync" ]; do :; done`,
        `exit 0`,
      ].join("\n"),
    );
    const res = await defaultCommandRunner("/bin/sh", [script]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("late-output");
  });

  it("settles a bounded grace after 'exit' when a daemon grandchild holds the pipe", async () => {
    // The grandchild inherits stdout, stays silent, and outlives the grace,
    // so 'close' won't fire until it dies — the runner must settle on the
    // grace timer with the recorded exit code rather than hang.
    const script = writeScript(
      [
        `sync="$0.started"`,
        `( : > "$sync"; exec sleep 10 ) &`,
        `while [ ! -e "$sync" ]; do :; done`,
        `exit 7`,
      ].join("\n"),
    );
    const start = Date.now();
    const res = await defaultCommandRunner("/bin/sh", [script]);
    const elapsed = Date.now() - start;
    expect(res.code).toBe(7);
    // Wide margins: at least most of one grace-width, well under the 10s
    // the grandchild would make us wait if we hung until 'close'.
    expect(elapsed).toBeGreaterThanOrEqual(EXIT_FLUSH_GRACE_MS - 500);
    expect(elapsed).toBeLessThan(8000);
  });
});
