# Why the `@page` background drops — the mechanism

**Analysis only. No product code changed.** `git diff` against `release/0.10.2`
is this document plus `tools/page-background-mechanism.mjs`.

#183 established *that* a `url()` referenced only from an `@page` rule is
requested by the print and painted without waiting. #185 and #186 built a fix
around that, and both stated plainly that they could not explain three of their
own measurements. This document explains all three, from Chromium source read at
**the exact tag under test**, with every claim split into MEASURED and INFERRED.

Two of the three turn out to be the same mechanism seen from different sides,
and the disputed collision is settled: **#186 reproduced a real defect, #184's
harness was immunised by puppeteer's `defaultViewport`, and the confound is
confirmed with source on both sides.**

---

## 0. The three answers

| # | Question | Answer | Status |
|---|---|---|---|
| 1 | Why is an `@page`-only `url()` not fetched during load? | `@page` style is produced *only* by `StyleResolver::StyleForPage`, which nothing in the document lifecycle calls; `CSSImageValue::CacheImage` fetches lazily at style resolution. And the print does not wait because **`PrintRenderFrameHelper::PrintWithParams` — the CDP `Page.printToPDF` path — never calls `WillPrintSoon()`**, the 2-second pre-print resource wait that the *user* print path does call. | **Explained.** Source read at tag 151.0.7922.75 + measured. |
| 2 | Why does the first transition into a device-metrics override defeat a hidden `<img>`? | `DevToolsEmulator::EnableDeviceEmulation` calls **`MemoryCache::Get()->EvictResources()`** when `!device_metrics_enabled_`, and CDP's `Emulation.setDeviceMetricsOverride` always sends `cache_behavior = kClearCache`. The `<img>`'s completed `Resource` becomes unfindable; the print starts a fresh async load. | **Explained.** Source read at tag 151.0.7922.75 + measured, deterministic 12/12. |
| 3 | Why is a preload consumable by an `<img>` but shared by many style consumers? | Two different caches. `ResourceFetcher::MatchPreload` **erases** the entry (`preloads_.erase(it)`) for the first *real* consumer, and `PreloadKey` is `(url, ResourceType)` with no initiator in it — so an `<img>` takes it. The sharing among style consumers is **not** the preload at all: it is `StyleImageCache::fetched_image_map_`, a URL-keyed map on the `StyleEngine` that never reaches the fetcher. | **Explained.** Source read at tag 151.0.7922.75 + measured. |

The reason #2 and #3 looked like separate puzzles: **`preloads_` is a strong map
and `cached_resources_map_` is a weak one.** `MemoryCache::EvictResources()`
reaches the second and cannot reach the first. That single asymmetry is the whole
of "preload survives, `<img>` does not".

---

## 1. Harness conditions — read this before any number below

This defect has been misdiagnosed three times by harness artefacts. **Four knobs
silently invert the outcome.** Every measurement in this document names all four,
and the fixture prints them.

| knob | what it does | where it bit |
|---|---|---|
| a device-metrics override established **before navigation** | first transition happens before the resource exists, so the eviction has nothing to evict — **immunises an `<img>` guard** | #184's 15 negative configurations |
| `--virtual-time-budget` | the print waits for network quiescence; the load event does not — converts a drop into a paint | `tools/page-background-repro.mjs` passes `=15000`; #184 §1b inherited it and retracted |
| `file://` vs `http://`, and the response's `cache-control` | `no-store` takes the reuse decision down a different branch (§5.3) | the intermittent rows in §5 |
| number of prints | print #2 paints, because `StyleImageCache` retains the now-loaded image | #183 §A2 |

**Everything below**, unless a row says otherwise: Chrome **151.0.7922.75**,
`--headless=new`, driven over **raw CDP** with node's built-in `WebSocket` (not
puppeteer — puppeteer's defaults are one of the variables), the launch flags
`packages/cli/src/engine/shared/cdp.ts:149-162` uses, **no
`--virtual-time-budget`**, and the build's own post-load sequence
(`Emulation.setDeviceMetricsOverride` → `Emulation.setEmulatedMedia({media:"print"})`
→ the ready probe → one `Page.printToPDF`), matching
`packages/cli/src/engine/compiler/build.ts:386-394`.

Every cell is differenced against **its own** control — the same document with
the `@page` `url()` removed — so `0.0000` means the declaration changed nothing.
Rows marked *(control)* must come out as stated; a run where they do not is void.

**Reproduce it:**

```
node tools/page-background-mechanism.mjs           # the full table
node tools/page-background-mechanism.mjs --n 12    # repetitions, for §5
```

Zero npm dependencies. Requires `google-chrome` (or `$CHROMIUM_PATH`) and
`pdftoppm`. It generates its own tile rather than committing one, for #183's
reason: a committed fixture can acquire a second reference from anything else in
the repo and then passes regardless of the bug.

**Source citations.** Every Chromium line quoted below was fetched from
`https://raw.githubusercontent.com/chromium/chromium/151.0.7922.75/<path>` — the
**tag of the browser that produced the measurements**, not `main`. Line numbers
are that tag's.

---

## 2. Question 1 — why an `@page`-only `url()` is not fetched during load

### 2.1 The answer

Two independent facts, both now read from source:

**(a) `@page` style is never computed outside pagination.** The only producer of
an `@page` `ComputedStyle` is `StyleResolver::StyleForPage`
([style_resolver.cc:2176](https://raw.githubusercontent.com/chromium/chromium/151.0.7922.75/third_party/blink/renderer/core/css/resolver/style_resolver.cc)),
and it ends with `state.LoadPendingResources()` (line 2260) — which is what turns
a pending `background-image` into a real `StyleImage`, via
`ElementStyleResources::LoadPendingImages`'s `kBackgroundImage` case, with no
pagination exclusion. Its callers are pagination-only: `LoadPaginationResources`
(style_resolver.cc:2333), `CalculateInitialContainingBlockSizeForPagination`
(pagination_utils.cc), and `LayoutPageBorderBox`
(page_container_layout_algorithm.cc).

The fetch itself is lazy:

```cpp
// third_party/blink/renderer/core/css/css_image_value.cc:113
StyleImage* CSSImageValue::CacheImage(Document& document, ...) {
  if (!cached_image_) {
    ...
    ImageResourceContent* image_content =
        document.GetStyleEngine().CacheImageContent(params);
    cached_image_ = MakeGarbageCollected<StyleFetchedImage>(...);
  }
  return cached_image_.Get();
}
```

So: parse produces a `CSSImageValue` and **no fetch**; nothing resolves `@page`
style during load; the first thing that does is the print.

**(b) The CDP print path has no resource wait — structurally.** This is the part
nobody had. Chromium *does* have a pre-print wait, added in M128: `Document::
WillPrintSoon()` → `InitiateStyleOrLayoutDependentLoadForPrint()` →
`StyleResolver::LoadPaginationResources()`, after which it returns
`fetcher_->BlockingRequestCount() > 0` so the caller can defer for up to
`kLoadEventTimeout = base::Seconds(2)`
([print_render_frame_helper.cc:2641](https://raw.githubusercontent.com/chromium/chromium/151.0.7922.75/components/printing/renderer/print_render_frame_helper.cc)).

`WillPrintSoon()` is called from exactly two places in that file at tag 151:

- line **1341**, in `PrintRequestedPages` — the user-initiated print path;
- line **2688**, in the print-preview path.

`Page.printToPDF` reaches the renderer through
`print_to_pdf::PdfPrintJob` → `PrintRenderFrameHelper::PrintWithParams`
(line **1368**). Its body goes straight from `prep_frame_view_->EnterPrintMode(...)`
to `PrintPages(); FinishFramePrinting();` — **no `WillPrintSoon()`, no
`on_stop_loading_closure_`, no `SetupOnStopLoadingTimeout()`.**

So the mechanism that would have saved us exists, is wired into two other print
paths, and is absent from ours.

**(c) Why it never repaints.** The page box is an *anonymous* `LayoutBlockFlow`
created per print by `PaginationState::CreateAnonymousPageLayoutObject` and
destroyed by `DestroyAnonymousPageLayoutObjects()` when print mode ends
(`local_frame_view.cc`). It *does* register as an `ImageResourceObserver` while
alive (`LayoutObject::SetStyle` → `UpdateImageObservers` → `AddAsImageObserver`)
and deregisters in `WillBeDestroyed`. There is no live page box after the print
to invalidate. "Never repaints" is structural, not a missing invalidation.

**(d) Why print #2 paints.** `StyleImageCache::fetched_image_map_` is keyed by URL
on the `StyleEngine` and outlives the print, so the second `StyleForPage` gets the
now-loaded `ImageResourceContent`.

### 2.2 The evidence

MEASURED (`tools/page-background-mechanism.mjs`, §A and §D):

| case | result | tile requests | print #1 |
|---|---|---:|---:|
| `@page url()`, sole reference *(control: must drop)* | **DROPPED** `0.0000` | 1 | 15 ms |
| … printed twice *(control: must paint)* | **PAINTS** | 1 | — |
| … + `<link rel=preload>` *(control)* | **PAINTS** | 1 | 17 ms |
| … + element `background-image` *(control)* | **PAINTS** | 1 | 16 ms |
| page box + 3 margin boxes, one preload *(control)* | **PAINTS** | **1** | 19 ms |

**The print issues the request, and a 2-second gap proves it is not the
override.** Same document, `<img>` guard, `setDeviceMetricsOverride` at +20 ms,
then a 2000 ms sleep, then the print:

```
    20ms  » setDeviceMetricsOverride
  2021ms  » printToPDF called
  2029ms  REQ#2 initiator=other prio=Low     <-- 8ms after the print, 2009ms after the override
  2030ms     #2 finished 867B
  2057ms  » printToPDF returned              <-- resource complete 27ms before the PDF came back
```

**The print does not wait, and does not incorporate a resource that lands
mid-print.** Tile held 1500 ms server-side, no post-load steps:

| document | load event | print #1 |
|---|---:|---:|
| `@page url()` only | +26 ms | **21 ms** |
| + `<img>` (blocks the load event) | +1520 ms | 20 ms |
| + `<link rel=preload>` (blocks nothing) | +36 ms | 31 ms |

A print that waited would be ≥1500 ms. None is. This also independently confirms
the load-blocking asymmetry #185 §1d measured, and its source: `ResourceType::kImage`
is load-event-blocking (`resource.cc`), but `ResourceFetcher::StartLoad` puts
`IsLinkPreload()` resources into `non_blocking_loaders_` instead of `loaders_`,
and `Document::ShouldComplete()` only counts `loaders_`.

And with `cache-control: max-age=3600`, the page box's second request is served
from the **disk cache in 1 ms** and the page **still drops** — the print does not
yield even for that.

### 2.3 MEASURED vs INFERRED

- **MEASURED**: no request during load; the request is issued by the print (2 s
  gap); the print never waits (1500 ms hold, 21 ms print); a resource completing
  mid-print is not painted; print #2 paints; one fetch serves four style consumers.
- **READ AT TAG 151**: `StyleForPage` is the only `@page` style producer and its
  callers are pagination-only; `CacheImage` is lazy; `PrintWithParams` does not
  call `WillPrintSoon`; `kLoadEventTimeout = 2s`; the anonymous page box is
  created and destroyed per print.
- **INFERRED**: that the specific `StyleForPage` call our request comes from is
  the one in `LoadPaginationResources` rather than the one in
  `PageContainerLayoutAlgorithm`. Both are inside the print call and the
  distinction changes nothing, but I did not separate them — release Chrome has no
  `DetermineRevalidationPolicy` / `StyleForPage` trace events (I captured 8,189
  events across `blink`, `blink.debug`, `disabled-by-default-network`,
  `devtools.timeline` and found none), so the two could not be told apart.
- **NOT ESTABLISHED**: that `StyleForPage` has no non-pagination caller anywhere
  in Chromium. The three known callers came from grepping the ~20 files fetched,
  not a whole-tree search.

### 2.4 What would break this

Any of these makes the fix unnecessary or ineffective; each is a concrete thing
to test or watch:

1. **`PrintWithParams` gains a `WillPrintSoon()` call.** This is the single most
   likely upstream fix, it is a two-line change, and the surrounding code already
   does it twice. When it lands, a bare `@page url()` starts painting on print #1
   and the preload becomes dead weight. **Watch:** the `print1` column in §D of
   the fixture going from ~20 ms to ~1500 ms.
2. **`LoadPaginationResources` widens.** Its `TODO(crbug.com/346799729)` says only
   `@page` rules matching *page 0 with no page name* are pre-resolved today.
   Widening it is necessary but not sufficient — (1) is what actually makes the
   print wait.
3. **The paint stops being synchronous with style resolution**, e.g. if the page
   container gained a repaint-on-image-load path that survives the print.
4. **`StyleImageCache` stops being URL-keyed on the `StyleEngine`.** Then print #2
   would stop painting, and the "many style consumers, one fetch" row would go to
   four fetches — which would also break the four-margin-box case that
   `dc-op-manual` depends on.

---

## 3. Question 2 — the device-metrics override

### 3.1 The answer

`Emulation.setDeviceMetricsOverride` **wipes Blink's entire MemoryCache** the
first time it turns device emulation on. Verbatim, at the tag under test:

```cpp
// third_party/blink/renderer/core/inspector/dev_tools_emulator.cc:275
gfx::Transform DevToolsEmulator::EnableDeviceEmulation(
    const DeviceEmulationParams& params,
    const mojom::blink::DeviceEmulationCacheBehavior& cache_behavior) {
  if (device_metrics_enabled_ && emulation_params_.view_size == params.view_size && ...) {
    return ComputeRootLayerTransform();                     // 287: cheap no-op path
  }
  if ((emulation_params_.device_scale_factor != params.device_scale_factor ||
       !device_metrics_enabled_) &&                          // 289-290
      cache_behavior ==
          mojom::blink::DeviceEmulationCacheBehavior::kClearCache) {
    // The MemoryCache does not take device parameters into account when
    // invalidating the cache because the device is normally the same.
    // With device emulation the device parameters can change and, therefore,
    // DevToolsEmulator::EnableDeviceEmulation clears the memory cache if the
    // user changes the emulation params.
    // ...
    MemoryCache::Get()->EvictResources();                    // 307
  }
  emulation_params_ = params;
  device_metrics_enabled_ = true;                            // 311
```

The predicate is `!device_metrics_enabled_` — **not** whether the viewport
actually changed. And the CDP command always asks for the wipe:

```cpp
// content/browser/devtools/protocol/emulation_handler.h:151
  void UpdateDeviceEmulationState(
      const blink::mojom::DeviceEmulationCacheBehavior& cache_behavior =
          blink::mojom::DeviceEmulationCacheBehavior::kClearCache);
```

(the RenderFrameHost re-sync path explicitly passes `kKeepCache` instead — the
distinction exists precisely to separate "a user changed the emulation" from
"we re-applied the same emulation").

`EvictResources()` clears `resource_maps_` and both strong-reference lists
(`memory_cache.cc`). It has **no access to** `ResourceFetcher::preloads_` — the
MemoryCache is a global, `preloads_` is per-fetcher.

Then the lookup at print time can find a resource only two ways
([resource_fetcher.cc:1490-1508](https://raw.githubusercontent.com/chromium/chromium/151.0.7922.75/third_party/blink/renderer/platform/loader/fetch/resource_fetcher.cc)):

```cpp
    resource = MatchPreload(params, resource_type, preloads_list_iterator);
    if (resource) {
      policy = RevalidationPolicy::kUse;                     // 1492: no validation at all
      ...
    } else if (IsMainThread()) {
      resource = MemoryCache::Get()->ResourceForURL(params.Url(), cache_identifier);
      if (resource) {
        policy = DetermineRevalidationPolicy(...);
      }
    }
```

Post-eviction the second lookup returns `nullptr`, so `policy` keeps its
initialiser `kLoad` and a fresh async load starts. And a fresh load cannot paint,
because `ImageResourceContent::AddObserver` notifies a new observer
**synchronously** only when the image is already loaded.

The storage-class asymmetry is the whole story
([resource_fetcher.h:216, 673, 691-692](https://raw.githubusercontent.com/chromium/chromium/151.0.7922.75/third_party/blink/renderer/platform/loader/fetch/resource_fetcher.h)):

```cpp
216|   using DocumentResourceMap = HeapHashMap<String, WeakMember<Resource>>;
673|   DocumentResourceMap cached_resources_map_;                  // WEAK
691|   HeapHashMap<PreloadKey, Member<Resource>> preloads_;        // STRONG
692|   HeapVector<Member<Resource>> matched_preloads_;             // STRONG
```

### 3.2 The evidence

MEASURED, n=12 per cell, http, `no-store`, build sequence — **every cell
deterministic**:

| guard | pre-nav override | result | tile requests |
|---|---|---|---:|
| none *(control: must drop in both)* | — | 12/12 DROPPED | 1 |
| none *(control)* | yes | 12/12 DROPPED | 1 |
| hidden `<img>` | — | **12/12 DROPPED** | **2** |
| hidden `<img>` | yes | **0/12 dropped** | **1** |
| `<link rel=preload>` | — | 0/12 dropped | 1 |
| `<link rel=preload>` | yes | 0/12 dropped | 1 |
| element `background-image` | — | 0/12 dropped | 1 |

**Printing is not involved in the mechanism at all.** Replacing the print with a
script that appends one consumer of the same URL 600 ms later, and reading only
whether that consumer cost a network request:

| owner of the resource | later consumer | no override | after `setDeviceMetricsOverride` |
|---|---|---|---|
| hidden `<img>` | element `background-image` | reused | **REFETCH** |
| hidden `<img>` | another `<img>` | reused | **REFETCH** |
| element `background-image` | element `background-image` | reused | reused |
| element `background-image` | another `<img>` | reused | **REFETCH** |
| CSS rule `background-image` | element `background-image` | reused | reused |
| CSS rule `background-image` | another `<img>` | reused | **REFETCH** |
| `<link rel=preload>` | either | reused | reused |

Read the table as the two caches: the rows that survive are the ones that never
reach the fetcher (style→style, served by `StyleImageCache`) or that reach it
through `preloads_`. Everything that must go through
`MemoryCache::ResourceForURL` refetches.

**Knob sweep** — the same probe, varying only what is called after load
(guard = hidden `<img>`, later consumer = element background):

| call | refetch? |
|---|---|
| *(nothing)* | reused |
| `setDeviceMetricsOverride` 480×288 dsf=1 mobile=false | **REFETCH** |
| … dsf=0 / dsf=2 / mobile=true / 800×600 (no size change at all) | **REFETCH** (all) |
| `clearDeviceMetricsOverride` (never set) | reused |
| `setEmulatedMedia({media:"print"})` | reused |
| `setPageScaleFactor` 1 or 2 | reused |
| `setDefaultBackgroundColorOverride` | reused |
| `setEmulatedVisionDeficiency` | reused |
| `setCPUThrottlingRate` | reused |
| `setFocusEmulationEnabled` | reused |
| `Page.setFontSizes` | reused |
| `Network.setCacheDisabled true` | **REFETCH** |
| `HeapProfiler.collectGarbage` | reused |
| `Memory.simulatePressureNotification critical` | reused |
| second override while already enabled (size change only) | reused |
| pre-nav override, then `clearDeviceMetricsOverride` | **REFETCH** |

This is exactly the shape `!device_metrics_enabled_` predicts: parameters are
irrelevant, the enabled-bit transition is everything, and no other emulation knob
touches the cache. `Network.setCacheDisabled` matching is a shape analogy only —
it takes a different route to "the fetcher will not reuse".

### 3.3 MEASURED vs INFERRED

- **MEASURED**: the trigger is the transition of the device-emulation enabled
  bit, not its parameters; it is deterministic (12/12); it affects any consumer
  that must go through the fetcher's cache; it has nothing to do with printing;
  no other `Emulation.*` call does it; a forced GC does not.
- **READ AT TAG 151**: `EnableDeviceEmulation`'s eviction and its
  `!device_metrics_enabled_` predicate; CDP's `kClearCache` default;
  `EvictResources()`'s scope; the weak/strong storage classes; that
  `MediaQueryAffectingValueChanged` (the other thing the branch does) is gated on
  `AffectedByMediaValueChange` and clears nothing.
- **INFERRED**: that the eviction is *the* cause rather than merely co-located
  with it. The join is very tight — the predicate's shape matches the measured
  trigger exactly, including the counter-intuitive "identical 800×600 still
  breaks it" and the `preloads_`/`StyleImageCache` survivors — but release Chrome
  emits no trace event for either the eviction or the reuse decision, so the two
  were not observed in the same process.
- **DID NOT REPRODUCE**: the `device_scale_factor != params.device_scale_factor`
  half of the predicate. A pre-nav override followed by a post-load override with
  a *different* DSF (verified via `devicePixelRatio` going 1 → 2) did **not**
  cause a refetch. Either that clause does not reach `EnableDeviceEmulation` from
  the CDP path, or something else intervenes. **Unexplained, and bounded to that
  clause** — it does not affect any conclusion here, because the build only ever
  makes a first transition.
- **DID NOT REPRODUCE**: `Memory.simulatePressureNotification` evicting anything.
  So "any memory-cache purge does this" is *not* established; only the emulation
  transition was observed to.

### 3.4 What would break the fix

1. **The eviction is deleted or narrowed upstream.** It is already conditional
   (`kClearCache` vs `kKeepCache`), and its comment reads like something that
   would rather not exist. If `EnableDeviceEmulation` stopped evicting, an `<img>`
   guard would start working and the whole "element references are fatal" rule in
   §5 evaporates. **Watch:** §B of the fixture — "`<img>` guard, override AFTER
   load" flipping from DROPPED to PAINTS.
2. **Gutterpress establishes a viewport override before navigation.** This would
   immunise the build, and #185 §1f already recorded the argument against doing it
   deliberately. But it could happen *by accident*: switching the CLI from raw CDP
   to puppeteer, or routing a build through a pooled browser that already has an
   override, silently changes the browser state and would make the collision
   untestable. **Watch:** any change to `build.ts:386` or to how
   `launchChromium`/`connectChromium` obtain a page.
3. **The desktop host is not measured.** The CLI drives a fresh CDP page with no
   pre-navigation override. The desktop app prints from a real Electron
   `BrowserWindow`, whose emulation state at print time is **unknown**. If it
   already has an override, desktop builds are in the immunised state and a
   CLI-only test proves nothing about them. This is #186 §7's residual risk 4 and
   it is still open.
4. **`preloads_` stops being a strong map**, or `ClearPreloads` starts running
   with `kClearAllPreloads` before the print. Either removes the survivor.

---

## 4. Question 3 — one preload, many style consumers, one `<img>`

### 4.1 The answer

The premise contains a false step. **The preload is not what is shared.**

`ResourceFetcher::MatchPreload` erases the entry for the first real consumer,
unconditionally on that path
([resource_fetcher.cc:1912-1914](https://raw.githubusercontent.com/chromium/chromium/151.0.7922.75/third_party/blink/renderer/platform/loader/fetch/resource_fetcher.cc)):

```cpp
1912|   resource->MatchPreload(params);
1913|   preloads_.erase(it);
1914|   matched_preloads_.push_back(resource);
```

and the key carries nothing that could tell an `<img>` from a CSS image
(`preload_key.h`):

```cpp
20|   PreloadKey(const KURL& url, ResourceType type)
21|       : url(RemoveFragmentFromUrl(url)), type(type) {}
```

`Resource::CanReuse` is equally indifferent — its own comment says
*"initiator_info is purely informational and should be benign for re-use"*
(`resource.cc`) — and there is no `ImageResource::CanReuse` override. So an
`<img>` and a page-box background are, by construction, the same preload
consumer.

**What actually shares among style consumers is a different cache entirely.**
`CSSImageValue::CacheImage` → `StyleEngine::CacheImageContent` →

```cpp
// third_party/blink/renderer/core/css/style_image_cache.cc:24
ImageResourceContent* StyleImageCache::CacheImageContent(
    ResourceFetcher* fetcher, FetchParameters& params) {
  const KURL url_without_fragment = MemoryCache::RemoveFragmentIdentifierIfNeeded(params.Url());
  auto& image_content = fetched_image_map_.insert(url_without_fragment.GetString(), nullptr)
          .stored_value->value;
  if (!image_content || !CanReuseImageContent(*image_content)) {
    image_content = ImageResourceContent::Fetch(params, fetcher);
  }
  return image_content.Get();
}
```

A URL-keyed map on the `StyleEngine`. The **first** style consumer to resolve
takes the preload (or loads); consumers 2..N hit `fetched_image_map_` and never
call `RequestResource` at all. Page box + three margin boxes = one fetch, whether
or not there is a preload.

So the real rule is:

> A `<link rel=preload>` is a **single-use** ticket held in a strong map. A
> `StyleImage` is a **shared** object held in a different, style-level map. The
> preload's job is only to get the first style consumer over the line; after that
> the style cache does the sharing. An `<img>` spends the ticket without ever
> touching the style cache — so the page box arrives to find both empty.

### 4.2 The evidence

MEASURED, build sequence, no pre-nav override, `file://` (the build's real
scheme), **n=12 every row**:

| document | result | tile requests |
|---|---|---:|
| `@page url()` alone *(control)* | 12/12 DROPPED | 1 |
| + `<link rel=preload>` | 0/12 dropped | 1 |
| + hidden `<img>` | 12/12 DROPPED | 2 |
| + preload **then** hidden `<img>` | **12/12 DROPPED** | 2 |
| + hidden `<img>` **then** preload *(order reversed)* | **12/12 DROPPED** | 2 |
| + element `background-image` | 0/12 dropped | 1 |
| page box + 3 margin boxes, no guard *(control)* | 12/12 DROPPED | **1** |
| page box + 3 margin boxes + one preload | 0/12 dropped | **1** |
| page box + 3 margin boxes + hidden `<img>` | 12/12 DROPPED | 2 |

The four-box row is the direct measurement of the `StyleImageCache` claim: four
distinct `CSSImageValue`s, one fetch. And the `elembg` row is its converse —
an element background loaded during document load populates
`fetched_image_map_`, and the page box then paints having issued **no request at
all**.

### 4.3 MEASURED vs INFERRED

- **MEASURED**: four style consumers cost one fetch, with or without a preload;
  an element background makes the page box cost zero fetches; an `<img>` of the
  same URL makes it cost one more and drop; **document order is irrelevant** in
  the build's state — `<img>` before the preload and after it are both 12/12
  DROPPED with 2 requests.
- **READ AT TAG 151**: `MatchPreload`'s unconditional erase and its
  `policy = kUse` with no validation; `PreloadKey`'s two fields; `CanReuse`'s
  indifference to initiator; `StyleImageCache::CacheImageContent`;
  `ClearPreloads(kClearSpeculativeMarkupPreloads)` skipping link preloads;
  `WarnUnusedPreloads` never erasing.
- **INFERRED**: that the page box's fetch is refused by
  `DetermineRevalidationPolicy` for the specific reason we think, in any given
  row. The branch is not observable in a release build (no trace events), so the
  branch identity is read from source and matched to behaviour, not seen.

### 4.4 What would break it

1. **`PreloadKey` gains a discriminator** (initiator, destination, or the
   `DOMWrapperWorld` its own TODO contemplates). Then an `<img>` would stop
   consuming the CSS preload — the collision disappears and the fix gets simpler.
2. **`MatchPreload` stops erasing** — e.g. reference counting, or keeping link
   preloads for the document's life. Same effect.
3. **`StyleImageCache` gains an eviction path.** Today it is the reason four
   margin boxes cost one fetch and the reason print #2 paints. If it were cleared
   on style recalc, media change, or memory pressure, `dc-op-manual`'s sixteen
   margin boxes on one URL would become sixteen fetches, and the last row of §4.2
   would break. **This is the one to test**, because nothing in the fix would
   report it — the book would simply start dropping.
4. **A plugin, theme, or author emits an element reference to a CSS image's URL.**
   This is not a Chromium change but a Gutterpress one, and it is exactly the
   class #185/#186 close by content-addressing. My data strengthens their case:
   the failure is **deterministic** through the product path, and **the audit's
   predicate is backwards** — it reads "referenced elsewhere" as proof of safety
   when a `[src]` reference is precisely what breaks it.

---

## 5. The disputed collision — settled

### 5.1 The dispute

#186 §4.1 reproduced, through `gutterpress build`, that adding
`![](images/paper.png)` to a book whose `@page` background is the same file makes
the background drop. #184 could not reproduce it across 15 configurations with a
working positive control. #186 §4.3 named a suspected confound: #184's harness
ran under puppeteer's default viewport.

### 5.2 The confound is confirmed, from both sides

**Puppeteer establishes a device-metrics override before any navigation.** In the
version this repo pins (`puppeteer-core@25.0.4`):

```ts
// src/common/util.ts:42
export const DEFAULT_VIEWPORT = Object.freeze({width: 800, height: 600});

// src/node/BrowserLauncher.ts:90
      defaultViewport = DEFAULT_VIEWPORT,

// src/cdp/Page.ts:117
  static async _create(client, target, defaultViewport) {
    const page = new CdpPage(client, target);
    await page.#initialize();
    if (defaultViewport) {
      await page.setViewport(defaultViewport);      // -> Emulation.setDeviceMetricsOverride
    }
    return page;
  }
```

`setViewport` sends `Emulation.setDeviceMetricsOverride`
(`src/cdp/EmulationManager.ts:300`) at **page creation**, before the page has
navigated. That is the first transition — and it happens when there is nothing in
the MemoryCache to evict.

**Gutterpress does the opposite.** `build.ts` navigates, waits for ready, reads
the author's CSS, and only then pins the viewport (`build.ts:386`), on a raw-CDP
page (`cdp.ts:144-163`) that never had an override. That is a first transition
*after* the document's images are cached.

**And the measurement matches, deterministically:**

| harness state | preload + `<img>`, `file://`, n=12 | requests |
|---|---|---:|
| **no pre-nav override** — `gutterpress build` | **12/12 DROPPED** | 2 |
| **pre-nav override** — puppeteer's default | 0/12 dropped | 1 |
| no pre-nav override, `@page` alone *(control)* | 12/12 DROPPED | 1 |
| pre-nav override, `@page` alone *(control)* | 12/12 DROPPED | 1 |

**Both agents were right about their own runs.** #186 measured the product path
and found a real, deterministic defect. #184 measured an immunised browser and
correctly found nothing — its positive control still worked because the *base*
defect (§A) is independent of the override, which is exactly why the harness did
not look blind.

### 5.3 One correction to #186's framing, and one caveat

The collision is **not** a preload-specific phenomenon. A bare hidden `<img>`
with no preload at all drops 12/12 with 2 requests under the build's conditions.
The preload is irrelevant to it. What is fatal is **any element reference to the
URL**, because element references live only in the fetcher's cache and the
build's own viewport pin empties that cache.

**Caveat, stated because it is the kind of thing that has misled here before.**
In the *immunised* state and only over `http://` with `cache-control: no-store`,
`preload + <img>` is **intermittent** — I measured 4/12, 6/12 and 1/12 drops in
three separate runs of the same cell, and a forced GC did not move the rate. It
is 0/12 on `file://` and 0/12 with `max-age=3600`, and document order modulates
it there too (`<img>` before the preload measured 0/12 in the same state where
preload-first measured 6/12). The likely branch is
[resource_fetcher.cc:2174-2185](https://raw.githubusercontent.com/chromium/chromium/151.0.7922.75/third_party/blink/renderer/platform/loader/fetch/resource_fetcher.cc):

```cpp
2174|   const bool can_reuse_no_store_image =
2175|       is_available_image_in_fetcher &&
2176|       base::FeatureList::IsEnabled(
2177|           features::kReuseNoStoreImageOnSameSrcReassignment);
2181|   if (existing_resource.HasCacheControlNoStoreHeader() &&
2182|       !can_reuse_no_store_image) {
2183|     return {RevalidationPolicy::kReload, "Reload due to cache-control: no-store."};
```

with `is_available_image_in_fetcher` depending on the resource still being in the
**weak** `cached_resources_map_`. That is consistent with an intermittent result
and with its absence on `file://`, but I did not prove it. **It does not affect
any product conclusion**: Gutterpress builds from `file://`, and in the build's
real state the collision is 12/12 deterministic for a different, fully explained
reason.

---

## 6. What would break the fix — consolidated

The fix #186 recommends is: preload every staged CSS image, and content-address
them so no element can name the same URL. Concretely, these are what would break
it, in rough order of likelihood:

| # | change | effect | how you would find out |
|---|---|---|---|
| 1 | `PrintWithParams` gains `WillPrintSoon()` (upstream) | defect largely gone; preload becomes dead code with no signal that it is | `tools/page-background-mechanism.mjs` §D — `print1` jumps from ~20 ms to ~1500 ms; §A row 1 flips to PAINTS |
| 2 | Gutterpress acquires a **pre-navigation** viewport override (switch to puppeteer, pooled browser, desktop `BrowserWindow`) | the browser is immunised; the collision becomes unreproducible and any regression test silently passes for the wrong reason | §B rows 2 and 3 of the fixture stop differing |
| 3 | the desktop host already prints in the immunised state | CLI tests prove nothing about desktop; the two hosts diverge silently | **unmeasured — open**; needs one build printed from a real Electron `BrowserWindow` with request counting |
| 4 | `DevToolsEmulator` stops evicting on first transition | element references stop being fatal | §B row 2 flips to PAINTS |
| 5 | `StyleImageCache` gains an eviction path | many-consumer sharing breaks; a 16-margin-box book starts dropping | §A row 5 (page box + 3 margin boxes) goes to 4 requests |
| 6 | `MatchPreload` stops erasing, or `PreloadKey` gains a discriminator | collision disappears; content-addressing becomes belt-and-braces | §C rows 1 and 2 stop differing |
| 7 | `ClearPreloads(kClearAllPreloads)` starts running before the print | the preload stops surviving to print time; the fix fails outright | §A row 3 flips to DROPPED |
| 8 | a resource slow enough that the preload has not completed by print time | the preload gives a head start, **not a guarantee** | measured: tile held 1500 ms → preload row still drops (§2.2) |

Row 8 deserves emphasis because #185 §1g and #186 §2 both concluded the mechanism
is *"preload-list identity, not timing"*. **Identity is why it survives the
eviction and why a second reference destroys it. Timing still decides whether the
resource is complete.** With the response held 1500 ms, the preload row drops.
The reason the 0/5/30/120 s load→print sweeps were all stable is that the fetch
completes during load, not that completion stopped mattering. A very large asset
on a very slow disk is a real, if remote, failure mode, and no load→print delay
protects against it — only the fetch starting earlier does.

---

## 7. What is still unexplained, bounded

1. **The `device_scale_factor` clause of the eviction predicate did not
   reproduce.** Pre-nav override at dsf=1, then a post-load override at dsf=2
   (confirmed by `devicePixelRatio` reading 1 then 2), no refetch. Bounded to that
   clause; the `!device_metrics_enabled_` clause reproduces 12/12. Nothing in this
   analysis or the fix depends on it, because the build only ever makes a first
   transition.
2. **The intermittent `no-store` collision in the immunised state** (§5.3).
   Bounded: `http` + `no-store` only; absent on `file://` and with `max-age`;
   independent of forced GC; correlates 1:1 with the page box issuing a second
   request. Narrowest remaining hypothesis: the weak `cached_resources_map_` entry
   is sometimes absent, taking `DetermineRevalidationPolicy` to
   `"Reload due to cache-control: no-store."`. Not proven — release Chrome emits
   no trace event for the decision.
3. **Which `StyleForPage` call site issues the print's fetch** —
   `LoadPaginationResources` or `PageContainerLayoutAlgorithm`. Both are inside
   the print call; not separable without a debug build.
4. **Whether the eviction is causal or merely co-located.** The predicate's shape
   matches every measured trigger, including three counter-intuitive ones, but the
   eviction itself was never observed in-process. To close it you would need a
   Chromium build with `RESOURCE_LOADING_DVLOG` enabled, or a
   `disabled-by-default` trace category that survives release compilation.
5. **The desktop host's browser state.** Unmeasured. Item 3 in §6.

---

## 8. Corrections to the earlier documents

| document | claim | correction |
|---|---|---|
| #183 §A4 | the join between `StyleForPage`-during-pagination and lazy `CacheImage` is *inferred* | Confirmed, and completed: the reason the print does not wait is that `PrintWithParams` never calls `WillPrintSoon()`. #183 could not have known this because it did not know the wait existed. |
| #183 §A4 step 5 | "the print then lays out and paints immediately … and never repaints" | Right, and now with a structural reason: the page box is an anonymous LayoutObject destroyed with the print. It *does* register as an image observer — it just does not outlive the job. |
| #185 §1e/§1g, #186 §3 | "what the first-transition override invalidates is unexplained by anyone" | It is `MemoryCache::Get()->EvictResources()`, `dev_tools_emulator.cc:307`, byte-identical at the tag they measured. |
| #185 §1g, #186 §2 | "the mechanism is preload-list identity, **not timing**" | Half right. Identity explains survival and the collision; timing still decides completeness. A 1500 ms response makes the preload row drop. |
| #186 §3 | "an `[src]` element provides neither (a) nor (b) — and removes (b)" | Correct as a rule, but the *reason* is not that `<img>` is a weaker kind of reference. It is that element references live only in the fetcher's cache, which the build's own viewport pin empties. |
| #186 §4.3 | the collision is "reproduced by one agent, not by another, with a specific suspected cause" | **Settled.** The suspected cause is confirmed on both sides: puppeteer-core `defaultViewport` → `CdpPage._create` → `setViewport` before navigation; `build.ts:386` after it. 12/12 vs 0/12. |
| #186 §4.1 | presents the collision as preload-specific | It is not. A bare hidden `<img>` with no preload drops 12/12 under the build's conditions. Any element reference is fatal. |
| #184/#186 | "many style consumers share ONE preload entry" | They do not share the preload. The first consumer erases it. The sharing is `StyleImageCache::fetched_image_map_`, a different, style-level cache the fetcher never sees. |

None of these overturn the recommendation in #186. Two strengthen it: the
collision is deterministic rather than disputed, and content-addressing closes a
class that is wider than the preload story suggested.

---

## 9. Evidence index

**Measurements.** All produced by the harness published as
`tools/page-background-mechanism.mjs` (and the scratch variants it was
consolidated from). Chrome 151.0.7922.75, `--headless=new`, raw CDP, no
`--virtual-time-budget`. Repetition counts are stated per table; nothing in this
document is reported from n=1 except the timeline traces in §2.2, which are
qualitative and were each observed at least twice.

**Chromium source.** Every quoted line fetched from
`https://raw.githubusercontent.com/chromium/chromium/151.0.7922.75/<path>` —
the tag of the browser measured. Files read:

- `third_party/blink/renderer/core/inspector/dev_tools_emulator.cc`
- `third_party/blink/renderer/core/inspector/inspector_emulation_agent.cc`
- `content/browser/devtools/protocol/emulation_handler.{h,cc}`
- `third_party/blink/renderer/platform/loader/fetch/resource_fetcher.{h,cc}`
- `third_party/blink/renderer/platform/loader/fetch/{resource.cc,preload_key.h,memory_cache.cc}`
- `third_party/blink/renderer/core/css/{css_image_value.cc,style_image_cache.cc,style_engine.{h,cc}}`
- `third_party/blink/renderer/core/css/resolver/{style_resolver.cc,element_style_resources.cc}`
- `third_party/blink/renderer/core/loader/resource/{image_resource.cc,image_resource_content.cc}`
- `third_party/blink/renderer/core/{dom/document.cc,frame/local_frame.cc,frame/local_frame_view.cc,frame/pagination_state.cc,layout/layout_object.cc,layout/pagination_utils.cc,layout/pagination/page_container_layout_algorithm.cc,paint/box_fragment_painter.cc,paint/view_painter.cc}`
- `components/printing/renderer/print_render_frame_helper.cc`
- `components/printing/browser/print_to_pdf/pdf_print_job.cc`

**Puppeteer source.** `puppeteer-core@25.0.4`, as installed in this repo:
`src/common/util.ts`, `src/node/BrowserLauncher.ts`, `src/cdp/Page.ts`,
`src/cdp/EmulationManager.ts`.

**Gutterpress source.** `packages/cli/src/engine/compiler/build.ts:362-394`,
`packages/cli/src/engine/shared/cdp.ts:144-163`.

**What I tried and could not get.** Release Chrome emits no trace events for
`ResourceFetcher::DetermineRevalidationPolicy`, `StyleForPage`,
`LoadPaginationResources`, or `MemoryCache::EvictResources` — 8,189 events
captured across `blink`, `blink.debug`, `blink.resource`,
`disabled-by-default-blink.debug`, `disabled-by-default-network`, `network`,
`loading`, `navigation`, `printing`, `devtools.timeline` and
`disabled-by-default-devtools.timeline`, with zero hits on any of those names.
Those events exist in the source but are compiled out or gated in an official
build. `issues.chromium.org/issues/346799729` is behind a sign-in wall to
automated fetching; the `TODO(crbug.com/346799729)` in
`style_resolver.cc:2337` is quoted from source instead.
