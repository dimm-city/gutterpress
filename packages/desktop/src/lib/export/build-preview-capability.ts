/**
 * Build/preview/export pipeline capability (SFE-P5b, D10's named bounded
 * context). Replaces the corresponding `getPlatform()` members consumed by
 * `+page.svelte`'s `ExportController`/`ProjectLifecycleController`
 * construction and its own `onUrlPreviewBlocked` subscription.
 *
 * `startPreview`/`build` preserve REAL marshalling from the old
 * `ElectronAdapter` (#49): they unwrap `FolderRef.key` into the plain path
 * string the IPC bridge expects — kept here rather than dying, since it is
 * genuine translation logic, not pure forwarding.
 */
import { bridge } from "$lib/platform/bridge";
import type {
  BuildArgs,
  BuildResult,
  ExportProgressEvent,
  PreviewStartArgs,
  PreviewStartResult,
  UrlPreviewBlockedEvent,
} from "$lib/platform/contract";

/**
 * Coarse host capability flags (#49) so the UI can degrade gracefully
 * without branching on a platform discriminant directly. Moved here from
 * `platform/contract.ts` (SFE-P5b review round 1) — `capabilities()` is not
 * an `ElectronBridge` member (it was always a local synthesis, never a
 * bridge call — see {@link getPlatformCapabilities}'s own doc comment), so
 * nothing about it required staying in the shared IPC-DTO file; this is its
 * one real owning capability.
 */
export interface PlatformCapabilities {
  /** The host can write build output to a real, user-chosen filesystem path. */
  nativeSavePath: boolean;
  /** The host can reveal a file/folder in the OS file manager. */
  showInFolder: boolean;
  /** The host can persist a folder handle across sessions. */
  persistentFolderAccess: boolean;
}

export function onBuildProgress(cb: (data: ExportProgressEvent) => void): () => void {
  return bridge().onBuildProgress(cb);
}

/** #49: unwrap FolderRef.key → the string `input` the existing IPC expects. */
export function startPreview(args: PreviewStartArgs): Promise<PreviewStartResult> {
  const { input, ...rest } = args;
  return bridge().startPreview({ ...rest, input: input.key });
}

export function stopPreview(): Promise<{ stopped: boolean }> {
  return bridge().stopPreview();
}

export function cancelExport(exportId: string): Promise<{ canceled: boolean }> {
  return bridge().cancelExport(exportId);
}

/** #49: unwrap FolderRef.key → the string `input` the existing IPC expects. */
export function build(args: BuildArgs): Promise<BuildResult> {
  const { input, ...rest } = args;
  return bridge().build({ ...rest, input: input.key });
}

export function onUrlPreviewBlocked(cb: (data: UrlPreviewBlockedEvent) => void): () => void {
  return bridge().onUrlPreviewBlocked(cb);
}

/**
 * Coarse host capability flags (#49). Electron (the only host this package
 * runs on, SFE-P5a/D10) is always full-capability: native save paths, OS
 * file-manager reveal, and persistent folder access are all available, so
 * the values themselves are a pure local synthesis, not an IPC call.
 *
 * `bridge()` is still called (its return value is unused) to preserve the
 * exact fail-loudly-off-Electron behavior `getPlatform().capabilities()`
 * had: `+page.svelte`'s `canSavePdf` derived reads this eagerly at mount
 * (the one unconditional, non-`isDesktop()`-gated call site in that file),
 * so it was — and still is — `+page.svelte`'s own trigger for "`vite dev`
 * without Electron must fail clearly" (SFE-P5a). Dropping the `bridge()`
 * call would silently change that behavior; keeping it costs nothing since
 * the values never actually vary.
 */
export function getPlatformCapabilities(): PlatformCapabilities {
  bridge();
  return {
    nativeSavePath: true,
    showInFolder: true,
    persistentFolderAccess: true,
  };
}
