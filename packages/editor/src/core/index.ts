/**
 * `@dimm-city/gutterpress-editor/core` — the framework-free, browser-safe
 * source-edit contract surface (D3/D4/D7/D14). package.json's `exports`
 * maps the `"./core"` subpath directly to this file, so a consumer that
 * wants ONLY these contracts (no future `src/web/**`/`src/vscode-adapter/**`
 * code pulled in) can import this subpath instead of the package root.
 */
export * from "./contracts.ts";
export * from "./diagnostics.ts";
export * from "./apply-edit.ts";
export * from "./validate.ts";
export * from "./hosts.ts";
export * from "./memory-host.ts";
export * from "./contract-tests.ts";
export * from "./commands.ts";
