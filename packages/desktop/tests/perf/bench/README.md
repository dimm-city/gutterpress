# Perf bench fixtures + baselines

Checked-in fixtures and committed baselines for the **advisory** perf gates
(GitHub issue #107). Unlike `tests/perf/.fixture-book/` (generated, gitignored,
used by the throughput `render-gate.mjs`), everything here is committed.

## `novel-50p/`

A ~50-page, **text-only** Gutterpress project (10 deterministic prose chapters +
`themes/novel/theme.css`). Paginates to ~48 pages in the native viewer under the theme's
fixed `@page` box, so page count — and therefore re-render cost — is
reproducible. Consumed by `tests/perf/rerender-latency-gate.mjs`.

- Content is generated deterministically (no `Math.random`) by
  `novel-50p/generate.mjs`. The `.md` output is committed; the generator is kept
  only so the fixture can be retuned reproducibly (`node novel-50p/generate.mjs`).
  It is **not** run by CI.

## `perf-baseline.json`

The committed re-render baseline the gate compares against:

```json
{ "novel-50p": { "rerenderMs": <median-ms>, "measuredAt": "<YYYY-MM-DD>", "note": "..." } }
```

A placeholder (`rerenderMs: 0`, `measuredAt: "pending"`) means *no baseline yet*
— the gate then reports the measured ms with `ratio n/a` and does not flag a
regression.

## Running the re-render gate

Requires the desktop to be **built first** (the gate launches the packaged app,
it does not build it), and a working Electron binary:

```sh
cd packages/desktop
npm run build && npm run electron:build   # once, after any src change
npm run rerender-gate                      # measure + compare, ADVISORY (never fails)
```

The gate prints e.g.:

```
[rerender-gate] median re-render: 210ms (min 198ms, max 240ms, n=4) | baseline 180ms | ratio 1.17x | target ≤300ms
::notice title=Re-render latency::210ms (1.17x baseline, target ≤300ms)
```

It is **advisory**: it always exits 0 and emits `::notice::` / `::warning::`
GitHub annotations, so it never turns a check red. On a headless CI runner with
no `$DISPLAY` it self-wraps in `xvfb-run`.

## Refreshing the baseline (deliberate, maintainer-only)

The baseline only moves when a human intentionally commits it — PR CI never
writes it. To refresh:

```sh
cd packages/desktop
npm run build && npm run electron:build
npm run rerender-baseline    # = rerender-latency-gate.mjs --write-baseline
```

This overwrites `perf-baseline.json` with the freshly measured median +
`measuredAt`. Review the number and commit it.
