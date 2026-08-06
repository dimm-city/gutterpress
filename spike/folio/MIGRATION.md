# Migration plan — Paged.js → Folio

The engine question is answered (see [`COMPARISON.md`](./COMPARISON.md) "FINAL
A/B REPORT"): with the confounds removed the two engines agree on pagination to
1.3%, and Folio is the more faithful renderer. Verified twice — the numbers
reproduce **exactly** on `release/0.10.0` (byte-identical extracted text for
both engines). What is **not** measured is the integration cost, and that is
now the largest risk in the project.

This plan is ordered so that the first step pays for itself whether or not
Folio is ever adopted.

---

## Decisions already made — do not re-litigate

These were ratified by the project owner (2026-08-05/06). If work seems to
conflict with one of them, the work is wrong, not the decision.

1. **The `zoom: 1.5` shim is NOT carried forward. Ever.** It exists solely to
   make A/B measurements comparable and is deleted on adoption. The permanent
   fix is **adjusting the CSS tokens** to the sizes the team actually wants, so
   that `pt` values mean what they say. Depending on a "mysterious zoom" was
   explicitly rejected. See Step 2 for how the new sizes get chosen, and
   [`ENGINE.md`](./ENGINE.md) §9 for what the 1.5× actually is.
2. **The reflow is accepted.** Retuning the tokens will change the page count
   from today's 296 printed pages toward wherever the honest sizes land
   (200–296). That is expected, not a regression.
3. **Guiding priorities, in order: output quality, standards compliance /
   WYSIWYG (the HTML+CSS means what it says), and DX.** When a trade-off
   appears, resolve it toward these. This is why the zoom was rejected and why
   Folio's fidelity wins over Paged.js's familiarity.
4. **Step-3 subjects are the in-repo examples plus purpose-built fixtures — not
   the field guide.** The field guide lives in another repo, cannot be modified
   freely, and its CSS is coupled to Paged.js's DOM. It remains the *reference*
   for realistic complexity; it is not the test bed.
5. **Preview and PDF switch together, per project, behind one flag.** Never
   independently — a Folio preview against a Paged.js PDF disagrees by ~1.5×
   in page count while the old scale exists, which is worse than today.

---

## Step 1 — Four fixes worth making regardless

None of these depends on the Folio decision; all four are defects or wins in
the pipeline shipping today.

| fix | why | evidence |
| --- | --- | --- |
| **Mirrored binding gutters** | The book declares a 0.125in binding offset via `var(--binding-margin, …)`; Paged.js silently drops that declaration. Root-caused to Paged.js itself (not `packages/cli`) — see below. Not fixed; documented. | Folio 55pt recto / 46pt verso; Gutterpress 52/53pt either parity (`compare/ab-report.py`) |
| **`generateDocumentOutline`** | Shipped PDFs have no bookmarks; the same DOM printed with the flag yields 155. One line in `pagination.ts`. | COMPARISON.md §A |
| **Scope `filter:`** | ~90% of build time on **both** engines, and it silently rasterizes card text to 300 DPI bitmaps — not selectable, searchable or accessible in the released PDF. | 57.0s → 6.2s over 60pp; [`ENGINE.md`](./ENGINE.md) §10 |
| **Explain the 1.364× scale** | Paged.js typesets the book at a scale its stylesheet never asks for. Root-caused (not just reproduced): triggered by `@font-face` rules appearing BEFORE `:root`/the rest of the stylesheet — the field guide's own authoring order. Confirmed Paged.js-internal (not `packages/cli`); not fixed, documented. | `body{zoom:1.5}` reproduces Paged.js on 921/921 words ±0.15pt; `ENGINE.md` §9 |

The scale item is the gate for everything after it. Do not migrate away from a
mechanism nobody can explain — and it is worth knowing whether it is a Paged.js
behaviour or something in how the pipeline drives it. **Answered**: it is a
Paged.js behaviour, triggered by `@font-face` rule order — see
[`ENGINE.md`](./ENGINE.md) §9 for the isolated trigger condition and the
fixture matrix that confirms it.

### Mirrored binding gutters — root cause (Paged.js, not `packages/cli`)

Investigated in `packages/cli`: `pagination.ts` drives the polyfill with
`page.setViewport`/`page.goto`/`page.pdf({ margin: 0, … })` and never touches
`@page` margins itself; `pagedjs.ts` only injects the polyfill `<script>` and a
`break-inside` handler, never rewrites CSS. Two fixtures, run through the exact
shipped `renderHtmlToPdf()` path, isolate the cause to the vendored polyfill:

1. A fixture with **literal** `@page :left { margin-left: 1in; margin-right: 0.5in }`
   / `@page :right { margin-left: 0.5in; margin-right: 1in }` mirrors correctly
   end-to-end — measured recto/verso left text edges 36pt / 72pt against
   declared 0.5in/1in (both exact). The same declarations, run through
   `examples/with-design-guide/book-01` via the real `gutterpress build` CLI
   (its `design-guide/styles/guide.css` already declares `@page :left`/`:right`
   with literal `0.75in`/`1in`), also mirror correctly: 54pt / 72pt.
2. The field guide's actual `page-rules.css` (read-only, from a local checkout
   used only for measurement) expresses the binding side as
   `margin-right: var(--binding-margin, 0.75in)` / `margin-left: var(--binding-margin, 0.75in)`
   — a **custom-property function**, not a literal length. Reproducing only
   that one change (literal → `var(--binding-margin, 1in)`, with
   `--binding-margin: 1in` on `:root`) in the same fixture, through the same
   shipped code path, reproduces the defect: the `var()`-declared side is
   silently **dropped**, not fallback-substituted — the page falls through to
   the base (unmirrored) `@page` margin instead. Measured: recto (literal
   `margin-left: 0.5in`) still correct at 36pt; verso (`var()` side) lands at
   54pt, which is the fixture's **base `@page` `margin-right/left: 0.75in`**,
   not the declared `1in`, not even the `var()`'s own `0.75in` fallback text.

The mechanism, confirmed by reading the vendored source
(`packages/cli/src/assets/vendor/paged.polyfill.js`): the `@page` declaration
walker (`parsed.margin[m] = declaration.value.children.first();`, ~line 28123)
takes the first CSS value node of a longhand `margin-*` declaration without
checking its type. For `margin-left: var(--binding-margin, .75in)` that node is
a `Function` (`var`), not a `Dimension`. `addMarginVars()` (~line 28499) then
guards on `typeof margin[m].value !== "undefined"` — a `Function` node has no
`.value` — so the declaration is dropped outright: no `--pagedjs-margin-*`
override is emitted for that side, and the page inherits the base `@page`
value instead. Verified directly in a real field-guide PDF's serialized
`book.html`: `.pagedjs_left_page{--pagedjs-margin-left:0.625in}` and
`.pagedjs_right_page{--pagedjs-margin-right:0.625in}` — each rule overrides
**only the side declared as a literal length**; the `var()`-declared side is
absent from both rules, so both parities fall back to the base `@page`'s
`0.625in`/`0.625in` — which is exactly the near-symmetric 52/53pt measured by
`ab-report.py` (45pt page-box margin + normal glyph inset).

This is a Paged.js defect in its own `@page` AST parser, not a `packages/cli`
driving-code defect — literal-valued mirrored margins already work correctly
end-to-end today. Per this task's instructions, it is **documented, not
patched**: a fix would mean either forking the vendored polyfill (ruled out) or
adding a bespoke CSS custom-property resolution pass to `packages/cli` solely
to work around a parser gap in code already slated for removal — a new
repair-layer for a shrinking-lifetime dependency, working against the "reduce
complexity" mandate. Authors can work around it today by giving `@page
:left`/`:right` margin declarations literal values (no `var()`); Folio does not
have this limitation (see `ENGINE.md` §3, which documents Folio's own
unrelated cascade-order cause of the same *symptom*).

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
A/B measurements comparable. **Decision 1 above: it is deleted on adoption,
never migrated, and no production stylesheet may contain it.** The furniture
half of that shim (brick via margin boxes, chips, suppressions) is different —
it becomes the *starting point* for the field guide's real Folio CSS when that
book eventually migrates.

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
   (`ENGINE.md` §8), so Folio must synthesize it.
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

## Pitfalls — every one of these cost real time in the spike

Measurement traps (they produce convincing wrong answers):

- **`pdftotext` word counts are meaningless on this design language.** Any
  `filter:`ed subtree is rasterized — its text is a picture ([`ENGINE.md`](./ENGINE.md)
  §10). This once produced "168 near-blank pages" that were fully typeset
  cards. Use glyph bounding boxes (`pdftotext -bbox`) on unfiltered content,
  rasters, and `compare/ab-report.py`.
- **PDF page parity ≠ printed page parity.** Gutterpress restarts folio
  numbering after front matter, offsetting the two by 5. A gutter-mirroring
  check keyed to PDF parity gives the wrong verdict; key to the *printed*
  number (ab-report does both).
- **A same-page percentage is not an agreement metric on its own.** The
  engines sit at 4.7% "same page" while agreeing almost everywhere — the delta
  is a few long constant-offset runs, one insertion shifting hundreds of
  anchors. Read the drift *profile*, not the headline number.
- **"Inert" markup is a claim to verify, not assume.** Adding `id`s once
  renumbered every chapter (`h1[id]` was real theme CSS); 0.10.0's
  `data-source-*` attributes were confirmed inert only by stripping them and
  diffing to byte-identity.
- **`CSS.supports` lies** for GCPM features — render-probe instead
  ([`ENGINE.md`](./ENGINE.md) §2). And the engine is **pinned to Chromium 151**
  (`REQUIRED_MILESTONE`); a milestone bump is a code change, re-run the spikes.

Engine behaviours that will bite an implementer:

- **`zoom` dilutes**: `body{zoom:1.5}` yields 1.364× glyphs. Any future scale
  computation must account for it — better, per Decision 1, never ship zoom.
- **Margin boxes cannot `transform: rotate()` or `box-shadow`**
  ([`ENGINE.md`](./ENGINE.md) §8). Rotated poster chips need an in-flow
  element — which then cannot read `counter(page)` (it computes to 0 outside
  margin boxes). Pick one per design element.
- **`counter-reset: page` does not work in native print** — the folio-restart
  gap is real and must be synthesized ([`ENGINE.md`](./ENGINE.md) §8).
- **Full-bleed + running heads requires the margin-box painting technique**
  ([`ENGINE.md`](./ENGINE.md) §5) — `@page { margin: 0 }` deletes the boxes the
  heads live in.
- **Do not "optimize" the measurement pass by stripping paint effects.**
  Removing `filter` moves layout (containing block — 26% of words shift);
  `filter: opacity(1)` keeps the geometry but still rasterizes text.
- **`Page.printToPDF` must use `ReturnAsStream`.** Base64 returns the whole
  PDF in one CDP message; on a 141 MB book it looks like a hang (>600 s, no
  error, no progress). Already fixed in `src/shared/cdp.ts` — do not regress.

Harness/process traps:

- **Staging must copy assets.** `renderChaptersToFile` emits only HTML; the
  asset copy is a separate build step. An asset-less stage once produced a
  complete, internally consistent, entirely wrong A/B (`stage-book.ts` now
  mirrors the shipped step).
- **Stage B (Paged.js in-browser) has never completed on a 300-page book**
  (>2 h before being killed, twice). Skip it for large subjects or bound it
  with a timeout; the compile legs and `ab-report.py` carry the comparison.
- **Field-guide content bugs**: four broken image refs hard-fail the build
  (three are path typos — `cybersurgeon.png`, `chapter-03/etherlock.png`,
  `chapter-01/proxy.jpg`). The A/B ran against a corrected copy; fix them in
  `dc-op-manual` before using that book for anything.
- **`compare/run.ts` passes `--skip-pre-validate`** deliberately: the subject
  is pagination, and Folio has no content-validation gate to mirror.

---

## Current state of the two known Folio gaps

1. **Front-matter folio restart** — built. `gcpm-extract.ts` records the
   author's `counter-reset: page N` (`GcpmModel.counterResets`); the compiler
   measures which page each declaring element lands on and
   `src/shared/synthesis.ts`'s `pageCounterValues` (the ONE shared function,
   `ARCHITECTURE.md` §1) replays the restart as a per-page number list, same
   trick the counter-style map already used for `string()`. `counterStyleCss`
   rewrites every `counter(page[, style])` in every page context into a
   generated `@counter-style` keyed by style, so `lower-roman` front matter and
   plain-decimal body show the SAME restarted numbering in different symbols.
   The viewer applies the identical function by overriding the `page` value it
   feeds `evaluate()` — no CSS synthesis needed screen-side. Fixed a real
   viewer/print divergence surfaced by this: a recto/verso blank inserted right
   before the restart used to inherit the WRONG named-page run's format on
   screen (`fragment.ts`'s `blankPageIndices()` now isolates it, matching the
   compiler's `folio--blank` context — `ENGINE.md` §8). Verified end-to-end
   through `src/cli.ts` on a throwaway fixture (3pp roman front matter, recto
   chapter start, 3pp arabic body) with an independent reader (`pdftotext`):
   printed folios `i, ii, iii, iv, 1, 2, 3` — page 4 is the inserted blank,
   correctly still roman. Viewer margin-box text matched print folio-for-folio
   on the same fixture. Fixture 4 in Step 3 is the formal acceptance test; it
   should assert exactly this shape (roman front matter, a recto-forced
   chapter start that requires a blank, arabic body restarting at 1) and that
   viewer and print agree on every folio, not just the page count.
2. **Export time** — 2 print passes ≈ 13.5 min on the field guide. Design
   sketched, not built: predict the page map from the viewer (0.11 s), apply
   synthesis, print once, verify against that print's `/Dests` (free);
   mismatch falls back to today's two prints. Bounded by viewer↔print parity
   (330/331 blocks, knife-edge only). Note the cost is **export-only** — the
   preview never prints ([`ARCHITECTURE.md`](./ARCHITECTURE.md) §10) — and
   ~90% of each print is `filter:`, which Step 1's scoping shrinks for both
   engines.

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
