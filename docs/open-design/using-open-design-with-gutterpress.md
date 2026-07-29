# Using Open Design with Gutterpress

Open Design can refine a Gutterpress publication directly because both applications work with ordinary files. Open Design edits the repository; Gutterpress renders the authoritative paginated preview. There is no conversion step and no Open Design-specific Gutterpress project format.

This guide uses release candidate 0.2.0 of the **Gutterpress Publishing** plugin,
Open Design 0.16.1, and the unreleased Gutterpress source on this branch as of
2026-07-28. Published Gutterpress 0.8.3 does not contain the required preview
corrections. Open Design records but does not enforce the plugin's declared
`>=0.16.1` engine floor, so verify the CLI version manually.

## Install the Open Design plugin

The plugin is not yet listed in the Open Design marketplace. Install it from a
Gutterpress checkout:

```bash
od plugin validate ./packages/open-design-plugin/plugin --no-daemon
od plugin install ./packages/open-design-plugin/plugin
od plugin doctor gutterpress-publishing
```

For a team-maintained copy stored in the repository:

```bash
od plugin validate ./design/open-design/plugins/gutterpress-publishing --no-daemon
od plugin install ./design/open-design/plugins/gutterpress-publishing
```

Open Design copies a locally installed plugin into its own registry. Reinstall it after pulling a changed plugin version from Git.

On Linux, `/usr/bin/od` may be the unrelated coreutils octal-dump command. If
`od plugin --help` does not show Open Design commands, use the absolute CLI path
shown by the Open Design desktop app's integration setup.

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

Open the **repository root** in Open Design and the **target book folder** in Gutterpress:

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

Open Design can see the shared foundation and all books. Gutterpress renders only the book you opened.

## Keep design guidance out of the manuscript

Gutterpress recognizes `manifest.yaml`.

When `source.files` is explicit, a root-level `DESIGN.md` is safe:

```yaml
source:
  files:
    - chapters/01-introduction.md
    - chapters/02-rules.md
```

When `source.files` is absent or empty, Gutterpress renders every top-level `.md` file in the book folder alphabetically — and only top-level files, so a `chapters/` folder needs an explicit list. Put book-specific guidance under `design/DESIGN.md` when discovery is implicit.

The Gutterpress Publishing plugin checks this before editing and warns when a control document could enter the publication.

## Start the Gutterpress preview

Start Preview in the desktop application, or run:

```bash
gutterpress preview ./books/core-book
```

Gutterpress prints the actual local URL, normally:

```text
http://localhost:3579/
```

Open that URL in an Open Design Browser tab. The preview uses Gutterpress's real
Markdown, CSS, and Paged.js pipeline, so it is the visual authority while
editing. Wait for pagination to complete and confirm page-critical work with a
normal Gutterpress build before final delivery.

When Open Design changes active CSS, fonts, images, page rules, or manuscript
structure, Gutterpress rebuilds before replacing the visible preview. Stylesheet
and Markdown changes both take the full-document pagination path so a changed
boundary can reflow every following page. Declared shared CSS dependencies are
watched too.

## Apply the Gutterpress Publishing plugin

Apply the plugin to the Open Design project bound to the repository and put the
working brief in the same message. Include these values when they are not
obvious:

- **Book path** — `.` for a single book or a path such as `books/core-book`
- **Goal** — the design change to make
- **Edit scope** — theme, layout, or content
- **Change ownership** — book-only or shared foundation
- **Preview URL** — the running Gutterpress URL

Open Design 0.16.1 intentionally does not render plugin input fields in an
existing project's composer. The plugin therefore resolves these values from
the message, project, and active Browser tab. It defaults to theme-only,
book-only edits; when a safety-relevant value remains ambiguous, it asks once in
an inline form and makes no edits until the answer arrives.

Open Design 0.16.1 also has an existing-project picker bug that can display the
plugin chip without attaching its snapshot to the next run. The reliable
invocation until that host bug is fixed is:

```bash
od project list
od plugin run gutterpress-publishing \
  --project <project-id> \
  --message "In books/core-book, refine chapter openers. Keep it theme-only and book-only. The preview is http://localhost:3579/." \
  --follow
```

The CLI run does not attach an open Browser tab or collect inline form answers.
Put the book path, goal, edit scope, ownership, and preview URL in `--message`
when they matter. If the agent still emits a clarification form, it stops
without writing; answer from the project chat or start a follow-up run with the
resolved brief.

The plugin reads the book manifest, source list, active theme, ordered styles,
plugins, print constraints, and tracked design guidance before changing files.

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
- authored Gutterpress plugin behavior when CSS and semantic Markdown are insufficient.

### Content

Open Design may edit prose and manuscript structure as well as design files. Use this only when content changes are intended.

## Understand themes and styles

Gutterpress keeps two different CSS locations:

- `themes/<id>/` is a selectable theme package containing `theme.css`, optional `theme.json`, and optional theme-owned assets. Built-in, folder, and zip imports copy complete packages; bare CSS and URL imports create only the stylesheet plus metadata, and URL imports do not fetch referenced assets.
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

A `styles:` entry is a path Gutterpress **reads**, not a file it copies. Point a book straight at the shared foundation and list the book's own CSS after it:

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

Gutterpress inlines those files in order into the built book. Each stylesheet's `url()` references resolve **relative to that stylesheet**, so a shared theme's own fonts and images come with it automatically:

```text
shared/themes/publisher/theme.css
  └── url("../../fonts/Publisher.woff2")   → embedded in the book
```

Fonts are always embedded as data URIs. Images under about 512 KB are embedded;
larger ones are copied into the generated output tree. An HTML build is a bundle:
besides `book.html`, it includes navigation scripts, `index.html`, a fingerprint,
copied assets, and, when Chromium is unavailable at build time, the Paged.js
runtime fallback.

There is no asset list, no flattening, and no collision rule. To shadow a shared decision, list the book's own stylesheet later — the cascade does the rest.

**One standing rule:** an image used directly in **Markdown prose** must live inside the book folder. A `../` or absolute image reference is a build error asking you to copy the file into the project. Shared art that is referenced from shared **CSS** is fine; shared art referenced from prose must be copied into the book that uses it.

> Manifests written for older Gutterpress releases may still carry `source.assets` or `output`. Both were removed; a manifest that still has either fails with a message naming the field. Delete them — assets are discovered from what the book references, and output goes to `dist/<title-slug>/`.

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

Opening the preview in an Open Design Browser tab supplies URL and title context.
Open Design 0.16.1 does not attach arbitrary element comments or ancestor
metadata from an external HTTP page. When the selected agent exposes Browser
Use automation, it can inspect Gutterpress's existing `data-source-line`,
`data-chapter-src`, IDs, and semantic classes. Otherwise, describe or attach a
screenshot of the visual target and let the plugin confirm ownership from
source.

The Browser page is generated output. Direct DOM tuning against the HTTP preview is temporary. Durable changes always go into:

- the active theme;
- shared or local styles;
- semantic Markdown;
- authored Gutterpress plugin source; or
- the manifest when layout configuration requires it.

Never save generated `book.html` back as publication source.

## Work with Gutterpress plugins

### Authored local plugins

Shared and book-local authored plugins use paths relative to the manifest:

```yaml
plugins:
  - path: ../../shared/plugins/publisher-components.js
  - path: ./plugins/core-book-components.js
```

Open Design changes these only in layout or content scope and only when Markdown rendering behavior must change.

### Registry-installed npm plugins

Install npm plugins through Gutterpress:

```bash
gutterpress plugin add markdown-it-highlightjs@4.3.0 ./books/core-book
```

For a package whose plugin function is a named export:

```bash
gutterpress plugin add markdown-it-emoji@3.0.0 ./books/core-book --export full
```

Gutterpress verifies and vendors the exact runtime graph beneath the book's `plugins/npm/` directory. Commit that managed tree and the manifest entry for reproducible offline team builds. Do not hand-edit it or move it into `shared/`.

Use the Gutterpress desktop plugin manager for broader inspection, enabling, disabling, importing, or removal. The public CLI currently exposes `plugin add`.

## Use the companion design guide

A `design-guide/` project is the best place to inspect the complete visual system without hunting through production chapters:

```bash
gutterpress preview ./books/core-book/design-guide
```

A useful guide covers typography, palette, reusable components, tables, callouts, page templates, chapter openers, running content, images, plugin output, and long-content edge cases. It should reference the same shared and local CSS as the book.

## Finish the session

1. Confirm that every change has the correct shared or book-local owner.
2. Remove experiments that were superseded.
3. Record durable decisions in `DESIGN.md` or `design/notes/`.
4. Run the normal Gutterpress checks.

```bash
gutterpress lint ./books/core-book
gutterpress build ./books/core-book --format pdf
```

Use `gutterpress doctor` when diagnosing missing external tools or installation problems.

## Core rules

- Open Design edits source files; Gutterpress renders them.
- Open the repository root in Open Design and the target book in Gutterpress.
- Keep theme packages in `themes/` and ordinary CSS in `styles/`.
- Keep design guidance nested when manuscript discovery is implicit.
- Put cross-book work in `shared/`; put book-only work in the book folder.
- Reference shared CSS directly from `styles:` — nothing needs copying.
- Keep prose images inside the book that uses them.
- Keep one active local theme. A first application defaults to the front;
  replacement preserves its existing cascade position. Do not reorder a valid
  stylesheet list merely to force the theme first.
- Let Gutterpress manage registry-installed packages under `plugins/npm/`.
- Never edit generated `book.html` or build output.
- Use the Gutterpress preview as the final authority for pagination.

## References

- [Gutterpress CLI and manifest reference](../../packages/cli/README.md)
- [Gutterpress styling and themes](../../examples/gutterpress-user-guide/04-styling-theming.md)
- [Gutterpress plugins](../../examples/gutterpress-user-guide/06-plugins.md)
- [Gutterpress companion design guides](../design-guides.md)
- [Gutterpress compatibility plan for filesystem design tools](./gutterpress-open-design-implementation-plan.md)
- [Open Design](https://github.com/nexu-io/open-design)
