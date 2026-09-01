/**
 * IPC-handler tests for `electron/api/vcs.ts` (SFE-P5c2 — migrated off
 * `src/routes/api/vcs/{enable-version-history,save-snapshot,
 * restore-snapshot,list-snapshots-page}/+server.ts`, all deleted).
 *
 * Two halves:
 *  1. Project-scoping guard coverage, ported from the deleted
 *     `route-scoping.test.ts`'s `vcs/*` rows (2026-07-29 file-operations
 *     audit, Theme 1) — same cases, calling `electron/api/vcs.ts` directly.
 *  2. SPECIAL WEIGHT (run note — the checkout-journal crash-safety
 *     guarantee): `vcsRestoreSnapshot` delegates to the lib's
 *     `restoreVersionWithBackup` exactly as the deleted route did. That
 *     guarantee itself (a pull/restore that dies between merge and checkout
 *     must not publish a wholesale revert) is implemented and unit-tested
 *     inside `packages/cli` (outside this lane's write ownership) — what
 *     lives on THIS side of the boundary, and what this file pins, is that
 *     a malformed/partial snapshot id is rejected BEFORE it can reach the
 *     lib's checkout at all, so a bad IPC payload can never become a
 *     malformed git ref.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerHostServices, getHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import {
  vcsEnableVersionHistory,
  vcsListSnapshotsPage,
  vcsRestoreSnapshot,
  vcsSaveSnapshot,
} from "../../electron/api/vcs";

const HEX40_A = "a".repeat(40);

const ROUTES: Array<{ name: string; call: (dir: string) => Promise<unknown> }> = [
  { name: "vcs:enableVersionHistory", call: (d) => vcsEnableVersionHistory(d) },
  { name: "vcs:listSnapshotsPage", call: (d) => vcsListSnapshotsPage(d) },
  { name: "vcs:restoreSnapshot", call: (d) => vcsRestoreSnapshot(d, HEX40_A) },
  { name: "vcs:saveSnapshot", call: (d) => vcsSaveSnapshot(d, "snap") },
];

let base: string;
let repoRoot: string;
let bookDir: string;
let siblingRepo: string; // "<base>/repo" + "2" — a DIFFERENT repo, shared prefix
let outsideDir: string;
let savedHostServices: HostServices | null;

/** The rejection message of a promise, or null when it resolved. */
async function messageOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function openProject(roots: string[]): void {
  registerHostServices(
    makeHostServices({
      desktop: { getUserDataPath: () => base },
      fsGuard: { projectRoots: () => roots, readOnlyRoots: () => [] as string[] },
    }),
  );
}

beforeEach(async () => {
  // Host services are process-global — save/restore so this file's fixture
  // never leaks into a sibling test file.
  savedHostServices = getHostServices();

  base = await mkdtemp(path.join(tmpdir(), "gutterpress-vcs-ipc-"));
  repoRoot = path.join(base, "repo");
  bookDir = path.join(repoRoot, "books", "field-guide");
  siblingRepo = path.join(base, "repo2");
  outsideDir = path.join(base, "elsewhere");
  await mkdir(bookDir, { recursive: true });
  await mkdir(siblingRepo, { recursive: true });
  await mkdir(outsideDir, { recursive: true });
  await writeFile(path.join(bookDir, "manifest.yaml"), "title: Field Guide\n", "utf8");
  openProject([bookDir, repoRoot]);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
  registerHostServices(savedHostServices as HostServices);
});

// ── Every guarded handler: outside the open project is rejected ───────────

for (const route of ROUTES) {
  test(`${route.name}: an unrelated outside path is rejected`, async () => {
    const message = await messageOf(route.call(outsideDir));
    expect(message).toBe(`${route.name}: path is outside the open project`);
  });
}

test("vcs:restoreSnapshot: a sibling REPO with a shared string prefix is rejected", async () => {
  const message = await messageOf(vcsRestoreSnapshot(siblingRepo, HEX40_A));
  expect(message).toBe("vcs:restoreSnapshot: path is outside the open project");
});

test("with no project open every guarded handler rejects, including its own book dir", async () => {
  openProject([]);
  for (const route of ROUTES) {
    const message = await messageOf(route.call(bookDir));
    expect(message).toBe(`${route.name}: path is outside the open project`);
  }
});

test("the enclosing REPO ROOT passes the guard on every handler (multi-project sessions)", async () => {
  for (const route of ROUTES) {
    const message = await messageOf(route.call(repoRoot));
    // The fake lib has no real git repo underneath, so every call still
    // fails — for the LIB's own reason (friendlyVcsError's terse fallback),
    // never the project-scoping guard.
    expect(message).not.toBe(`${route.name}: path is outside the open project`);
  }
});

// ── SPECIAL WEIGHT: a malformed snapshot id never reaches the lib's checkout ──

test("vcs:restoreSnapshot rejects a non-hex id before touching the lib", async () => {
  const message = await messageOf(vcsRestoreSnapshot(bookDir, "not-a-real-id"));
  expect(message).toBe("vcs:restoreSnapshot requires a valid snapshot id");
});

test("vcs:restoreSnapshot rejects a partial (too-short) snapshot id", async () => {
  const message = await messageOf(vcsRestoreSnapshot(bookDir, HEX40_A.slice(0, 10)));
  expect(message).toBe("vcs:restoreSnapshot requires a valid snapshot id");
});

test("vcs:listSnapshotsPage rejects a malformed continuation cursor before it can become a ref query", async () => {
  const message = await messageOf(vcsListSnapshotsPage(bookDir, undefined, "not-a-real-id"));
  expect(message).toBe("vcs:listSnapshotsPage requires a valid snapshot id cursor");
});

// ── vcs:saveSnapshot's own hooks-unavailable path (checked BEFORE validation,
// matching the deleted route's `defineRoute({ hooks, validate, call })` order) ──

test("vcs:saveSnapshot fails closed when VCS hooks are not registered, even for an outside path", async () => {
  registerHostServices(
    makeHostServices({
      desktop: { getUserDataPath: () => base },
      fsGuard: { projectRoots: () => [bookDir, repoRoot], readOnlyRoots: () => [] as string[] },
      vcs: undefined,
    }),
  );
  const message = await messageOf(vcsSaveSnapshot(outsideDir, "snap"));
  expect(message).toBe("VCS hooks not registered");
});
