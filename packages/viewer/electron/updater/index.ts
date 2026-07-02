// ──────────────────────────────────────────────────────────────────────────
// updater/index.ts — core web-UI auto-update engine (main process only)
//
// Networking and filesystem mutation for the web-UI bundle live ONLY here (and
// the thin main.ts wiring that calls it). Never in the renderer.
//
// Flow:
//   checkForUpdate()  -> reads npm registry package metadata for
//                        @dimm-city/print-md-ui (stable/rc/beta), verifies the
//                        package tarball via dist.integrity, validates+verifies
//                        the embedded manifest, applies downgrade/failed/compat gates.
//   downloadAndStage()-> downloads the package tarball, verifies dist.integrity,
//                        extracts the embedded bundle zip, verifies it, extracts into
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

import crypto from "node:crypto";
import path from "node:path";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
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

export const WEB_UI_PACKAGE = "@dimm-city/print-md-ui";

const DEFAULT_REGISTRY_URL = `https://registry.npmjs.org/${WEB_UI_PACKAGE}`;

// Test/diagnostic override for the npm registry metadata URL.
let warnedFeedOverride = false;
function registryUrl(): string {
  const override = process.env.PRINT_MD_UPDATER_FEED_URL;
  if (override) {
    if (!warnedFeedOverride) {
      warnedFeedOverride = true;
      console.warn(
        `[updater] PRINT_MD_UPDATER_FEED_URL override active: ${override}`
      );
    }
    return override;
  }
  return DEFAULT_REGISTRY_URL;
}

type UpdateChannel = "stable" | "rc" | "beta";
let warnedChannelOverride = false;

function selectedChannel(): UpdateChannel {
  const raw = (process.env.PRINT_MD_UPDATER_CHANNEL ?? "stable").toLowerCase();
  if (raw === "stable" || raw === "rc" || raw === "beta") {
    return raw;
  }
  if (!warnedChannelOverride) {
    warnedChannelOverride = true;
    console.warn(`[updater] invalid PRINT_MD_UPDATER_CHANNEL=${raw}; using stable`);
  }
  return "stable";
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

// Package version metadata cached by checkForUpdate(), reused by
// downloadAndStage() on the common check→stage path.
let cachedPackageVersion: { version: string; pkg: RegistryPackageVersion } | null = null;

// Network guards: every fetch is time-bounded so a stalled connection can't
// hang an IPC handler forever, and downloads are size-capped to prevent a
// compromised/oversized release from exhausting memory (the integrity check
// runs only after the full buffer is resident, so the cap must come first).
const FETCH_TIMEOUT_MS = 30_000;
const MAX_BUNDLE_BYTES = 256 * 1024 * 1024; // 256 MB hard ceiling
const MAX_META_BYTES = 1 * 1024 * 1024; // manifest/sig are tiny
const MAX_PACKAGE_BYTES = 256 * 1024 * 1024; // npm tarball hard ceiling
const MAX_TAR_BYTES = 512 * 1024 * 1024; // decompressed tar hard ceiling

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

interface RegistryPackageVersion {
  version?: string;
  dist?: {
    tarball?: string;
    integrity?: string;
  };
}

interface RegistryMetadata {
  "dist-tags"?: {
    latest?: string;
    rc?: string;
    beta?: string;
  };
  versions?: Record<string, RegistryPackageVersion>;
}

function channelTag(channel: UpdateChannel): "latest" | "rc" | "beta" {
  if (channel === "stable") return "latest";
  return channel;
}

async function fetchRegistryMetadata(): Promise<RegistryMetadata> {
  const res = await fetch(registryUrl(), {
    headers: {
      "User-Agent": "print-md-desktop-app-updater",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`npm registry request failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as RegistryMetadata;
  if (!data || typeof data !== "object") {
    throw new Error("npm registry response was not an object");
  }
  return data;
}

function getVersionFromChannel(
  meta: RegistryMetadata,
  channel: UpdateChannel
): { version: string; pkg: RegistryPackageVersion } | null {
  const tag = channelTag(channel);
  const version = meta["dist-tags"]?.[tag];
  if (typeof version !== "string" || version.trim() === "") {
    return null;
  }
  const pkg = meta.versions?.[version];
  if (!pkg) {
    return null;
  }
  return { version, pkg };
}

function getVersionByExact(
  meta: RegistryMetadata,
  version: string
): RegistryPackageVersion | null {
  return meta.versions?.[version] ?? null;
}

function parseIntegrity(
  integrity: string
): { algorithm: string; digestBase64: string } | null {
  const first = integrity.split(" ").find((entry) => entry.includes("-"));
  if (!first) return null;
  const idx = first.indexOf("-");
  if (idx <= 0 || idx === first.length - 1) return null;
  const algorithm = first.slice(0, idx).toLowerCase();
  const digestBase64 = first.slice(idx + 1);
  if (!/^[a-z0-9-]+$/.test(algorithm) || digestBase64.trim() === "") {
    return null;
  }
  return { algorithm, digestBase64 };
}

function verifyTarballIntegrity(
  bytes: Buffer,
  integrity: string
): { ok: true } | { ok: false; reason: string } {
  const parsed = parseIntegrity(integrity);
  if (!parsed) {
    return { ok: false, reason: "invalid dist.integrity format" };
  }
  try {
    const actual = crypto
      .createHash(parsed.algorithm)
      .update(bytes)
      .digest("base64");
    if (actual !== parsed.digestBase64) {
      return { ok: false, reason: "dist.integrity mismatch" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: `unsupported dist.integrity algorithm: ${parsed.algorithm}` };
  }
}

function readTarSize(header: Uint8Array): number {
  const raw = Buffer.from(header.subarray(124, 136))
    .toString("utf8")
    .replace(/\0/g, "")
    .trim();
  if (raw === "") return 0;
  const size = Number.parseInt(raw, 8);
  return Number.isFinite(size) && size >= 0 ? size : 0;
}

function extractFilesFromNpmTarball(
  tarballGz: Buffer,
  wantedFiles: string[]
): Map<string, Buffer> {
  const wanted = new Set(wantedFiles);
  const out = new Map<string, Buffer>();
  const tar = gunzipSync(tarballGz, { maxOutputLength: MAX_TAR_BYTES });
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    const allZero = header.every((b) => b === 0);
    if (allZero) break;
    const name = Buffer.from(header.subarray(0, 100))
      .toString("utf8")
      .replace(/\0.*$/, "");
    const size = readTarSize(header);
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;
    if (contentEnd > tar.length) break;

    if (wanted.has(name)) {
      out.set(name, Buffer.from(tar.subarray(contentStart, contentEnd)));
      if (out.size === wanted.size) break;
    }

    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  return out;
}

async function downloadBuffer(url: string, maxBytes: number): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { "User-Agent": "print-md-desktop-app-updater" },
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

/**
 * Record a check outcome that indicates a PROBLEM with the published release
 * (bad/missing metadata, failed signature) rather than a benign "nothing new".
 * Sets phase=error + lastError so getStatus() reports it and the manual
 * "Check for updates" path surfaces the reason to the user instead of a
 * misleading "You're up to date". Benign outcomes (no releases, already up to
 * date, downgrade floor, …) must NOT use this — they stay phase=idle so the
 * silent startup check never alarms anyone.
 */
function checkProblem(reason: string): { available: null; reason: string } {
  phase = "error";
  lastError = reason;
  availableVersion = null;
  console.warn(`[updater] check found a problem: ${reason}`);
  return { available: null, reason };
}

export async function checkForUpdate(channelOverride?: UpdateChannel): Promise<{
  available: UpdateManifest | null;
  reason?: string;
}> {
  phase = "checking";
  lastError = null;
  try {
    const channel = channelOverride ?? selectedChannel();
    const meta = await fetchRegistryMetadata();
    const picked = getVersionFromChannel(meta, channel);

    // Record the check time regardless of outcome.
    const state = await readState();
    state.lastCheckAt = new Date().toISOString();
    await writeState(state);

    if (!picked) {
      phase = "idle";
      availableVersion = null;
      return { available: null, reason: `no web-ui package found for ${channel} channel` };
    }

    cachedPackageVersion = picked;

    const tarballUrl = picked.pkg.dist?.tarball;
    const tarballIntegrity = picked.pkg.dist?.integrity;
    if (typeof tarballUrl !== "string" || typeof tarballIntegrity !== "string") {
      return checkProblem("package version missing dist.tarball or dist.integrity");
    }

    const tarballBytes = await downloadBuffer(tarballUrl, MAX_PACKAGE_BYTES);
    const tarballCheck = verifyTarballIntegrity(tarballBytes, tarballIntegrity);
    if (!tarballCheck.ok) {
      return checkProblem(`package tarball verification failed: ${tarballCheck.reason}`);
    }

    const files = extractFilesFromNpmTarball(tarballBytes, [
      "package/update-manifest.json",
      "package/update-manifest.json.sig",
    ]);
    const manifestBytes = files.get("package/update-manifest.json");
    const sigBytes = files.get("package/update-manifest.json.sig");
    if (!manifestBytes || !sigBytes) {
      return checkProblem("package tarball missing update-manifest.json or update-manifest.json.sig");
    }
    if (manifestBytes.byteLength > MAX_META_BYTES || sigBytes.byteLength > MAX_META_BYTES) {
      return checkProblem("manifest metadata files exceed size cap");
    }

    // Signature: fail closed. Distinguish "key not configured" (placeholder
    // shipped) from a genuine verification failure so the diagnostic is useful.
    if (!verifyManifestSignature(manifestBytes, sigBytes.toString("utf8").trim())) {
      const reason = isSigningKeyConfigured()
        ? "manifest signature verification failed"
        : "updater signing key not configured (placeholder public key)";
      if (!isSigningKeyConfigured()) {
        console.warn(`[updater] ${reason} — no updates will be applied`);
      }
      return checkProblem(reason);
    }

    let manifest: UpdateManifest;
    try {
      manifest = validateManifest(JSON.parse(manifestBytes.toString("utf8")));
    } catch (e) {
      return checkProblem(`manifest validation failed: ${(e as Error).message}`);
    }

    if (manifest.version !== picked.version) {
      return checkProblem(
        `manifest version ${manifest.version} does not match package version ${picked.version}`
      );
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

      // Locate exact package version metadata. Reuse cached metadata from
      // checkForUpdate() when available; otherwise refetch from npm registry.
      let pkg: RegistryPackageVersion | null =
        cachedPackageVersion?.version === version ? cachedPackageVersion.pkg : null;
      if (!pkg) {
        const meta = await fetchRegistryMetadata();
        pkg = getVersionByExact(meta, version);
      }
      if (!pkg) {
        phase = "error";
        return { staged: false, reason: "package metadata for staged version not found" };
      }

      const tarballUrl = pkg.dist?.tarball;
      const tarballIntegrity = pkg.dist?.integrity;
      if (typeof tarballUrl !== "string" || typeof tarballIntegrity !== "string") {
        phase = "error";
        return {
          staged: false,
          reason: "package version missing dist.tarball or dist.integrity",
        };
      }

      const tarballBytes = await downloadBuffer(tarballUrl, MAX_PACKAGE_BYTES);
      const tarballCheck = verifyTarballIntegrity(tarballBytes, tarballIntegrity);
      if (!tarballCheck.ok) {
        phase = "error";
        return {
          staged: false,
          reason: `package tarball verification failed: ${tarballCheck.reason}`,
        };
      }

      const extracted = extractFilesFromNpmTarball(tarballBytes, [
        `package/${manifest.assets.bundle.name}`,
      ]);
      const zipBytes = extracted.get(`package/${manifest.assets.bundle.name}`);
      if (!zipBytes) {
        phase = "error";
        return {
          staged: false,
          reason: `bundle file ${manifest.assets.bundle.name} not found in package tarball`,
        };
      }
      if (zipBytes.byteLength > MAX_BUNDLE_BYTES) {
        phase = "error";
        return { staged: false, reason: "bundle file exceeds size cap" };
      }

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
      if (!(await hasRuntimeBundle(stagingDir))) {
        await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
        await rm(zipPath, { force: true }).catch(() => {});
        phase = "error";
        return {
          staged: false,
          reason: "extracted bundle missing handler.js, client/, or server/",
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

async function hasRuntimeBundle(root: string): Promise<boolean> {
  const [handlerOk, clientOk, serverOk] = await Promise.all([
    fileExists(path.join(root, "handler.js")),
    dirExists(path.join(root, "client")),
    dirExists(path.join(root, "server")),
  ]);
  return handlerOk && clientOk && serverOk;
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

    // The staged dir must still have a valid adapter-node runtime bundle.
    if (!(await hasRuntimeBundle(staged.path))) {
      console.warn("[updater] staged bundle missing handler.js, client/, or server/; clearing staged");
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
