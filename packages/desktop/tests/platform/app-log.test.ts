// ──────────────────────────────────────────────────────────────────────────
// app-log.test.ts — the app's own fault log (electron/app-log.ts).
//
// Real fs against a tmp dir: the two things that can silently lose or ruin a
// diagnostic file are (a) the log directory not existing yet on a fresh
// install and (b) unbounded growth.
// ──────────────────────────────────────────────────────────────────────────

import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { APP_LOG_MAX_BYTES, initAppLog, logAppError } from "../../electron/app-log";

test("a logged fault lands in the file, timestamped, creating the log dir", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "gutterpress-app-log-"));
  // Nothing has created userData/logs/ yet on a fresh install — the first
  // fault must still be recorded, not dropped.
  const file = path.join(base, "logs", "Gutterpress app.log");
  initAppLog(() => file);
  try {
    await logAppError("[updater] check failed: HttpError: 403 rate limit exceeded");
    await logAppError("[updater] download failed: net::ERR_CONNECTION_RESET");

    const text = await readFile(file, "utf8");
    const lines = text.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("[updater] check failed: HttpError: 403 rate limit exceeded");
    expect(lines[1]).toContain("[updater] download failed: net::ERR_CONNECTION_RESET");
    // An author pasting this into a support thread needs to know when.
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z /);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("the log restarts at the cap instead of growing without bound", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "gutterpress-app-log-cap-"));
  const file = path.join(base, "Gutterpress app.log");
  initAppLog(() => file);
  // Filling the cap takes messages far too big to echo into the test output.
  const realConsoleError = console.error;
  console.error = () => {};
  try {
    const filler = "x".repeat(Math.floor(APP_LOG_MAX_BYTES / 2));
    await logAppError(`first ${filler}`);
    await logAppError(`second ${filler}`);

    const size = (await stat(file)).size;
    expect(size).toBeLessThanOrEqual(APP_LOG_MAX_BYTES);
    // The newest fault is the one worth keeping.
    const text = await readFile(file, "utf8");
    expect(text).toContain("second ");
    expect(text).not.toContain("first ");
  } finally {
    console.error = realConsoleError;
    await rm(base, { recursive: true, force: true });
  }
});
