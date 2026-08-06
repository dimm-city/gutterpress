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
| **`generateDocumentOutline`** | ✅ **DONE** (`bfcbd15`): `outline: true` in `pagination.ts`'s `page.pdf()` call. 0 → 155 bookmarks, all 155 destinations landing on a page whose text contains the bookmark title (verified with two readers that share no code with our pipeline). ⚠️ Correction: `tagged: true` is a **no-op** — `/StructTreeRoot` and `/MarkInfo <</Marked true>>` were already present before the commit. Bookmarks are the whole delta. The desktop export path got the same fix (`a5123dd`: `generateDocumentOutline`/`generateTaggedPDF` on `webContents.printToPDF`), **measured** in headless Electron 42 — flags on → `/Outlines` + `/StructTreeRoot` present, flags off → neither; also measured: the CDP params alone suffice, Electron's main does NOT need the `--generate-pdf-document-outline`/`--export-tagged-pdf` launch flags puppeteer adds by default. | COMPARISON.md §A |
| **Scope `filter:`** | ~90% of build time on **both** engines, and it silently rasterizes card text to 300 DPI bitmaps — not selectable, searchable or accessible in the released PDF. ⚠️ **Partially done**: `packages/cli/src/lib/printsafe.ts` now emits a print-safety **warning** (`printsafe/no-risky-print-effects`) naming these exact measured consequences whenever `filter:` appears in author CSS — see its test in `printsafe.test.ts`. The actual scoping — rewriting the design guide's CSS so `filter:` applies to the smallest possible selector — is unchanged and out of scope for this repo: it lives in the book's own CSS, owned by `dc-op-manual`. | 57.0s → 6.2s over 60pp; [`ENGINE.md`](./ENGINE.md) §10 |
| **Explain the 1.364× scale** | ✅ **RESOLVED — and it inverts the headline.** "Paged.js inflates, triggered by `@font-face` rule order" was refuted (font substitution, not a scale). The follow-up finding — "the 1.364× is Chromium print shrink-to-fit compressing the PLAIN render" — is correct as far as it went, but the open question it left ("is Folio's leg compressed the same way?") is now answered: **yes, identically.** `folio build()`'s only `Page.printToPDF()` call (`src/compiler/build.ts`'s `printPdf()`, used at every tier) is a bare CDP print of the raw document with no width-fitting of its own — the multicol fragmentation that would make it immune belongs to Folio's on-screen *viewer*, not its PDF build path. Measured on the real staged field guide: Folio's real body-text "chapters" prints **13.38pt**, matching plain Chromium's compressed **13.381pt** — not the shipped Paged.js PDF's **18.26pt** (re-confirmed), and Folio's own build lands at **201 pages**, same as the plain-Chromium leg, both short of Paged.js's 301. Paged.js's number is the honest one here: pagination removes the over-wide trigger by construction; Folio's native-print path does not. | `ENGINE.md` §9 (resolved subsection); four-leg synthetic table (53.15/79.73pt, ratio 0.6666 on both engines) + the field-guide re-measurement (13.38pt Folio vs 13.381pt plain vs 18.26pt Paged.js) |

The scale item was the gate for everything after it, and **the gate is now
closed — with the opposite result Step 2 was written expecting.** Do not
retune tokens against Folio's *current* numbers on the field guide: they are
compressed the same way the discredited "plain Chromium" baseline was.
Paged.js's 18.25pt is the uncompressed, honest 12pt-CSS rendering on this
book; Folio matches it only once the field guide's over-wide layout (960px
content against ~705pt printable) is fixed, or Folio gains an explicit
pre-print width check it does not have today. Until one of those happens, a
Folio PDF of the field guide as currently authored will silently under-size
text the same way the old "plain Chromium" measurement did — this is a defect
to fix, not a scale to design tokens around.

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

**Premise correction (measured, see Step 1's scale row and `ENGINE.md` §9):**
"Under Folio, `12pt` means 12pt" is **not true on the field guide as currently
authored.** Folio's own build of the field guide renders body text at 13.38pt
for a 12pt declaration — the same shrink-to-fit-compressed value the
discredited "plain Chromium" baseline gave, because Folio's PDF path is a
bare native print with no width-fitting, and the guide's content is ~960px
wide against ~705pt printable. The book's *honest* 12pt-declared size, on
this document, is Paged.js's 18.25pt — the number pagination happens to
protect and Folio's native-print path does not. Do not set Step 2's tokens
from a Folio proof of the field guide until the over-wide layout is fixed (or
Folio gains a pre-print width check); a Folio proof taken today would be
tuning against the same compressed numbers this whole investigation
originated to root out.

For a document that is NOT over-wide, the original premise holds: Folio
prints at the size the CSS declares (confirmed on this task's synthetic
control fixture, `folio build()` matching plain Chromium's uncompressed
79.73pt probe exactly). The paragraph below still describes the right
*process* for a correctly-fitted document; it no longer describes what a
Folio proof of the field guide *as it stands today* would show.

Under Folio, `12pt` means 12pt once a document is not over-wide. The tokens
become honest, which is the whole point — but it forces a decision that has
been made implicitly until now.

**The "distortion" framing this section was written under is dead** (see the
premise correction above): today's shipped output is the *uncompressed*,
honest rendering of the CSS — the visual judgments made against it were made
at the real size, and its ~18.25pt-glyph body text is what a 12pt declaration
plus this book's fonts and layout genuinely produce **when the content fits
the page**. What changes under Folio is not the size but the fragility: fix
the over-wide layout first, then take the proof at true size and set the
tokens from it. If the proofed size matches today's output, no retune is
needed at all; if the team wants different sizes, that is a design choice made
deliberately, not a correction of an engine artifact. Either way, set the
tokens from a proof at real size, then accept the page count.

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

## Step 3 — integration spike results (2026-08-06)

Built one flag, `gutterpress build --engine folio`, on `examples/gutterpress-user-guide`
(the largest in-repo example). Time-boxed; PDF path is real and measured
end-to-end, preview is NOT wired (see below) — that gap is itself the
headline finding.

### What was built

- `packages/cli/src/commands/build.ts` — `--engine <paged|folio>` flag.
- `packages/cli/src/lib/build-runner.ts` — `BuildRunnerOptions.engine`;
  `PdfOutput.finish` branches to a Folio call instead of `renderHtmlToPdf()`
  when `engine === "folio"`; preflight/prewarm skip `packages/cli`'s own
  Chromium pool for the same case (Folio launches its own).
- `packages/cli/src/lib/markdown/assemble.ts` + `markdown/index.ts` — thread
  `engine` down to the assembler so the Paged.js polyfill `<script>` slot is
  omitted entirely (not swapped) when `engine === "folio"`.
- `packages/cli/src/lib/folio-engine.ts` (**new**) — the actual bridge:
  dynamically imports `spike/folio/src/compiler/build.ts` and drives it
  directly against the assembled `book.html` file.
- `packages/cli/README.md` — documented the flag (`readme-drift.test.ts`
  enforces `--help` ⇄ README parity and caught the omission).

**6 files touched** (5 modified + 1 new) out of the 32 non-test files under
`packages/cli/src` that reference Paged.js, and **0 files touched** under
`packages/desktop/src` (16 reference Paged.js there) — the desktop app was
never opened.

### What had to be FORKED, named explicitly

1. **`folio-engine.ts` itself is a fork, not an integration.** It reaches
   `spike/folio/src/compiler/build.ts` with a *relative cross-directory
   import*. `spike/folio` is not a Bun workspace member (root `package.json`
   `workspaces` is `["packages/*"]` only) and is not published. This works
   from `bun packages/cli/src/cli.ts` (source checkout) but is provably
   incompatible with both shipping targets: the `bun build --compile` binary
   never bundles `spike/`, and the desktop app's electron-vite build doesn't
   either. **This is the single largest blast-radius item**: a real
   integration needs Folio promoted to an actual package (its own
   `package.json`, workspace membership, a build step emitting `.d.ts`) —
   not a bigger flag, a different starting point.
2. **A second, independent Chromium launcher.** Folio drives the *system*
   Chromium via its own raw-CDP `launchChromium()`
   (`spike/folio/src/shared/cdp.ts`), completely separate from
   `packages/cli/src/lib/browser-pool.ts` (puppeteer-core, connection
   pooling, warm-reuse across preview rebuilds). The flag does not share a
   browser instance between the two engines — each `--engine folio` build
   launches and tears down its own Chromium process. Measured cost of that:
   see wall-clock below.
3. **`renderHtmlToPdf()`'s HTTP staging is not engine-agnostic despite
   looking like an extension seam.** The existing injected-`PdfRenderer`
   mechanism (`opts.pdfRenderer`, already used by the Electron desktop) looks
   like the natural place to plug Folio in — it accepts any renderer
   function. It is NOT sufficient: `renderHtmlToPdf()`'s own staging
   (`paginationOverlays` → `pagedjs.ts`'s `patchHtmlStringForPagedjs`)
   unconditionally injects the Paged.js polyfill into the served HTML
   *regardless of which renderer runs against it*, and does so even with no
   polyfill-tag marker present (a deliberate fallback — finding #22, "a doc
   that merely mentions 'pagedjs' must not silently skip loading it"). First
   attempt used this seam and produced a real, silent, measured failure:
   Folio's own Chromium navigated to a Paged.js-staged URL, Paged.js started
   re-paginating the live DOM, and Folio's fragmentation ran against a
   document being rewritten out from under it — **output dropped from 61pp /
   9,699 words to 6pp / 754 words, no error thrown, exit code 0.** Root
   cause confirmed by driving Folio's own CLI directly against the identical
   assembled `book.html` with NO staging: 61pp, 9,699 words, matching C2's
   baseline exactly. Fix: `PdfOutput.finish` calls
   `folio-engine.ts`'s `buildFolioPdf()` directly on the plain file, bypassing
   `renderHtmlToPdf()` and `paginationOverlays` entirely. **Named finding**:
   the `PdfRenderer` seam is Paged.js-coupled at the staging layer, not just
   the print layer — a future non-spike integration cannot reuse it as-is.
4. **`tsc` boundary.** A `typeof import("../../../../spike/folio/...")`
   type-only cast (tried first, for type safety across the boundary) pulls
   spike/folio's entire module graph into `packages/cli`'s `tsc --noEmit`
   program, which then fails: `packages/cli/tsconfig.json` is stricter than
   `spike/folio/tsconfig.json` (e.g. `noUncheckedIndexedAccess`), so files
   that typecheck clean under spike/folio's own gate produce 15+ errors under
   `packages/cli`'s. Worked around with an untyped dynamic `import()` (`any`)
   — meaning the bridge has **zero type safety across the boundary**, which a
   real integration could not ship.

### What was NOT touched — Decision #5 is currently VIOLATED by this spike

Decision #5 ("preview and PDF switch together, per project, behind one
flag — never independently") is **not met**. This flag only changes the PDF
build path. Live preview (`packages/cli/src/preview/http-server.ts`,
`preview/file-watcher.ts`'s `injectPreviewScripts`) still unconditionally
injects `pagedjs-interface.js` + `pagedjs-bridge.js` + the Paged.js polyfill
for every project, flagged or not — `--engine folio --format pdf` and
`gutterpress preview` on the same project would currently disagree exactly
the way Decision #5 warns against.

Wiring preview was time-boxed out, but the concept was validated separately
(not shipped): the assembled `book.html` (engine: folio, no polyfill tag)
was hand-loaded in real headless Chromium with Folio's viewer bundle
(`spike/folio/dist/folio.js`) injected in place of the polyfill script.
Result: **0 `.pagedjs_*` classes, no polyfill script present, Folio
self-mounted and fragmented the document client-side to 65 pages** (17
`.folio-strip` contexts, `--folio-pages` custom properties summed) — in the
same ballpark as the 61-page print output (the print/predict gap the C2
report already documents), with no server round-trip needed. So the
mechanism is plausible, but making it real requires:
- Serving `spike/folio/dist/folio.js` (+ `folio-agent.js`) as a preview asset
  — `packages/cli/src/lib/embedded-assets.ts`'s bundling list would need a
  new entry, itself the same "promote spike/folio to a real package" problem
  as finding #1 above, now on the preview side too.
- A `injectPreviewScripts` branch that swaps the Paged.js trio for the Folio
  script instead of the current single unconditional rewrite.
- Deciding what the preview toolbar's Paged.js-specific
  `pagedjs-interface.js`/`pagedjs-bridge.js` postMessage API becomes for
  Folio — not investigated.

None of this is unusually hard *individually*; it is unbuilt, and every item
routes back through the same packaging gap as the PDF path's finding #1.

### Measured

- **Page count agreement (the success criterion this spike could actually
  check):** PDF-only, both via `--engine folio`: **61 pages, 61 pages, 61
  pages** across 3 runs — matches Folio's own direct CLI build on the
  identical assembled HTML (61pp, 9,699 words, byte-for-byte the C2 report's
  number) and Paged.js's own build of the same project (64pp — the two
  engines' existing, already-documented divergence, not a regression from
  this flag). Preview page count: **not measured** — preview isn't wired
  (see above); the hand-probe above got 65pp from the viewer's own client-
  side fragmentation on the same document, which is *close to* but not equal
  to the 61pp print number — expected, and already documented as the
  predict/verify gap in the C2 report, not a new finding.
- **DOM verification (inspected the artifact, not the code, per the task's
  instruction):**
  `grep -o "pagedjs[a-zA-Z_-]*" book.html` on the `--engine folio`-assembled
  HTML still finds **3 residual identifiers**:
  `--pagedjs-margin-left`/`--pagedjs-margin-right` (custom properties emitted
  by `markdown-it-paged.js`'s own `PAGED_CSS` — generic, default to `0px`,
  functionally inert under Folio, but the *name* is Paged.js-branded and
  untouched by this task's scope — CLAUDE.md §6 says `markdown-it-paged` owns
  its full CSS contract) and `.pagedjs_sheet` (a selector in the EXAMPLE
  PROJECT'S OWN `examples/gutterpress-user-guide/styles/guide.css`, targeting
  a Paged.js-only DOM class for full-bleed background painting — under Folio
  this rule is simply dead, meaning that background-painting effect is
  **silently absent** in Folio output, a real visual regression for this
  specific example, not caught by page-count parity). Neither is the
  polyfill *loading* (confirmed: no `<script src="...paged.polyfill...">` in
  the served/printed document; zero `.pagedjs_page`/`.pagedjs_*` runtime
  classes in the printed PDF's structure) — so the letter of the success
  criterion is met on the PDF path, but the example project's own CSS is not
  actually engine-neutral, which page-count parity alone would have missed.
- **Wall clock, PDF build, warm, n=3 each, same machine, same project:**
  Paged.js (`gutterpress build --format pdf`): **2.8s, 4.2s, 3.7s**
  (mean ≈3.6s). Folio (`--engine folio`): **6.1s, 7.6s, 7.6s**
  (mean ≈7.1s, ~2x slower) — entirely attributable to finding #2 (no shared
  warm browser; Folio launches its own Chromium from cold every call). A real
  integration sharing one warm browser between the two paths would very
  likely close most of this gap, but that sharing does not exist today.
- **Preview startup:** not measured — no `--engine folio` preview path
  exists to start.
- **tsc / test suites (packages/cli, this task's own regression check, not
  one of the binding spike/folio gates):** `bunx tsc --noEmit -p tsconfig.json`
  clean (0 errors) after routing the `spike/folio` import through an untyped
  `any` boundary (finding #4). `bun test`: 2222 pass → 2224 pass, 0 fail
  (added 0 new tests — this is a spike, not a shipped feature; the only test
  regression caught was `readme-drift.test.ts` flagging the undocumented
  `--engine` flag, fixed by updating `README.md` in the same commit).
- **spike/folio's own binding gates, unaffected (no spike/folio files
  touched by this task):** `bun run spikes`: 15/15, 212 checks. `bun test`:
  57 pass, 0 fail, 126 expect() calls. `bunx tsc --noEmit`: clean.

### Recommendation against the decision gate: **SPRAWLING (partial)**

Not sprawling in the sense of "touches everywhere" — 6 files in
`packages/cli`, 0 in `packages/desktop`, existing tests unaffected. It is
sprawling in the sense the gate actually cares about: **the PDF half looks
contained only because it currently violates Decision #5** (preview and PDF
must switch together; this spike ships PDF-only) and **only because it
forks rather than shares** three separate subsystems (browser launch/pool,
the `PdfRenderer` staging seam, and the module/package boundary itself). Two
of those forks — the browser launcher and the `spike/folio` packaging gap —
are prerequisites for the preview half to exist AT ALL, not incremental
follow-up work; wiring preview does not add a fourth small thing, it forces
finding #1 (promote `spike/folio` to a real, typed, workspace package) to
actually happen before Decision #5 can be satisfied for even one project.
That is a real, non-trivial engineering item (build tooling, `.d.ts`
generation, a shared or reconciled browser-launch layer, a decision on what
`packages/desktop`'s Electron `printToPDF` path does under `engine: folio`
if desktop is ever in scope), not a flag.

Given Step 1's four wins are already banked regardless of this outcome, and
this spike found no NEW correctness problem with Folio itself (the 61pp
number matches every prior measurement in this document exactly), the
honest read is: **stop the "flip a flag today" framing; the packaging work
(promote `spike/folio` to a workspace package with a real build + `.d.ts`,
and reconcile or explicitly duplicate the browser-launch layer) is a
prerequisite project of its own, sized independently of "book by book"
migration.** Once that exists, "book by book" per Decision #5 is very
plausibly contained — nothing measured here contradicts that — but it is
not what "finish the two Folio gaps and migrate book by book" describes
today, because today there is no book that can legally ship the `spike/`
import at all.

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
   **Review found a second instance of the same gap (F1, fixed):** a blank
   inserted for a recto/verso break AFTER the restart already took effect was
   built from a verbatim copy of the author's `@page :blank` rules in
   `build.ts`, bypassing `counterStyleCss`'s `counter(page)`->`@counter-style`
   rewrite entirely — it printed the raw physical page while the viewer (which
   always went through `pageCounterValues`) showed the restarted folio.
   `counterStyleCss` now owns the `folio--blank` block too, through the same
   rewrite (`ENGINE.md` §8 has the full account). **A related gap (F3, fixed):**
   `target-counter()` pointing at a restarted page resolved the physical page,
   not the folio that page itself prints; `synthesis.ts`'s new
   `restartedPageValues`/`toFolioPage` close it on both the compiler
   (`applySynthesis`) and the viewer (`decorate.ts`'s `buildMaps`).
2. **Export time (predict-then-verify)** — built. `predictPageMap()` in
   `build.ts` runs the viewer's own `fragmentDocument()` on a SEPARATE
   page/tab (never the page about to print) to guess the Tier 3 page map,
   feeds it through the same `applySynthesis()` the fixpoint loop already
   used per-pass, and seeds the loop's convergence check with the guess. Pass
   1 of the (unchanged) existing loop carries the guessed synthesis and IS the
   verification print: if its own `/Dests` matches the guess, the loop
   converges after ONE print; if not, the loop's existing pass-2 body runs
   exactly as before, at today's two-print cost — never worse, never
   unverified (`ARCHITECTURE.md` §10 has the full design and measurements).
   Measured on `examples/gutterpress-user-guide`: output is byte-identical to
   the un-predicted baseline (61pp, 9,699 words, 0 diffs) whether the guess
   hits or misses — the verification is retained unconditionally. The guess
   currently **misses** on this specific book (a pre-existing, separately-
   documented viewer limitation — the cover page's `page:` assignment on a
   descendant, not the container — see `ARCHITECTURE.md` §10) and falls back
   to 2 prints, ~80–150 ms slower warm than the un-predicted baseline; the
   `s8-compiler` spike's running-heads fixture (no cover-page idiom) now
   converges in 1 pass where it always needed 2. Bounded by viewer↔print
   parity (330/331 blocks, knife-edge only). Note the cost is **export-only**
   — the preview never prints ([`ARCHITECTURE.md`](./ARCHITECTURE.md) §10) —
   and ~90% of each print is `filter:`, which Step 1's scoping shrinks for
   both engines.
   **Review found a convergence gap (F2, fixed):** the fixpoint loop's
   `mapSignature()` compared only the id->page map, not `pageCount` — an
   under-predicted page count could stabilize on the same id->page map as the
   next real print and be accepted as a fixpoint, sizing the fixed
   `@counter-style` symbol lists too short (a page beyond the list silently
   fell back to plain decimal). `mapSignature()` now folds `pageCount` in;
   `s8-compiler` gates both the 1-print hit (exact count, not `<= 2`) and a
   deterministic miss (this same cover-page idiom) that proves the fallback
   fires and still ships correct output — see `ARCHITECTURE.md` §10.

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
