# Recommendation — `@page { background: url() }`

**Status:** the agreed solution for [#152](https://github.com/dimm-city/gutterpress/issues/152).
Design only; no product code changed. Every edit made while measuring was
reverted before commit.
**Settles:** [#183](https://github.com/dimm-city/gutterpress/pull/183) (root cause) ·
[#184](https://github.com/dimm-city/gutterpress/pull/184) (author-outcome proposal) ·
[#185](https://github.com/dimm-city/gutterpress/pull/185) (subtraction proposal)
**Measured on:** Google Chrome 151.0.7922.75, Linux x64, 2026-08-24 — in a
CDP harness that replicates the build's exact print sequence, **and** end to
end through `gutterpress build`.

Everything below is **measured** or explicitly labelled **inferred** /
**read from source**. §9 lists what was not measured.

---

## 0. Summary

The two proposals converged, and the convergence is **correct**: delete the
size threshold, copy CSS images like every other image, and declare each one
with `<link rel="preload" as="image">`. My measurements confirm the shape and
settle the three questions left open.

But the convergence was **incomplete**, and the missing piece changes what
ships:

1. **#185 is right about the contradiction and #184 is wrong.** A preload does
   not block the print. #184's "it blocks" result is an artifact of
   `--virtual-time-budget=15000`, a flag inherited from the repro script that
   the product's print path does not pass. Measured, both ways, below.
2. **The anomaly is resolved, not bounded.** `Emulation.setDeviceMetricsOverride`
   — the build's viewport pin — is the single step that defeats a hidden
   `<img>`. Bisected to that one CDP call, reproduced outside the pipeline in a
   40-line harness, and confirmed to be the *call*, not the geometry change.
3. **There is a hole neither proposal found, and it is load-bearing.** An
   `<img>` referencing the same URL **consumes the preload**, and the page
   background then drops — *with* the fix in place. A markdown prose image is
   an `<img>`. Measured end to end: `premd` mean-abs-diff `0.0000`. Worse,
   deleting `IMAGE_INLINE_MAX_BYTES` **creates new instances** of this failure
   in books that work today (`smallmd` paints today at `136.7501`; after the
   deletion it is the `premd` shape). Neither proposal measured a book where
   the same file is both a page background and an image.

So the recommendation is the convergent one **plus one non-negotiable
addition**: the `engine.page-background.unreferenced` audit is **repaired, not
deleted**, and its repair is a precondition for deleting the threshold —
because as the emitter is proposed, the emitted `<link href>` is swallowed by
the audit's own `[href]` selector and the audit goes **100% silent, including
on the shape that still fails**.

---

## 1. The recommendation

### 1.1 Emit one `<link rel="preload" as="image">` per staged CSS image

**Adopt #185's source (the copy plan), not #184's (`URL_TOKEN_RE` over the
assembled CSS).** Three pieces of evidence decide it:

- **#184's source emits preloads for files that do not exist.** Plugin CSS
  reaches `assembleBookHtml` as a separate `pluginCss` string
  (`markdown/assemble.ts:66,110,180`) and is **never** passed through
  `inlineStyles` — so a `url()` inside plugin CSS is never staged. Collecting
  from the assembled CSS would emit a `<link>` to a file the build never
  copied: a 404 on the print path, and a broken preload in a published
  `--format html` bundle. #184 offers this as its advantage ("no blind spot
  inside the document"); measured against the pipeline it is the defect.
- **#184's source needs a comment stripper, and that is new fragility.**
  `gutterpress-css.ts` mentions `url(...)` in prose at lines 39, 229 and 231.
  #184 proposes `inlineCss.replace(/\/\*[\s\S]*?\*\//g, "")` to cope. A regex
  comment-stripper over CSS is exactly the kind of thing that will one day meet
  `content: "/*"`. The copy plan needs none of it.
- **The copy plan is already the right shape.** `inlineOne` builds
  `copies: Map<dest, {from, to}>` (`asset-inline.ts:340`), keyed by output
  path, so it is **already deduped**, its `to` values **are** the hrefs, it
  **excludes** fonts (inlined before the size branch) and `--gp-shape`
  (`inlineShapeUrls`, a separate pass), and it **excludes remote `url()`**,
  which `rewriteUrls` returns `null` for. It also already covers custom
  properties: `root.walkDecls` matches `--paper: url(…)`, which is why the
  `var()` shape is fixed for free (measured, §2.4).

Concretely — `markdown/index.ts` already holds `inlined.copies` at line 94:

```ts
// markdown/index.ts, inside renderBook's assembleBookHtml({ … }) call
preloadImages: inlined.copies.map((c) => c.to),
```

```ts
// assemble.ts — one option, one map, one interpolation in the <head> template
const preloadTags = (opts.preloadImages ?? [])
  .map((h) => `\n  <link rel="preload" as="image" href="${h}">`)
  .join("");
```

Emitted in `<head>`, before `<style>`. It cannot fork the document —
`assembleBookHtml` produces the one `book.html` every format consumes.

### 1.2 Delete `IMAGE_INLINE_MAX_BYTES` and the size branch

`asset-inline.ts:28` and `:327–329`. CSS images take the existing copy path.
Fonts and `--gp-shape` are untouched; each has a recorded, measured rationale
in its own header. Three image policies collapse to one: **images are files.**

**Conditional on §1.3 landing in the same change.** Deleting the threshold
converts a class of currently-working books into silently-broken ones (§4.2).
That is acceptable only if the build tells the author. It is not acceptable
otherwise, and "we will add the check later" is how this defect survived
months of green fixtures.

### 1.3 Repair `engine.page-background.unreferenced` — do not delete it

**#184 §2.3 (delete) is wrong; #185 §2.3 (keep, rewrite the message) is right
but understates the repair needed.**

Read the audit's predicate (`engine/compiler/build.ts:1144–1183`):

```js
for (const el of document.querySelectorAll("[src],[href]"))
  referenced.add(absolute(el.getAttribute("src") || el.getAttribute("href")));
…
return [...owned].filter(([abs, hit]) => !/^data:/i.test(hit.url) && !referenced.has(abs))
```

Two consequences, both measured on real builds:

- **The `<link rel="preload">` we emit matches `[href]`**, so after §1.1 the
  audit is silent on every CSS image. Measured: the `pre`, `img`, `preimg` and
  `mdimg` builds all produced **zero** warnings — including the three that
  printed blank paper.
- **An `<img src>` matches `[src]`**, so the audit treats as *protective*
  precisely the one second reference that is measurably **not** protective on
  the print path (§3), and that actively *destroys* the preload (§4.1).

The repair is a predicate change inside the walk that already runs — no new
round trip, no new machinery:

> A URL owned by an `@page` rule (or a page-margin box) is **protected** iff it
> is also resolved by a CSS rule outside `@page` / an element inline style,
> **or** a `<link rel="preload">` names it *and* no `[src]` element in the
> document names it. `[src]` elements never protect on their own.

After the emitter, the only shape that can fire is the collision — which is
exactly the only shape that still fails. And its remedy is one the author can
actually perform: **use a separate copy of the file for the page background.**
Measured to work: the `remedy` book (same bytes under two names) paints at
`141.5137`.

That matters, because the current message's remedy — "add a `<link
rel=preload>` to the page head" — **cannot be followed**. `assembleBookHtml`
emits a fixed `<head>` (`assemble.ts:184–196`) and the manifest has no
head-injection key. #185 §1c found this; it is confirmed. That advice is
deleted either way. What replaces it is not "pipeline, you missed one" (#185)
but a genuine author instruction for a genuine author-caused shape.

`known-limitations.md` §3 needs the same correction, and one more: it currently
tells authors that *"even a 1×1 invisible `<img>`"* is enough. On the
Gutterpress print path that is **false** (§3).

### 1.4 What is *not* recommended

- **Always inline.** Settled and rejected on #185's `gutterpress preview`
  measurement (`book.html` 4,915,559 B vs 72,439 B; navigate→networkidle2
  3,625 ms vs 1,006 ms). Not relitigated.
- **Moving the viewport pin before navigation.** It would close the collision
  hole (measured: `override=before-nav` makes the `<img>` and `preload+img`
  cases paint). It is **not** available: the pinned size is
  `resolvePage(model).geometry`, derived from CSS read *after* the document
  loads (`build.ts:362–386`), so the print page cannot know it before
  navigating. Buying it would cost a second navigation, and it would change the
  size at which the document first lays out — a pagination risk this
  recommendation will not take. Recorded as a measured fact, not a proposal.

---

## 2. Verdict on the contradiction: #185 is right

**#184 §1b:** "a 2500 ms server-side delay still paints on a single print."
**#185 §1d:** "a preload does not delay the load event … a slow enough resource
still loses."

Both measured something real; they measured different browsers-under-different-
flags. The harness below serves the document over HTTP, holds the tile response
server-side, and times the **load event with an independent beacon the server
logs** — so load timing is observed without trusting the print.

| print driver | guard | delay | tile REQ | tile RESP | **load beacon** | result |
|---|---|---:|---:|---:|---:|---|
| `--print-to-pdf` (no vtb) | none | 0 | 218 ms | 218 ms | 215 ms | DROPPED |
| `--print-to-pdf` (no vtb) | preload | 0 | 194 ms | 194 ms | 197 ms | PAINTS |
| `--print-to-pdf` (no vtb) | `<img>` | 0 | 204 ms | 204 ms | 208 ms | PAINTS |
| `--print-to-pdf` (no vtb) | none | 2500 | 216 ms | — | 212 ms | DROPPED |
| **`--print-to-pdf` (no vtb)** | **preload** | **2500** | 232 ms | — | **237 ms** | **DROPPED** |
| `--print-to-pdf` (no vtb) | `<img>` | 2500 | 226 ms | 2726 ms | **2729 ms** | PAINTS |
| **`--print-to-pdf --virtual-time-budget=15000`** | **preload** | **2500** | 213 ms | 2712 ms | **217 ms** | **PAINTS** |
| `--print-to-pdf --virtual-time-budget=15000` | `<img>` | 2500 | 243 ms | 2744 ms | 2746 ms | PAINTS |
| CDP: navigate → load → print | preload | 2500 | 205 ms | — | 209 ms | DROPPED |
| **CDP: the build's exact sequence** | **preload** | **2500** | 215 ms | — | 218 ms | **DROPPED** |

**The load event.** With a preload the beacon fires at 237 ms while the
response has still not been delivered — **the preload does not delay `load`**.
With an `<img>` the beacon fires at 2729 ms, three milliseconds after the
response — **an `<img>` does**. #185's §1d table is reproduced exactly.

**Why #184 saw the opposite.** `tools/page-background-repro.mjs` launches
Chrome with `--virtual-time-budget=15000` (lines 243–245), and #184 states its
harness was adapted from that script. Under that flag the beacon still fires at
217 ms — `load` is *not* delayed — yet the print does not happen until 2712 ms.
**Virtual time waits for the pending fetch; the load event does not.** #185
predicted this reconciliation without measuring it; it is now measured. #184's
inference from its own server log (favicon at 2827 ms, "after load") read a
virtual-time deferral as a load-event deferral.

**But "it merely wins a race" is also not the right description**, and this is
the part both proposals missed. Count the HTTP requests for the tile under the
build's own sequence:

| second reference | tile HTTP requests | result |
|---|---:|---|
| none | 1 (issued *by the print*, too late) | DROPPED |
| **`<link rel=preload as=image>`** | **1** | **PAINTS** |
| `<img style="display:none">` | **2** | DROPPED |
| **preload + `<img>`** | **2** | **DROPPED** |

With a preload the page box costs **zero** extra requests: it is satisfied from
the resource the preload already fetched, without starting a new load. There is
no race left to win — *provided the preload entry is still there*. With an
`<img>` the count is 2, and with **preload + `<img>` it is also 2, not 3** —
the `<img>` matched and consumed the preload, and the page box then had to
start a fresh fetch. That is the mechanism, established by counting, not by
reading Blink.

**What this means for the fix's risk profile.** The failure mode is **not**
"a slower asset server or a bigger image". On the print path the asset is a
local file staged beside `book.html`; there is no server and no delay to lose
to. Measured: the protection is stable across **0 ms, 5 s, 30 s and 120 s**
between `load` and `printToPDF`, with the renderer busy in a rAF/layout loop
throughout — `128.0360` at every gap, identical. A 292-page book that spends
minutes in audits is safe; #185 listed this as unmeasured and it now holds.

The failure mode is **identity**: the preload must exist and must not have been
consumed. That is §4.1, and it is deterministic, inspectable, and detectable —
which is a far better risk profile than a race, but only because we now know to
look for it.

*(One genuine race remains, out of scope for the PDF path: a `--format html`
bundle served over a slow network and printed from the reader's browser can
still lose, exactly as the 2500 ms rows show. Named in §7.)*

---

## 3. The anomaly, resolved

#185 §1e: a complete, verified-at-print-time hidden `<img>` **drops** through
the pipeline while the same staged document prints fine outside it, under five
print configurations and 0–12 s of delay. Reproduced four times, unexplained.

**It is `Emulation.setDeviceMetricsOverride`.** Bisecting the build's
post-load sequence one CDP call at a time, `<img>` guard, `file://` and
`http://` identical, two repetitions each:

| step added after `load` | `<img>` guard | tile fetches | `preload` guard |
|---|---|---:|---|
| *(none — load → print)* | PAINTS | 1 | PAINTS |
| **`Emulation.setDeviceMetricsOverride`** | **DROPPED** | **2** | PAINTS |
| `Emulation.setEmulatedMedia({media:"print"})` | PAINTS | 1 | PAINTS |
| ready probe (`fonts.ready` + 2×rAF) | PAINTS | 1 | PAINTS |
| 400 ms idle | PAINTS | 1 | PAINTS |
| metrics + media | DROPPED | 2 | PAINTS |
| **all three — the build's sequence** | **DROPPED** | **2** | **PAINTS** |

Three controls that pin it down further:

- **It is the call, not the geometry.** Overriding to the headless default
  (800×600, `deviceScaleFactor: 1` — no actual change) still drops. So it is
  not a device-scale image reload.
- **It is not HTTP cacheability.** With `cache-control: max-age=3600` the extra
  network request disappears (1 fetch) and the `<img>` case **still drops**.
  The second request under `no-store` was a symptom; the cause is that the page
  box re-resolves its image at print time and the resolution does not complete
  before the paint.
- **Order is the lever.** With the override applied **before** navigation, the
  `<img>` guard paints again (and so does `preload+img`). The build cannot use
  this: the pinned size is derived from the author's `@page` CSS, read after
  load (`build.ts:362–386`). Note the *prediction* page already pins before
  navigating (`build.ts:1664–1665`) because it is handed the viewport — the two
  pages genuinely differ here.

And the base case is unaffected: with the override before navigation, a page
background with **no** second reference still drops (`0.0000`). **The Chromium
defect is real and independent; the convergence is not resting on a false
premise.** What the viewport pin changes is only *which kinds of second
reference work*.

**Behavioural rule (measured).** Under the build's print sequence, a page-box
`url()` paints on print #1 iff, at print time, the URL is either
**(a)** also resolved by a CSS rule outside `@page` (an element's
`background-image`, an inline `style`, a `data:` URI), or
**(b)** named by a `<link rel="preload">` that nothing else has consumed.
An `[src]` element provides neither — and removes (b).

**Inferred, not proven:** that (b) works because Blink satisfies the page-box
style-image request from `ResourceFetcher`'s preload list without a new load,
and that (a) works because a `StyleImage` resolved during load is reused. The
*behaviour* is measured; the Blink naming is not, and this document does not
depend on it.

**Why the pipeline's `<img>` failure is not a mystery in our code.** The
viewport pin exists for a documented, measured reason (`build.ts:370–386`:
`vw`/`vh` units resolving against whatever window state the browser is in,
measured as a 0.84× shrink-to-fit divergence). This is a deliberate,
justified product decision interacting with a Chromium defect — not a bug of
ours to find and fix.

---

## 4. The hole neither proposal found

### 4.1 An `<img>` of the same file defeats the fix

Measured **end to end through `gutterpress build`**, 5×3 in page, 1,631,629 B
`@page` background (over the current threshold, so copied), each book
differenced against its own control:

| book | markdown body | mean-abs-diff | result | audit warns? |
|---|---|---:|---|---|
| `none` | *(empty)* | `0.0000` | DROPPED | **yes** |
| `pre` | `<link rel="preload" …>` | `141.2847` | **PAINTS** | no |
| `varpre` | preload; CSS uses `:root{--paper:url()}` + `var(--paper)` | `141.2847` | **PAINTS** | no |
| `img` | `<img src="images/paper.png" style="display:none">` | `0.0000` | **DROPPED** | **no** |
| `preimg` | preload **+** hidden `<img>` | `0.0000` | **DROPPED** | **no** |
| `mdimg` | `![texture](images/paper.png)` | `0.0000` | **DROPPED** | **no** |
| `premd` | preload **+** `![texture](images/paper.png)` | `0.0000` | **DROPPED** | **no** |
| `remedy` | preload; prose image is a **separate copy** | `141.5137` | **PAINTS** | no |

`premd` is the fix in place, defeated. A markdown prose image is an `<img>`;
using the same texture as both page background and an illustration is an
entirely reachable thing for a non-technical author to do. And the audit is
silent on all four failing rows.

`varpre` independently confirms both proposals' central design point: the
collector must **not** be `@page`-scoped, because the custom-property form the
product sells to authors carries no `url()` inside the `@page` rule.

### 4.2 Deleting the threshold creates new instances of it

Both proposals assert that under-threshold books are unaffected. #185 §4:
*"Books whose CSS image is under 512 KB: identical output."* That is measured
only for books **without** the collision. With it:

| book | asset | today | after §1.2 |
|---|---:|---|---|
| `smallmd` — 2,181 B tile used as `@page` background **and** `![](…)` | 2,181 B | **PAINTS `136.7501`** (inlined as `data:` — immune) | the `premd` shape: **DROPS** |

So §1.2 is not free. It trades a size cliff for a wider blast radius on one
narrow shape. That trade is worth making — but only with §1.3, which turns
every instance from *silent* into *reported with a remedy the author can
perform*. The honest statement for the changelog is: **more books are affected,
and no affected book is silent.**

---

## 5. What gets deleted, concretely

| deleted | where |
|---|---|
| `IMAGE_INLINE_MAX_BYTES` (constant + export) | `packages/cli/src/lib/asset-inline.ts:28` |
| the `bytes.byteLength <= …` branch and its `dataUri` return for images | `asset-inline.ts:327–329` |
| three threshold-pinned test cases (rewritten, not removed) | `asset-inline.test.ts:116, 128, 292` |
| the threshold's doc comments | `preview/server-context.ts:41`, `preview/http-server.test.ts:423` |
| the `[src]`-is-protective clause in the audit's `referenced` set | `engine/compiler/build.ts:1144–1183` |
| the unfollowable "add a `<link>` to the page head" remedy — in the diagnostic **and** in `known-limitations.md` §3 | `build.ts`, `docs/known-limitations.md` |
| the *"even a 1×1 invisible `<img>`"* advice, which is measurably false on the print path | `docs/known-limitations.md` §3 |
| **the rule that an image's fate depends on its byte count** | everywhere |
| **the rule that an image's fate depends on whether the book has a `target-counter()`** | everywhere |
| **the preview↔print divergence for `@page` background images** | everywhere |

Net new code: one optional field, one `.map()`, one interpolation, and a
narrowed predicate in a walk that already runs.

**Not deleted:** `engine.page-background.unreferenced` itself; font inlining;
`inlineShapeUrls`; `ServerState.cssAssets` and its preview route (#185 §1a is
correct and #183 §C4 is inverted — never-inline makes that plumbing carry
*more*, not less; it stays).

---

## 6. The removal trigger, executable

Both proposals worry the shim will entrench and #184 conceded it had no
structural answer. The structural answer is an **expiry test that fails when
the shim becomes unnecessary**, living in the repo's own suite, not in a
`tools/` script someone has to remember to wire.

**The canary.** One test, in the engine's existing print-path test style:
print a standalone HTML fixture whose `@page` background `url()` is its **only**
reference, through the engine's own print path (the same
`setDeviceMetricsOverride` → `setEmulatedMedia` → ready probe → `printToPDF`
sequence), and assert the mean-abs-diff against the same fixture without the
declaration is `0.0000`. It asserts **the bug is still there**. On the day
Chromium fixes #152 it goes red, and its failure message says: *delete the
preload emitter in `assemble.ts` and this test.*

It must be a standalone fixture, not a built book — under §1.1 every built book
gets a preload, so a book fixture could never exercise the unprotected case.

**Why this and not `tools/page-background-repro.mjs` exit 2.** Keep the script
in CI as a cheap Chromium-level signal, but it is not the authoritative
trigger: it prints with `--print-to-pdf --virtual-time-budget=15000`, and §2
measures that this flag changes the outcome for the preload control. A trigger
that runs a browser configuration the product does not ship can pass — or fail
— for reasons the product will never have. The canary runs the product's own
print path.

**Where the boundary is.** One `.map()` in `assemble.ts`, one field in
`markdown/index.ts`. The header comment on those four lines records: the spec
gap (#152), what proves it is still needed (the canary), and what to delete.

---

## 7. Residual risks, stated plainly

1. **The `<img>` collision is not fixed, only reported (§4.1).** A book that
   uses one file as both a page background and an image prints blank paper. The
   fix does not cover it; §1.3's audit is the only thing standing between that
   author and 292 blank pages, and an audit is a warning in a build log, which
   is exactly the instrument #184 §5 argues authors learn to ignore. I accept
   this because the remedy is trivial and now correct, and because preventing
   it would require moving the viewport pin — a pagination risk (§1.4).

2. **§1.2 makes more books capable of this failure than today (§4.2).** Every
   CSS image becomes a file, so every CSS image becomes collision-capable.
   Under-512 KB books that work today can break. This is a deliberate trade of
   *silent and size-conditional* for *reported and uniform*, and someone who
   weights "no existing book regresses" above "no book fails silently" has a
   real disagreement with this recommendation, not a confused one.

3. **The mechanism is preload-list identity, not blocking (§2).** Anything that
   consumes the preload removes the protection. Today only `[src]` elements do.
   A future viewer or engine change that eagerly touches CSS image URLs from
   an element could silently do the same. The canary will not catch that — it
   tests the *unprotected* case. The `pre`-shaped regression test (§8) will.

4. **A published `--format html` bundle can still lose the race.** Served over
   a slow network and printed from the reader's browser, a preload that has not
   landed by print time drops the background (measured: 2500 ms hold →
   DROPPED). The PDF path is immune because it prints from staged local files.
   We do not control the reader's browser and should not pretend to.

5. **Unused preloads are still fetched.** A CSS image behind a `@media screen`
   block or an unused component is preloaded regardless. On the print path that
   is a local file read; in a published HTML bundle it is a real download.
   Accepted, per #185 §4 — the predicate that would avoid it is the machinery,
   and targeting is what breaks the `var()` shape.

6. **A remote `url(https://…)` in `@page` is untouched.** The inliner leaves
   it alone and it is not in the copy plan, so no preload is emitted and it
   still drops. §1.3's repaired audit is the only thing that reports it.

7. **Chromium can change any of this without notice.** The behavioural rule in
   §3 is measured on one build of Chrome 151 on Linux. Windows and macOS are
   unmeasured. The canary converts "silently stops working" into "CI goes red"
   only for the *bug's disappearance*; a change that breaks the *fix* is caught
   by the regression test, and only if that test is genuinely end to end.

8. **Entrenchment is reduced, not eliminated.** #184 is right that a workaround
   which works and is invisible has no constituency for removal. The canary is
   the answer to the mechanical half. The structural half is that the emitter's
   deletion is four lines and a test — small enough that the day CI goes red,
   deleting it is the cheapest way to make CI green again. That is the best
   incentive available; it is not a guarantee.

---

## 8. What must be seen red first

Per `memory:tests-must-be-seen-red-first`, and because every fixture that
"verified" `@page { background }` for months passed regardless of the bug:

1. **The end-to-end regression test** — build a book whose `@page` background
   is over the old threshold, assert a non-zero mean-abs-diff against the same
   book with the declaration removed. **Must be observed reading `0.0000`
   against `release/0.10.2`** before the emitter lands. A test that does not
   fail red here is not testing this.
2. **The collision test for §1.3** — build the `premd` book (preload emitted,
   plus a markdown prose image of the same file) and assert the audit
   **warns**. Against `release/0.10.2` *and* against the emitter-without-repair
   state, this must be observed producing **zero** warnings. That red is the
   whole justification for §1.3, and it is the one that is easiest to skip
   because the feature "works".
3. **The `smallmd` regression (§4.2)** — assert the under-threshold collision
   book warns. Observed today: it **paints** and does **not** warn. After §1.2
   it must drop *and* warn. If it drops without warning, §1.2 must not ship.
4. **The expiry canary (§6)** — observed **green** on Chrome 151 (the bug
   reproduces) and observed **red** by temporarily inverting its assertion, so
   its failure path is known to work rather than assumed.

Also required before merge, per #185 §8: `scripts/native-parity-gate.ts` green
with an empty allowlist. A `<link>` in `<head>` establishes no box and page
counts were unchanged in every build here (1 page before and after, and
`remedy`/`varpre` unchanged), but the gate is the contract and it was not run.

---

## 9. Evidence discipline

**Measured here** (Chrome 151.0.7922.75, Linux x64, 2026-08-24):

| # | claim | evidence |
|---|---|---|
| 1 | a preload does not delay `load` | beacon at 237 ms, response held 2500 ms, print DROPPED |
| 2 | an `<img>` does delay `load` | beacon at 2729 ms, response at 2726 ms, PAINTS |
| 3 | `--virtual-time-budget=15000` is what makes #184's preload paint | beacon 217 ms (early) but print deferred to 2712 ms; PAINTS |
| 4 | the build's own CDP sequence drops a preload at 2500 ms delay | `0.0000` |
| 5 | with a preload the page box costs **zero** extra fetches | 1 tile request |
| 6 | an `<img>` **consumes** the preload | `preload+img` = 2 tile requests, not 3 |
| 7 | `setDeviceMetricsOverride` is the step that defeats `<img>` | 7-step bisect × 2 reps, http + file |
| 8 | it is the call, not the geometry | identical-size override (800×600) still DROPS |
| 9 | it is not HTTP cacheability | `max-age=3600`: 1 fetch, still DROPS |
| 10 | applying the override before navigation restores `<img>` | PAINTS; and `none` still DROPS |
| 11 | preload protection survives long gaps | `128.0360` at 0 / 5 s / 30 s / 120 s |
| 12 | real pipeline: status quo drops, preload paints | `0.0000` → `141.2847`, PDF 6,223 B → 1,171,321 B |
| 13 | real pipeline: `var()` shape paints with the preload | `141.2847` |
| 14 | real pipeline: `<img>` / prose-image collision drops, **with** the preload | `preimg`, `mdimg`, `premd` all `0.0000` |
| 15 | real pipeline: the separate-copy remedy works | `remedy` `141.5137` |
| 16 | deleting the threshold regresses under-threshold collision books | `smallmd` `136.7501` today |
| 17 | the audit is silent on every failing shape once a preload is emitted | 0 warnings on `pre`/`img`/`preimg`/`mdimg`/`premd` |

**Read from source, not measured:** `pluginCss` bypassing `inlineStyles`
(`assemble.ts:66,110,180`); `copies` being a dest-keyed Map excluding fonts,
shapes and remote urls (`asset-inline.ts:300–342`); the audit's `[src],[href]`
predicate (`build.ts:1144–1183`); the fixed `<head>` and absent manifest key
(`assemble.ts:184–196`); `sheetViewport` deriving from post-load CSS
(`build.ts:362–386`) and the prediction page pinning pre-navigation
(`build.ts:1664–1665`); `--virtual-time-budget=15000` in
`tools/page-background-repro.mjs:243–245`; `url(...)` in `gutterpress-css.ts`
comments at lines 39, 229, 231.

**Taken from #185 without re-measuring:** the `gutterpress preview`
always-inline cost (4,915,559 B / 3,625 ms vs 72,439 B / 1,006 ms).

**Taken from #183 without re-measuring:** print counts for `over` (1) and
`over-xref` (2); the `data:` URI immunity.

**Not measured:**

- **Windows and macOS.** Linux only.
- **A book with many CSS images.** Every fixture here had one or two. Ten
  preloads and ten staged files is the normal case for a real book.
- **`dc-op-manual` end to end.** Read-only, and not rebuilt here. #184's
  acceptance test — build the field guide with the `html { background }` rule
  removed and check its 292 pages — remains the honest final check, and it is
  exactly the experiment the product owner already ran and lost.
- **The parity gate.** §8.
- **Whether any other element type consumes a preload the way `[src]` does.**
  Tested: `<img>` hidden, `<img>` visible, markdown prose image. Not tested:
  `<video poster>`, `<object>`, CSS `content: url()`.
