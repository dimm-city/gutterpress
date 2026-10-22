---
title: Write and preview your book
description: The editor, the live preview, Edit, Read and Focus, your book's files and images, turning pages, zoom, and the Problems panel.
---

# Write and preview your book

## The toolbar

Across the top of the window, from the left:

- the **panel toggle** (Ctrl+\) shows or hides the left panel;
- **Edit** (Ctrl+E) puts the editor and the preview side by side;
- **Read** shows the preview on its own, two pages at a time;
- **Focus** hides the panels and toolbars; press Esc to bring them back;
- **Setup** (the wrench) opens [Book settings](05-design.md);
- **Publish** opens the [Publish](08-publish.md) view.

![Edit mode: the table of contents, the editor and the live preview side by side](images/workspace-edit.jpg)

In a narrow window, Edit and Read become **Markdown** and **Preview** tabs.

## Write

The editor is on the left in Edit mode. Your writing is markdown; the
[writing chapter](https://gutterpress.dimm.city/docs/writing-content/) covers the syntax and the
layout markers.

The editor toolbar has buttons for bold, italic, strikethrough, inline code, links, quotes,
bulleted and numbered lists, and a heading picker. Its **Insert** menu adds a layout block
(**Chapter**, **Section**, **Two columns**, **Page break**, **Spread**), a horizontal rule, a
table, an image or a [snippet](04-snippets.md).

**Save** (Ctrl+S) saves now; it turns blue when there are unsaved changes. Edits are also saved
automatically unless you turn that off in Settings → Saving. The indicator in the status bar
reads **Edits saved**, **Saving…** or **Unsaved changes**.

### Pick a class from a list

Classes are how you tune a block or an image: `.gp-no-break`, `.gp-right`, a plugin's
`.dc-snug`. You do not have to remember them. In the editor, type a `.`

- after a marker word, as in `@section .`, or
- inside curly braces on any element, as in `## Title {.` or `![Map](map.png){.`

and a list appears. It starts with Gutterpress's own `gp-*` classes, then the classes each
plugin your book uses documents in its component catalog, then the classes your book's own
stylesheets use. Each suggestion has a one-line description where there is one, and says where
it comes from. On an image the image classes come first; on a marker line a plugin's
classes for that marker do.

Keep typing to narrow the list, then press **Tab** or **Enter** to accept (**Esc** dismisses it).
**Ctrl+Space** asks for the list inside empty braces. The list works the same way as the `@`
suggestions for [markers and components](04-snippets.md#insert-a-component).

### Change a block's properties

A marker block (`@section`, `@skill`, `@gear`, a plugin's own markers, `@page`) can be tuned from a
dialog, without typing a class or a marker by hand. Open it either way:

- **in the preview**, right-click the block's own edge or padding (not a paragraph inside it) and
  choose **Block properties…**; inside a page the menu also has **Page properties…** for the
  page itself;
- **in the editor**, put the cursor on the marker line and press **Alt+Enter** (Option+Enter on
  a Mac).

The dialog has:

- **Keep together** keeps the block whole: it moves to the next page rather than splitting
  (adds `.gp-no-break` to the marker line).
- **A section for each plugin** your book uses, with the modifiers its component catalog
  documents. For Dimm City these are **Avoid split** (`.dc-avoid-split`) and **Snug**
  (`.dc-snug`). A plugin that documents a modifier gets a toggle here with no change to
  Gutterpress.
- **Break before** puts a `@page-break` line directly above the block, so it starts on a new
  page. Turning it off removes that line (and any other page breaks stacked directly above).
- **Columns** wraps the block's content in `@columns N` … `@end-columns` (1 to 5), changes N,
  or unwraps it. It needs the block's own closing line (`@end-section`, `@end-skill`); without
  one the dialog says so and leaves it unavailable. A block that already has its own
  `@columns` run in the middle of its content is left for you to edit in the source.

Only what you change is edited. The variant word, `#id`, `label="…"`, other classes and
whichever spelling you use (`.class` or `{.class}`) stay exactly as written, and Apply with
nothing changed writes nothing. Edits made from the editor go into its undo history
(Ctrl+Z).

## Your book's files and images

The left panel has three tabs:

- **TOC** — the table of contents; click a heading to go to it.
- **Files** — your book's chapters. **New chapter** and **New folder** are at the top; hover a
  file for **Rename** and **Delete**. Deleting asks you to confirm, and the "Deleted" message
  that follows has an **Undo** button for the most recent delete.
- **Media** — your book's images. **Add images…** adds images to the book; select one and
  choose **Insert into document** to put it at the cursor.

![The Files tab, with New chapter and New folder](images/left-panel-files.jpg)

## Preview

The preview shows your book's pages exactly as they will print, and updates as you type.

- **Turn pages** with the buttons above the preview (first, previous, the page picker, next,
  last), with a flick of the mouse wheel over the preview, or with the keys below.
- **Zoom** with the menu at the top right of the preview: **Fit to width** or 25%–200%. The
  starting zoom is set in Settings → App → Preview.
- **Check the print overlays** with the **print overlays** button beside the zoom menu. It draws
  four layers on every page, each in its own colour: the **bleed** (a tinted band outside the
  trim, with a solid line where the page is cut), the printer's safe area for text (**Safe area:
  text**, a dashed line, with the strip beside the trim tinted), the printer's safe area for art
  (**Safe area: art**, a dotted line) and your own **page margins** (a thin solid line). Text,
  pictures and boxes that leave their safe line are outlined amber while they stay on the page and
  red once they cross the trim; each safe area layer outlines only what its own rule covers. Art
  you placed on purpose (full-bleed images, pinned art) is outlined softly and not counted. A small
  legend in the corner of the preview names each layer with its sizes in inches, says where they
  come from and counts what was found. The number on the button is how many things leave a safe
  area; hover for a one-line summary. It works in Read and Edit, the app remembers your choice, and
  it is for your eyes only: it is never printed, never in an exported PDF, and it does not move
  anything.
  - **Pick the layers.** The small arrow beside the button opens a menu with a tick box and a
    colour swatch for each layer: **Bleed**, **Safe area: text**, **Safe area: art** and **Page
    margins**. Ticking one while the overlays are off turns them on.
  - **Where the lines come from.** The bleed and the safe lines come only from your project's print
    settings: `page.width` and `page.height`, `page.bleed`, `page.safe`, `page.artSafe` and
    `page.gutter` in `manifest.yaml`, or your preset's values. Only the **Page margins** layer reads
    your stylesheet: your `@page` margins place your text and never move the printer's lines, and no
    stylesheet or plugin can hide or restyle the overlays. A DriveThruRPG (`dtrpg`) file already
    contains 0.125in of bleed on the top, bottom and outer edges (none on the binding edge), so the
    band and the trim line appear inside the page on those edges. The `dtrpg` preset asks for text
    at least 0.5in inside the trim and art at least 0.25in from the outside edges (0.5in at the
    binding edge); the `book` preset uses 0.25in for both. Set `page.safe` and `page.artSafe` (in
    points) for your printer's, and `page.gutter` if your book keeps further from the spine than
    that. With no bleed or safe area set, that part is not drawn and the legend says which setting
    to add.
  - **Make it louder or quieter, or change the colours** in Settings → App → Preview: *Print overlay
    strength* (Subtle, Normal or Strong: line width, tint and bleed band) and a colour for each
    layer (*Bleed overlay colour*, *Safe area: text overlay colour*, *Safe area: art overlay
    colour*, *Page margins overlay colour*). The lines stay the same thickness on screen at every
    zoom. These are app settings, not book CSS.

| Key | Does |
| --- | --- |
| Right arrow or Page Down | Next page |
| Left arrow or Page Up | Previous page |
| Home / End | First / last page |
| + or = / - | Zoom in / out |
| F | Fit to width |
| Ctrl+F | Find in the preview |

The page keys work when you are not typing in the editor or a field.

![Read mode: the preview on its own, two pages at a time](images/workspace-read.jpg)

## Fix problems

The **Problems** badge in the editor toolbar checks your book as you work and reads
**No problems** or a summary. Click it to open the list at the bottom of the editor: problems are
grouped by file, and clicking one opens the file at the line it is about. Esc closes the list.

![The Problems panel under the editor, reporting a missing image](images/problems-panel.jpg)

Next: [insert snippets and components](04-snippets.md).
