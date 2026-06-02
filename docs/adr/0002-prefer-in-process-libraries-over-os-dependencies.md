# ADR 0002 — Prefer in-process libraries over OS dependencies

**Status:** Proposed (2026-06-01)
**Supersedes / relates to:** ADR 0001 (No bundlers at runtime)
**Research:** [`docs/os-dependency-replacement-research.md`](../os-dependency-replacement-research.md)

## Context

print-md shells out to a number of operating-system tools via
`packages/lib/src/lib/exec.ts` (`execCapture` / `run`). The full inventory lives
in `packages/lib/src/lib/diagnostics.ts`:

- **Rendering:** Chromium / Chrome / Edge (via puppeteer-core)
- **PDF post-processing:** qpdf, Ghostscript (`gs`)
- **PDF inspection (validation):** Poppler (`pdfinfo`, `pdffonts`, `pdfimages`,
  `pdftotext`), qpdf (`--check`, `--list-all-objects`, `--json=1`), `grep`
- **Image inspection (validation):** ImageMagick (`identify`)
- **Source linting:** `markdownlint-cli2`, `htmlhint`

Every one of these is a separate install the user must perform (`brew install`,
`apt install`, Chocolatey, manual PATH setup). For a tool whose stated primary
goal is *"Create a way for non-technical writers to easily publish print
materials"*, requiring a non-technical user to install Poppler and ImageMagick
from a GitHub releases page and add `bin/` to PATH is a direct contradiction.

The optional checks degrade gracefully — `tool-check.ts` skips any check whose
`requiredTools` aren't on PATH and logs a warning. But "silently skipped" means
a non-technical user gets *no* print-safety validation and never knows why.

A 2026 survey of the npm/WASM ecosystem (see the research doc) found that the
**majority** of these tools now have viable in-process replacements that need no
system install.

## Decision

**When an OS dependency can be replaced by a pure-JS or self-contained-WASM
library that bundles cleanly under `bun build --compile` and Electron, prefer
the in-process library** — even at a modest cost in bundle size — *provided it
does not reintroduce the runtime-filesystem-resolution failure modes ADR 0001
exists to prevent.*

This decision establishes a priority order and a set of guardrails; it does
**not** mandate replacing every tool at once (see phasing below).

### Priority order for any external-tool dependency

1. **Pure-JS library or Node built-in** — always preferred. Zero system dep,
   bundles trivially. (grep, markdownlint, htmlhint, PDF inspection via PDF.js.)
2. **Native library with prebuilt binaries** (e.g. `sharp`) — acceptable in the
   **viewer** (Electron, with `asarUnpack`) but **NOT** in the compiled CLI
   binary, because its `@img/*` optional-dep path resolution is exactly the
   failure mode ADR 0001 forbids.
3. **Self-contained WASM** — acceptable only after verifying it loads under
   `bun build --compile` (the Bun `--compile` WASM-load bug
   [#18145](https://github.com/oven-sh/bun/issues/18145) disqualifies some WASM
   packages) **and** its license is compatible (several are AGPL).
4. **System tool, kept optional and lazy** — the fallback when no viable
   in-process option exists (Ghostscript PDF/X CMYK conversion; the Chromium
   render engine).

### Guardrails (inherited from ADR 0001)

- No new dependency may read its own `package.json`/data files at runtime, use
  `createRequire` for JSON, or use computed-path dynamic `import()`. These break
  under `--compile`.
- Heavy or optional-path deps must be **lazy-loaded** at the command/check call
  site, never at import time.
- A native dep (`sharp`) is confined to the viewer; the CLI uses a pure-JS path.

### Two dependencies are explicitly NOT removable

- **Chromium** cannot be removed without abandoning Paged.js, which by design
  runs inside a live browser DOM. The achievable goal is removing the *system*
  requirement (bundled Playwright Chromium for browserless environments; the
  viewer rendering via its own Electron Chromium), not removing the engine.
- **Ghostscript PDF/X CMYK conversion** has no pure-JS equivalent. It stays an
  optional feature backed by a system `gs` or an opt-in WASM gs (pending an
  AGPL decision).

## Consequences

### Positive

- The **default RGB pipeline and all validation checks** can run with **zero
  system dependencies** once phases 1–3 land. A non-technical user installs one
  thing (a browser they likely already have) instead of five.
- Checks **stop silently skipping.** Print-safety validation runs everywhere,
  which is the whole point of having the checks.
- Diagnostics (`diagnostics.ts`, the Help/About dialog) shrink to the two
  genuinely-external dependencies (browser, optional gs), making the system
  requirements honest and short.

### Negative

- Bundle size grows modestly (`pdfjs-dist`/`unpdf` ≈ 2–35 MB source; pure-JS
  image libs are small). Mitigated by lazy-loading per check.
- Two checks lose fidelity vs. their CLI tool: `qpdf --check` (no pure-JS
  parity — degrades to a "does it parse" gate) and image DPI (best-effort via
  content-stream transform math). These can stay optional-system-tool if strict
  parity is required.
- `markdownlint-cli2` / `htmlhint` move from devDependencies to runtime deps of
  the lib (using the `markdownlint` core lib + `htmlhint` programmatic API),
  which means they now ship — resolving the "viewer devDeps don't ship" gating
  hack for these two.

### Neutral

- `requiredTools` on migrated checks is dropped; those checks always run. The
  `tool-check.ts` mechanism stays for the remaining system tools (gs, qpdf for
  PDF/X, the Poppler/ImageMagick checks until they migrate).

## Phasing

1. **Phase 1 (free wins):** grep → `node:fs`; markdownlint-cli2 → `markdownlint`
   lib; htmlhint CLI → `htmlhint` lib. No fidelity loss, removes 2 system deps.
   See [`docs/phase-1-os-dependency-removal-plan.md`](../phase-1-os-dependency-removal-plan.md).
2. **Phase 2 (PDF inspection):** Poppler + qpdf-inspection checks → `pdfjs-dist`
   / `unpdf`. Accept degraded `qpdf --check` and DPI, or keep those optional.
3. **Phase 3 (images):** `sharp` in the viewer; pure-JS combo in the CLI; image
   ink-coverage gated behind optional sharp.
4. **Phase 4 (hard deps, decision required):** opt-in WASM gs for PDF/X (after
   AGPL sign-off + PDF/X smoke test); Playwright hermetic Chromium for
   browserless CLI use; viewer renders via Electron's own Chromium.

## Sources

See [`docs/os-dependency-replacement-research.md`](../os-dependency-replacement-research.md)
for the full per-tool evaluation with pros/cons, confidence levels, and citations.
</content>
