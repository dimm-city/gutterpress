# ADR 0001 — No bundlers at runtime

**Status:** Accepted (2026-05-10)
**Branch:** `claude/setup-install-examples-x23PJ`

## Context

print-md ships as a standalone binary produced by `bun build --compile`. Users
download a single executable from GitHub Releases — no Node, no Bun, no
`node_modules` required on the host.

Previously, `src/preview/vite-setup.ts` used Vite as the live-reload dev server
behind `print-md preview`. To make that survive `--compile`, the team
accumulated:

- A compile-time bundler plugin (`scripts/compile-plugin.ts`) that
  regex-rewrites `JSON.parse(readFileSync(new URL("../package.json",
  import.meta.url)))` patterns inside Vite's and Stylelint's source files,
  because `bun --compile` resolves `import.meta.url` to a path inside
  `/$bunfs` where the relative `package.json` no longer exists.
- A list of native externals (`lightningcss`, `fsevents`) excluded from the
  bundle because Vite drags in optional native bindings that have no JS
  fallback under `--compile`.
- A dynamic `import('vite')` inside `createConfiguredViteServer` so that
  importing it eagerly didn't crash `print-md preview --help`.
- Two custom Vite plugins (`raw-css`, `css-full-reload-on-change`) that exist
  solely to *bypass* Vite's CSS-as-JS-module pipeline and module graph — i.e.
  to undo Vite's bundling behavior on every CSS request.

Recent commit history (`aa63b6f`, `f00be56`, `e421634`, etc.) shows this fight
has been ongoing.

## Decision

**Vite, Rollup, and any other bundler must not be imported at runtime.**

Replace the Vite-based preview server with a Bun-native server using
`Bun.serve` and its built-in WebSocket upgrade. The actual feature surface
needed is small:

- Static file serving from a temp directory
- Custom `/api/*` route handlers (already exist in `src/preview/routes.ts`)
- A WebSocket channel that broadcasts a `{ type: "full-reload" }` message
  when the file watcher fires
- A tiny client snippet (~10 lines) injected into the viewer that listens on
  that WebSocket and reloads on the message

This is roughly 150 lines of code and removes ~50 MB of transitive deps from
the bundle.

Stylelint stays — it's a real linter doing real work in
`src/lib/lint-runner.ts` — but it is **lazy-loaded** at the call site of
`runLint()` so it isn't on the import-time hot path. The narrow regex rewrite
for `stylelint/lib/utils/FileCache.mjs` may stay until we find a cleaner
sidestep.

## Consequences

### Positive

- **Smaller binary, faster startup.** No Vite, no Rollup, no Lightning CSS,
  no Connect, no on-disk extraction of native `.node` bindings at startup.
- **`scripts/compile.ts` simplifies dramatically** — the `lightningcss`,
  `fsevents` externals and the Vite-targeted regex rewrite all go away.
- **The two anti-Vite Vite plugins delete themselves.** `raw-css` and
  `css-full-reload-on-change` are workarounds against the very tool we're
  removing.
- **No "ship a runtime tarball alongside the binary" complexity** — that
  alternative path was considered and is now unnecessary.

### Negative

- The preview server loses Vite's HMR module graph for JS/TS edits to the
  viewer chrome. Acceptable: the viewer chrome is shipped as
  pre-built embedded assets (`src/assets/preview/`), not edited live during
  `print-md preview` use.
- We own the dev-server code instead of inheriting Vite's. ~150 lines of
  surface; the routes, file-watcher, and middleware split stays the same.

### Neutral

- The `connect`-style middleware shape in `src/preview/api-middleware.ts`
  becomes a Bun-native `(req: Request) => Response` shape. The handlers in
  `src/preview/routes.ts` already operate on `Request`/`Response`, so the
  middleware glue actually shrinks.

## Sources

- [Single-file executable — Bun](https://bun.com/docs/bundler/executables)
- [Embed directory in executable with `bun build --compile` — oven-sh/bun#5445](https://github.com/oven-sh/bun/issues/5445)
- [`bun build` does not embed binaries from node_modules correctly — oven-sh/bun#15374](https://github.com/oven-sh/bun/issues/15374)
- [`bun build --compile`: `Bun.resolve(..., import.meta.url)` resolves relative to `cwd` — oven-sh/bun#13405](https://github.com/oven-sh/bun/issues/13405)
- [Compile the worker with `import.meta.url` doesn't work — oven-sh/bun#16869](https://github.com/oven-sh/bun/issues/16869)
- [Using Bun Compile/Build to embed an Express / Vite / Vue Application into a Binary — calumk on dev.to](https://dev.to/calumk/using-bun-compilebuild-to-embed-an-express-vite-vue-application-1e41)
  — confirms the pattern: when a "Vite + Bun --compile" combination is shipped,
  Vite is run **at print-md build time** to produce static output, not at
  runtime inside the binary.
