/**
 * IPC-handler contract for `electron/api/log.ts`'s `logRead` (SFE-P5c1 —
 * migrated off `src/routes/api/log/read/+server.ts`, deleted). Ports the
 * log/read cases from the deleted `fs-routes-scoping.test.ts` (code review:
 * "read any absolute path's full contents" — confined to the fs-guard's
 * read-only roots, same allow-list `fs:readFile`'s `includeReadOnlyRoots`
 * uses).
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerHostServices } from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { logRead, logList } from "../../electron/api/log";

async function caught(p: Promise<unknown>): Promise<{ message: string }> {
  try {
    await p;
    throw new Error("expected the promise to reject, but it resolved");
  } catch (e) {
    return { message: e instanceof Error ? e.message : String(e) };
  }
}

let base: string;
let recoveryDir: string;
let outsideDir: string;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "gutterpress-log-ipc-"));
  recoveryDir = path.join(base, "recovery");
  outsideDir = path.join(base, "elsewhere");
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(outsideDir, { recursive: true });
  registerHostServices(
    makeHostServices({
      fsGuard: { projectRoots: () => [], readOnlyRoots: () => [recoveryDir] },
    }),
  );
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

test("log:read: a path under the read-only root (operation logs / recovery) is allowed", async () => {
  await writeFile(path.join(recoveryDir, "op.log"), "log line", "utf8");
  expect(await logRead(path.join(recoveryDir, "op.log"))).toBe("log line");
});

test("log:read: an absolute path outside the read-allow-list is rejected", async () => {
  const { message } = await caught(logRead(path.join(outsideDir, "secret.txt")));
  expect(message).toBe("log:read: path is outside the open project");
});

test("log:read: no path resolves null rather than throwing", async () => {
  expect(await logRead(undefined)).toBeNull();
});

test("log:list: returns .log files under the read-only roots, newest first", async () => {
  await writeFile(path.join(recoveryDir, "a.log"), "a", "utf8");
  await new Promise((r) => setTimeout(r, 5));
  await writeFile(path.join(recoveryDir, "b.log"), "b", "utf8");
  await writeFile(path.join(recoveryDir, "ignore.txt"), "not a log", "utf8");
  const entries = await logList();
  expect(entries.map((e) => e.name)).toEqual(["b.log", "a.log"]);
});
