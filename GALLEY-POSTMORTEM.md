# Previewer overhaul: what was built, why it failed, what would work

A record of the work on `claude/previewer-architecture-overhaul-l9awpz` (PR #154).
Written to be useful to whoever picks this up next, including the parts that
reflect badly on how it was built.

---

## 1. What was actually asked for

The original request, verbatim:

> review the example html file below and think through how we can overhaul the
> previewer to use a strategy similar to the one in this example, but instead of
> exporting it converts the html (or html element) to markdown and update the
> source file appropriately. this flips the current strategy on its head and
> converts markdown to html only during initial load of the project. the editing
> and viewing use html directly, the html is then converted back to markdown and
> the source files are updated. so the viewer/editor works directly on the built
> html and only save touches the markdown files. this is a major change, so think
> through it carefully and understand that the intent is "inline editing" with no
> need for watching, building, refreshing to create the best possible UX for
> editing and viewing projects

The attached example was ~700 lines titled *"GALLEY — prototype of an
Obsidian-style inline HTML editor"*. Its entire architecture:

```html
<article id="doc" contenteditable="true"></article>
```

Stylesheets are parsed with CSSOM and every selector prefixed with `#doc`, so
arbitrary CSS restyles the document without touching editor chrome. That is it.
**Zero pagination CSS. Zero column properties. Zero DOM restructuring.** You type
in the styled document.

Later clarifications, all consistent with that:

- Tiptap for the editor, "preserves the realtime inline editing and award winning
  level UX", must work with plugins, snippets, media gallery.
- "we should not be modifying the html at all beyond rendering it from the
  markdown" — and injecting strips is "a sign your design is fundamentally flawed".
- "making pagination CSS-only over the untouched rendered HTML" and "the most
  simple implementation and integration with TipTap as possible to reduce the
  complexity of the app".
- Print preview should be the existing HTML paginated viewer (two-up, zoom, fast).

The word "galley" came from the example's own title. It is a typesetting term: a
galley is the tray holding set type before it is divided into pages, and a
*galley proof* is the continuous, unpaginated proof pulled from it. It names
exactly the thing the example demonstrated.

---

## 2. What was built instead

### 2.1 First attempt (ADR 0010) — later deleted wholesale

A hand-written DOM→markdown serializer (1,226 lines), per-block patch proposals
addressed by `data-source-range`, and a "converge-on-drift" verifier that
re-rendered saved files in the background and patched blocks whose render
differed from the screen. Plus a corpus round-trip gate.

This was replaced entirely after a library evaluation. Its removal is the single
largest deletion in the branch.

### 2.2 Second attempt (ADR 0011) — the Galley

One Tiptap/ProseMirror document over the whole book. The load-bearing decision,
stated in the PR body as a feature:

> the Tiptap view's `view.dom` IS the fragmenter's flow root

That is the mistake. Everything below follows from it.

**The fragmenter does not style the rendered document — it rewrites it.**
Measured in `packages/cli/src/engine/viewer/fragment.ts`:

| line | mutation |
|---|---|
| 601, 615–616 | creates a `div` strip, inserts it, **reparents every node into it** |
| 363–368 | builds a shell, moves nodes in, deletes the original |
| 237–242, 873–878, 1111–1114 | injects **spacer `div`s of computed pixel height** to force breaks |
| 802–823 | synthesizes `<tr>`/`<td>` shim rows for repeated table headers |
| 917 | unwraps strips by moving children back out |

Pointing that at ProseMirror's own DOM meant PM's `DOMObserver` saw external
mutation and reverted it. The fix layered on top was `withFragmenter()` — detach
the observer around every fragmenter pass — and a `layoutBracket` option added to
the viewer's public `MountOptions` so the *host* could wrap its own passes too.

### 2.3 The save protocol

Whole-chapter proposals over the bridge, with: a `pendingAck` map, a `seq` nonce
per proposal, `staleChapters` suspension, a `FATAL_ACK_REASONS` set, a retry
timer, an `expected`-chain that only advances on ack, and a desktop-side
`attempt(expected)` → retry-with-`lastApplied` → `ackFrame()` round trip.

For writing a local file that the same process owns.

---

## 3. Why it failed

### 3.1 The central claim was never true

The PR says screen↔file drift is "impossible by construction". It is not. There
are two transforms — markdown-it tokens → PM doc, and a hand-configured
`prosemirror-markdown` serializer back out — and they are not inverses. Drift was
not eliminated; it was moved from "two views" to "two transforms" and then
asserted away.

Three mechanisms exist only to prop that claim up, and each is evidence against
it:

- **Opaque atoms** — an admission the doc model cannot represent the document. If
  the model were the document there would be no escape hatch.
- **`srcMap` byte memoization** — each node's original bytes are kept in a
  `WeakMap` because the serializer is not faithful. A correct codec would not need
  to remember what it could not reproduce.
- **The corpus gate at `BYTE_IDENTICAL_MIN = 0.8`, comparing with `.trim()`**
  (`scripts/roundtrip-gate.ts:47,112`) — calibrated to accept the known lossiness
  rather than catch it. This is exactly why the whitespace damage shipped unseen.

### 3.2 The coupling created a permanent obligation

`layoutBracket` is not a design. It is the cost of the coupling, and it pushed a
standing requirement onto every future caller: wrap every layout pass or
pagination silently goes to zero. That failure already happened once (view-mode
change wiped pagination). The "fix" added a parameter and moved the obligation
rather than removing it.

### 3.3 Complexity with no proven need

The ack/retry/seq/stale-chapter apparatus guards conflict cases for a local file
write. Nobody established those cases occur at a rate justifying the machinery.
The instruction "save changes before toggle, they should not be refused" is the
correct reading: if a save just writes, there is no refusal, no retry, no
suspension, and no nonce.

### 3.4 Gates that could not catch their own failures

- `build-runner.orchestration.test.ts:35` gated a test on `chromium ? test.skip :
  test` — **inverted**. CI always installs Chrome, so 14 assertions never ran
  there, including the check that published output ships no editor bundle.
  Measured: 23 `expect()` calls without Chromium, 9 with.
- `native-parity-gate.ts` — declared permanent and required-green in CLAUDE.md,
  but referenced by no workflow. Its first real run failed with 14 divergences.
- `galley-mount.test.ts` asserted `pages >= 1, sheets >= 1` across the
  edit→preview transition — too weak to notice that the transition was nesting
  strips inside strips (`nestedStrips: 1`).
- Two parity fixtures were both named `book`, so they shared a staging directory
  *and* a report label — and `KNOWN_DIVERGENCES` matches on that name, so one
  allowlist entry would have silently excused both.

### 3.5 Process failures worth naming

- A false root cause was written into `.github/workflows/ci.yml` (blaming an
  anchor bug that had already been fixed and pinned by a test).
- "Unreproducible locally" was accepted as a stopping point when the real
  situation was one blocked host; a working Chromium 153 was ~5 minutes away via
  `storage.googleapis.com/chromium-browser-snapshots`.
- Effort went into test harnesses and metrics while shipped features (the context
  menu) were left disabled.

---

## 4. What the evidence actually showed

Once measured properly, with Chromium 153:

**CSS-only pagination over untouched HTML works.** Roughly ten lines of CSS on the
rendered document, no DOM mutation at all:

```
book-01               2pp = 2pp    0 divergences
book-02               2pp = 2pp    0 divergences
css-authoring-spike   7pp = 7pp    0 divergences
gp-image-positioning  7pp = 7pp    0 divergences
```

Two things had to be handled, both principled:

1. `break-before: page` is **inert inside a multicol container** — only `column`
   fragments there. Every forced break the author declared must be remapped.
   (Missing this is what made the first attempt drift: the design guide puts
   `break-before: page` on `h1`, so every chapter break vanished.)
2. `@page NAME { margin }` has no multicol equivalent, but the difference from the
   base page is always a margin delta, and the element that triggers the named
   page can absorb it. Author keeps writing `@page NAME`; the viewer emits
   standard element CSS for it.

**The 54pp design guide is the honest limit of the naive form** — it has four page
geometries (base, `chapter` with `margin-top: 180pt`, `gp-full-bleed`, `cover`),
and a single multicol container has one column size. Page *count* matched (54=54)
but interior placement drifted.

**That stopped mattering** once editing became continuous, because pagination
moved to the read-only preview where the fragmenter was always correct:

```
design-guide  54pp = 54pp   0 divergences    (parity gate, green)
```

**Continuous editing is instant.** Measured in the packaged app, 43 real
keystrokes: **median 0.60ms, p95 0.80ms** keydown→input. The old coupled
architecture measured 2.70ms because every keystroke scheduled a fragmenter pass.
The galley test suite went 34s → 5.3s.

**Digital PDF** (`--format pdf`, no PDF/X): 7pp in 2,916ms / 142KB; 54pp in
4,526ms / 505KB; parse-to-open 8ms / 118ms. Cost is almost entirely fixed
(browser launch + first layout), not per-page.

---

## 5. What would work instead

### 5.1 The shape

- **Editing is continuous and CSS-only.** ProseMirror owns its DOM. Nothing
  reparents, injects spacers, or mounts a fragmenter over it. One generated
  stylesheet sets a column at the page's real content width, page padding, sheet
  background, page-tall `.page`/`.spread` (so `.gp-pin` — which pins to the
  nearest `.page`/`.spread` **element**, not a page box — lands where it prints),
  and the compiled `@page NAME` deltas.
- **Pagination is the print preview.** The existing viewer, read-only, where
  spread view and zoom are free and there is no editor to fight. The parity gate
  governs that path and is green.
- Everything horizontal is identical to print, because the column is the real
  content width: line breaking, wrapping, image sizes, floats, column utilities.
  What continuous view does not show is where pages divide and per-page furniture
  (running heads, folios) — both need a page box.

This is implemented and pushed (`db315ea`, `26f020a`). It deleted
`withFragmenter`, `refreshViewer`, `scheduleRefresh`, `stampChromeUneditable`, the
`gp:relayout` listener, `ViewerGlobal`, and `MountOptions.layoutBracket`.

### 5.2 What should still be cut

- **The save protocol.** Replace proposal/ack/seq/retry/staleChapters with: write
  the file. Flush and complete the write before any view switch. If a conflict is
  genuinely possible (external edit), detect it at write time and tell the author
  — do not build a distributed-consensus shape around a local file.
- **The corpus gate's thresholds.** `BYTE_IDENTICAL_MIN = 0.8` and the `.trim()`
  comparison encode the implementation's known lossiness. A gate should assert the
  requirement (untouched bytes stay untouched) and fail until the codec meets it.
- **Opaque atoms and `srcMap`** deserve re-examination against a simpler codec.
  They are compensations for an unfaithful round trip, not features.

### 5.3 Known open items

- **Whitespace on save**: runs of 2+ blank lines collapse to one, and a missing
  final newline is added. Block bytes are preserved by node identity, but the
  whitespace *between* blocks belongs to no node so `prosemirror-markdown` emits
  its own separator. Left in place deliberately; named explicitly in the e2e test
  rather than silently tolerated.
- **Toolbar view toggle** (Edit ↔ Print preview) — decided, not built. Today only
  the `preview.inlineEditing` setting flips it, which was built as a rollback
  kill-switch, not a view control.
- **Running heads / folios in continuous view** — wanted, non-editable, deferred
  to a follow-up.
- **Footnote definitions** edit as opaque source. A definition lives mid-source but
  renders at the chapter end; rich editing breaks one of those two truths.
- **Refused-save handling** — should become moot once saves just write.

---

## 6. Current state of the branch

PR #154, base `release/0.10.0`. Net **−299 lines** (7,873 added / 8,172 removed
across 103 files). All CI checks green at last push.

Verified locally with Chromium 153 (`storage.googleapis.com/chromium-browser-snapshots`;
the Chrome-for-Testing metadata host and `cdn.playwright.dev` are both blocked by
network policy, and playwright 1.60 pins Chromium 141, below the engine's 148 gate):

- CLI 1,854 pass / 0 fail
- Desktop 2,009 pass / 0 fail
- Galley 23/23, including a new assertion that no strips nest on the
  edit→preview transition
- Parity gate green on all five fixtures, design guide 54pp at 0 divergences
- End-to-end typing in the packaged app reaches disk byte-preserved

Fixed along the way, each reproduced before being fixed:

- The viewer dropped a forced `break-before` on a first in-flow child instead of
  propagating it to the parent (CSS Fragmentation 3 §3.3). Chromium propagates;
  the code's comment asserted the opposite. This was the entire 14-divergence
  parity failure.
- `mount()` was not idempotent — it re-fragmented a previous mount's own chrome.
  Now unwraps first, fixing it for every caller.
- A ProseMirror view leaked on every failed entry into edit mode.
- A failure while leaving edit mode wedged the mode state machine permanently.
- A committed fixture had `****# Alpha Chapter` — not heading syntax, so that
  chapter rendered with no `<h1>` under the editor↔preview sync tests.

---

## 7. The one-line version

The example asked for a styled document you can type in. What got built was a
JavaScript layout engine that rewrites the author's DOM, an editor welded to it,
and a distributed-save protocol around a local file write — then gates tuned to
pass anyway. The parts that work are the parts that do less: CSS does the
pagination, the browser does the fragmenting, and the editor is left alone.
