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
- **Check the safe area and bleed** with the **Safe area and bleed** button beside the zoom menu.
  Each page gets a dashed outline of its safe area with the band between it and the trim tinted,
  and a red band for the bleed with a solid red line at the trim. Anything that leaves the safe
  area is outlined: amber while it stays on the page, red once it crosses the trim. Art you placed
  on purpose (full-bleed images, pinned art) is outlined softly and not counted. The number on the
  button is how many elements leave the safe area; hover for the details. It works in Read and
  Edit, the app remembers your choice, and it is for your eyes only: it is never printed, never in
  an exported PDF, and it does not move anything.
  - **Where the lines come from.** Only your project's print settings: `page.width` and
    `page.height`, `page.bleed` and `page.safe` in `manifest.yaml`, or your preset's values. Your
    stylesheet's `@page` margins place your text and never move the lines, and no stylesheet or
    plugin can hide or restyle the overlay. A DriveThruRPG (`dtrpg`) file already contains 0.125in
    of bleed on the top, bottom and outer edges (none on the binding edge), so the band and the trim
    line appear inside the page on those edges. The `dtrpg` and `book` presets set a 0.25in safe
    area; set `page.safe` (in points) for your printer's. With no bleed or safe area set, that part
    is not drawn and the button's tooltip says which setting to add.
  - **Make it louder or quieter, or change its colour** in Settings → App → Preview: *Safe area
    overlay strength* (Subtle, Normal or Strong: line width, tint and bleed band) and *Safe area
    overlay colour* (the safe-area outline and tint). The lines stay the same thickness on screen
    at every zoom. These are app settings, not book CSS.

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
