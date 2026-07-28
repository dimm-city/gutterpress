# Using Open Design with Print-MD

Open Design can refine a Print-MD publication directly because both applications work with ordinary files. Open Design edits the repository; Print-MD renders the authoritative paginated preview. There is no conversion step and no Open Design-specific Print-MD project format.

This guide assumes the **Print-MD Publishing** plugin is available in Open Design. The generic Print-MD preview improvements it relies on — theme cascade position, repagination after a stylesheet edit, and watching declared shared files — are in `main` as of 2026-07-28.

## Install the Open Design plugin

Install the published plugin once:

```bash
od plugin install print-md-publishing
```

For a team-maintained copy stored in the repository:

```bash
od plugin validate ./design/open-design/plugins/print-md-publishing --no-daemon
od plugin install ./design/open-design/plugins/print-md-publishing
```

Open Design copies a locally installed plugin into its own registry. Reinstall it after pulling a changed plugin version from Git.

## Open the right folders

### Single book

Open the book folder in both applications:

```text
my-book/
├── manifest.yaml
├── chapters/
├── design/
│   └── DESIGN.md
├── themes/
├── styles/
├── fonts/
├── images/
├── plugins/
├── profiles/
└── design-guide/
```

### Multi-book repository

Open the **repository root** in Open Design and the **target book folder** in Print-MD:

```text
publication-project/
├── DESIGN.md
├── design/
├── shared/
│   ├── themes/
│   ├── styles/
│   ├── fonts/
│   ├── images/
│   ├── plugins/
│   └── profiles/
└── books/
    ├── core-book/
    └── supplement/
```

Open Design can see the shared foundation and all books. Print-MD renders only the book you opened.

## Keep design guidance out of the manuscript

Print-MD recognizes `manifest.yaml`, `manifest.yml`, and `print-md.yaml`.

When `source.files` is explicit, a root-level `DESIGN.md` is safe:

```yaml
source:
  files:
    - chapters/01-introduction.md
    - chapters/02-rules.md
```

When `source.files` is absent or empty, Print-MD renders every top-level `.md` file in the book folder alphabetically — and only top-level files, so a `chapters/` folder needs an explicit list. Put book-specific guidance under `design/DESIGN.md` when discovery is implicit.

The Print-MD Publishing plugin checks this before editing and warns when a control document could enter the publication.

## Start the Print-MD preview

Start Preview in the desktop application, or run:

```bash
print-md preview ./books/core-book
```

Print-MD prints the actual local URL, normally:

```text
http://localhost:3579/
```

Open that URL in an Open Design Browser tab. The Print-MD preview is authoritative for page size, pagination, columns, running content, page breaks, and print layout.

When Open Design changes active CSS, fonts, images, page rules, or manuscript structure, Print-MD rebuilds and completes a fresh Paged.js pagination before replacing the visible preview. This applies to a shared stylesheet outside the book too, as long as the book's manifest names it.

## Apply the Print-MD Publishing plugin

Apply the plugin to the Open Design project bound to the repository. Supply:

- **Book path** — `.` for a single book or a path such as `books/core-book`
- **Goal** — the design change to make
- **Edit scope** — theme, layout, or content
- **Change ownership** — book-only or shared foundation
- **Preview URL** — the running Print-MD URL

The plugin reads the book manifest, source list, active theme, ordered styles, plugins, print constraints, and tracked design guidance before it changes anything.

## Choose the edit scope

### Theme

The default scope. Open Design may change:

- colors and CSS custom properties;
- typography and font declarations;
- borders, backgrounds, ornaments, and decorative assets;
- reusable component styling; and
- page chrome that does not require manuscript restructuring.

It does not change manuscript prose or semantic layout markers.

### Layout

Open Design may also change:

- reusable section components;
- `@chapter`, `@page`, `@section`, `@spread`, `@continue`, and related semantic markers;
- page and column rules;
- manifest style configuration when required; and
- authored Print-MD plugin behavior when CSS and semantic Markdown are insufficient.

### Content

Open Design may edit prose and manuscript structure as well as design files. Use this only when content changes are intended.

## Understand themes and styles

Print-MD keeps two different CSS locations:

- `themes/<id>/` is a selectable theme package containing `theme.css`, optional `theme.json`, and optional theme-owned assets.
- `styles/` contains ordinary publication CSS such as `book.css` and reusable component rules.

A small project may use only:

```yaml
styles:
  - styles/book.css
```

A larger project may use one active theme followed by stable shared and book styles:

```yaml
styles:
  - themes/publisher/theme.css
  - styles/publisher-components.css
  - styles/book.css
```

Later manifest styles win at equal specificity. Open Design integrates accepted changes into the file that should own them permanently. It does not create `open-design.css`, a token JSON file, or another tool-specific layer.

## Compose shared and book-local design

A `styles:` entry is a path Print-MD **reads**, not a file it copies. Point a book straight at the shared foundation and list the book's own CSS after it:

```yaml
source:
  files:
    - chapters/01-introduction.md
    - chapters/02-rules.md
styles:
  - ../../shared/themes/publisher/theme.css
  - ../../shared/styles/publisher-components.css
  - styles/book.css
```

Print-MD inlines those files in order into the built book. Each stylesheet's `url()` references resolve **relative to that stylesheet**, so a shared theme's own fonts and images come with it automatically:

```text
shared/themes/publisher/theme.css
  └── url("../../fonts/Publisher.woff2")   → embedded in the book
```

Fonts are always embedded as data URIs. Images under about 512 KB are embedded; larger ones are copied next to `book.html`.

There is no asset list, no flattening, and no collision rule. To shadow a shared decision, list the book's own stylesheet later — the cascade does the rest.

**One standing rule:** an image used directly in **Markdown prose** must live inside the book folder. A `../` or absolute image reference is a build error asking you to copy the file into the project. Shared art that is referenced from shared **CSS** is fine; shared art referenced from prose must be copied into the book that uses it.

> Manifests written for older Print-MD releases may still carry `source.assets` or `output`. Both were removed; a manifest that still has either fails with a message naming the field. Delete them — assets are discovered from what the book references, and output goes to `dist/<title-slug>/`.

## Choose shared or book-only ownership

Use shared files when a decision belongs to the product line:

```text
shared/themes/publisher/theme.css
shared/styles/publisher-components.css
shared/fonts/
shared/images/
shared/plugins/
```

Use the book folder when a decision belongs only to the current publication:

```text
books/core-book/themes/
books/core-book/styles/book.css
books/core-book/fonts/
books/core-book/images/
books/core-book/plugins/
```

Example shared request:

```text
Increase body leading across the product line. Update the shared publisher
foundation and verify the core-book preview. Do not add a local override.
```

Example local request:

```text
Give only the core book's chapter openers a darker accent and tighter spacing.
Integrate the change into its local theme or styles/book.css. Leave shared files
unchanged.
```

## Use visual selection correctly

Select or comment on an element in the Open Design Browser preview. The plugin uses the selection context together with Print-MD's existing `data-source-line`, `data-chapter-src`, IDs, semantic classes, and manifest configuration to identify likely Markdown and CSS ownership.

The Browser page is generated output. Direct DOM tuning against the HTTP preview is temporary. Durable changes always go into:

- the active theme;
- shared or local styles;
- semantic Markdown;
- authored Print-MD plugin source; or
- the manifest when layout configuration requires it.

Never save generated `book.html` back as publication source.

## Work with Print-MD plugins

### Authored local plugins

Shared and book-local authored plugins use paths relative to the manifest:

```yaml
plugins:
  - path: ../../shared/plugins/publisher-components.js
  - path: ./plugins/core-book-components.js
```

Open Design changes these only in layout or content scope and only when Markdown rendering behavior must change.

### Registry-installed npm plugins

Install npm plugins through Print-MD:

```bash
print-md plugin add markdown-it-highlightjs@4.3.0 ./books/core-book
```

For a package whose plugin function is a named export:

```bash
print-md plugin add markdown-it-emoji@3.0.0 ./books/core-book --export full
```

Print-MD verifies and vendors the exact runtime graph beneath the book's `plugins/npm/` directory. Commit that managed tree and the manifest entry for reproducible offline team builds. Do not hand-edit it or move it into `shared/`.

Use the Print-MD desktop plugin manager for broader inspection, enabling, disabling, importing, or removal. The public CLI currently exposes `plugin add`.

## Use the companion design guide

A `design-guide/` project is the best place to inspect the complete visual system without hunting through production chapters:

```bash
print-md preview ./books/core-book/design-guide
```

A useful guide covers typography, palette, reusable components, tables, callouts, page templates, chapter openers, running content, images, plugin output, and long-content edge cases. It should reference the same shared and local CSS as the book.

## Finish the session

1. Confirm that every change has the correct shared or book-local owner.
2. Remove experiments that were superseded.
3. Record durable decisions in `DESIGN.md` or `design/notes/`.
4. Run the normal Print-MD checks.

```bash
print-md lint ./books/core-book
print-md build ./books/core-book --format pdf
```

Use `print-md doctor` when diagnosing missing external tools or installation problems.

## Core rules

- Open Design edits source files; Print-MD renders them.
- Open the repository root in Open Design and the target book in Print-MD.
- Keep theme packages in `themes/` and ordinary CSS in `styles/`.
- Keep design guidance nested when manuscript discovery is implicit.
- Put cross-book work in `shared/`; put book-only work in the book folder.
- Reference shared CSS directly from `styles:` — nothing needs copying.
- Keep prose images inside the book that uses them.
- Keep one active theme, listed first, and extend it through later ordinary styles.
- Let Print-MD manage registry-installed packages under `plugins/npm/`.
- Never edit generated `book.html` or build output.
- Use the Print-MD preview as the final authority for pagination.

## References

- [Print-MD CLI and manifest reference](../../packages/cli/README.md)
- [Print-MD styling and themes](../../examples/print-md-user-guide/04-styling-theming.md)
- [Print-MD plugins](../../examples/print-md-user-guide/06-plugins.md)
- [Print-MD companion design guides](../design-guides.md)
- [Print-MD compatibility plan for filesystem design tools](./print-md-open-design-implementation-plan.md)
- [Open Design](https://github.com/nexu-io/open-design)
