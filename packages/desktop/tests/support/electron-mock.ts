/**
 * Shared "electron" module mock for `bun test` (audit E7).
 *
 * Importing the real "electron" package outside an actual Electron process
 * throws (it tries to locate/download the Electron binary), so every suite
 * that imports an `electron/*.ts` module must `mock.module("electron", …)`
 * first. `bun test --isolate` does NOT sandbox that registration between files
 * touching the "electron" specifier — whichever suite's factory ends up "live"
 * serves every other suite's static `from "electron"` imports too. So every
 * such mock must expose the SAME superset of keys every electron/*.ts module
 * imports (app.getPath/isPackaged/getVersion/single-instance lock methods/quit,
 * protocol, BrowserWindow, safeStorage).
 *
 * This helper owns that superset in ONE place. The five suites used to hand-copy
 * it, kept in sync only by a comment. Add a new `from "electron"` import in
 * production? Extend the default here and every suite gets it. Pass per-suite
 * overrides for the pieces a given test genuinely customizes (a mutable
 * getPath, a capturing protocol.handle, a custom BrowserWindow).
 */

import { EventEmitter } from "node:events";

/** Reversible fake "encryption" — proves round-trip plumbing without an OS keyring. */
let fakeSelectedStorageBackend = "gnome_libsecret";

export function setFakeSelectedStorageBackend(backend: string): void {
  fakeSelectedStorageBackend = backend;
}

export const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s, "utf8"),
  decryptString: (b: Buffer) => Buffer.from(b).toString("utf8"),
  getSelectedStorageBackend: () => fakeSelectedStorageBackend,
};

export interface ElectronMockOverrides {
  /** Merged over the default `app` (so a mutable getPath overrides just that key). */
  app?: Record<string, unknown>;
  autoUpdater?: unknown;
  protocol?: unknown;
  BrowserWindow?: unknown;
  safeStorage?: unknown;
}

/**
 * Build the canonical mocked "electron" namespace, with optional per-suite
 * overrides. Call as `mock.module("electron", () => electronMock({ … }))`.
 */
export function electronMock(overrides: ElectronMockOverrides = {}) {
  return {
    app: {
      getPath: () => "/tmp/gutterpress-test-userdata",
      isPackaged: true,
      getVersion: () => "1.0.0",
      releaseSingleInstanceLock: () => {},
      requestSingleInstanceLock: () => true,
      quit: () => {},
      ...(overrides.app ?? {}),
    },
    autoUpdater: overrides.autoUpdater ?? new EventEmitter(),
    protocol: overrides.protocol ?? {},
    BrowserWindow: overrides.BrowserWindow ?? class {},
    safeStorage: overrides.safeStorage ?? fakeSafeStorage,
  };
}
