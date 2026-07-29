# Project contract

What Gutterpress treats as a project, what it renders, and what it owns.
Verified against the Gutterpress source that ships this package, 2026-07-28.

## Manifest

Gutterpress looks for this manifest name:

```text
manifest.yaml
```

Every path inside a manifest resolves from the **manifest's own directory**.
There is no project-wide search: the `bookPath` you were given is the book. If
the manifest does not exist there, stop without writing anything.

## Manuscript selection

```yaml
source:
  files:
    - chapters/01-introduction.md
    - chapters/02-rules.md
```

- **Explicit** — the listed files render, in that order. Any location works,
  including subdirectories.
- **Implicit** (`source.files` absent or empty) — every `.md` file **directly
  inside** the book folder renders, alphabetically. Discovery never recurses, so
  a `chapters/` folder is invisible unless it is listed.

The hazard to check before writing any Markdown at a book root: under implicit
discovery a root `DESIGN.md`, `README.md`, or `NOTES.md` **is a chapter**. Put
control documents under `design/`, above the book, or make `source.files`
explicit first. Never create a root-level control document in a book that uses
implicit discovery.

## Stylesheets

`styles:` is the explicit contract. When it is omitted, Gutterpress picks the first
of these that exists:

```text
styles/book.css
css/print.css
css/index.css
css/style.css
css/main.css
```

then the first `.css` it discovers (project root, `styles/`, `css/`,
`themes/<id>/theme.css`, alphabetically), then nothing at all. The same resolver
serves the renderer, the linter, and the desktop CSS editor, so what is edited
is always what is rendered.

## Page geometry

CSS `@page` is the real page geometry — it is what Paged.js lays out and what
Chromium prints. The manifest's `page:` block (`width`, `height`, `tolerance`)
states the **expected** trim size for validation; changing it does not resize
anything. To change the page, change `@page` in the stylesheet that owns it.

## Removed manifest fields

Two fields were deleted from Gutterpress and now make the build fail with a message
naming them:

- **`source.assets`** — assets are discovered from what the book actually
  references. There is no asset list, no staging step, and no flattening.
- **`output`** — output goes to `dist/<title-slug>/` by convention.

Never add either one back, and remove them if you find them in a manifest you
are already editing for another reason.

## Output — never edit

```text
book.html            # generated entry document
dist/**              # dist/<title-slug>/ — the whole generated output bundle
```

`book.html` contains the rendered Markdown, inlined stylesheets, and embedded
fonts, but a complete HTML build may also contain copied large images,
navigation scripts, `index.html`, a build fingerprint, and the Paged.js runtime
fallback. Treat the output directory as one bundle. None of it is source;
saving a serialized preview DOM back over any source file destroys the authoring
model.

## Commands the user runs (you do not run them)

```bash
gutterpress preview ./books/core-book      # live paginated preview, default port 3579
gutterpress lint    ./books/core-book      # print-safety CSS checks
gutterpress build   ./books/core-book --format pdf
gutterpress doctor                         # environment diagnosis
```

This plugin requests no shell or subprocess capability. Ask the user to run
these; do not attempt to invoke them.
