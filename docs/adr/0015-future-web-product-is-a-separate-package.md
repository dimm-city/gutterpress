# ADR 0015 — A future browser product is a separate package, not a mode of the desktop app

Date: 2026-09-01 · Status: accepted · Implemented by: SFE-P5a

> **Closes:** `docs/pwa-webadapter-plan.md` (status-noted CLOSED 2026-09-01,
> kept as history, not resumable). **Related:** ADR 0014 (the editor package
> this future product would actually reuse) and ADR 0017 (the capability
> seam this ADR's deletion made possible).

## Context

`packages/desktop` carried a partially-shipped, intentionally dormant PWA
implementation (issue #33's `WebAdapter`): an in-browser File System Access
folder-open path, in-browser preview, IndexedDB persistence, a service
worker, and a web app manifest, selected at runtime by `getPlatform()`
falling back to `WebAdapter` off-Electron. It existed to keep a future
browser product "for later" inside the same package as the Electron app.

That design never paid for itself and actively cost correctness: because
`WebAdapter` was a real fallback path, any renderer code that accidentally
value-imported Node-oriented lib code could build and even boot under
`vite dev` — masking exactly the class of defect the render-purity gate
exists to catch (root `CLAUDE.md` §8's `fileURLToPath is not a function`
incident). A dormant second host implementation is not a neutral
placeholder; it is untested code with its own filesystem, persistence, and
service-worker surfaces that must stay correct without a product driving
it, and a silent fallback that hides a real host being unavailable.

## Decision

**A future browser product is not implemented inside `packages/desktop`**
(plan D10). `WebAdapter`, `web-fs.ts`, `web-store.ts` (including
`InMemoryWebStore`), the service worker (`src/service-worker.ts`) and its
registration, and every PWA-only test and dead-code exemption were deleted
outright in P5a — not stubbed, not feature-flagged off. `getPlatform()`
(itself later deleted per ADR 0017) stopped falling back to a web
implementation and instead threw `DesktopHostRequiredError` off-Electron:
failing loudly and immediately beats silently selecting a partial product.

**When a web product is built, it is a new, separate package** — the plan
names it explicitly: built against `@dimm-city/gutterpress-editor` (ADR
0014) and `gutterpress/render` (ADR 0012) as its public surfaces, from
scratch, rather than by finishing `WebAdapter`. Nothing in this deletion
touches the *renderer/host split* requirement that makes such a package
possible later: the desktop SPA still contains zero platform/host code and
reaches every host capability through the one typed-IPC seam (root
`CLAUDE.md` §8, unaffected by `WebAdapter`'s removal) — that split is an
architecture requirement about renderer/host separation, independent of
whether a PWA ever ships from `packages/desktop`.

## Consequences

- `packages/desktop` is unambiguously an Electron-only product. There is no
  dormant second host implementation for a change to accidentally
  reactivate or drift out of sync with the real one.
- Net measured deletion: 19 files, +92/−2,638 lines (`5db8c581`), split
  ~1,517 net production lines and ~1,029 net test lines — the deletion
  ledger's SFE-P5a entry carries the full file-by-file accounting and
  search proofs (`WebAdapter`/`web-fs`/`web-store`/service-worker → zero
  runtime occurrences).
- A future web package starts from `@dimm-city/gutterpress-editor` and
  `gutterpress/render` — both already framework-free and Node-free
  respectively (ADR 0012, ADR 0014) — rather than inheriting
  Electron-shaped assumptions baked into a resurrected `WebAdapter`.
- Several source comments in `packages/desktop/src/**` still cite "ADR
  0004" (platform abstraction) by a number that does not exist in this
  repository — a pre-existing gap (confirmed absent before this plan
  began; see ADR 0009's "Note on predecessors"). This ADR and ADR 0017 are
  the current record for that topic; the dangling in-source citations
  themselves are frozen source outside this run's write ownership and are
  recorded, not silently left unmentioned (deletion ledger, SFE-P5a "ADR
  statusing").

## Alternatives rejected

- **Keep `WebAdapter` dormant "for later"** — rejected explicitly by plan
  non-goal ("no retained PWA abstraction 'for later'. A future web product
  gets a dedicated host package") and by the concrete incident above: a
  dormant fallback is not free, it actively weakens the render-purity gate
  it coexists with.
- **Finish `WebAdapter` into a real PWA now** — out of scope for 0.11.0 (plan
  "out of scope: shipping a browser PWA in 0.11.0") and would have meant
  building a second host adapter against the desktop's pre-rich-editor
  architecture, immediately stale once ADR 0012/0014's editor package
  landed.
- **A generic host abstraction covering Electron and a hypothetical browser
  host simultaneously** — rejected by the same reasoning as ADR 0017's
  rejection of a broad service locator: a seam justified by a host that
  does not exist yet is speculative abstraction, not a boundary a real
  consumer needs today.
