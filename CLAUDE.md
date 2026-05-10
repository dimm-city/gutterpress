# CLAUDE.md — guidance for AI coding sessions on this repo

## What print-md ships

A standalone binary built with `bun build --compile` (see `scripts/compile.ts`).
Users download a single executable from GitHub Releases — no Node, no Bun, no
`node_modules` on the host. The CLI also runs from source via `bun src/cli.ts`
during development.

## Architectural rules

These are non-negotiable for any change that touches the runtime or build
pipeline.

### 1. No bundlers at runtime

Do **not** import `vite`, `rollup`, `esbuild`, or any other bundler at runtime
(eager or lazy) inside `src/`. Bundlers carry native bindings, large transitive
graphs, and `package.json`/`__dirname`-relative resolution patterns that break
under `bun build --compile`. Past attempts to ship vite inside the binary
required a compile-time regex plugin to rewrite `JSON.parse(readFileSync(new
URL("../package.json", import.meta.url)))` patterns inside `node_modules` — a
hack we are eliminating.

If you need a dev server with live reload, use **`Bun.serve`** with its built-in
`websocket` upgrade. The historical use case (`src/preview/`) is a static file
server + a "full-reload" websocket message on file change — which is exactly
what `Bun.serve` provides natively in ~150 lines without any bundler.

### 2. Lazy-load heavy optional deps

Anything used by a single subcommand (e.g. `stylelint` in `print-md lint`)
should be imported with a dynamic `import()` inside the command handler, not at
top-level. This keeps `print-md --help` fast and isolates compile failures to
the specific command path.

### 3. Don't add bun-patch files for upstream `package.json` reads

If a third-party package reads its own `package.json` at module load via
`readFileSync(new URL(...))` and breaks under `--compile`, prefer to:

  1. Drop the dep (often it's a bundler we shouldn't be running at runtime
     anyway — see rule 1).
  2. If the dep is essential, add a narrow rewrite to
     `scripts/compile-plugin.ts`. Each rewrite must target one specific file
     path inside `node_modules` and be guarded by the exact source pattern.
  3. Never use `bun patch` — it requires re-patching on every dep version
     bump.

### 4. Embedded static assets are fine

`with { type: "file" }` imports and `src/lib/embedded-assets.ts`'s extraction
pattern are the **canonical** way to ship the viewer chrome (HTML/CSS/JS)
inside the binary. This pattern works under `bun build --compile` and should
not be rewritten.

## Background reading

- ADR `docs/adr/0001-no-bundlers-at-runtime.md`
- [Single-file executable — Bun](https://bun.com/docs/bundler/executables)
- [Embed directory in executable with `bun build --compile` (#5445)](https://github.com/oven-sh/bun/issues/5445)
- [`bun build` does not embed binaries from node_modules correctly (#15374)](https://github.com/oven-sh/bun/issues/15374)
- [`bun build --compile`: `Bun.resolve(..., import.meta.url)` resolves relative to `cwd` (#13405)](https://github.com/oven-sh/bun/issues/13405)
