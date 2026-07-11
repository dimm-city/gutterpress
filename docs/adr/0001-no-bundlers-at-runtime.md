# ADR 0001: No bundlers at runtime; self-contained compiled binary

> **Note:** reconstructed 2026-07-11 from in-repo citations; original ADR
> lost. Rebuilt from the surviving `(ADR 0001 …)` comments (see "Sources")
> and the normative text in `CLAUDE.md` §1/§3, which carries the full,
> maintained statement of this rule. Treat this file as a pointer plus
> summary, not a verbatim restoration.

## Status

Accepted. The maintained, binding statement lives in `CLAUDE.md`
(Architectural rules §1 "No bundlers at runtime" and §3 "Keep the binary free
of deps that need filesystem resolution at runtime").

## Context

print-md ships as a standalone single-file executable built with
`bun build --compile`. Runtime dependencies that carry native bindings, read
their own `package.json`/data files at runtime, or load modules via
computed-path dynamic `import()` break inside the compiled binary's `/$bunfs/`
virtual filesystem.

## Decision

- Never import `vite`, `rollup`, `esbuild`, or any other bundler at runtime
  (eager or lazy) inside `packages/cli/src/`.
- The preview server is a plain `node:http` + `ws` server (Node-compatible so
  Electron's bundled Node can run the same code — see `CLAUDE.md` §1 for the
  current dev-server guidance).
- Dependencies that require filesystem resolution at runtime are dropped or
  replaced with pure-JS alternatives (stylelint → postcss is the recorded
  precedent).
- Pure-JS/self-contained parsing is preferred over external tools where
  practical (e.g. `image-inspect.ts` reads image headers directly instead of
  requiring an ImageMagick-style dependency).

## Consequences

- The compiled binary needs zero `node_modules` on the user's machine.
- Embedded static assets use `with { type: "file" }` imports
  (`CLAUDE.md` §4).
- New dependencies must be vetted against `bun build --compile`
  compatibility before adoption.

## Sources

- `CLAUDE.md` §1, §3 (normative text)
- `packages/cli/src/preview/http-server.ts` header
- `packages/cli/src/lib/image-inspect.ts` header
