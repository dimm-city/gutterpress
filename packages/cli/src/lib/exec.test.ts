import { test, expect, spyOn } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  execCapture,
  spawnCapture,
  buildEnhancedPath,
  localBin,
  enhancedPath,
  EXIT_FLUSH_GRACE_MS,
} from "./exec";

test("execCapture rejects with a signal-named message when child is killed by a signal", async () => {
  // The shell kills itself with SIGTERM; node reports code=null, signal="SIGTERM".
  let err: Error | undefined;
  try {
    await execCapture("sh", ["-c", "kill -TERM $$"]);
  } catch (e) {
    err = e as Error;
  }

  expect(err).toBeDefined();
  expect(err!.message).not.toContain("exited null");
  expect(err!.message).toContain("SIGTERM");
});

// --- PATH construction (arch finding #3: exec.ts hardcoded ":" while
// tool-probe.ts correctly used node:path's `delimiter`) -------------------

test("buildEnhancedPath joins with the given separator, not a hardcoded ':'", () => {
  // Simulates Windows (";") on whatever OS the test actually runs on, so
  // the delimiter bug is caught even when CI runs on Linux.
  const result = buildEnhancedPath("C:\\tools\\.bin", "C:\\Windows;C:\\Windows\\System32", ";");
  expect(result).toBe("C:\\tools\\.bin;C:\\Windows;C:\\Windows\\System32");
});

test("buildEnhancedPath defaults to node:path's delimiter for the current platform", () => {
  const result = buildEnhancedPath("/x/y/.bin", "/usr/bin");
  expect(result).toBe(`/x/y/.bin${delimiter}/usr/bin`);
});

test("buildEnhancedPath does not corrupt Windows drive-letter paths by fusing them together", () => {
  // The original bug (a hardcoded ":") would turn "C:\tools\.bin" + "C:\Windows"
  // into "C:\tools\.bin:C:\Windows" — PATH entries fused into one bogus segment.
  // With the correct ";" separator the two drive-letter entries stay distinct.
  const result = buildEnhancedPath("C:\\tools\\.bin", "C:\\Windows", ";");
  const segments = result.split(";");
  expect(segments).toEqual(["C:\\tools\\.bin", "C:\\Windows"]);
});

test("exec.ts exports a single shared enhancedPath built from localBin", () => {
  expect(enhancedPath.startsWith(localBin + delimiter)).toBe(true);
});

// --- execCapture timeout + timer cleanup (arch finding #16) ---------------

test("execCapture with no timeoutMs option behaves as before (unlimited wait)", async () => {
  const { stdout } = await execCapture("printf", ["hello"]);
  expect(stdout).toBe("hello");
});

test("execCapture rejects and kills the child once timeoutMs elapses", async () => {
  const start = Date.now();
  let err: Error | undefined;
  try {
    await execCapture("sh", ["-c", "sleep 5"], { timeoutMs: 100 });
  } catch (e) {
    err = e as Error;
  }
  const elapsed = Date.now() - start;

  expect(err).toBeDefined();
  expect(err!.message).toContain("timed out");
  // Should resolve close to the 100ms timeout, not wait out the 5s sleep.
  expect(elapsed).toBeLessThan(2000);
});

test("execCapture with timeoutMs: 0 disables the kill timer entirely", async () => {
  // 0 means "no timeout", not "timeout immediately": no kill timer is armed
  // (the only setTimeout in the path is the post-exit flush grace) and a
  // short-lived child completes normally instead of being SIGKILLed at once.
  const spy = spyOn(globalThis, "setTimeout");
  spy.mockClear();
  try {
    const { stdout } = await execCapture("printf", ["ok"], { timeoutMs: 0 });
    expect(stdout).toBe("ok");
    const delays = spy.mock.calls.map((c) => c[1]);
    expect(delays).not.toContain(0);
    expect(delays.filter((d) => d !== EXIT_FLUSH_GRACE_MS)).toEqual([]);
  } finally {
    spy.mockRestore();
  }
});

test("execCapture's kill timer is cleared on normal (non-timeout) completion", async () => {
  const clearTimeoutSpy = spyOn(globalThis, "clearTimeout");
  clearTimeoutSpy.mockClear();

  await execCapture("printf", ["ok"], { timeoutMs: 5000 });

  expect(clearTimeoutSpy).toHaveBeenCalled();
  clearTimeoutSpy.mockRestore();
});

test("execCapture's kill timer is unref'd so it cannot hold the event loop open", async () => {
  const realSetTimeout = globalThis.setTimeout;
  let sawUnrefCall = false;

  const setTimeoutSpy = spyOn(globalThis, "setTimeout").mockImplementation(((
    fn: (...args: unknown[]) => void,
    ms?: number,
    ...rest: unknown[]
  ) => {
    const timer = realSetTimeout(fn, ms, ...rest) as NodeJS.Timeout;
    const originalUnref = timer.unref.bind(timer);
    timer.unref = (() => {
      sawUnrefCall = true;
      return originalUnref();
    }) as typeof timer.unref;
    return timer;
  }) as typeof setTimeout);

  try {
    await execCapture("printf", ["ok"], { timeoutMs: 5000 });
  } finally {
    setTimeoutSpy.mockRestore();
  }

  expect(sawUnrefCall).toBe(true);
});

// --- post-exit flush grace (exit vs close) --------------------------------
//
// Both scripts synchronize on a flag file so the parent shell only exits
// once the backgrounded subshell has provably started (and thus holds the
// inherited stdout pipe) — without this the fork/exit race can let 'close'
// fire immediately and the test measures nothing.

function syncFilePath(): string {
  return join(mkdtempSync(join(tmpdir(), "pmd-exec-")), "started");
}

test("spawnCapture re-arms the flush grace while a grandchild keeps streaming after 'exit'", async () => {
  // The SWA CLI pattern taken further: the direct child exits while its
  // grandchild streams for LONGER than one grace-width, with gaps SHORTER
  // than the grace. The grace is an idle window — every chunk re-arms it —
  // so the full stream must be captured, not cut at exit+grace.
  const sync = syncFilePath();
  const script = [
    `( : > "${sync}"; i=0; while [ $i -lt 8 ]; do echo "tick-$i"; sleep 0.05; i=$((i+1)); done ) &`,
    `while [ ! -e "${sync}" ]; do :; done`,
    `exit 0`,
  ].join("\n");
  const res = await spawnCapture("sh", ["-c", script], { exitGraceMs: 200 });
  expect(res.code).toBe(0);
  // 8 ticks over ~400ms: a one-shot 200ms grace would truncate the tail.
  for (let i = 0; i < 8; i++) {
    expect(res.stdout).toContain(`tick-${i}`);
  }
});

test("spawnCapture settles ~one grace after 'exit' when a silent grandchild holds the pipe", async () => {
  // A silent daemon writes nothing, so nothing re-arms the grace: settle
  // one grace-width after exit, with the recorded exit code — never hang
  // until the grandchild dies.
  const sync = syncFilePath();
  const script = [
    `( : > "${sync}"; exec sleep 10 ) &`,
    `while [ ! -e "${sync}" ]; do :; done`,
    `exit 3`,
  ].join("\n");
  const start = Date.now();
  const res = await spawnCapture("sh", ["-c", script], { exitGraceMs: 200 });
  const elapsed = Date.now() - start;
  expect(res.code).toBe(3);
  expect(elapsed).toBeGreaterThanOrEqual(150);
  expect(elapsed).toBeLessThan(5000);
});

test("execCapture respects the cwd option", async () => {
  const os = await import("node:os");
  const fs = await import("node:fs");
  const dir = fs.realpathSync(os.tmpdir());
  const { stdout } = await execCapture("pwd", [], { cwd: dir });
  expect(stdout.trim()).toBe(dir);
});
