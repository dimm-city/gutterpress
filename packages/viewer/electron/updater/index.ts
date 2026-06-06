// ──────────────────────────────────────────────────────────────────────────
// updater/index.ts — core web-UI auto-update engine (main process only)
//
// Networking and filesystem mutation for the web-UI bundle live ONLY here (and
// the thin main.ts wiring that calls it). Never in the renderer.
//
// Flow:
//   checkForUpdate()  -> finds newest web-v* release, validates+verifies its
//                        manifest, applies the downgrade/failed/compat gates.
//   downloadAndStage()-> downloads the bundle zip, verifies it, extracts into
//                        versions/<v>.staging with path-traversal guards, then
//                        atomically renames to versions/<v> and records
//                        staged.json. Staging != current.
//   promoteStaged()   -> previous := current; current := staged; clear staged.
//   rollback()        -> current := previous; record bad version as failed.
//   pruneVersions()   -> after a healthy promote, rm version dirs that are not
//                        the current/previous pointer path. Only inside
//                        web-runtime/versions/.
//
// All public functions are failure-tolerant: they log via console.warn/error
// and return structured results; they never throw out to callers.
// ──────────────────────────────────────────────────────────────────────────

import path from "node:path";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { unzipSync } from "fflate";
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
import {
  DESKTOP_API,
  isSigningKeyConfigured,
  type UpdateManifest,
} from "./contract.js";
import { validateManifest } from "./manifest-validator.js";
import { verifyManifestSignature, verifyBundle } from "./verify.js";

export const GITHUB_REPO = "dimm-city/print-md";

const RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases`;
const WEB_TAG_RE = /^web-v(.+)$/;

// ──────────────────────────────────────────────────────────────────────────
// In-memory phase tracking + in-flight guard (mirrors activeExportSession in
// main.ts: a single nullable singleton gates concurrent network/stage work).
// ──────────────────────────────────────────────────────────────────────────

type Phase = "idle" | "checking" | "downloading" | "staged" | "error";

let phase: Phase = "idle";
let lastError: string | null = null;
let availableVersion: string | null = null;
let inFlight: Promise<unknown> | null = null;

// Newest release found by the last checkForUpdate(), reused by downloadAndStage
// to avoid a second identical GitHub API round-trip (and the extra rate-limit
// hit) on the common check→stage path.
let cachedRelease: { version: string; rel: GhRelease } | null = null;

// Network guards: every fetch is time-bounded so a stalled connection can't
// hang an IPC handler forever, and downloads are size-capped to prevent a
// compromised/oversized release from exhausting memory (the integrity check
// runs only after the full buffer is resident, so the cap must come first).
const FETCH_TIMEOUT_MS = 30_000;
const MAX_BUNDLE_BYTES = 256 * 1024 * 1024; // 256 MB hard ceiling
const MAX_META_BYTES = 1 * 1024 * 1024; // manifest/sig are tiny

// A version is only treated as permanently bad after this many health-gate
// failures, so a single transient miss (slow cold start, window closed before
// markReady) does not blocklist an otherwise-good bundle forever.
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
// bundle. The shared State interface is fixed, so staged info lives here.
// { version, path } where path is the ABSOLUTE versions/<version> dir.
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

// ──────────────────────────────────────────────────────────────────────────
// GitHub releases — web-v* line only. Never /releases/latest (installer line).
// ──────────────────────────────────────────────────────────────────────────

interface GhAsset {
  name: string;
  browser_download_url: string;
}
interface GhRelease {
  tag_name: string;
  draft?: boolean;
  prerelease?: boolean;
  assets: GhAsset[];
}

async function fetchWebReleases(): Promise<GhRelease[]> {
  const res = await fetch(RELEASES_URL, {
    headers: {
      "User-Agent": "print-md-viewer-updater",
      Accept: "application/vnd.github+json",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`GitHub releases request failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as GhRelease[];
  if (!Array.isArray(data)) {
    throw new Error("GitHub releases response was not an array");
  }
  // Drafts AND prereleases are excluded: a GitHub pre-release (beta/rc) must
  // never be auto-delivered to the stable channel. There is no beta channel.
  return data.filter(
    (r) => WEB_TAG_RE.test(r.tag_name) && !r.draft && !r.prerelease
  );
}

/** Version string extracted from a web-v* tag. */
function tagVersion(tagName: string): string | null {
  const m = WEB_TAG_RE.exec(tagName);
  return m ? m[1]! : null;
}

/** Newest web-v* release by semver of its tag version. */
function pickNewest(releases: GhRelease[]): GhRelease | null {
  let best: { rel: GhRelease; version: string } | null = null;
  for (const rel of releases) {
    const v = tagVersion(rel.tag_name);
    if (!v) continue;
    if (!best || compareSemver(v, best.version) > 0) {
      best = { rel, version: v };
    }
  }
  return best?.rel ?? null;
}

function findAsset(rel: GhRelease, name: string): GhAsset | null {
  return rel.assets.find((a) => a.name === name) ?? null;
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

/** Effective current web-UI version: current pointer || baseline manifest. */
async function effectiveCurrentVersion(): Promise<string> {
  // The UI actually loaded is the NEWER of the baked-in baseline and any
  // promoted bundle — resolveWebRoot() serves the baked UI whenever it is >=
  // the pointer. Compare against that maximum so a published web bundle is only
  // treated as "newer" when it beats what is genuinely on screen. Returning the
  // raw pointer here (ignoring a newer baked baseline) is what made a freshly
  // built/upgraded app keep pulling and promoting an OLDER published bundle.
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

export async function checkForUpdate(): Promise<{
  available: UpdateManifest | null;
  reason?: string;
}> {
  phase = "checking";
  lastError = null;
  try {
    const releases = await fetchWebReleases();
    const newest = pickNewest(releases);

    // Record the check time regardless of outcome.
    const state = await readState();
    state.lastCheckAt = new Date().toISOString();
    await writeState(state);

    if (!newest) {
      phase = "idle";
      availableVersion = null;
      return { available: null, reason: "no web-ui releases found" };
    }

    // Cache the newest release so downloadAndStage need not re-fetch the list.
    const newestVersion = tagVersion(newest.tag_name);
    if (newestVersion) cachedRelease = { version: newestVersion, rel: newest };

    const manifestAsset = findAsset(newest, "update-manifest.json");
    const sigAsset = findAsset(newest, "update-manifest.json.sig");
    if (!manifestAsset || !sigAsset) {
      phase = "idle";
      availableVersion = null;
      return { available: null, reason: "release missing manifest or signature asset" };
    }

    // The two metadata files are independent — fetch them concurrently.
    const [manifestBytes, sigBytes] = await Promise.all([
      downloadBuffer(manifestAsset.browser_download_url, MAX_META_BYTES),
      downloadBuffer(sigAsset.browser_download_url, MAX_META_BYTES),
    ]);

    // Signature: fail closed. Distinguish "key not configured" (placeholder
    // shipped) from a genuine verification failure so the diagnostic is useful.
    if (!verifyManifestSignature(manifestBytes, sigBytes.toString("utf8").trim())) {
      phase = "idle";
      availableVersion = null;
      const reason = isSigningKeyConfigured()
        ? "manifest signature verification failed"
        : "updater signing key not configured (placeholder public key)";
      if (!isSigningKeyConfigured()) {
        console.warn(`[updater] ${reason} — no updates will be applied`);
      }
      return { available: null, reason };
    }

    let manifest: UpdateManifest;
    try {
      manifest = validateManifest(JSON.parse(manifestBytes.toString("utf8")));
    } catch (e) {
      phase = "idle";
      availableVersion = null;
      return {
        available: null,
        reason: `manifest validation failed: ${(e as Error).message}`,
      };
    }

    // Compatibility gate.
    if (manifest.requiresDesktopApi > DESKTOP_API) {
      phase = "idle";
      availableVersion = null;
      return { available: null, reason: "needs newer app" };
    }

    // Downgrade guard: ignore versions <= minimumSeenVersion.
    if (
      state.minimumSeenVersion &&
      compareSemver(manifest.version, state.minimumSeenVersion) <= 0
    ) {
      phase = "idle";
      availableVersion = null;
      return { available: null, reason: "version below downgrade floor" };
    }

    // Skip versions that have failed the health gate too many times.
    if (isVersionBlocked(state, manifest.version)) {
      phase = "idle";
      availableVersion = null;
      return { available: null, reason: "version previously failed" };
    }

    // Strictly newer than current?
    const current = await effectiveCurrentVersion();
    if (compareSemver(manifest.version, current) <= 0) {
      phase = "idle";
      availableVersion = null;
      return { available: null, reason: "already up to date" };
    }

    phase = "idle";
    availableVersion = manifest.version;
    return { available: manifest };
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

/** Reject any zip entry that would escape `root` (.. segments or absolute). */
function safeJoin(root: string, entryName: string): string | null {
  // fflate normalizes separators to "/" already; reject absolute and traversal.
  if (entryName.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(entryName)) return null;
  if (entryName.split(/[\\/]/).some((seg) => seg === "..")) return null;
  const target = path.resolve(root, entryName);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

export async function downloadAndStage(
  manifest: UpdateManifest
): Promise<{ staged: boolean; reason?: string }> {
  if (inFlight) {
    return { staged: false, reason: "an update operation is already in progress" };
  }
  const run = (async (): Promise<{ staged: boolean; reason?: string }> => {
    phase = "downloading";
    lastError = null;
    const version = manifest.version;
    const downloadsDir = path.join(webRuntimeDir(), "downloads");
    const partPath = path.join(downloadsDir, `web-v${version}.zip.part`);
    const zipPath = path.join(downloadsDir, `web-v${version}.zip`);
    const versionsDir = path.join(webRuntimeDir(), "versions");
    const stagingDir = path.join(versionsDir, `${version}.staging`);
    const finalDir = path.join(versionsDir, version);

    try {
      await mkdir(downloadsDir, { recursive: true });

      // Locate the bundle on the matching web-v* release. Reuse the release
      // cached by checkForUpdate when it matches; otherwise fetch the list.
      let rel: GhRelease | null =
        cachedRelease?.version === version ? cachedRelease.rel : null;
      if (!rel) {
        const releases = await fetchWebReleases();
        rel = releases.find((r) => tagVersion(r.tag_name) === version) ?? null;
      }
      if (!rel) {
        phase = "error";
        return { staged: false, reason: "release for staged version not found" };
      }
      const bundleAsset = findAsset(rel, manifest.assets.bundle.name);
      if (!bundleAsset) {
        phase = "error";
        return { staged: false, reason: "bundle asset not found on release" };
      }

      // Download to .part, then verify, then rename to .zip. The signed
      // manifest's size is trusted (sig verified upstream), so cap the download
      // near it, bounded by the absolute ceiling.
      const cap = Math.min(
        MAX_BUNDLE_BYTES,
        Math.max(manifest.assets.bundle.size, 0) + 4096
      );
      const zipBytes = await downloadBuffer(bundleAsset.browser_download_url, cap);
      await writeFile(partPath, zipBytes);

      const integrity = verifyBundle(zipBytes, manifest.assets.bundle);
      if (!integrity.ok) {
        await rm(partPath, { force: true }).catch(() => {});
        phase = "error";
        return { staged: false, reason: `bundle verification failed: ${integrity.reason}` };
      }
      await rename(partPath, zipPath);

      // Fresh staging dir.
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
      await mkdir(stagingDir, { recursive: true });

      // Extract with traversal guards on EVERY entry.
      const entries = unzipSync(new Uint8Array(zipBytes));
      for (const [name, data] of Object.entries(entries)) {
        if (name.endsWith("/")) continue; // directory marker
        const target = safeJoin(stagingDir, name);
        if (!target) {
          await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
          await rm(zipPath, { force: true }).catch(() => {});
          phase = "error";
          return { staged: false, reason: `unsafe zip entry rejected: ${name}` };
        }
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, Buffer.from(data));
      }

      // Post-extract structural assertions.
      const indexOk = await fileExists(path.join(stagingDir, "index.html"));
      const appOk = await dirExists(path.join(stagingDir, "_app"));
      if (!indexOk || !appOk) {
        await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
        await rm(zipPath, { force: true }).catch(() => {});
        phase = "error";
        return {
          staged: false,
          reason: "extracted bundle missing index.html or _app/",
        };
      }

      // Atomic promote of the staging dir into its final name.
      await rm(finalDir, { recursive: true, force: true }).catch(() => {});
      await rename(stagingDir, finalDir);

      // Record staged pointer (NOT current).
      await writeStaged({ version, path: finalDir });

      // Downloaded zip is no longer needed once extracted.
      await rm(zipPath, { force: true }).catch(() => {});

      phase = "staged";
      availableVersion = version;
      return { staged: true };
    } catch (e) {
      lastError = (e as Error).message;
      phase = "error";
      console.warn("[updater] downloadAndStage failed (non-fatal):", lastError);
      await rm(partPath, { force: true }).catch(() => {});
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
async function dirExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
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

    // The staged dir must still have a valid index.html.
    if (!(await fileExists(path.join(staged.path, "index.html")))) {
      console.warn("[updater] staged bundle missing index.html; clearing staged");
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
      // No previous to fall back to — drop the current pointer so resolveWebRoot
      // returns the bundled-in-asar build.
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
  // Report the version actually SERVED, mirroring resolveWebRoot()'s rule: a
  // promoted pointer only wins if it is strictly newer than the baked baseline.
  // Otherwise the baked UI is on screen, so currentVersion must be the baseline
  // — not a stale pointer left in userData (which previously made the Help
  // modal show e.g. 0.2.3 while 0.3.0 was actually rendered).
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
