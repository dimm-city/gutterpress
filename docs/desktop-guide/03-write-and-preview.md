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
- **Check margins and bleed** with the **Margins and bleed** button beside the zoom menu. Each page
  gets a tinted margin area inside a dashed outline of the text block, and a red band for the
  bleed with a solid red line at the trim. Anything that spills past the margins is outlined: amber
  for the margin, red for across the trim. Art you placed on purpose (full-bleed images, pinned
  art) is outlined softly and not counted. The number on the button is how many elements spill
  over; hover for the details. It works in Read and Edit, the app remembers your choice, and it is
  for your eyes only: it is never printed, never in an exported PDF, and it does not move
  anything.
  - **The bleed band only appears when your stylesheet sets a bleed.** The margins and bleed are
    the ones your `@page` CSS defines, so a book without one shows the margins and no band, and the
    button's tooltip says "No bleed set". Add `bleed: 0.125in;` to your `@page` rule to see it.
  - **Make it louder or quieter, or change its colour** in Settings → App → Preview: *Margin
    overlay strength* (Subtle, Normal or Strong: line width, margin tint and bleed band) and
    *Margin overlay colour* (the margin outline and tint). The lines stay the same thickness on
    screen at every zoom. These are app settings, not book CSS.

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
