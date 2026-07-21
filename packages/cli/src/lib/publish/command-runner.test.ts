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

/**
 * Instrumented setTimeout spy that records, for every timer armed while it
 * is installed, the callback, the delay, AND the arming call stack — then
 * passes through to the real setTimeout. `runnerIdleTimers()` filters to
 * timers that (a) use the exact idle delay and (b) were armed from the
 * runner's spawn core (armKill in exec.ts), so unrelated code arming a
 * 300000ms timer while the process-wide spy is installed can neither
 * false-fail an "arms nothing" assertion nor hand us a foreign callback
 * to invoke. Tests that rely on the provenance filter must include a
 * positive control (a call known to arm the timer) so a rename of
 * armKill/exec.ts fails loudly instead of passing vacuously.
 */
function trackTimers() {
  const original = globalThis.setTimeout;
  const armed: { cb: () => void; delay: unknown; stack: string }[] = [];
  const spy = spyOn(globalThis, "setTimeout").mockImplementation(((
    cb: () => void,
    delay?: number,
    ...rest: unknown[]
  ) => {
    armed.push({ cb, delay, stack: new Error().stack ?? "" });
    return (original as (...a: unknown[]) => ReturnType<typeof setTimeout>)(cb, delay, ...rest);
  }) as unknown as typeof setTimeout);
  return {
    armed,
    runnerIdleTimers: () =>
      armed.filter(
        (t) => t.delay === PUBLISH_IDLE_TIMEOUT_MS && /armKill|exec\.ts/.test(t.stack),
      ),
    restore: () => spy.mockRestore(),
  };
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
    const timers = trackTimers();
    try {
      const script = writeScript("echo hi");
      // Positive control: an omitted-timeoutMs call must arm the idle timer,
      // proving the delay+provenance filter actually matches the runner's
      // timers before we assert its absence below.
      await defaultCommandRunner("/bin/sh", [script]);
      expect(timers.runnerIdleTimers().length).toBeGreaterThanOrEqual(1);
      timers.armed.length = 0;

      const res = await defaultCommandRunner("/bin/sh", [script], { timeoutMs: 0 });
      expect(res.code).toBe(0);
      expect(res.stdout).toContain("hi");
      expect(timers.runnerIdleTimers().length).toBe(0);
    } finally {
      timers.restore();
    }
  });

  it("default timeout: the armed idle timer, when fired, kills the child and rejects", async () => {
    // Call sites that forget timeoutMs (e.g. commandExists probes) must not
    // silently regain hang-forever behavior — the runner itself defaults it.
    // Asserting only "some timer was armed with the right delay" would stay
    // green if the timer were inert (cleared immediately / rejection dropped),
    // so this test fires the armed callback by hand and asserts the real
    // consequences: the child dies and the runner rejects with the idle
    // message. The 30s sleep makes an unkilled child observable.
    const timers = trackTimers();
    try {
      const script = writeScript('echo "pid=$$"\nsleep 0.05\necho tick\nsleep 30');
      let pid = 0;
      let tickSeen!: () => void;
      const gotTick = new Promise<void>((r) => {
        tickSeen = r;
      });
      const runner = defaultCommandRunner("/bin/sh", [script], {
        onOutput: (line) => {
          const m = /^pid=(\d+)$/.exec(line.trim());
          if (m) pid = Number(m[1]);
          if (line.trim() === "tick") tickSeen();
        },
      });
      // Attach both handlers NOW: the manual firing below cannot leave an
      // unhandled-rejection window, and the promise is awaited exactly once.
      const settled = runner.then(
        () => null,
        (e: unknown) => e as Error,
      );
      await gotTick;

      // Idle-mode pin: armed once at spawn, RE-armed with the same delay on
      // each output chunk — a "total"-mode regression arms exactly once.
      const idleTimers = timers.runnerIdleTimers();
      expect(idleTimers.length).toBeGreaterThanOrEqual(2);

      // Fire the currently-armed timer ~300s early. (Firing a stale, already
      // -cleared arm would be equivalent: settle() is idempotent.)
      idleTimers[idleTimers.length - 1]!.cb();

      const err = await settled;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain(
        `produced no output for ${PUBLISH_IDLE_TIMEOUT_MS}ms`,
      );

      // The kill is real: the shell printed its own pid ($$ === child.pid),
      // and it must die promptly instead of finishing its 30s sleep.
      expect(pid).toBeGreaterThan(0);
      const deadline = Date.now() + 3000;
      let alive = true;
      while (alive && Date.now() < deadline) {
        try {
          process.kill(pid, 0);
          await new Promise((r) => setTimeout(r, 20));
        } catch {
          alive = false;
        }
      }
      expect(alive).toBe(false);
    } finally {
      timers.restore();
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
