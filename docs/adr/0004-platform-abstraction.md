# ADR 0004: Platform abstraction — the renderer is host-agnostic

> **Note:** reconstructed 2026-07-11 from in-repo citations; original ADR
> lost. `CLAUDE.md` §8 and dozens of `§8 / ADR 0004` comments across
> `packages/desktop/src/` cite this document, but no ADR file existed anywhere
> in the repo. This reconstruction treats `CLAUDE.md` §8 as the living,
> binding statement of the rule and summarizes the decision and its history;
> §8 remains the source of truth for the current recipe (it is updated more
> often than an ADR should be).

## Status

Accepted. Enforced by `tools/check-render-purity.mjs` (desktop client bundle)
and `packages/cli/scripts/check-render-pure.mjs` (lib `render.ts` entry).

## Context

The desktop app is an Electron desktop app with a SvelteKit SPA frontend. Two
failure modes motivate treating the renderer/host boundary as a hard rule
rather than a convention:

1. **The renderer can accidentally bundle host code.** A *value* import of
   `gutterpress` (as opposed to `import type`) drags the Node-target
   library — and its transitive `fileURLToPath`/`node:*`/`postcss`/
   `isomorphic-git` code — into the browser bundle. Vite shims `node:*` well
   enough that the build succeeds, but the code **crashes at runtime** in the
   browser. This exact mistake shipped a `500` / `fileURLToPath is not a
   function` crash in `0.4.0-beta.4`.
2. **The team wants the SPA to be portable to a browser PWA** (tracked as
   issue #33) without a rewrite. That is only possible if the SPA never
   assumes an Electron host is present — every host capability must be
   reached through a seam that has (or can grow) a non-Electron
   implementation.

## Decision

- The renderer (everything under `packages/desktop/src/`, compiled to
  `build/client/`) contains **zero** platform/host code: no runtime
  `gutterpress` value imports, no `node:*`/`fs`/`path`/`url`/
  `child_process`/`postcss` imports.
- Host capabilities are reached through **two** seams, chosen by capability
  class (see `CLAUDE.md` §8 for the current, authoritative recipe — this ADR
  intentionally does not duplicate step-by-step instructions that are
  expected to keep evolving):
  1. **Server routes (default):** `src/routes/api/**/+server.ts` — real Node
     work, called from the SPA with `fetch("/api/...")` through a typed
     `src/lib/api.ts` wrapper. This is host Node code that happens to live
     under `src/routes/`; SvelteKit's `adapter-node` build keeps it out of
     the client bundle by construction.
  2. **The `Platform`/`HostServices` adapter** (`src/lib/platform/contract.ts`
     + `ElectronAdapter`/`WebAdapter`, reached via `getPlatform()`) — reserved
     for capability classes a plain route can't cover: push-event streams,
     calls that must drive a live `BrowserWindow`, and File System
     Access-divergent fs primitives.
- Either seam is verified mechanically, not just by convention: the client
  bundle (`build/client/`) is scanned for the named leak identifiers
  (`fileURLToPath`, `createRequire`, `isomorphic-git`), any quoted `node:*`
  specifier, or a bare builtin `require()`. A hit is release-blocking.
- The rule applies to "every Electron application started in this org" per
  `CLAUDE.md` §8's alert — it is adopted as the default pattern for new
  Electron apps in general, not a Gutterpress-specific workaround.

## Consequences

- The renderer can, in principle, run unmodified as a browser PWA once #33
  schedules the work — `WebAdapter` already carries a dormant, partial
  implementation of several capabilities (recents/favorites/desktop-prefs via
  IndexedDB, settings via `localStorage`, File System Access primitives) kept
  specifically so that migration has a starting point.
- The split adds ceremony for a small number of capabilities (adapter +
  contract + both implementations, vs. a route + one wrapper), which is why
  the route-first path is the default and the adapter is reserved for the
  three capability classes it genuinely owns — see `CLAUDE.md` §8.
- Because Rollup tree-shaking can hide an unreachable leak from the
  production purity scan while `vite dev` (no tree-shaking) still crashes on
  it, the lib side (`packages/cli`) carries an independent, non-split build +
  scan of `src/render.ts` so a leak is caught even if the desktop-side
  production scan misses it.

## Sources

Reconstructed from `CLAUDE.md` §8 and the `§8 / ADR 0004` comments in:
`packages/desktop/src/lib/platform/{contract,web-adapter,web-fs,web-store,
 paths,shared-types}.ts`, `packages/desktop/src/service-worker.ts`,
`packages/desktop/src/lib/editor/snippet-vars.ts`,
`packages/desktop/src/lib/{api,dialog,errors,format}.ts`,
`packages/desktop/src/lib/{update,export}/*-controller.svelte.ts`,
`packages/desktop/src/lib/routes/*-controller*.ts`,
`packages/desktop/electron/{main.ts,preload.ts,types.d.ts}`,
`packages/cli/src/render.ts`, `packages/cli/src/lib/markdown/{assemble,
renderer}.ts`, `packages/desktop/tests/recovery/*.test.ts`.
