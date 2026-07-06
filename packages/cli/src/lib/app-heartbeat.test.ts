import { expect, test } from "bun:test";
import * as fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  APP_HEARTBEAT_FRESH_MS,
  appHeartbeatPath,
  isAppHeartbeatFresh,
  readAppHeartbeat,
  removeAppHeartbeat,
  writeAppHeartbeat,
} from "./app-heartbeat.ts";

async function makeRepoDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "app-heartbeat-"));
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  return dir;
}

test("absent heartbeat: readAppHeartbeat is null, isAppHeartbeatFresh is false", async () => {
  const dir = await makeRepoDir();
  try {
    expect(await readAppHeartbeat(dir)).toBeNull();
    expect(await isAppHeartbeatFresh(dir)).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("fresh heartbeat: written now reads back and is fresh", async () => {
  const dir = await makeRepoDir();
  try {
    const now = 1_700_000_000_000;
    await writeAppHeartbeat(dir, now, 4242);
    const heartbeat = await readAppHeartbeat(dir);
    expect(heartbeat).toEqual({ pid: 4242, timestamp: now });
    expect(isAppHeartbeatFresh(dir, now)).resolves.toBe(true);
    // Just under the freshness window is still fresh.
    expect(
      await isAppHeartbeatFresh(dir, now + APP_HEARTBEAT_FRESH_MS - 1),
    ).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stale heartbeat: at/after the freshness window reads as not fresh", async () => {
  const dir = await makeRepoDir();
  try {
    const now = 1_700_000_000_000;
    await writeAppHeartbeat(dir, now, 1);
    expect(await isAppHeartbeatFresh(dir, now + APP_HEARTBEAT_FRESH_MS)).toBe(false);
    expect(await isAppHeartbeatFresh(dir, now + APP_HEARTBEAT_FRESH_MS + 60_000)).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("corrupt heartbeat file reads as absent, not an error", async () => {
  const dir = await makeRepoDir();
  try {
    fs.writeFileSync(appHeartbeatPath(dir), "not json{{{");
    expect(await readAppHeartbeat(dir)).toBeNull();
    expect(await isAppHeartbeatFresh(dir)).toBe(false);

    fs.writeFileSync(appHeartbeatPath(dir), JSON.stringify({ pid: "nope" }));
    expect(await readAppHeartbeat(dir)).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("removeAppHeartbeat deletes the marker; missing file is not an error", async () => {
  const dir = await makeRepoDir();
  try {
    await writeAppHeartbeat(dir, Date.now());
    expect(fs.existsSync(appHeartbeatPath(dir))).toBe(true);
    await removeAppHeartbeat(dir);
    expect(fs.existsSync(appHeartbeatPath(dir))).toBe(false);
    // Calling again on an already-missing file must not throw.
    await removeAppHeartbeat(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeAppHeartbeat is best-effort: a missing .git dir never throws", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "app-heartbeat-nogit-"));
  try {
    // No .git subdirectory created — the write target's parent doesn't exist.
    await expect(writeAppHeartbeat(dir)).resolves.toBeUndefined();
    expect(await readAppHeartbeat(dir)).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appHeartbeatPath: filename never matches stale-lock candidate patterns", () => {
  const p = appHeartbeatPath("/some/repo");
  const filename = path.basename(p);
  // recover-stale-lock.ts scans fixed top-level names + refs/**/*.lock.
  expect(filename.endsWith(".lock")).toBe(false);
  expect(p.includes(`${path.sep}refs${path.sep}`)).toBe(false);
});
