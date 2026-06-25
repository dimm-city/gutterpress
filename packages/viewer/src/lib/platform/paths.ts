/**
 * Shared, PWA-clean path helpers (#61).
 *
 * These are pure string operations — NO `node:path` (importing it as a value
 * would drag node code into the SPA and break the renderer/host split, §8 /
 * ADR 0004). They are the single source of truth for basename derivation across
 * the adapter, `+page.svelte`, and the editor/conflict components, replacing the
 * scattered inline `.split(/[\\/]/).pop()` / `.split("/").pop()` derivations.
 */
import type { FileRef } from "./contract";

/**
 * Last non-empty path segment, splitting on both POSIX and Windows separators.
 * `filter(Boolean)` so a trailing separator (e.g. `".../proj/"`) yields the
 * folder name, not `""`. Falls back to the input when there is no segment.
 */
export function basenameOf(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

/**
 * Join a host base path with child segments using the base's native separator
 * (Windows `\` if the base contains one, else POSIX `/`). Pure string op — the
 * single source of truth for the renderer's `base.includes("\\") ? "\\" : "/"`
 * path-building (it had accreted across `+page.svelte`). NOTE: building host
 * paths in the renderer is itself a bandaid the host should remove (#61 —
 * return a ref instead of a path); this just centralizes it until then.
 */
export function joinPath(base: string, ...segments: string[]): string {
  const sep = base.includes("\\") ? "\\" : "/";
  return [base.replace(/[\\/]+$/, ""), ...segments].join(sep);
}

/**
 * Wrap a host file path into a host-neutral {@link FileRef} (#61), analogous to
 * the adapter's FolderRef wrapping (#49). `key` is the host path / FSA handle id;
 * `displayName` is the precomputed basename so the UI never splits a path itself.
 */
export function fileRef(key: string): FileRef {
  return { key, displayName: basenameOf(key) };
}
