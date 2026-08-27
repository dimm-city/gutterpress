/**
 * Shared "vscode" module mock for `bun test` (SFE-P1a).
 *
 * The real "vscode" module is injected by the VS Code extension host at
 * runtime — it is not an npm package and importing it outside a real (or
 * `@vscode/test-electron`-launched) host throws/fails to resolve. This run
 * does NOT add `@vscode/test-electron` (recorded gap — see
 * src/extension.ts's header), so any suite that imports src/extension.ts
 * (which statically `import`s "vscode" as a VALUE, for
 * `vscode.window.registerCustomEditorProvider`) must
 * `mock.module("vscode", ...)` BEFORE that dynamic `import()`. This
 * mirrors packages/desktop/tests/support/electron-mock.ts's
 * `mock.module("electron", ...)` pattern for the identical reason
 * (Electron isn't a real runtime outside a packaged Electron app either).
 *
 * src/provider.ts imports "vscode" as `import type * as vscode` only — a
 * type-only import is fully erased at compile time, so provider.ts needs
 * NO runtime "vscode" module at all, and neither does tests/provider.test.ts
 * or tests/manifest.test.ts (which parses package.json directly). This
 * mock is therefore consumed by exactly one suite today
 * (tests/extension.test.ts).
 *
 * `bun test --isolate` does not fully sandbox `mock.module()` registrations
 * across files that touch the SAME specifier (see electron-mock.ts's header
 * for the identical caveat applied to "electron") — whichever suite's
 * factory ends up "live" serves every other suite's static `from "vscode"`
 * imports too. Since only one suite in this package needs a live "vscode"
 * runtime import today, that collision risk does not yet apply here. If a
 * second suite needs `mock.module("vscode", ...)`, give it the SAME
 * superset via this helper (extend the default below), exactly as
 * electron-mock.ts documents for "electron".
 */

export interface VscodeDisposableLike {
  dispose(): void;
}

export interface VscodeMockOverrides {
  /** Merged into `window` (so a spying override replaces just this key). */
  registerCustomEditorProvider?: (
    viewType: string,
    provider: unknown,
    options: unknown,
  ) => VscodeDisposableLike;
}

/**
 * Build the canonical mocked "vscode" namespace, with optional per-suite
 * overrides. Call as `mock.module("vscode", () => vscodeMock({ ... }))`.
 */
export function vscodeMock(overrides: VscodeMockOverrides = {}) {
  return {
    window: {
      registerCustomEditorProvider:
        overrides.registerCustomEditorProvider ?? ((): VscodeDisposableLike => ({ dispose: () => {} })),
    },
  };
}
