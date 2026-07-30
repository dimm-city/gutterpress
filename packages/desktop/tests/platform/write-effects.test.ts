/**
 * `scheduleAutoWriteEffects` — the auto-snapshot/auto-sync arming gate shared by
 * the five mutating fs routes (write-file, create-file, create-folder, rename,
 * delete).
 *
 * 2026-07-29 audit. The gate fired only when the written path was inside the
 * FOLDER-WATCHER's dir — the opened book. But fs-route authorization was
 * deliberately widened (commit c310e2) to the opened book PLUS its enclosing
 * repository root, precisely so a multi-book project can edit repo-root shared
 * styles and assets. So the app happily wrote
 * `<repo>/shared/styles/components.css` and then armed NOTHING: the edit never
 * entered version history, and never synced, until some later in-book save
 * happened to arm the timer. The two halves of the same feature disagreed —
 * writes were allowed under the repo root, but only book writes counted as
 * edits.
 *
 * The debounce is still SCHEDULED for the watched dir (the scheduler's own
 * `getWatchedDir() !== dir` guard would drop anything else, and the snapshot
 * commits the whole repo regardless) — what widens is which writes COUNT.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import path from "node:path";
import { registerHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { scheduleAutoWriteEffects } from "../../electron/server-bridge/write-hooks";

const REPO = path.resolve("/repo");
const BOOK = path.join(REPO, "books", "field-guide");
const SIBLING_BOOK = path.join(REPO, "books", "almanac");
const OUTSIDE = path.resolve("/elsewhere");

let snapshots: string[];
let syncs: string[];

function install(watchedDir: string | null, repositoryRoot: string | null): void {
  snapshots = [];
  syncs = [];
  registerHostServices(
    makeHostServices({
      write: {
        scheduleAutoSnapshot: (dir: string) => snapshots.push(dir),
        scheduleAutoSync: (dir: string) => syncs.push(dir),
        getWatchedDir: () => watchedDir,
        getRepositoryRoot: () => repositoryRoot,
      },
    }),
  );
}

beforeEach(() => {
  install(BOOK, REPO);
});

afterEach(() => {
  registerHostServices(undefined as unknown as HostServices);
});

test("a write inside the opened book arms snapshot + sync for the watched dir", () => {
  scheduleAutoWriteEffects(path.join(BOOK, "chapter-01.md"));
  expect(snapshots).toEqual([BOOK]);
  expect(syncs).toEqual([BOOK]);
});

test("a write to a repo-root SHARED file arms snapshot + sync too", () => {
  // The write the fs-guard's repoRoot allowance exists for.
  scheduleAutoWriteEffects(path.join(REPO, "shared", "styles", "components.css"));
  expect(snapshots).toEqual([BOOK]);
  expect(syncs).toEqual([BOOK]);
});

test("a write to a SIBLING book in the same repo arms snapshot + sync", () => {
  // Also inside the repo, also authorized, also a change the repo's history
  // must capture.
  scheduleAutoWriteEffects(path.join(SIBLING_BOOK, "chapter-01.md"));
  expect(snapshots).toEqual([BOOK]);
  expect(syncs).toEqual([BOOK]);
});

test("the repo root itself counts", () => {
  scheduleAutoWriteEffects(path.join(REPO, "DESIGN.md"));
  expect(snapshots).toEqual([BOOK]);
  expect(syncs).toEqual([BOOK]);
});

test("a write OUTSIDE both roots arms nothing", () => {
  scheduleAutoWriteEffects(path.join(OUTSIDE, "notes.md"));
  expect(snapshots).toEqual([]);
  expect(syncs).toEqual([]);
});

test("a sibling REPO with a shared string prefix arms nothing", () => {
  // `/repo2` must not read as inside `/repo`.
  scheduleAutoWriteEffects(path.join(`${REPO}2`, "shared", "x.css"));
  expect(snapshots).toEqual([]);
  expect(syncs).toEqual([]);
});

test("with no repo (a plain local folder) only book writes count", () => {
  install(BOOK, null);
  scheduleAutoWriteEffects(path.join(BOOK, "chapter-01.md"));
  expect(snapshots).toEqual([BOOK]);
  scheduleAutoWriteEffects(path.join(REPO, "shared", "x.css"));
  expect(snapshots).toEqual([BOOK]); // unchanged — nothing new armed
});

test("with no project open nothing is armed, even inside a known repo", () => {
  install(null, REPO);
  scheduleAutoWriteEffects(path.join(BOOK, "chapter-01.md"));
  expect(snapshots).toEqual([]);
  expect(syncs).toEqual([]);
});
