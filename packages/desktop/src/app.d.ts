// SvelteKit ambient types for the desktop SPA.
//
// The `window.electron` bridge (exposed by electron/preload.ts) is typed here so
// the SPA tsconfig sees it. ONLY src/lib/platform/electron-adapter.ts should
// read window.electron; everything else goes through getPlatform().
// Relative import (not the `#lib` alias) so this file type-checks with no
// import mapping at all.
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
