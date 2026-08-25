# Recommendation — `@page { background: url() }`

**Status:** the agreed solution for [#152](https://github.com/dimm-city/gutterpress/issues/152).
Design only; no product code changed. Every edit made while measuring was
reverted before commit.
**Settles:** [#183](https://github.com/dimm-city/gutterpress/pull/183) (root cause) ·
[#184](https://github.com/dimm-city/gutterpress/pull/184) (author-outcome proposal) ·
[#185](https://github.com/dimm-city/gutterpress/pull/185) (subtraction proposal)
**Revision:** second pass, after both proposal authors responded to the first.
The shape changed — §1.2 is new and it is what makes the whole thing hold.
**Measured on:** Google Chrome 151.0.7922.75, Linux x64, 2026-08-24 — in a CDP
harness that replicates the build's print sequence, **and** end to end through
`gutterpress build`.

Everything below is **measured**, **measured by another agent** (attributed),
or explicitly labelled **inferred** / **read from source**. §9 lists what was
not measured and what is still disputed.

---

## 0. Summary

The two proposals converged on: delete the size threshold, copy CSS images like
every other image, declare each one with `<link rel="preload" as="image">`. That
convergence is correct and survives scrutiny. Three findings changed what
ships around it.

1. **#185 is right about the contradiction and #184 is wrong.** A preload does
   not block the print. #184's "it blocks" result is an artifact of
   `--virtual-time-budget=15000`, a flag inherited from the repro script that
   the product's print path does not pass (§2). But "it merely wins a race" is
   also the wrong description: with a preload the page box costs **zero** extra
   fetches. The mechanism is **preload-list identity, not timing**, and it holds
   across a 120-second gap between load and print.
2. **The anomaly is explained.** A hidden `<img>` is defeated by the **first
   transition into a device-metrics override after load** — not by the
   override's geometry, and not by media emulation, the ready probe, or elapsed
   time (§3). My first pass called it "the `setDeviceMetricsOverride` call";
   #185's follow-up measurement corrected that to "the first transition", and
   the correction reconciles both agents' results without either being wrong.
3. **A URL used by both CSS and an `<img>` is a failure mode, and the fix as
   originally proposed does not cover it.** I found it; #185 **solved** it, by
   deletion (§1.2): content-address **every** CSS image so a CSS URL and a prose
   URL can never coincide. It does not handle the collision — it makes the
   collision **unrepresentable**, which kills the whole class (plugin-emitted
   `<img>`, author raw HTML, a stray `<link>`), not the one instance I happened
   to find.

Both proposal authors concur with this shape. What follows is that shape,
stated precisely enough to implement, with its residual risks named rather than
smoothed.

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
  `var()` shape is fixed for free (measured, §4).

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

**No predicate.** #184 offered a cheaper-looking variant — skip the preload for
a URL the document already references from an element — and **withdrew it**.
Recorded here so it is not re-invented: with §1.2 in place a CSS URL is never
referenced from an element, so the predicate would always be false; it would be
dead code that looks load-bearing, and it would put a decision back into the
emitter that §1.2 removed from the problem. The emitter needs no predicate at
all, and that is the reason to prefer this shape over every variant considered.

### 1.2 Content-address **every** CSS image (this is what closes the hole)

In `inlineOne` (`asset-inline.ts:331–341`), delete the conditional that keeps a
project-relative path for in-project CSS images. Every CSS image becomes
`assets/<contentHash><ext>`:

```ts
// asset-inline.ts — the whole change is the deletion of the branch
const dest = `${HASHED_ASSET_DIR}/${contentHash(bytes)}${ext}`;
copies.set(dest, { from: absAsset, to: dest });
return dest;
```

Prose images are untouched: `planImageCopies` keeps authored relative paths, so
`![](images/tile.png)` still ships as `images/tile.png`.

**What this buys.** The page background's URL becomes a name **nothing in the
document can utter**. An author's `<img src="images/tile.png">`, a plugin-emitted
`<img>`, a hand-written `<link>` — none of them can name `assets/<hash>.png`,
because the hash is computed by the build. Different URLs ⇒ different preload
entries ⇒ the preload can never be consumed by an element.

This is the difference between handling a failure and removing it. My §4 found
one instance (a markdown prose image of the same file). §1.2 kills the class.
It is also strictly *less* code than the alternative: it deletes a conditional
rather than adding a check.

**Measured by #185** (status quo → v2, real pipeline, each book against its own
control):

| shape | status quo | with §1.1 + §1.2 |
|---|---:|---:|
| `@page` background only, 2.4 MB | `0.0000` | **`91.2541`** |
| `:root { --paper: url() }` + `var(--paper)` | `0.0000` | **`91.2541`** |
| **page box + 3 margin boxes on one URL** | `0.0000` | **`89.1921`** |
| the collision fixture | `101.6601` | `101.6601` (unchanged) |

The multi-box row is the one that matters for the real book: `dc-op-manual`
puts **sixteen** margin boxes on one URL, and one preload covers all of them.

The collision row reads "unchanged" in #185's fixture — see §4.3, where the
empirical status of the collision is the one thing this document does **not**
present as settled.

**Author-facing cost: measured at ~zero** (by #184):

- **The PDF is byte-equivalent.** An 8-page book with a 480,771 B image used
  both ways: **800,220 B / 1 embedded image object** (shared) before,
  **800,216 B / 1 object** after. Chromium's PDF writer de-duplicates by image
  content, so double-shipping never reaches the artifact the author uploads.
- **Hashed names never surface to the author.** `auditContent`
  (`build.ts:1049`) names elements by `tag#id.class`, not by URL, and
  `readOrThrow` (`asset-inline.ts:167`) names absolute *source* paths in its
  errors. There is no diagnostic in which an author would meet
  `assets/9f3c…png` and have to work out what it is.

**Residual, and real:** a `--format html` bundle carries a both-ways asset
**twice on disk**, and `planImageCopies`'s documented promise — *"Images keep
their authored relative path, so the author's folder layout is what ships"*
(`asset-inline.ts:463–466`) — now holds for prose images only. That comment
must be corrected in the same change. This is legibility, not correctness, and
it is **visible** (a duplicate file in a folder you can open) rather than
silent (292 blank pages). That is the right direction to trade.

### 1.3 Delete `IMAGE_INLINE_MAX_BYTES` and the size branch

`asset-inline.ts:28` and `:327–329`. CSS images take the copy path. Fonts and
`--gp-shape` are untouched; each has a recorded, measured rationale in its own
header. Three image policies collapse to one: **images are files.**

In the first pass I made this conditional on the audit repair, because deleting
the threshold created new collision instances — a 2,181 B tile used as both page
background and prose image **paints today** (`136.7501`) precisely because the
CSS copy is a `data:` URI, and would have dropped after. **§1.2 removes that
objection at the root**: after content-addressing, the two references are two
different URLs, so the under-threshold book is no longer collision-capable
either. §1.3 is now free-standing.

### 1.4 Repair `engine.page-background.unreferenced` — do not delete it

**#184 §2.3 (delete) is wrong; #185 §2.3 (keep, rewrite the message) is right
but understates the repair needed.** This is non-optional.

Read the audit's predicate (`engine/compiler/build.ts:1144–1183`):

```js
for (const el of document.querySelectorAll("[src],[href]"))
  referenced.add(absolute(el.getAttribute("src") || el.getAttribute("href")));
…
return [...owned].filter(([abs, hit]) => !/^data:/i.test(hit.url) && !referenced.has(abs))
```

The predicate treats *"something else mentions this URL"* as proof of safety.
Measured, that inference is not merely incomplete — **it is inverted for the one
reference type that breaks the page box.** An `<img src>` matches `[src]`, so
the audit stays silent (`audit fired: 0`) on exactly the shape where the
reference is what causes the failure. And after §1.1 the emitted `<link href>`
matches `[href]`, so the audit falls silent on every CSS image. Measured on real
builds: the `pre`, `img`, `preimg`, `mdimg` and `premd` books all produced
**zero** warnings — and four of those five printed blank paper.

With §1.2 in place, that silence becomes *correct* — but only **by accident**.
The audit is not verifying that a preload will work; it is observing that some
element mentions the URL. The repair makes the silence mean what a reader thinks
it means:

> A URL owned by an `@page` rule (or a page-margin box) is **protected** iff it
> is also resolved by a CSS rule outside `@page` / an element inline style,
> **or** a `<link rel="preload">` names it *and* no `[src]` element in the
> document names it. `[src]` elements never protect on their own.

Under §1.2 the second clause is always satisfied, so the audit is silent for
every staged CSS image — provably, not incidentally. It still fires for the
cases §1.1 cannot cover: a remote `url(https://…)` in `@page` (left alone by the
inliner, never copied, never preloaded), and any CSS that reaches the document
without passing through `inlineStyles`. **And if §1.2's invariant is ever
retracted** — a future "friendlier asset names" change — the audit is what turns
the returning collision from silent into reported. It is the backstop for §1.5.

The message must stop telling the author to add a `<link>` to the page head:
`assembleBookHtml` emits a fixed `<head>` (`assemble.ts:184–196`) and the
manifest has no head-injection key, so that remedy is available only to us
(#185 §1c, confirmed). `known-limitations.md` §3 needs the same correction, plus
one more: it tells authors that *"even a 1×1 invisible `<img>`"* is enough. On
the Gutterpress print path that is **false** (§3).

### 1.5 Test the invariant §1.2 creates

§1.2's guarantee — **a CSS image URL and a prose image URL can never
coincide** — is now load-bearing for correctness, and nothing in the code says
so. A later change to make asset names friendlier (`images/tile.png` instead of
`assets/9f3c….png` — an obvious, well-meant readability improvement) would
retract it **silently**, and the failure would be 292 blank pages in a valid
PDF.

One test, asserting the invariant directly: build a book whose CSS and whose
markdown both reference the same source file, and assert that the two
destinations differ and that no `[src]` in the built document names the CSS
destination. It must carry the reason in its name and its failure message.
This is the smallest thing that makes the invariant visible to the person who
would otherwise retract it.

### 1.6 What is *not* recommended

- **Always inline.** Settled and rejected on #185's `gutterpress preview`
  measurement (`book.html` 4,915,559 B vs 72,439 B; navigate→networkidle2
  3,625 ms vs 1,006 ms). Not relitigated.
- **Establishing a device-metrics override before navigation.** §3 measures
  that this immunises element references — and the geometry is irrelevant, so
  the build *could* do it. **Do not.** It would be compensating machinery for a
  browser-state transition nobody has explained, in a place with no natural
  reason to exist; correctness would depend on an undocumented Blink behaviour
  that no test can name and no removal trigger can retire; and it does not fix
  the base case at all — an unreferenced `@page` url still drops (measured).
  Both #185 and I recommend against it explicitly, so that a future reader who
  rediscovers §3 does not reach for it.
- **A predicate on the emitter** (§1.1), withdrawn by its own author.

---

## 2. Verdict on the contradiction: #185 is right

**#184 §1b:** "a 2500 ms server-side delay still paints on a single print."
**#185 §1d:** "a preload does not delay the load event … a slow enough resource
still loses."

Both measured something real; they measured different browsers under different
flags. The harness below serves the document over HTTP, holds the tile response
server-side, and times the **load event with an independent beacon the server
logs** — so load timing never depends on the print.

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

**The load event.** With a preload the beacon fires at 237 ms while the response
has still not been delivered — **the preload does not delay `load`**. With an
`<img>` the beacon fires at 2729 ms, three milliseconds after the response —
**an `<img>` does**. #185's §1d table is reproduced exactly.

**Why #184 saw the opposite.** `tools/page-background-repro.mjs` launches Chrome
with `--virtual-time-budget=15000` (lines 243–245), and #184 states its harness
was adapted from that script. Under that flag the beacon still fires at 217 ms —
`load` is *not* delayed — yet the print does not happen until 2712 ms.
**Virtual time waits for the pending fetch; the load event does not.** #184's
inference from its own server log (favicon at 2827 ms, "after load") read a
virtual-time deferral as a load-event deferral.

**But "merely wins a race" is also wrong**, and this is what both proposals
missed. Counting tile requests under the build's own sequence:

| second reference | tile HTTP requests | result |
|---|---:|---|
| none | 1 (issued *by the print*, too late) | DROPPED |
| **`<link rel=preload as=image>`** | **1** | **PAINTS** |
| `<img style="display:none">` | 2 | DROPPED |
| **preload + `<img>`** | **2, not 3** | **DROPPED** |

With a preload the page box costs **zero** extra requests — it is satisfied from
the resource the preload already fetched, without starting a new load. There is
no race left to win, *provided the preload entry is still there*. With
`preload + <img>` the count is 2, not 3: the `<img>` matched and **consumed**
the preload, and the page box then had to start a fresh fetch. Mechanism
established by counting, not by reading Blink.

**What this means for the risk profile.** The failure mode is **not** "a slower
asset server or a bigger image". On the print path the asset is a local file
staged beside `book.html`; there is no server to be slow. Measured: the
protection is stable across **0 ms, 5 s, 30 s and 120 s** between `load` and
`printToPDF`, with the renderer busy in a rAF/layout loop throughout —
`128.0360` at every gap, identical. A 292-page book that spends minutes in
audits is safe; #185 listed this as unmeasured and it now holds.

The failure mode is **identity**: the preload must exist and must not have been
consumed. §1.2 makes consumption unrepresentable, which is why the two halves of
this recommendation are one change and not two.

*(One genuine race remains, out of scope for the PDF path: a `--format html`
bundle served over a slow network and printed from the reader's browser can
still lose, exactly as the 2500 ms rows show. Named in §7.)*

---

## 3. The anomaly, explained — with a correction to my first pass

#185 §1e: a complete, verified-at-print-time hidden `<img>` **drops** through the
pipeline while the same staged document prints fine outside it, under five print
configurations and 0–12 s of delay. Reproduced four times, unexplained.

**Step 1 — which step (mine).** Bisecting the build's post-load sequence one CDP
call at a time, `<img>` guard, `file://` and `http://` identical, two
repetitions each:

| step added after `load` | `<img>` guard | tile fetches | `preload` guard |
|---|---|---:|---|
| *(none — load → print)* | PAINTS | 1 | PAINTS |
| **`Emulation.setDeviceMetricsOverride`** | **DROPPED** | 2 | PAINTS |
| `Emulation.setEmulatedMedia({media:"print"})` | PAINTS | 1 | PAINTS |
| ready probe (`fonts.ready` + 2×rAF) | PAINTS | 1 | PAINTS |
| 400 ms idle | PAINTS | 1 | PAINTS |
| **all three — the build's sequence** | **DROPPED** | 2 | **PAINTS** |

Two controls: it is **not the geometry** (overriding to the headless default
800×600 — no actual change — still drops) and **not HTTP cacheability** (with
`cache-control: max-age=3600` the extra network request disappears and it still
drops; the second request was a symptom, not the cause).

**Step 2 — the correction (#185's follow-up).** I concluded from the above that
it is *the `setDeviceMetricsOverride` call*. That is too coarse. #185 measured
the same document with the same post-load override, varying only the state
established **before navigation**:

| pre-navigation state | post-load override | result |
|---|---|---|
| puppeteer `defaultViewport: {800, 600}` | applied | **PAINTS** (15,620 B) |
| puppeteer `defaultViewport: null` | applied | **DROPS** (14,403 B) |

So it is **the first transition into an override after load** that defeats an
element reference. If the page was already under an override when it loaded, a
later override is not a first transition and nothing breaks.

**This reconciles everything.** My harness launched Chrome and navigated with no
prior override, so my 800×600 "no-change" override was still a *first*
transition — my result and #185's are the same phenomenon, and neither
measurement was wrong. It also explains #185 §1e's central puzzle: their
external puppeteer prints of the staged document carried puppeteer's default
viewport, i.e. they were run in the **immunised** state, which is why the same
document printed fine outside the pipeline and failed inside it.

**And it retracts one of my claims.** I wrote that the build "cannot" apply the
pin before navigation because the pinned size derives from `@page` CSS read after
load (`build.ts:362–386`). Geometry is irrelevant, so it *could* establish some
override early. §1.6 is why it must not.

**Behavioural rule (measured).** Under the build's print sequence — no override
established before load — a page-box `url()` paints on print #1 iff, at print
time, the URL is either **(a)** also resolved by a CSS rule outside `@page` (an
element's `background-image`, an inline `style`, a `data:` URI), or **(b)** named
by a `<link rel="preload">` that nothing else has consumed. An `[src]` element
provides neither — and removes (b).

**Inferred, not proven:** that (b) works because Blink satisfies the page-box
style-image request from `ResourceFetcher`'s preload list without a new load,
and that (a) works because a `StyleImage` resolved during load is reused. What
the first-transition-into-an-override actually invalidates is **unexplained by
anyone**. The behaviour is measured; the mechanism is not, and this
recommendation does not depend on it — which is precisely why §1.6 refuses to
build on it.

**Why the pipeline's `<img>` failure is not a bug of ours.** The viewport pin
exists for a documented, measured reason (`build.ts:370–386`: `vw`/`vh` units
resolving against whatever window state the browser is in, measured as a 0.84×
shrink-to-fit divergence). This is a deliberate, justified product decision
interacting with a Chromium defect.

---

## 4. The collision: found, solved by deletion, empirically disputed

### 4.1 What I measured

End to end through `gutterpress build`, 5×3 in page, 1,631,629 B `@page`
background (over the current threshold, so copied), each book differenced
against its own control:

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
| `smallmd` | 2,181 B tile as `@page` bg **and** `![](…)`, status quo | `136.7501` | PAINTS (`data:` URI) | no |

`varpre` independently confirms both proposals' central design point: the
collector must **not** be `@page`-scoped, because the custom-property form the
product sells to authors carries no `url()` inside the `@page` rule.

`remedy` is what proves §1.2 works by construction: the same bytes under two
names paint, because the page background's URL is one nothing else utters.

### 4.2 Why the answer is deletion, not detection

My first pass proposed detecting the collision and telling the author to keep a
separate copy. #185's answer is better and is what §1.2 adopts: **make the two
URLs different by construction, and there is nothing to detect.** A detector
covers the instance I found; content-addressing covers the class — including
plugin-emitted `<img>` tags, author raw HTML, and any future code path that puts
an element reference in the document. It is also less code: a deleted
conditional versus a new predicate.

### 4.3 What is disputed, and what does not depend on it

**#184 could not reproduce the collision** across 15 configurations with a
working positive control. That is a direct contradiction of §4.1 and it is not
resolved.

- **My rows are product-path rows.** They were produced by
  `bun packages/cli/src/cli.ts build`, which drives Chromium through the
  engine's own CDP client — a page with **no** device-metrics override before
  navigation.
- **The suspected cause** (the coordinator's hypothesis, unconfirmed) is that
  #184's harness ran under puppeteer's default viewport — precisely the
  immunised state §3 identifies. If that holds, both results are correct
  descriptions of different browser states, exactly as §3's correction resolved
  the earlier disagreement. #185 has been asked to publish the exact fixture so
  the confound can be tested.
- **Until that resolves, the collision is: reproduced by one agent through the
  product's own build path, not reproduced by another in a harness, with a
  specific suspected cause.** It is not settled fact and this document does not
  present it as one.

**Nothing in §1 depends on resolving it.** §1.2 is justified on its own
measurements — the `@page`-only, `var()` and four-box rows, and the fact that it
deletes code rather than adding it. If the collision turns out to be
unreproducible, §1.2 costs a duplicate file on disk in one rare bundle shape
and buys an invariant that makes a whole class of future failure impossible to
express. That is a trade worth taking on its own.

---

## 5. What gets deleted, concretely

| deleted | where |
|---|---|
| `IMAGE_INLINE_MAX_BYTES` (constant + export) | `packages/cli/src/lib/asset-inline.ts:28` |
| the `bytes.byteLength <= …` branch and its `dataUri` return for images | `asset-inline.ts:327–329` |
| **the in-project / out-of-project destination conditional** — every CSS image is content-addressed | `asset-inline.ts:331–341` |
| three threshold-pinned test cases (rewritten, not removed) | `asset-inline.test.ts:116, 128, 292` |
| the threshold's doc comments | `preview/server-context.ts:41`, `preview/http-server.test.ts:423` |
| the `[src]`-is-protective clause in the audit's `referenced` set | `engine/compiler/build.ts:1144–1183` |
| the unfollowable "add a `<link>` to the page head" remedy — in the diagnostic **and** in `known-limitations.md` §3 | `build.ts`, `docs/known-limitations.md` |
| the *"even a 1×1 invisible `<img>`"* advice, which is measurably false on the print path | `docs/known-limitations.md` §3 |
| **the rule that an image's fate depends on its byte count** | everywhere |
| **the rule that an image's fate depends on whether the book has a `target-counter()`** | everywhere |
| **the possibility that a CSS image URL and a prose image URL are the same string** | everywhere |
| **the preview↔print divergence for `@page` background images** | everywhere |

Net new code: one optional field, one `.map()`, one interpolation, a narrowed
predicate in a walk that already runs, and two tests.

**Corrected, not deleted:** `planImageCopies`'s doc comment
(`asset-inline.ts:463–466`), whose promise about the author's folder layout now
covers prose images only.

**Not deleted:** `engine.page-background.unreferenced` itself; font inlining;
`inlineShapeUrls`; `ServerState.cssAssets` and its preview route. #185 §1a is
correct and #183 §C4 is inverted — never-inline makes that plumbing carry
*more*, not less — and §1.2 goes further still: with every CSS image
content-addressed, the `assets/<hash>` preview route is now load-bearing for
**every** CSS image rather than only out-of-project ones. It stays, and it gets
more traffic.

---

## 6. The removal trigger, executable

Both proposals worry the shim will entrench and #184 conceded it had no
structural answer. The structural answer is an **expiry test that fails when the
shim becomes unnecessary**, living in the repo's own suite, not in a `tools/`
script someone has to remember to wire.

**The canary.** One test, in the engine's existing print-path test style: print a
standalone HTML fixture whose `@page` background `url()` is its **only**
reference, through the engine's own print path (the same
`setDeviceMetricsOverride` → `setEmulatedMedia` → ready probe → `printToPDF`
sequence, with no override before navigation), and assert the mean-abs-diff
against the same fixture without the declaration is `0.0000`. It asserts **the
bug is still there**. On the day Chromium fixes #152 it goes red, and its failure
message says: *delete the preload emitter in `assemble.ts` and this test.*

It must be a standalone fixture, not a built book — under §1.1 every built book
gets a preload, so a book fixture could never exercise the unprotected case. Its
launch configuration is part of the test: a canary that runs with a
pre-navigation override would be testing the immunised state (§3) and could pass
for the wrong reason.

**Why this and not `tools/page-background-repro.mjs` exit 2.** The script is not
the authoritative trigger: it prints with
`--print-to-pdf --virtual-time-budget=15000`, and §2 measures that this flag
changes the outcome for the preload control it validates. A trigger that runs a
browser configuration the product does not ship can pass — or fail — for reasons
the product will never have.

> **Resolved 2026-08-25 — neither `tools/` script is wired into CI.** This
> paragraph originally added "keep the script in CI as a cheap Chromium-level
> signal". Measured against what shipped in #188, that would have subtracted
> confidence rather than added it, so it is withdrawn. The canary is the whole
> mechanism.
>
> - **The canary already runs in CI and is not skipped.** CI's `test` job
>   (`bun --filter gutterpress test`) installs Chrome and Ghostscript, so
>   `testIf` resolves to `test`. Run `32812569951` on `0b35fe3` logs
>   `(pass) CANARY: Chromium still drops an @page background image that nothing
>   else references [1463.87ms]` — no skip warning. Added wall-clock for the
>   trigger today: **zero**. `setup-chrome`'s `chrome-version: stable` and the
>   runner image's own Chrome both move, so the trigger is re-evaluated against
>   a current stable Chromium on every run, with nothing to bump.
> - **The launch-config warning above is satisfied, executably.** Assertion 3
>   measures `viaElement`, and an `<img>` reference must NOT protect the page
>   box. Measured `0.0000` locally and green in CI, so neither browser is in
>   the immunised state (§3). Assertion 2 measures `painted = 230.7204`: the
>   `0.0000` in assertion 1 is Chromium dropping the image, not a harness
>   printing blank paper. Its red path was re-confirmed by inverting assertion
>   1, which fails with the intended *"the bug this shim exists for is FIXED"*
>   message.
> - **The repro script would put two contradictory expectations in one CI.**
>   Its `page-url-img` control asserts an `<img>` reference PAINTS — the
>   immunised behaviour — because `--virtual-time-budget=15000` and
>   `--print-to-pdf` put it in a different browser state from the product's
>   print path, where the canary asserts the exact opposite. Non-blocking it
>   makes a job that cannot fail; blocking it makes exit 2 a *false* removal
>   trigger fired by a flag we do not ship. Cost measured: 15.4 s locally plus
>   a `poppler-utils` install CI does not currently do.
> - **The mechanism script's only failure mode misdirects.** Its A-row-1
>   control expects DROPPED, so the day Chromium fixes #152 it exits 1 with
>   `HARNESS BROKEN … Fix the harness or the environment` — the opposite of the
>   correct action. It also gates CI on the *explanation*, which the canary's
>   own header refuses on the grounds that three earlier explanations of this
>   defect were wrong. Its most load-bearing control (`<img>` + override after
>   load → DROPPED) is already assertion 3, measured on the product's own print
>   path rather than a CDP replica. Cost measured: 18.7 s locally, same missing
>   dependency.
>
> Both scripts stay as investigation tools — run by hand, with their conditions
> printed — which is what they were built to be.

**Where the boundary is.** One `.map()` in `assemble.ts`, one field in
`markdown/index.ts`. The header comment on those four lines records the spec gap
(#152), what proves it is still needed (the canary), and what to delete.

Note that §1.2 has **no** removal trigger and needs none: content-addressing is
not a shim. It is an asset-naming policy that would be defensible with #152
fixed tomorrow, and deleting it would be a plain regression in collision safety,
not the retirement of a workaround. It should not be filed under
"things to remove when Chrome catches up".

---

## 7. Residual risks, stated plainly

1. **The invariant in §1.2 is load-bearing and only one test deep.** "A CSS URL
   and a prose URL can never coincide" is now the reason the fix holds. §1.5's
   test and §1.4's repaired audit are the two guards; a change that made asset
   names friendlier would have to defeat both to reintroduce the failure, but
   both are small and a determined refactor could take them with it.

2. **A both-ways asset ships twice in a `--format html` bundle**, and the
   author's folder layout no longer describes what ships for CSS images. Visible
   rather than silent, and byte-equivalent in the PDF (§1.2) — but a real
   legibility cost that someone who values bundle tidiness may weigh
   differently.

3. **The collision itself is disputed (§4.3).** If #184's non-reproduction is
   right and mine is an artefact, §1.2 is buying an invariant against a failure
   that does not occur, at the cost of item 2. I do not believe that — my rows
   are product-path rows — but I cannot close it here.

4. **The mechanism behind §3 is unexplained by anyone.** We know *what* defeats
   an element reference (the first transition into an override after load); no
   one knows *why*. The preload is immune to it in every configuration measured,
   which is the main reason to prefer the preload over any element-based second
   reference — but "immune in every configuration measured" is not "immune".

5. **The CLI and the desktop host may not be in the same browser state.** The
   CLI drives a fresh CDP page with no override before navigation; the desktop
   prints from a real Electron `BrowserWindow`. Whether the desktop is in the
   immunised state is **unmeasured**. If it is, the two hosts disagree today
   about which second references work — a divergence the preload fix hides
   rather than causes, and one worth measuring before someone relies on host
   behaviour.

6. **A published `--format html` bundle can still lose the race.** Served over a
   slow network and printed from the reader's browser, a preload that has not
   landed by print time drops the background (measured: 2500 ms hold →
   DROPPED). The PDF path is immune because it prints from staged local files.
   We do not control the reader's browser.

7. **Unused preloads are still fetched.** A CSS image behind a `@media screen`
   block or an unused component is preloaded regardless. On the print path that
   is a local file read; in a published HTML bundle it is a real download.
   Accepted, per #185 §4 — the predicate that would avoid it is the machinery,
   and targeting is what breaks the `var()` shape.

8. **A remote `url(https://…)` in `@page` is untouched.** The inliner leaves it
   alone and it is not in the copy plan, so no preload is emitted and it still
   drops. §1.4's repaired audit is the only thing that reports it.

9. **Chromium can change any of this without notice.** The behavioural rule in
   §3 is measured on one build of Chrome 151 on Linux. Windows and macOS are
   unmeasured. The canary converts "silently stops working" into "CI goes red"
   only for the bug's *disappearance*; a change that breaks the *fix* is caught
   by the end-to-end regression test, and only if that test is genuinely end to
   end.

10. **Entrenchment is reduced, not eliminated.** #184 is right that a workaround
    which works and is invisible has no constituency for removal. The canary
    answers the mechanical half. The structural half is that the emitter's
    deletion is four lines and a test — small enough that the day CI goes red,
    deleting it is the cheapest way to make CI green again. That is the best
    incentive available; it is not a guarantee.

---

## 8. What must be seen red first

Per `memory:tests-must-be-seen-red-first`, and because every fixture that
"verified" `@page { background }` for months passed regardless of the bug:

1. **The end-to-end regression test** — build a book whose `@page` background is
   over the old threshold, assert a non-zero mean-abs-diff against the same book
   with the declaration removed. **Must be observed reading `0.0000` against
   `release/0.10.2`** before the emitter lands. A test that does not fail red
   here is not testing this.
2. **The invariant test (§1.5)** — must be observed failing against
   `release/0.10.2`, where an in-project CSS image and a prose image of the same
   file produce the *same* destination. That red is the whole point: it is the
   assertion that a future refactor would have to consciously delete.
3. **The audit-repair test (§1.4)** — a book with an element reference to a CSS
   image URL must warn. Against `release/0.10.2` *and* against the
   emitter-without-repair state, it must be observed producing **zero**
   warnings. This is the easiest red to skip, because by then the feature
   "works".
4. **The expiry canary (§6)** — observed **green** on Chrome 151 (the bug
   reproduces) and observed **red** by temporarily inverting its assertion, so
   its failure path is known to work rather than assumed. Its launch config must
   be checked for a pre-navigation override (§3), or it can pass for the wrong
   reason.

Also required before merge, per #185 §8: `scripts/native-parity-gate.ts` green
with an empty allowlist. A `<link>` in `<head>` establishes no box and page
counts were unchanged in every build here, but the gate is the contract and it
was not run.

---

## 9. Evidence discipline

**Measured by me** (Chrome 151.0.7922.75, Linux x64, 2026-08-24):

| # | claim | evidence |
|---|---|---|
| 1 | a preload does not delay `load` | beacon at 237 ms, response held 2500 ms, print DROPPED |
| 2 | an `<img>` does delay `load` | beacon at 2729 ms, response at 2726 ms, PAINTS |
| 3 | `--virtual-time-budget=15000` is what makes #184's preload paint | beacon 217 ms (early) but print deferred to 2712 ms; PAINTS |
| 4 | the build's own CDP sequence drops a preload at 2500 ms delay | `0.0000` |
| 5 | with a preload the page box costs **zero** extra fetches | 1 tile request |
| 6 | an `<img>` **consumes** the preload | `preload+img` = 2 tile requests, not 3 |
| 7 | `setDeviceMetricsOverride` is the step that defeats `<img>`; media, ready probe and idle are not | 7-step bisect × 2 reps, http + file |
| 8 | it is not the geometry | identical-size override (800×600) still DROPS |
| 9 | it is not HTTP cacheability | `max-age=3600`: 1 fetch, still DROPS |
| 10 | preload protection survives long gaps | `128.0360` at 0 / 5 s / 30 s / 120 s |
| 11 | real pipeline: status quo drops, preload paints | `0.0000` → `141.2847`, PDF 6,223 B → 1,171,321 B |
| 12 | real pipeline: `var()` shape paints with the preload | `141.2847` |
| 13 | real pipeline: element/prose collision drops **with** the preload | `preimg`, `mdimg`, `premd` all `0.0000` |
| 14 | real pipeline: separate-copy destinations paint | `remedy` `141.5137` |
| 15 | under-threshold collision books paint today via `data:` | `smallmd` `136.7501` |
| 16 | the audit is silent on every failing shape once a preload is emitted | 0 warnings on `pre`/`img`/`preimg`/`mdimg`/`premd` |

**Measured by #185, taken here without re-measuring:** the v2 rows in §1.2
(`0.0000`→`91.2541` for `@page`-only and `var()`; `0.0000`→`89.1921` for page box
+ 3 margin boxes; collision unchanged at `101.6601`); the
`defaultViewport: {800,600}` vs `null` transition (15,620 B vs 14,403 B); the
`gutterpress preview` always-inline cost (4,915,559 B / 3,625 ms vs 72,439 B /
1,006 ms).

**Measured by #184, taken here without re-measuring:** PDF byte-equivalence for
a both-ways asset (800,220 B / 1 shared object vs 800,216 B / 1 object, 8-page
book, 480,771 B image); that hashed names never surface in author-facing output
(`auditContent` names by `tag#id.class`; `readOrThrow` names absolute source
paths); the non-reproduction of the collision across 15 configurations (§4.3).

**Taken from #183 without re-measuring:** print counts for `over` (1) and
`over-xref` (2); the `data:` URI immunity.

**Read from source, not measured:** `pluginCss` bypassing `inlineStyles`
(`assemble.ts:66,110,180`); `copies` as a dest-keyed Map excluding fonts, shapes
and remote urls (`asset-inline.ts:300–342`); the audit's `[src],[href]`
predicate (`build.ts:1144–1183`); the fixed `<head>` and absent manifest key
(`assemble.ts:184–196`); `sheetViewport` deriving from post-load CSS
(`build.ts:362–386`) and the prediction page pinning pre-navigation
(`build.ts:1664–1665`); `planImageCopies`'s folder-layout promise
(`asset-inline.ts:463–466`); `--virtual-time-budget=15000` in
`tools/page-background-repro.mjs:243–245`; `url(...)` in `gutterpress-css.ts`
comments at lines 39, 229, 231.

**Disputed, not settled:** whether the element/prose collision reproduces
(§4.3). Reproduced by me through `gutterpress build`; not reproduced by #184
across 15 harness configurations; suspected confound is a pre-navigation
viewport override (§3), unconfirmed pending #185 publishing the fixture.

**Not measured:**

- **Windows and macOS.** Linux only.
- **The desktop host's browser state** (residual risk 5) — whether an Electron
  `BrowserWindow` is in the immunised state of §3.
- **A book with many CSS images.** Every fixture here had one or two.
- **`dc-op-manual` end to end.** Read-only, and not rebuilt here. #184's
  acceptance test — build the field guide with the `html { background }` rule
  removed and check its 292 pages — remains the honest final check, and it is
  exactly the experiment the product owner already ran and lost.
- **The parity gate.** §8.
- **Whether element types other than `<img>` consume a preload.** Tested:
  `<img>` hidden, `<img>` visible, markdown prose image. Not tested:
  `<video poster>`, `<object>`, CSS `content: url()`.
- **Why the first transition into an override invalidates an element-owned
  image.** Unexplained by any agent; §1.6 is written so nothing depends on it.
