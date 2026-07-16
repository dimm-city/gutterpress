import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defaultCommandRunner } from "./command-runner.ts";

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

  it("has no timeout when timeoutMs is omitted (unchanged default)", async () => {
    const script = writeScript("echo hi");
    const res = await defaultCommandRunner("/bin/sh", [script]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("hi");
  });
});
