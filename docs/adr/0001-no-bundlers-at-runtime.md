# ADR 0001 — No bundlers at runtime (packages/cli only)

**Status:** Accepted  
**Date:** 2026-04-01  
**Scope:** `packages/cli/src/` only — does NOT apply to `packages/viewer/`

---

## Context

print-md is distributed as a standalone binary compiled with `bun build --compile`.
Users download a single executable from GitHub Releases — no Node, no Bun, no
`node_modules` on the host.

Early versions of the preview server used **Vite** as a dev server. This caused
multiple problems under `bun build --compile`:

1. Vite carries native optional dependencies (`rollup`, `lightningcss`,
   `fsevents`) with platform-specific `.node` binaries that Bun's compiler
   cannot reliably embed.

2. Vite reads its own `package.json` at module load via
   `JSON.parse(readFileSync(new URL("../package.json", import.meta.url)))`.
   Under `bun build --compile`, `import.meta.url` resolves relative to `cwd`,
   not the embedded bundle location, so this pattern throws at startup.

3. The workaround — a compile-time regex plugin in `scripts/compile-plugin.ts`
   that rewrites the `readFileSync` calls inside `node_modules/vite` — was
   fragile, version-dependent, and had to be re-verified on every Vite bump.

4. print-md does not bundle code at preview time. It serves a pre-rendered
   `book.html` and triggers a full-page reload on file change. Vite's
   CSS-as-JS-module pipeline and module-graph HMR were actively bypassed by
   two custom Vite plugins written solely to defeat Vite's default behaviour.
   Running a bundler-based dev server to serve a static file was the wrong
   shape for the problem.

## Decision

Do **not** import `vite`, `rollup`, `esbuild`, or any other bundler at runtime
(eager or lazy) inside `packages/cli/src/`.

The preview server uses **`Bun.serve`** with its built-in WebSocket upgrade.
This provides everything print-md needs:

- Static file serving (for `book.html` and assets)
- WebSocket pub/sub (`server.publish(topic, data)`) for full-reload broadcasts
- Request routing for `/api/*` endpoints

Implementation is ~150 lines in
`packages/cli/src/preview/http-server.ts` with no native bindings and no
`package.json`-at-load-time patterns.

## Scope clarification

This ADR applies **only to `packages/cli/src/`**.

`packages/viewer/` is an Electron + SvelteKit desktop app. It is a web
application built by Vite/Rollup at _build time_, not at _runtime_. Vite is a
`devDependency` of the viewer package and is never embedded in the compiled CLI
binary. The viewer is not compiled with `bun build --compile`. Vite's use in
the viewer is intentional and correct.

## Consequences

**Positive:**
- The compiled binary has no native `.node` binding extraction at startup.
- Preview startup is fast — `Bun.serve` is a one-liner.
- No compile-time regex rewrites for third-party `package.json` reads.
- Any markdown-it plugin from npm works out of the box (they don't use bundlers).

**Negative / trade-offs:**
- The preview server does not support Hot Module Replacement (HMR) for
  individual CSS/JS modules. It does full-page reload on any change. This is
  acceptable because print-md renders a complete `book.html` on every build;
  there is no module graph to update incrementally.
- Contributors who want a Vite-based workflow must use `packages/viewer` (the
  SvelteKit app), not add Vite to the CLI.

## Related upstream issues

- [Embed directory in executable with `bun build --compile` (#5445)](https://github.com/oven-sh/bun/issues/5445)
- [`bun build` does not embed binaries from node_modules correctly (#15374)](https://github.com/oven-sh/bun/issues/15374)
- [`bun build --compile`: `Bun.resolve(..., import.meta.url)` resolves relative to `cwd` (#13405)](https://github.com/oven-sh/bun/issues/13405)
