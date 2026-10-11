/**
 * `@dimm-city/gutterpress-editor` — public entry point.
 *
 * Packaging note (SFE-P1a): package.json's `exports` map `"."` to this file
 * and `"./core"` to `src/core/index.ts` directly as TypeScript SOURCE —
 * there is no build step yet ("do NOT add a build step yet" — this run's
 * lane instructions). Nothing outside this package consumes it yet (the
 * desktop app and `packages/vscode-extension` gain a dependency on it in
 * later runs), and Bun resolves package.json `exports` pointing at `.ts`
 * files directly, so this is sufficient until a real bundling consumer
 * needs compiled output — at which point `exports` gains `types`/`default`
 * conditions pointing at a `dist/` build, the way `packages/cli`'s
 * package.json already does.
 *
 * This run re-exports only the core surface (contracts, diagnostics,
 * validators, hosts, `MemoryDocumentHost` — see `src/core/index.ts`).
 * The framework-free web mount (`src/web/**`, added alongside this run by
 * a parallel lane) and the VS Code adapter (`src/vscode-adapter/**`, P1b)
 * are re-exported here once they exist — this barrel is not a promise that
 * today's surface is final.
 */
export * from "./core/index.ts";
