/**
 * The ONE shared accessor for `window.electron` (SFE-P5b).
 *
 * Every feature-owned capability module (`$lib/update/updater-capability`,
 * `$lib/remote/remote-capability`, `$lib/export/build-preview-capability`,
 * `$lib/editor-host/editor-projection-capability`,
 * `$lib/app-lifecycle/app-lifecycle-capability`, `theme.svelte.ts`) calls
 * {@link bridge} to reach the real preload boundary. Nothing else may
 * reference `window.electron` directly — this replaces `electron-adapter.ts`,
 * which was the ONLY module permitted to touch it before this run.
 *
 * `isDesktop()` and {@link DesktopHostRequiredError} moved here from
 * `platform/index.ts` (still re-exported from there for the ~20 components
 * that only ever needed the boolean check, never the deleted `Platform`
 * service locator) — this is now the one place both live, matching D10's
 * "the fail-loudly guard moves to the one place that still needs it."
 *
 * The return type is `ElectronBridge` (`./contract`) — the typed mirror of
 * the ambient `Window.electron` shape `electron/types.d.ts` declares for the
 * main/preload TS program. That ambient declaration is themselves mirrored,
 * by hand, into `src/app.d.ts` for the SPA's own TS program (a second
 * `declare global` scope electron/types.d.ts's program does not cover) as
 * `Window.electron?: ElectronBridge` — `app.d.ts` is outside this run's write
 * ownership, so `ElectronBridge` stays a real, exported type in
 * `./contract.ts` rather than being inlined or deleted; see that file's
 * header for the full three-way accounting.
 */
import type { ElectronBridge } from "./contract";

/** Thrown by {@link bridge} when no Electron host is present (SFE-P5a). */
export class DesktopHostRequiredError extends Error {
  constructor() {
    super(
      "desktop host required — the browser host was removed in SFE-P5a; " +
        "a future web product is a separate package",
    );
    this.name = "DesktopHostRequiredError";
  }
}

/** True when running inside the Electron shell (the preload bridge is present). */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && Boolean(window.electron);
}

/**
 * Return the real preload bridge. Off-Electron (a plain browser, or `vite
 * dev` with no preload) this throws {@link DesktopHostRequiredError} instead
 * of returning `undefined` — fail loudly, not partially (SFE-P5a/P5b).
 */
export function bridge(): ElectronBridge {
  if (!isDesktop()) {
    throw new DesktopHostRequiredError();
  }
  return window.electron as ElectronBridge;
}
