# Developing an extension locally

Work on an extension (a markdown-it plugin, a look, or a design system that
carries both) against a real book, and see each change in the live preview
without publishing to npm first. The package format itself is described in
[User Guide: Chapter 5 — Plugins](../examples/gutterpress-user-guide/05-plugins.md).

A book normally pins a published version of the extension:

```yaml
extensions:
  - my-extension@1.2.0
```

An `extensions:` entry that starts with `./`, `../` or `/` is a path instead,
and Gutterpress reads that folder in place: nothing is downloaded, vendored or
checked against a receipt. Point the book at your working copy while you
develop, and switch back to a pinned version when you release.

## 1. Point the book at your working copy

Clone the extension next to the book's repository:

```
src/
├── my-extension/          package.json, plugin.js, styles/, …
└── my-books/
    └── field-guide/
        └── manifest.yaml
```

Then change the entry in the book's `manifest.yaml`. The path is relative to
the manifest; an absolute path also works:

```yaml
extensions:
  - ../../my-extension      # was: my-extension@1.2.0
```

Edit the line by hand. `gutterpress ext add ../../my-extension field-guide`
does not replace the pin: it adds the path as a new last entry, so the book
loads both copies and the local one sits at a different place in the cascade
(list order is cascade order).

`gutterpress ext list field-guide` now shows the entry marked `path`.

## 2. Preview and edit

```sh
gutterpress preview field-guide
```

The desktop app runs the same preview server, so opening the book there works
the same way.

The preview watches the files the book reads from your folder and rebuilds
whenever one changes:

- `package.json`, so changes to `main` or to the `gutterpress.styles` list
  take effect
- the markdown-it entry (`gutterpress.markdown`, else `main`)
- every stylesheet in `gutterpress.styles`, the files they `@import`, and the
  fonts and images they reference with `url()`

The CLI prints `Watching shared dependency: <file>` as it starts watching
each one. Two kinds of file are not watched:

- **Modules the entry imports.** The runtime caches them for the life of the
  process, so an edit to a helper module does not show up even after a
  rebuild. Restart the preview.
- **Stylesheets listed in a `styles` export from the module.** An edit to one
  of these shows up on the next rebuild but does not start one. List them in
  `gutterpress.styles` instead.

## 3. Check the whole book

The preview shows the pages you look at. To find every page a change moved,
build the book once with the pin and once with the path, then compare the two
PDFs with the render-parity tool from a gutterpress checkout (see
[Render-parity gate](./render-parity-gate.md)):

```sh
gutterpress build field-guide --format pdf --out /tmp/before.pdf   # pinned
# switch the manifest to the path
gutterpress build field-guide --format pdf --out /tmp/after.pdf
bun packages/cli/scripts/render-parity.ts compare /tmp/before.pdf /tmp/after.pdf
```

It compares page count, page size, and the position of every text run and
image. It does not compare colour, so a colour-only change compares clean;
check those pages by eye.

## 4. Switch back and release

The path works only on your machine. CI, and anyone else who builds the book,
does not have your working copy, and their build stops with
`Plugin file not found`. Restore the pinned entry before you commit to the
book's repository, for example:

```sh
git checkout field-guide/manifest.yaml
```

After you publish, move the book to the new version:

```sh
gutterpress ext add my-extension@1.3.0 field-guide
```

`ext add` vendors the new version and re-pins the entry in place. It leaves
the old version's folder under `plugins/npm/my-extension/`; delete it
yourself.

## How a working copy differs from the published package

- **Files.** The book sees everything in your working copy. The published
  package contains only what the `files` field in `package.json` includes, so
  a stylesheet or font missing from that list works locally and is absent
  once published. Run `npm pack --dry-run` before releasing to see what
  ships.
- **Entry module.** For a folder, the markdown-it module is
  `gutterpress.markdown`, else `main`. For an installed package it is resolved
  by npm's rules, which check `exports` first. If `exports` names a different
  file, the two load different modules.
- **Dependencies.** An installed package runs against the dependency tree
  vendored with it. A folder's imports resolve from its own `node_modules`,
  so install its dependencies in the working copy.

The cascade layer is the same either way: `ext.<name>`, from the `name` in
`package.json`.

## Don't edit the vendored copy

Editing files under `plugins/npm/` is not a shortcut. Gutterpress checks that
tree against the file hashes in its receipt, so a single changed byte stops
the build with `Vendor tree hash does not match its receipt`. Point the book
at a working copy instead.
