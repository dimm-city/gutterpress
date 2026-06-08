# ADR 0005 — Preview bridge protocol & forward-compatible hook set

Status: Accepted (2026-06-08)
Supersedes/relates: ADR 0003 (web-UI auto-update), ADR 0004 (platform abstraction)

## Context

The viewer's preview is a paged.js document rendered **inside an `<iframe>`**
served by the lib's preview HTTP server. The host SPA talks to it over a
`postMessage` request/reply protocol defined by two lib-side scripts:

- `packages/lib/src/assets/preview/scripts/pagedjs-interface.js` — defines
  `window.previewAPI` (page nav, zoom, view mode) and fires the
  `pageChanged` / `renderingComplete` DOM events.
- `packages/lib/src/assets/preview/scripts/pagedjs-bridge.js` — the
  cross-origin relay. Maps host commands to `previewAPI` and forwards events.

Host side: `packages/viewer/src/lib/preview-client.ts` (`PreviewClient`)
sends `{type:'pmd:cmd', id, cmd, args}` and awaits `{type:'pmd:reply', id, ok,
result}`, and subscribes to `{type:'pmd:event', name, detail}`. It is **fully
generic** — any new `cmd`/event name works with no change to `PreviewClient`.

### The asymmetry that drives this ADR

The two layers have very different update costs:

| Layer | Ships as | Update path | Cost to change |
|---|---|---|---|
| **SPA** (`packages/viewer/src`) | static bundle | web-UI auto-update (ADR 0003), Ed25519-signed `web-v*` releases | **cheap** — hot-swap, no reinstall |
| **lib bridge scripts** | bundled into `@dimm-city/print-md-lib`, embedded in the asar / compiled binary | full app re-release | **expensive** — manual, per-platform |

Therefore: **changing the lib bridge later is the thing to avoid.** Every time
a future viewer feature needs a *new* lib-side command, users must reinstall the
whole app. So we add a small set of **generic, stable primitives now**, and
build features in the SPA on top of them.

There is already an ideal foundation we are NOT changing:

- `data-source-line="<1-based line>"` is stamped on **every block element** by
  `markdown-it-source-map` (lib render pipeline). Editor↔preview mapping needs
  **no renderer change** — the data is already in the DOM.
- Headings already carry `id` (from `markdown-it-attrs`) and `data-source-line`.
- The shell (`preview-shell.js`) relays `pmd:cmd`/`pmd:reply` **transparently**,
  so new commands pass through the double-buffer without shell changes.

## Decision

### 1. Design principle

> **The lib bridge exposes generic primitives. Features live in the SPA.**

A new lib command is justified only when it needs same-origin access to the
paged.js DOM that the SPA cannot get across the iframe boundary (page-index
computation, DOM reads/writes inside the frame). Anything expressible by
composing the primitives below must be built SPA-side, not added to the lib.

### 2. The hook set to add now

Commands (request/reply; added to `previewAPI` + the bridge command map):

| Command | Args | Returns | Why it must live in the lib |
|---|---|---|---|
| `getOutline()` | — | `Array<{level,text,id,sourceLine,chapter,page,index}>` | Page index requires same-origin paged.js page math. Powers UX-013 chapter jump, TOC, minimap, scrollspy. |
| `scrollTo(target, opts?)` | `target = {line, chapter?}\|{id}\|{selector}\|{page}`; `opts = {block?: 'start'\|'center', smooth?: boolean}` | `{page, sourceLine}` | Single anchored-jump primitive. Covers editor→preview (`{line, chapter}`), chapter jump (`{id}`/`{line}`), and any future jump (`{selector}`). |
| `getVisibleSource()` | — | `{sourceLine, chapter, page}` of the top-most visible block | Cross-iframe scroll position read. Powers preview→editor sync + scrollspy. |
| `queryDom(spec)` | `{selector, fields:Array<'text'\|'id'\|'sourceLine'\|'page'\|'tag'\|'rectTop'\|{attr:string}>, limit?}` | `Array<Record<field,value>>` | **The generic future-proofer.** Read-only, no eval, attribute whitelist. Lets the SPA extract figures, tables, footnotes, links, word-anchors, search candidates — with no further lib change. |
| `highlight(spec)` | `{line?\|id?\|selector?, group?:string, scroll?:boolean, transient?:boolean}` | `{count}` | DOM write inside the frame (add a marker class). Powers find-in-page, editor-cursor echo, annotations. |
| `clearHighlights(group?)` | `group?` | `{cleared}` | Pair for `highlight`. |

Events (iframe→host; added to the bridge's event forwarder):

| Event | Detail | Why |
|---|---|---|
| `sourceLineChanged` | `{sourceLine, chapter, page}` | Debounced (~150ms) on scroll. Preview→editor sync + outline scrollspy at finer-than-page granularity. |
| `elementActivated` | `{sourceLine, chapter, id, tag}` | Fired when the user clicks a content block. Powers click-to-source ("click a paragraph in the preview, jump the editor there"). Cheap now, expensive to retrofit. |

> **Per-file source lines:** `data-source-line` resets per chapter file, so a
> line is only unambiguous paired with `chapter` (the `data-chapter-src` source
> filename). `scrollTo({line, chapter})` scopes the lookup; sync events carry the
> chapter so the host only moves the editor when the scrolled chapter is the open
> file.

Unchanged (already shipped): `ready`, `pageChanged`, `renderingComplete`;
`getTotalPages`, `getCurrentPage`, `goToPage`, `firstPage`/`prevPage`/`nextPage`/
`lastPage`, `setViewMode`, `setZoom`, `getPageDimensions`, `toggleDebugMode`,
`print`; `pmd:bg-color`, `pmd:inject-styles`.

### 3. What this set deliberately enables WITHOUT future lib changes

- **Find-in-document:** `queryDom` to scan text → `highlight({selector,group:'find'})` → `scrollTo` → `clearHighlights('find')`.
- **TOC / chapter sidebar / minimap:** `getOutline` (+ `sourceLineChanged` for the active marker).
- **Editor↔preview scroll & cursor sync:** `scrollTo({line})`, `getVisibleSource`/`sourceLineChanged`, `highlight({line,transient})`.
- **Click-to-source / light WYSIWYG affordances:** `elementActivated`.
- **Figure/table/footnote lists, link audits, word count:** `queryDom`.
- **Annotations / review marks:** `highlight` groups + `queryDom`.

### 4. Security / invariants

- `queryDom` is **read-only** and returns only whitelisted fields; no script
  execution, no innerHTML. `highlight` only toggles a class (`pmd-hl` +
  group); it never injects markup.
- Commands remain **idempotent and side-effect-light**; render/layout is owned
  by paged.js.
- The bridge stays decoupled from the platform IPC contract (ADR 0004): this is
  the **iframe↔SPA** seam, not the **host↔SPA** seam. Neither imports the other.

### 5. Versioning

`previewAPI.PROTOCOL_VERSION` (integer) is bumped when a command/event is
added. `PreviewClient` exposes `getProtocolVersion()` and degrades gracefully
(feature-detect: a command that returns "unknown command" → SPA hides that
feature) so a newer SPA hot-update can run against an older lib build without
crashing. This is what makes the SPA's independent update cadence safe.

## Consequences

- One-time lib change adds all six commands + two events; after that, the listed
  future features ship as SPA-only hot updates.
- Slightly larger bridge surface (justified: each primitive is generic and
  reused across many features — net complexity *reduction* vs. adding one
  command per feature later).
- `queryDom`/`highlight` must be kept generic; resist adding feature-specific
  commands when a primitive composition works.
