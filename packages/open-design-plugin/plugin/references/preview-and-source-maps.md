# Preview and source metadata

How to read the running Print-MD preview, and how to get from a rendered
element back to the file that produced it. Verified against Print-MD `main`,
2026-07-28.

## The preview is the authority

```bash
print-md preview ./books/core-book
# Preview server running at http://localhost:3579
```

Port 3579 is the default; the user may bind another one, and the printed URL is
the truth. The `previewUrl` input carries whatever they are actually running.

The preview renders the same document the build does — same markdown pipeline,
same inlined CSS, same Paged.js polyfill — so page size, pagination, columns,
running content, breaks, and print layout are all authoritative there. Judge
layout from the preview, never from a browser's ordinary flow rendering.

`GET /api/status` returns `{ hasInput, currentPath }` if you need to confirm the
server is alive and which project it has open.

## What happens when a file changes

The watcher debounces a burst of writes into one rebuild, then:

- **one Markdown file changed** → that chapter is re-paginated and spliced into
  the live view;
- **anything else** — a stylesheet, several files at once, a deletion, a
  manifest edit → a full reload, which is a complete Paged.js pagination.

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
Browser tab.

## Relating a rendered element to its source

Print-MD emits two attributes and no others:

- **`data-source-line`** — from `markdown-it-source-map`, on elements produced by
  Markdown. The number is the line **within its own chapter file**, so it is
  only meaningful together with the chapter.
- **`data-chapter-src`** — on the `.pmd-chapter` wrapper in the live preview,
  carrying the chapter's path relative to the book.

To locate a selection:

1. Walk up from the selected node to the nearest ancestor carrying
   `data-source-line`.
2. Walk further up to the nearest `[data-chapter-src]` to learn which file.
3. Together those give file + line. Confirm by reading that line in the source
   before editing it.

Paged.js splits and clones content across page boxes, so a fragment may carry a
line number inherited from a node that began on an earlier page — treat the
result as a strong hint, verified against the file, not as an exact address.

For a **styling** question, the attributes only tell you which Markdown produced
the element. Which rule styles it comes from the element's semantic classes and
the ordered `styles:` list; read the stylesheets to find the declaration that
actually applies.

Do not build a source-map database, a sidecar index, or any second metadata
format. These two attributes are the contract.

## Preview DOM edits are transient

The Browser page is generated output served over HTTP. Anything changed in that
DOM disappears on the next rebuild and never reaches the repository. Use a
selection or a DOM experiment as *context* for deciding what to change; then
make the durable edit in the theme, a stylesheet, semantic Markdown, an authored
plugin, or the manifest.

Never save a serialized preview DOM back over `book.html` or any source file.
