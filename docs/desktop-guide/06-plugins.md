---
title: Add plugins and formatting extras
description: Turn on the built-in formatting extras, add plugins from npm or a folder, keep them up to date, and set the order they load in.
---

# Add plugins and formatting extras

Plugins add new markdown to your book: highlights, callouts, footnote styles, a game's components
and more. Six of them are built in; the rest come from npm or a folder. All of them are on the
**Extensions** tab of **Setup**.

## Turn on a formatting extra

Six extras are built in, with nothing to download. Open **Setup → Extensions**. Under **Add an
extension → Built-in extras**, each extra the book does not use yet has an **Add** button and says
what to type; click it and the extra works straight away, and appears in **Your extensions** above.
To take one out again, click its **Remove** there, and it is offered under **Built-in extras**
again (footnotes, tables and definition lists are always on):

| Extra | Type |
| --- | --- |
| Highlight | `==text==` |
| Subscript | `H~2~O` |
| Superscript | `29^th^` |
| Abbreviations | `*[GPS]: Global Positioning System` |
| Callouts | `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]` |
| Math | `$E = mc^2$` in a line, or `$$` ... `$$` on lines of their own |

## Add a plugin from npm or a folder

On **Setup → Extensions**, under **Add an extension → From npm, a folder or a web address**:

- type a package's name in **npm package** (with a version if you want one, such as
  `markdown-it-highlightjs@4.3.0`) and click **Add**. Gutterpress downloads it, checks it, keeps a
  copy inside your book, and adds it to the list; your book then builds from that copy, even
  offline. **Find extensions** opens the [Find plugins](https://gutterpress.dimm.city/plugins/)
  page, which lists looks and plugins on npm;
- **Add a folder or file…** adds a plugin you have on your computer, used where it is;
- **Import a .zip or .css file…**, or a **Web address** and **Import**, copies a look or plugin into
  your book's `extensions` folder.

Plugins from npm, folders and the web run with full access to your computer: only add ones you
trust.

![Book setup, Extensions tab: your extensions, and the ways to add one](images/book-settings-extensions.jpg)

## Keep plugins working and up to date

**Your extensions**, at the top of the Extensions tab, is everything your book uses, looks and
extras included, in the order they load: one lower in the list wins where two disagree, and your own
stylesheet always comes last. Each row says what it is and where it comes from, and has:

- a checkbox to use it or not, **↑** and **↓** to move it, and **Remove** (which deletes an npm
  plugin's downloaded copy);
- **Version x is available.** and **Update**, when npm has a newer version. Gutterpress asks npm
  once each time you open the Extensions tab;
- **Couldn't load.** with **Show details**, when it fails, and **Install** or **Reinstall** for an
  npm plugin whose copy is missing or broken (or **Check again** for anything else). A plugin
  that works says nothing.

To use a particular version, add it with its version (`name@1.2.0`) or change the version in
`manifest.yaml`; the command line's `gutterpress ext` does the same. The
[plugins chapter](https://gutterpress.dimm.city/docs/plugins/) covers ordering plugins and writing
your own.

Next: [save a PDF](07-export-pdf.md).
