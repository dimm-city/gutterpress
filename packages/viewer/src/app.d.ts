// SvelteKit ambient types for the viewer SPA.
//
// The `window.electron` bridge (exposed by electron/preload.ts) is typed here so
// the SPA tsconfig sees it — electron/types.d.ts carries the same shape for the
// main/preload tsconfig scope, which the SPA build does not include. ONLY
// src/lib/platform/electron-adapter.ts should read window.electron; everything
// else goes through getPlatform().
// Relative import (not the `$lib` alias) so this file type-checks even before
// `svelte-kit sync` has generated the alias mapping (e.g. a fresh CI checkout).
import type { ElectronBridge } from "./lib/platform/contract";

declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }

  interface Window {
    electron?: ElectronBridge;
  }
}

export {};
