// ──────────────────────────────────────────────────────────────────────────
// web-runtime: resolvable SPA root + on-disk update layout (Phase 1 plumbing)
//
// The app:// protocol serves the SvelteKit SPA from a downloaded bundle in
// userData when one is present and valid, otherwise from the bundled-in-asar
// build/ directory (today's behavior). This module owns the userData layout
// and the pointer/state files that later phases populate. No networking here.
//
// Layout, rooted at <userData>/web-runtime:
//   current.json   -> { version, path }   (path = ABSOLUTE path to versions/<version>)
//   previous.json  -> { version, path }
//   state.json     -> State (see interface)
//   versions/<version>/   (extracted bundle root: index.html + _app/)
//   downloads/
//
// All reads are failure-tolerant (corrupt JSON / missing files fall back and
// never throw). All writes are atomic (tmp file + rename).
// ──────────────────────────────────────────────────────────────────────────

import { app } from "electron";
import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

export interface Pointer {
  version: string;
  path: string;
}

export interface State {
  schemaVersion: 1;
  currentVersion: string | null;
  previousVersion: string | null;
  minimumSeenVersion: string | null;
  lastCheckAt: string | null;
  lastHealthyVersion: string | null;
  failedVersions: Record<string, unknown>;
}

function defaultState(): State {
  return {
    schemaVersion: 1,
    currentVersion: null,
    previousVersion: null,
    minimumSeenVersion: null,
    lastCheckAt: null,
    lastHealthyVersion: null,
    failedVersions: {},
  };
}

export function webRuntimeDir(): string {
  return path.join(app.getPath("userData"), "web-runtime");
}

export async function ensureLayout(): Promise<void> {
  const dir = webRuntimeDir();
  await mkdir(path.join(dir, "versions"), { recursive: true });
  await mkdir(path.join(dir, "downloads"), { recursive: true });
}

export async function writeAtomic(target: string, contents: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await writeFile(tmp, contents, "utf8");
  await rename(tmp, target);
}

export async function readPointer(
  name: "current" | "previous"
): Promise<Pointer | null> {
  try {
    const raw = await readFile(
      path.join(webRuntimeDir(), `${name}.json`),
      "utf8"
    );
    const ptr = JSON.parse(raw) as Pointer;
    if (typeof ptr?.version !== "string" || typeof ptr?.path !== "string") {
      return null;
    }
    return ptr;
  } catch {
    return null;
  }
}

export async function writePointer(
  name: "current" | "previous",
  ptr: Pointer
): Promise<void> {
  await writeAtomic(
    path.join(webRuntimeDir(), `${name}.json`),
    JSON.stringify(ptr, null, 2)
  );
}

export async function readState(): Promise<State> {
  try {
    const raw = await readFile(
      path.join(webRuntimeDir(), "state.json"),
      "utf8"
    );
    const parsed = JSON.parse(raw) as Partial<State>;
    return {
      ...defaultState(),
      ...parsed,
      schemaVersion: 1,
      failedVersions:
        parsed.failedVersions &&
        typeof parsed.failedVersions === "object" &&
        !Array.isArray(parsed.failedVersions)
          ? parsed.failedVersions
          : {},
    };
  } catch {
    return defaultState();
  }
}

export async function writeState(state: State): Promise<void> {
  await writeAtomic(
    path.join(webRuntimeDir(), "state.json"),
    JSON.stringify(state, null, 2)
  );
}

// main.js lives at out/main/; the bundled SvelteKit SPA is at the package
// root build/. This is exactly the historical STATIC_ROOT value.
export function bundledWebRoot(): string {
  return path.resolve(__dirname, "../../build");
}

export async function resolveWebRoot(): Promise<string> {
  try {
    const ptr = await readPointer("current");
    if (ptr && isInsideVersions(ptr.path)) {
      await readFile(path.join(ptr.path, "index.html"));
      return ptr.path;
    }
  } catch {
    // fall through to bundled root
  }
  return bundledWebRoot();
}

// Containment guard: a current.json pointer is only honored if it resolves to a
// directory strictly inside web-runtime/versions/. Defends against a tampered
// or poisoned pointer redirecting the app:// root to an arbitrary location —
// the protocol handler's boundary check keys off this root, so the root itself
// must be trusted. Legitimate bundles are always staged under versions/<v>.
function isInsideVersions(candidate: string): boolean {
  const versionsDir = path.join(webRuntimeDir(), "versions");
  const resolved = path.resolve(candidate);
  return resolved.startsWith(versionsDir + path.sep);
}

export async function readBaselineVersion(): Promise<string> {
  try {
    const raw = await readFile(
      path.join(bundledWebRoot(), "update-manifest.json"),
      "utf8"
    );
    const manifest = JSON.parse(raw) as { version?: unknown };
    if (typeof manifest.version === "string") {
      return manifest.version;
    }
  } catch {
    // fall through to default
  }
  return "0.0.0";
}
