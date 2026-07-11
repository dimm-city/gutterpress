# ADR 0002: PDF rendering and pure-JS PDF/asset tooling

> **Note:** reconstructed 2026-07-11 from in-repo citations; original ADR
> lost. This document was rebuilt from the surviving `(ADR 0002 …)` comments
> across the codebase (see "Sources" below) rather than from a preserved
> original record. Treat it as an honest best-effort summary, not a verbatim
> restoration.

## Status

Accepted (as evidenced by the shipped implementation).

## Context

print-md needs to (1) render a staged HTML + CSS book to a print-ready PDF via
a Chromium engine, and (2) inspect and validate the resulting PDF and its
embedded images for the post-build check system — all while satisfying two
constraints elsewhere in this repo:

- **§1/§3 (`CLAUDE.md`):** the CLI must stay a self-contained `bun build
  --compile` binary. Dependencies that read their own `package.json` at
  runtime, or that load code via a computed-path dynamic `import()`, cannot be
  embedded and must be dropped or avoided.
- **The packaged Electron viewer already ships a full Chromium** (it *is*
  Electron). Spawning a second, separately-resolved Chromium via
  `puppeteer-core` for PDF export in that context is redundant weight and an
  extra "no Chromium found" failure mode non-technical users would hit.

## Decision

1. **HTML → PDF rendering (default, CLI/library):** drive a system/bundled
   Chromium via `puppeteer-core` (`packages/cli/src/lib/build-runner.ts`).
   Chosen over Prince XML, Playwright, and a `pagedjs-cli` subprocess because
   it is open-source and cross-platform, supports full CSS Paged Media,
   ships no bundled browser itself (print-md resolves a system/bundled
   Chromium — see `packages/cli/src/lib/chromium.ts`), and gives direct
   in-process PDF generation via `page.pdf()` with no subprocess overhead.
2. **HTML → PDF rendering (packaged Electron viewer, Phase 4):** inject an
   alternative `PdfRenderer` that uses Electron's **own** bundled Chromium — a
   hidden `BrowserWindow` + `webContents.printToPDF` — instead of spawning an
   external Chromium via puppeteer (`packages/viewer/electron/pdf-export.ts`).
   This drops the external-browser dependency for PDF export in the packaged
   app with zero added bytes and full Paged.js fidelity, at the cost of that
   renderer being Electron-only code. It is injected into the shared lib's
   `runBuild` as a `pdfRenderer` override, so the staging/serving/wait-for-
   Paged.js algorithm (`createStaticFileServer` + the render/measure/print
   sequence in `build-runner.ts`) is implemented once and shared by both
   renderers — only the final "drive a browser page and print" step differs.
   Escape hatch: `PRINTMD_VIEWER_PUPPETEER=1` falls back to the lib's default
   puppeteer renderer.
3. **Post-build PDF inspection (validation checks):** replace the Poppler
   suite (`pdfinfo`/`pdffonts`/`pdfimages`/`pdftotext`) and general `qpdf`
   structure inspection with an in-process, pure-JS reader —
   [`unpdf`](https://www.npmjs.com/package/unpdf), a serverless-tuned PDF.js
   build (`packages/cli/src/lib/pdf-inspect.ts`). Unlike raw `pdfjs-dist`
   (whose `legacy` build eagerly evaluates canvas/DOMMatrix code), `unpdf`
   bundles cleanly under `bun build --compile` and has zero system
   dependency. Accepted fidelity trade-offs:
   - `isLoadable` is a "does it parse" gate, not a deep `qpdf --check` of
     xref/stream-length integrity.
   - Image DPI is derived from decoded pixel size ÷ placed size and is
     therefore best-effort.
   - Bleed-box reads fall back to a raw-byte scan because `pdfjs` exposes no
     `TrimBox`/`BleedBox` accessor.
4. **External tools kept where no pure-JS equivalent exists:** Ghostscript
   (`gs`) for ink-coverage measurement and PDF/X CMYK conversion
   (`packages/cli/src/lib/ghostscript.ts`), and `qpdf` for PDF/X
   `OutputIntent`/`DOCINFO` structure checks — `qpdf` is already mandatory
   whenever PDF/X output is requested, so this adds no new tool dependency for
   the common (non-PDF/X) path. These are resolved via `execCapture` at
   validation time, not embedded in the binary.
5. **Asset checks (image inspection):** read image headers (size, DPI, color
   space) with a small dependency-free header parser
   (`packages/cli/src/lib/image-inspect.ts`) instead of shelling out to
   ImageMagick's `identify`, for the same "no computed-path resolution at
   runtime" reason as (3) — see `CLAUDE.md` §1/§3 (labeled `ADR 0001` in that
   file's own comments).

## Consequences

- Production PDFs built from the CLI/library entry point always go through
  `puppeteer-core` + a resolved Chromium (`chromium.ts`, `browser-pool.ts`).
- The packaged viewer's PDF export is faster and has one fewer external
  dependency to resolve, but its renderer is Electron-specific code
  (`electron/pdf-export.ts`), not part of the published library.
- The check system's PDF/image inspection has zero system dependency for the
  vast majority of checks; Ghostscript and `qpdf` remain the two accepted
  exceptions, tracked as a "separate, pre-existing concern" in `CLAUDE.md` §7.
- `pdf-parse.ts`, `pdf-inspect.ts`, and `image-inspect.ts` each carry their own
  "why not tool X" rationale inline — this ADR is the single place that ties
  those individual decisions together as one coherent choice.

## Sources

Reconstructed from citations in: `CLAUDE.md` (Monorepo layout section),
`packages/cli/src/lib/build-runner.ts`, `packages/viewer/electron/pdf-export.ts`,
`packages/cli/src/lib/pdf-inspect.ts`, `packages/cli/src/lib/pdf-parse.ts`,
`packages/cli/src/lib/ghostscript.ts`, `packages/cli/src/lib/image-inspect.ts`,
`packages/cli/src/checks/pdf/image-resolution.ts`,
`packages/cli/src/checks/pdf/qpdf-structure.ts`,
`examples/print-md-user-guide/08-system-setup.md`.
