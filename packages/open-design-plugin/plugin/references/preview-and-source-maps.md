# Preview and source metadata

How to read the running Print-MD preview, and how to get from a rendered
element back to the file that produced it. Verified against the Print-MD source
that ships this package, 2026-07-28.

## The preview is the authority

```bash
print-md preview ./books/core-book
# Preview server running at http://localhost:3579
```

Port 3579 is the default; the user may bind another one, and the printed URL is
the truth. The runtime brief carries whatever they are actually running.

The preview uses the same Markdown renderer, inlined CSS, and Paged.js polyfill
as the build. Judge print layout from its paginated pages, never from ordinary
browser flow. The live shell is optimized for editing, so wait for its completed
pagination and confirm page-critical work with the normal Print-MD build before
final delivery.

`GET /api/status` returns `{ hasInput, currentPath }` if you need to confirm the
server is alive and which project it has open.

## What happens when a file changes

The watcher debounces a burst of writes into one rebuild, then:

- **any watched source changed** — Markdown, stylesheet, font, image, manifest,
  or authored plugin - the shell loads the rebuilt `book.html` into its hidden
  frame, completes a full-document Paged.js pagination, then swaps it into view.

A stylesheet edit takes the full path deliberately. In a paged medium, fonts,
leading, spacing, custom properties, page geometry, columns, image sizing, and
`break-*` rules all move page boundaries, so a restyled-but-unrepaginated view
would show new styling on stale page boxes.

The watcher also follows everything the book reads from **outside its own
folder**: authored plugin paths, and each active stylesheet's full dependency
closure — the sheet itself, its `@import` chain, and every local `url()` target.
So editing `shared/styles/components.css` refreshes the preview, and so does
replacing `shared/fonts/Publisher.woff2` without touching any CSS.

One consequence worth knowing: a shared asset is watched because some stylesheet
*references* it. Dropping a brand-new file into `shared/fonts/` changes nothing
until a stylesheet points at it — which is the same edit that makes it matter.

Practical consequence: after a design edit, **wait for the rebuild to land**
before judging layout. If page counts or boundaries look stale, reload the
Browser tab, and use a normal Print-MD build for final page-critical approval.

## What Open Design Browser context contains

Opening the preview tab adds its URL and title to the run context. Open Design
0.16.1 does not attach arbitrary element comments or ancestor metadata from an
external HTTP preview. Some agents expose Browser Use automation that can query
the live DOM; others do not. Never claim a selector, opening tag, computed style,
or source location was supplied unless it is actually present in the run.

When Browser automation is unavailable, use the user's description or attached
screenshot, inspect the manifest and source, and ask one focused clarification
when the target remains ambiguous.

## Relating a rendered element to its source

For source attribution, rely on these two supported attributes:

- **`data-source-line`** — from `markdown-it-source-map`, on elements produced by
  Markdown. The number is the line **within its own chapter file**, so it is
  only meaningful together with the chapter.
- **`data-chapter-src`** — on source-mapped block elements in the live preview,
  carrying the chapter's path relative to the book. It adds metadata without a
  file-level wrapper, so authored CSS sees the same element tree as the build.

When live DOM inspection is available, locate a target as follows:

1. Walk up from the selected node to the nearest ancestor carrying
   `data-source-line`.
2. Use that element's nearest `[data-chapter-src]` match to learn which file.
3. Together those give file + line. Confirm by reading that line in the source
   before editing it.

Paged.js splits and clones content across page boxes, so a fragment may carry a
line number inherited from a node that began on an earlier page — treat the
result as a strong hint, verified against the file, not as an exact address.

For a **styling** question, the attributes only tell you which Markdown produced
the element. Which rule styles it comes from the element's semantic classes and
the ordered `styles:` list; read the stylesheets to find the declaration that
actually applies.

Print-MD also emits semantic data attributes for layout primitives; those are
not source coordinates. Do not build a source-map database, a sidecar index, or
any second metadata format. The two attributes above are the source-attribution
contract.

## Preview DOM edits are transient

The Browser page is generated output served over HTTP. Anything changed in that
DOM disappears on the next rebuild and never reaches the repository. Use a
selection or a DOM experiment as *context* for deciding what to change; then
make the durable edit in the theme, a stylesheet, semantic Markdown, an authored
plugin, or the manifest.

Never save a serialized preview DOM back over `book.html` or any source file.
