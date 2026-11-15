---
title: Save a PDF
description: Save a PDF of your book with a keyboard shortcut, or make every file your targets need from the Publish view.
---

# Save a PDF

**Ctrl+Shift+E** (Cmd+Shift+E on a Mac) saves a PDF of your book straight away: choose where in
the save dialog. It uses your book's page size and design exactly as the preview shows it, the
same PDF `gutterpress build` makes. While it works the app says **Laying out and writing the
PDF…**; "PDF saved to …" tells you when it's done, with **Show in Folder**.

Your book's content is checked first, as every build does. If something must be fixed first, the
PDF is not made and the message says **The book has problems to fix before the PDF can be
made.**; the problems are listed under **Problems** in the status bar. Any other failure says why
in a message that stays until you close it. The whole error is also in the app's log: on the
start screen, **Troubleshooting → Logs**.

If something on a page is too wide for it, the message names it and offers **Build anyway**,
which scales the whole book down to fit.

## A PDF for print, or a folder of files

To save a print-ready PDF/X, the website version, or a copy in a folder every time you publish,
add **A folder on this computer** as a target in **Publish → Targets** and choose its **File**
(PDF, PDF/X for print, or Website). Publishing checks each file against the rules of each target
it goes to. See [Publish your book](08-publish.md).

Next: [publish your book](08-publish.md).
