import { test, expect } from "bun:test";
import {
  AUTO_SNAPSHOT_DEFAULT_MINUTES,
  autoSnapshotDelayMs,
  isGitInternalPath,
  AUTO_SYNC_DEFAULT_MINUTES,
  autoSyncDelayMs,
} from "./host-policy";

test("autoSnapshotDelayMs: defaults, disable, clamping, garbage", () => {
  // Missing policy → defaults (enabled, 10 minutes).
  expect(autoSnapshotDelayMs(undefined)).toBe(
    AUTO_SNAPSHOT_DEFAULT_MINUTES * 60_000,
  );
  // Explicit values pass through.
  expect(
    autoSnapshotDelayMs({ autoSnapshot: true, autoSnapshotMinutes: 15 }),
  ).toBe(15 * 60_000);
  // Disabled → null (the host never arms the timer).
  expect(
    autoSnapshotDelayMs({ autoSnapshot: false, autoSnapshotMinutes: 10 }),
  ).toBe(null);
  // Floor: never below 5 minutes (commit-per-keystroke guard).
  expect(
    autoSnapshotDelayMs({ autoSnapshot: true, autoSnapshotMinutes: 1 }),
  ).toBe(5 * 60_000);
  // Ceiling: never above a day.
  expect(
    autoSnapshotDelayMs({ autoSnapshot: true, autoSnapshotMinutes: 99_999 }),
  ).toBe(24 * 60 * 60_000);
  // Garbage minutes fall back to the default, then clamp.
  expect(
    autoSnapshotDelayMs({ autoSnapshot: true, autoSnapshotMinutes: Number.NaN }),
  ).toBe(AUTO_SNAPSHOT_DEFAULT_MINUTES * 60_000);
  expect(
    autoSnapshotDelayMs({ autoSnapshot: true, autoSnapshotMinutes: -3 }),
  ).toBe(AUTO_SNAPSHOT_DEFAULT_MINUTES * 60_000);
  // Partial policy: only minutes set, switch defaults ON (enabledDefault).
  expect(
    autoSnapshotDelayMs({ autoSnapshotMinutes: 20 }),
  ).toBe(20 * 60_000);
});

test("autoSyncDelayMs: defaults, disable, clamping, non-finite fallback", () => {
  // Missing policy → defaults (enabled, 2 minutes).
  expect(autoSyncDelayMs(undefined)).toBe(AUTO_SYNC_DEFAULT_MINUTES * 60_000);
  // Explicit value passes through.
  expect(autoSyncDelayMs({ autoSync: true, autoSyncMinutes: 5 })).toBe(5 * 60_000);
  // Disabled → null (the host never arms the periodic timer).
  expect(autoSyncDelayMs({ autoSync: false, autoSyncMinutes: 2 })).toBe(null);
  // Floor: never below 1 minute.
  expect(autoSyncDelayMs({ autoSync: true, autoSyncMinutes: 0.1 })).toBe(1 * 60_000);
  // Ceiling: never above a day.
  expect(
    autoSyncDelayMs({ autoSync: true, autoSyncMinutes: 99_999 }),
  ).toBe(24 * 60 * 60_000);
  // Non-finite minutes → fallback to default, then clamp.
  expect(
    autoSyncDelayMs({ autoSync: true, autoSyncMinutes: Number.NaN }),
  ).toBe(AUTO_SYNC_DEFAULT_MINUTES * 60_000);
  expect(
    autoSyncDelayMs({ autoSync: true, autoSyncMinutes: -5 }),
  ).toBe(AUTO_SYNC_DEFAULT_MINUTES * 60_000);
  // Partial policy: only autoSync false set, minutes absent → null.
  expect(autoSyncDelayMs({ autoSync: false })).toBe(null);
  // Partial policy: only minutes set, switch defaults ON.
  expect(autoSyncDelayMs({ autoSyncMinutes: 3 })).toBe(3 * 60_000);
});

test("isGitInternalPath matches .git segments only", () => {
  expect(isGitInternalPath(".git")).toBe(true);
  expect(isGitInternalPath(".git/index")).toBe(true);
  expect(isGitInternalPath(".git\\index")).toBe(true);
  expect(isGitInternalPath("/home/me/book/.git/HEAD")).toBe(true);
  expect(isGitInternalPath("chapter-01.md")).toBe(false);
  expect(isGitInternalPath(".gitignore")).toBe(false);
  expect(isGitInternalPath("notes/.gitkeep")).toBe(false);
});
