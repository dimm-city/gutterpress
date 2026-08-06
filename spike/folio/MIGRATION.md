# Migration plan — Paged.js → Folio

The engine question is answered (see [`COMPARISON.md`](./COMPARISON.md) "FINAL
A/B REPORT"): with the confounds removed the two engines agree on pagination to
1.3%, and Folio is the more faithful renderer. What is **not** measured is the
integration cost, and that is now the largest risk in the project.

This plan is ordered so that the first step pays for itself whether or not
Folio is ever adopted.

---

## Step 1 — Four fixes worth making regardless

None of these depends on the Folio decision; all four are defects or wins in
the pipeline shipping today.

| fix | why | evidence |
| --- | --- | --- |
| **Mirrored binding gutters** | The book declares a 0.125in binding offset; Paged.js applies **none**. Inner margins run short on every other page and text creeps toward the spine. | Folio 55pt recto / 46pt verso; Gutterpress 52/53pt either parity (`compare/ab-report.py`) |
| **`generateDocumentOutline`** | Shipped PDFs have no bookmarks; the same DOM printed with the flag yields 155. One line in `pagination.ts`. | COMPARISON.md §A |
| **Scope `filter:`** | ~90% of build time on **both** engines, and it silently rasterizes card text to 300 DPI bitmaps — not selectable, searchable or accessible in the released PDF. | 57.0s → 6.2s over 60pp; [`ENGINE.md`](./ENGINE.md) §10 |
| **Explain the 1.364× scale** | Paged.js typesets the book at a scale its stylesheet never asks for, so every `pt` value in the CSS is a lie and the design is un-reasonable-about. | `body{zoom:1.5}` reproduces Paged.js on 921/921 words ±0.15pt |

The scale item is the gate for everything after it. Do not migrate away from a
mechanism nobody can explain — and it is worth knowing whether it is a Paged.js
behaviour or something in how the pipeline drives it.

---

## Step 2 — Decide the type size, deliberately

Under Folio, `12pt` means 12pt. The tokens become honest, which is the whole
point — but it forces a decision that has been made implicitly until now.

**Do not pick the size by matching today's output.** Every visual judgment in
the book so far was made through a 1.364× distortion, so "what it looks like
now" is not a design decision anyone actually took. At true size, 12pt on the
~7.2in measure is on the small side and 16.4pt is genuinely large; the right
answer is probably between, putting the book somewhere between 200 and 296
pages. Set the tokens from a proof at real size, then accept the page count.

The `body { zoom: 1.5 }` shim in `compare/fg-shim.css` exists **only** to make
A/B measurements comparable. It is deleted on adoption, not migrated.

---

## Step 3 — Time-boxed integration spike (one week, one flag)

The unmeasured risk. Paged.js is referenced in **20+ files under
`packages/cli/src`** and **10+ under `packages/desktop/src`** — preview server,
markdown renderer, marker handling, export controller, error messages, service
worker. Adoption is not swapping `pagination.ts` (596 lines).

**Switch preview and PDF together, behind one flag, per project.** They cannot
move independently: while the scale difference exists, a Folio preview against
a Paged.js PDF would disagree by ~1.5× in page count — worse than today.

### Test subjects: repo examples + purpose-built fixtures, NOT the field guide

The field guide proved the engine question but is the wrong subject for
migration work: it lives in another repo, cannot be modified freely, and its
CSS is coupled to Paged.js's DOM. Use the in-repo examples, and build fixtures
to close the gap between them and real-book complexity.

Measured coverage gap — feature counts in the CSS:

| feature | field guide | `with-design-guide` (largest example) |
| --- | --- | --- |
| `clip-path` | 65 | **0** |
| `filter:` | 16 | **0** |
| `columns:` | 25 | 4 |
| `string-set` | 7 | 2 |
| `target-counter` | 1 | **0** |
| `@page` rules | 24 contexts | 9 |
| `counter-reset` | 16 | — |
| bleed-related | 57 | — |

The examples do not exercise the constructs that actually broke things. A
migration fixture set must cover, each traceable to a finding in this repo:

1. **`filter:` + `clip-path` pairing** — the documented two-layer shadow pattern.
   Confirms rasterization behaviour and build cost (`ENGINE.md` §10).
2. **Full-bleed page background + running heads on every page** — the
   margin-box painting technique, including a tiled texture (`ENGINE.md` §5).
3. **Named pages with `:left`/`:right` mirroring and a binding margin** —
   the gutter defect above; assert the mirror survives.
4. **Front-matter → body folio restart** (roman then arabic from 1) — the one
   known Folio gap; `counter-reset: page` does **not** work in native print
   (`ENGINE.md` §9), so Folio must synthesize it.
5. **Margin-box furniture** — chips with backgrounds and borders; assert
   `transform: rotate()` and `box-shadow` are absent, since neither is
   supported in a margin box (`ENGINE.md` §8).
6. **Cross-references + a TOC with page numbers** — the Tier 3 path.
7. **Multi-column body with `break-inside: avoid` cards** — the density
   difference that accounts for the residual page delta.
8. **Recto/verso chapter starts and `@page :blank`** — not exercised by the
   field guide at all (0 occurrences), but required by real books.

Fixtures should be small enough to build in seconds so they can run in CI, with
one larger "kitchen sink" book for realistic timing.

### Success criteria

- Every fixture: same page count on both engines, or a documented reason.
- `compare/ab-report.py` drift profile stays in constant-offset runs.
- The flag removes Paged.js from the code path entirely for a flagged project
  (no polyfill loaded, no `.pagedjs_*` in the output DOM).
- Blast radius counted honestly: files touched, and anything that had to be
  forked rather than shared.

### Decision gate

Contained ⇒ finish the two Folio gaps (folio restart, predict-then-verify
export) and migrate book by book. Sprawling ⇒ stop; Step 1's four wins are
already banked.

---

## What adoption costs and removes

Honest accounting, measured:

| removed | added |
| --- | --- |
| `pagination.ts` 596 + `pagedjs.ts` 159 + `pagedjs-marker.ts` 50 = **805 lines** | Folio `src/` **4,073 lines** |
| `paged.polyfill.js` **902 KB** shipped to every page | viewer **27 KB** minified |
| 21 repair-layer sites (`data-ref` dedup, `break-inside` handler, unterminated-string repair) | — |
| 19 `.pagedjs_*` selectors + 3 `--pagedjs-*` props **per book, per author** | 0 |

It is **not** a net deletion of first-party lines (+3,268). It is a trade of
un-ownable third-party code for owned code at 33× less shipped weight, plus the
removal of a repair layer that exists only because Paged.js rewrites the DOM,
plus the removal of engine-specific CSS from the author's surface.
