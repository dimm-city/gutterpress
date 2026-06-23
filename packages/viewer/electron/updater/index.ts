// ──────────────────────────────────────────────────────────────────────────
// updater/index.ts — core runtime auto-update engine (main process only)
//
// The runtime (SPA + engine) is the single npm package @dimm-city/print-md.
// Networking and filesystem mutation live ONLY here (and the thin main.ts
// wiring that calls it). Never in the renderer.
//
// Flow:
//   checkForUpdate()  -> resolve the newest version for the channel from the
//                        npm registry; apply compat/downgrade/failed/newer gates.
//   downloadAndStage()-> download the tarball, verify it against the registry
//                        SSRI integrity, extract dist/ + ui/ + package.json into
//                        versions/<v>.staging with path-traversal guards, then
//                        atomically rename to versions/<v> and record staged.json.
//   promoteStaged()   -> previous := current; current := staged; clear staged.
//   rollback()        -> current := previous; record bad version as failed.
//   pruneVersions()   -> after a healthy promote, rm version dirs not pointed to.
//
// All public functions are failure-tolerant: they log via console.warn/error
// and return structured results; they never throw out to callers.
// ──────────────────────────────────────────────────────────────────────────

import path from "node:path";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { compareSemver } from "./semver.js";

import {
  readPointer,
  writePointer,
  readState,
  writeState,
  readBaselineVersion,
  webRuntimeDir,
  writeAtomic,
  type Pointer,
  type State,
} from "./web-runtime.js";
import { DESKTOP_API } from "./contract.js";
import {
  resolveCandidate,
  type Channel,
  type UpdateCandidate,
} from "./npm-source.js";
import { verifyIntegrity } from "./integrity.js";
import { readTarGz } from "./tar.js";

/** Channel to track. Override only for testing the beta (next) line. */
function channel(): Channel {
  return process.env.PRINT_MD_UPDATER_CHANNEL === "beta" ? "beta" : "stable";
}

// ──────────────────────────────────────────────────────────────────────────
// In-memory phase tracking + in-flight guard (mirrors activeExportSession in
// main.ts: a single nullable singleton gates concurrent network/stage work).
// ──────────────────────────────────────────────────────────────────────────

type Phase = "idle" | "checking" | "downloading" | "staged" | "error";

let phase: Phase = "idle";
let lastError: string | null = null;
let availableVersion: string | null = null;
let inFlight: Promise<unknown> | null = null;

// Newest candidate found by the last checkForUpdate(), reused by downloadAndStage
// to avoid a second identical registry round-trip on the common check→stage path.
let cachedCandidate: UpdateCandidate | null = null;

// Network guards: every fetch is time-bounded so a stalled connection can't hang
// an IPC handler forever, and downloads are size-capped to prevent an oversized
// release from exhausting memory (integrity runs only after the full buffer is
// resident, so the cap must come first).
const FETCH_TIMEOUT_MS = 30_000;
const MAX_TARBALL_BYTES = 256 * 1024 * 1024; // 256 MB hard ceiling

// A version is only treated as permanently bad after this many health-gate
// failures, so a single transient miss (slow cold start, window closed before
// markReady) does not blocklist an otherwise-good runtime forever.
const MAX_HEALTH_FAILURES = 2;

/** Failure count recorded for a version; legacy string entries = blocked. */
function failureCount(entry: unknown): number {
  if (typeof entry === "string") return MAX_HEALTH_FAILURES;
  if (
    entry &&
    typeof entry === "object" &&
    typeof (entry as { count?: unknown }).count === "number"
  ) {
    return (entry as { count: number }).count;
  }
  return 0;
}

/** True when a version has failed health checks enough times to be skipped. */
function isVersionBlocked(state: State, version: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(state.failedVersions, version)) {
    return false;
  }
  return failureCount(state.failedVersions[version]) >= MAX_HEALTH_FAILURES;
}

export interface UpdaterStatus {
  currentVersion: string | null;
  stagedVersion: string | null;
  availableVersion: string | null;
  phase: Phase;
  lastCheckAt: string | null;
  error: string | null;
}

// ──────────────────────────────────────────────────────────────────────────
// staged.json — a dedicated small pointer for a verified-but-not-promoted
// runtime. { version, path } where path is the ABSOLUTE versions/<version> dir.
// ──────────────────────────────────────────────────────────────────────────

interface Staged {
  version: string;
  path: string;
}

function stagedPath(): string {
  return path.join(webRuntimeDir(), "staged.json");
}

export async function readStaged(): Promise<Staged | null> {
  try {
    const raw = await readFile(stagedPath(), "utf8");
    const s = JSON.parse(raw) as Staged;
    if (typeof s?.version !== "string" || typeof s?.path !== "string") {
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export async function writeStaged(staged: Staged): Promise<void> {
  await writeAtomic(stagedPath(), JSON.stringify(staged, null, 2));
}

export async function clearStaged(): Promise<void> {
  await rm(stagedPath(), { force: true }).catch(() => {});
}

async function downloadBuffer(url: string, maxBytes: number): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { "User-Agent": "print-md-viewer-updater" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`download failed: ${res.status} ${res.statusText} (${url})`);
  }
  // Reject before buffering when the server advertises an oversized body.
  const declared = Number(res.headers?.get?.("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`download too large: ${declared} bytes > cap ${maxBytes} (${url})`);
  }
  const ab = await res.arrayBuffer();
  if (ab.byteLength > maxBytes) {
    throw new Error(`download too large: ${ab.byteLength} bytes > cap ${maxBytes} (${url})`);
  }
  return Buffer.from(ab);
}

/** Effective current runtime version: current pointer || baseline manifest. */
async function effectiveCurrentVersion(): Promise<string> {
  // The runtime actually loaded is the NEWER of the baked-in baseline and any
  // promoted bundle — resolveActive() serves the baked runtime whenever it is >=
  // the pointer. Compare against that maximum so a published version is only
  // treated as "newer" when it beats what is genuinely running.
  const baseline = await readBaselineVersion();
  const ptr = await readPointer("current");
  if (ptr?.version && compareSemver(ptr.version, baseline) > 0) {
    return ptr.version;
  }
  return baseline;
}

// ──────────────────────────────────────────────────────────────────────────
// checkForUpdate
// ──────────────────────────────────────────────────────────────────────────

/**
 * Record a check outcome that indicates a PROBLEM with the published release
 * (incomplete metadata) rather than a benign "nothing new". Sets phase=error +
 * lastError so getStatus() reports it and the manual "Check for updates" path
 * surfaces the reason. Benign outcomes (no version, already up to date,
 * downgrade floor, …) must NOT use this — they stay phase=idle so the silent
 * startup check never alarms anyone.
 */
function checkProblem(reason: string): { available: null; reason: string } {
  phase = "error";
  lastError = reason;
  availableVersion = null;
  console.warn(`[updater] check found a problem: ${reason}`);
  return { available: null, reason };
}

export async function checkForUpdate(): Promise<{
  available: UpdateCandidate | null;
  reason?: string;
}> {
  phase = "checking";
  lastError = null;
  try {
    const { candidate, reason } = await resolveCandidate(channel());

    // Record the check time regardless of outcome.
    const state = await readState();
    state.lastCheckAt = new Date().toISOString();
    await writeState(state);

    if (!candidate) {
      phase = "idle";
      availableVersion = null;
      return { available: null, reason: reason ?? "no published version" };
    }

    // Compatibility gate: never pull a runtime that needs a newer shell.
    if (candidate.requiresDesktopApi > DESKTOP_API) {
      phase = "idle";
      availableVersion = null;
      return { available: null, reason: "needs newer app" };
    }

    // Downgrade guard: ignore versions <= minimumSeenVersion.
    if (
      state.minimumSeenVersion &&
      compareSemver(candidate.version, state.minimumSeenVersion) <= 0
    ) {
      phase = "idle";
      availableVersion = null;
      return { available: null, reason: "version below downgrade floor" };
    }

    // Skip versions that have failed the health gate too many times.
    if (isVersionBlocked(state, candidate.version)) {
      phase = "idle";
      availableVersion = null;
      return { available: null, reason: "version previously failed" };
    }

    // Strictly newer than current?
    const current = await effectiveCurrentVersion();
    if (compareSemver(candidate.version, current) <= 0) {
      phase = "idle";
      availableVersion = null;
      return { available: null, reason: "already up to date" };
    }

    cachedCandidate = candidate;
    phase = "idle";
    availableVersion = candidate.version;
    return { available: candidate };
  } catch (e) {
    lastError = (e as Error).message;
    phase = "error";
    console.warn("[updater] checkForUpdate failed (non-fatal):", lastError);
    return { available: null, reason: lastError };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// downloadAndStage
// ──────────────────────────────────────────────────────────────────────────

/** Reject any tar entry that would escape `root` (.. segments or absolute). */
function safeJoin(root: string, entryName: string): string | null {
  if (entryName.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(entryName)) return null;
  if (entryName.split(/[\\/]/).some((seg) => seg === "..")) return null;
  const target = path.resolve(root, entryName);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

/**
 * Files the viewer actually needs from the package tarball: the engine (dist/,
 * minus the unused CLI binary and type declarations) + the SPA (ui/) + the
 * package.json (carries the version the diagnostics read). Everything else
 * (README, LICENSE) is skipped to keep the extracted runtime lean.
 */
function wantedEntry(name: string): boolean {
  if (name === "package.json") return true;
  if (name.endsWith(".d.ts")) return false;
  if (name === "dist/cli.js") return false;
  return name.startsWith("dist/") || name.startsWith("ui/");
}

export async function downloadAndStage(
  candidate: UpdateCandidate
): Promise<{ staged: boolean; reason?: string }> {
  if (inFlight) {
    return { staged: false, reason: "an update operation is already in progress" };
  }
  const run = (async (): Promise<{ staged: boolean; reason?: string }> => {
    phase = "downloading";
    lastError = null;
    const version = candidate.version;
    const versionsDir = path.join(webRuntimeDir(), "versions");
    const stagingDir = path.join(versionsDir, `${version}.staging`);
    const finalDir = path.join(versionsDir, version);

    try {
      await mkdir(versionsDir, { recursive: true });

      // Download the tarball and verify it against the registry SSRI integrity
      // BEFORE touching disk beyond the in-memory buffer.
      const tgzBytes = await downloadBuffer(candidate.tarball, MAX_TARBALL_BYTES);
      const integrity = verifyIntegrity(tgzBytes, candidate.integrity);
      if (!integrity.ok) {
        phase = "error";
        return { staged: false, reason: `integrity check failed: ${integrity.reason}` };
      }

      // Fresh staging dir.
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
      await mkdir(stagingDir, { recursive: true });

      // Extract the wanted entries with traversal guards on EVERY entry.
      const entries = readTarGz(new Uint8Array(tgzBytes));
      for (const entry of entries) {
        if (!wantedEntry(entry.name)) continue;
        const target = safeJoin(stagingDir, entry.name);
        if (!target) {
          await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
          phase = "error";
          return { staged: false, reason: `unsafe tar entry rejected: ${entry.name}` };
        }
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, Buffer.from(entry.data));
      }

      // Post-extract structural assertions: both engine and SPA must be present.
      const libOk = await fileExists(path.join(stagingDir, "dist", "index.js"));
      const uiOk = await fileExists(path.join(stagingDir, "ui", "index.html"));
      if (!libOk || !uiOk) {
        await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
        phase = "error";
        return {
          staged: false,
          reason: "extracted package missing dist/index.js or ui/index.html",
        };
      }

      // Atomic promote of the staging dir into its final name.
      await rm(finalDir, { recursive: true, force: true }).catch(() => {});
      await rename(stagingDir, finalDir);

      // Record staged pointer (NOT current).
      await writeStaged({ version, path: finalDir });

      phase = "staged";
      availableVersion = version;
      return { staged: true };
    } catch (e) {
      lastError = (e as Error).message;
      phase = "error";
      console.warn("[updater] downloadAndStage failed (non-fatal):", lastError);
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
      return { staged: false, reason: lastError };
    }
  })();
  inFlight = run;
  try {
    return await run;
  } finally {
    if (inFlight === run) inFlight = null;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// promoteStaged — used by "apply on next launch" AND "apply now".
// previous := current (if any); current := staged; clear staged.
// ──────────────────────────────────────────────────────────────────────────

export async function promoteStaged(): Promise<{
  promoted: boolean;
  version?: string;
}> {
  try {
    const staged = await readStaged();
    if (!staged) return { promoted: false };

    // The staged dir must still have a valid SPA entry.
    if (!(await fileExists(path.join(staged.path, "ui", "index.html")))) {
      console.warn("[updater] staged runtime missing ui/index.html; clearing staged");
      await clearStaged();
      return { promoted: false };
    }

    const current = await readPointer("current");
    if (current) {
      await writePointer("previous", current);
    }
    const next: Pointer = { version: staged.version, path: staged.path };
    await writePointer("current", next);
    await clearStaged();

    // Reflect in state (best-effort).
    const state = await readState();
    state.previousVersion = current?.version ?? state.previousVersion;
    state.currentVersion = staged.version;
    await writeState(state);

    availableVersion = null;
    phase = "idle";
    return { promoted: true, version: staged.version };
  } catch (e) {
    console.warn("[updater] promoteStaged failed (non-fatal):", (e as Error).message);
    return { promoted: false };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// rollback — current := previous; record bad version as failed; clear previous.
// ──────────────────────────────────────────────────────────────────────────

export async function rollback(reason: string): Promise<boolean> {
  try {
    const current = await readPointer("current");
    const previous = await readPointer("previous");

    const state = await readState();
    if (current?.version) {
      // Increment the failure count rather than permanently blocklisting on the
      // first miss — a transient health-gate failure (slow boot, window closed
      // before markReady) should not kill an otherwise-good version forever.
      const prior = failureCount(state.failedVersions[current.version]);
      state.failedVersions[current.version] = { reason, count: prior + 1 };
    }

    if (previous) {
      await writePointer("current", previous);
      state.currentVersion = previous.version;
    } else {
      // No previous to fall back to — drop the current pointer so resolveActive
      // returns the bundled-in-asar runtime.
      await rm(path.join(webRuntimeDir(), "current.json"), { force: true }).catch(
        () => {}
      );
      state.currentVersion = null;
    }

    // Clear previous pointer (it's now current, or there was none).
    await rm(path.join(webRuntimeDir(), "previous.json"), { force: true }).catch(
      () => {}
    );
    state.previousVersion = null;

    await writeState(state);
    availableVersion = null;
    phase = "idle";
    return true;
  } catch (e) {
    console.warn("[updater] rollback failed (non-fatal):", (e as Error).message);
    return false;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// pruneVersions — after a healthy promote, delete version dirs that are NOT the
// current or previous pointer path. ONLY rm inside web-runtime/versions/.
// ──────────────────────────────────────────────────────────────────────────

export async function pruneVersions(): Promise<void> {
  try {
    const versionsDir = path.join(webRuntimeDir(), "versions");
    const keep = new Set<string>();
    const current = await readPointer("current");
    const previous = await readPointer("previous");
    if (current?.path) keep.add(path.resolve(current.path));
    if (previous?.path) keep.add(path.resolve(previous.path));

    let entries: string[];
    try {
      entries = await readdir(versionsDir);
    } catch {
      return; // versions dir missing — nothing to prune
    }

    for (const name of entries) {
      const full = path.resolve(versionsDir, name);
      // Defensive: only ever rm strictly inside versions/.
      if (!full.startsWith(versionsDir + path.sep)) continue;
      if (keep.has(full)) continue;
      let isDir = false;
      try {
        isDir = (await stat(full)).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;
      // App-generated extracted bundle dir under userData — safe to rm.
      await rm(full, { recursive: true, force: true }).catch(() => {});
    }
  } catch (e) {
    console.warn("[updater] pruneVersions failed (non-fatal):", (e as Error).message);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// getStatus — reports phase + persisted files for the renderer.
// ──────────────────────────────────────────────────────────────────────────

export async function getStatus(): Promise<UpdaterStatus> {
  const current = await readPointer("current");
  const staged = await readStaged();
  const state = await readState();
  // Report the version actually SERVED, mirroring resolveActive()'s rule: a
  // promoted pointer only wins if it is strictly newer than the baked baseline.
  const baseline = await readBaselineVersion();
  const currentVersion =
    current && compareSemver(current.version, baseline) > 0
      ? current.version
      : baseline;
  return {
    currentVersion,
    stagedVersion: staged?.version ?? null,
    availableVersion,
    phase,
    lastCheckAt: state.lastCheckAt,
    error: lastError,
  };
}
