import { expect, test } from "bun:test";
import * as fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  APP_HEARTBEAT_FRESH_MS,
  appHeartbeatPath,
  heartbeatTtlMs,
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

test("heartbeatTtlMs: null cadence (feature disabled) falls back to the fixed default", () => {
  expect(heartbeatTtlMs(null)).toBe(APP_HEARTBEAT_FRESH_MS);
});

test("heartbeatTtlMs: TTL comfortably exceeds the refresh cadence at both ends of the range", () => {
  // Default auto-sync cadence (2 min): TTL must be strictly greater than the
  // cadence itself, or the marker goes stale at every tick boundary.
  const twoMinCadence = 2 * 60_000;
  expect(heartbeatTtlMs(twoMinCadence)).toBeGreaterThan(twoMinCadence);

  // Max configurable cadence (24 h): same invariant must hold, not just at the
  // default — this is exactly the case the fixed 2-min window got wrong.
  const twentyFourHourCadence = 24 * 60 * 60_000;
  expect(heartbeatTtlMs(twentyFourHourCadence)).toBeGreaterThan(twentyFourHourCadence);

  // Min configurable cadence (1 min).
  const oneMinCadence = 60_000;
  expect(heartbeatTtlMs(oneMinCadence)).toBeGreaterThan(oneMinCadence);
});

test("stamped ttlMs wins over the reader's maxAgeMs fallback", async () => {
  const dir = await makeRepoDir();
  try {
    const now = 1_700_000_000_000;
    const cadence = 10 * 60_000; // 10 min — well past the fixed 2-min default
    const ttlMs = heartbeatTtlMs(cadence);
    await writeAppHeartbeat(dir, now, 4242, ttlMs);
    expect(await readAppHeartbeat(dir)).toEqual({ pid: 4242, timestamp: now, ttlMs });

    // 3 minutes later: stale under the fixed APP_HEARTBEAT_FRESH_MS default,
    // but well within the stamped cadence-derived TTL — must read as fresh.
    const threeMinLater = now + 3 * 60_000;
    expect(threeMinLater - now).toBeGreaterThan(APP_HEARTBEAT_FRESH_MS);
    expect(await isAppHeartbeatFresh(dir, threeMinLater)).toBe(true);

    // Past the stamped TTL: reads as stale regardless of the maxAgeMs param.
    expect(await isAppHeartbeatFresh(dir, now + ttlMs, /* maxAgeMs */ 24 * 60 * 60_000)).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("heartbeat with no ttlMs still uses the maxAgeMs fallback (back-compat)", async () => {
  const dir = await makeRepoDir();
  try {
    const now = 1_700_000_000_000;
    await writeAppHeartbeat(dir, now, 4242); // no ttlMs
    expect(await isAppHeartbeatFresh(dir, now + APP_HEARTBEAT_FRESH_MS - 1)).toBe(true);
    expect(await isAppHeartbeatFresh(dir, now + APP_HEARTBEAT_FRESH_MS)).toBe(false);
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
