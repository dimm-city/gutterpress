---
name: print-md-publishing
description: Design and refine an existing Print-MD paged publication without converting it into a web application or editing generated output.
triggers:
  - print-md
  - paged publication
  - book theme
  - print layout
  - markdown to PDF
---

# Print-MD Publishing

You are editing an existing Print-MD publication in place. Print-MD remains the
renderer. The running Print-MD preview is the visual and pagination authority.

Use the plugin inputs as authoritative. Do not ask the user to repeat them.
Read the companion files in the staged skill's `references/` directory before
changing the project.

## Non-negotiable rules

- Do not create a new web application, `index.html`, React project, or replacement renderer.
- Do not edit generated `book.html`, `dist/`, preview temp files, or `.od-skills/`.
- Do not create Open Design-specific CSS, token JSON, manifest fields, or state files.
- Do not add `source.assets` or `output` to a manifest — both were removed from Print-MD and now fail the build outright.
- Do not edit Print-MD-managed files beneath `plugins/npm/`.
- Preserve semantic Markdown and existing Print-MD layout markers.
- Prefer the smallest stable change in an existing theme, stylesheet, component, manifest, or authored local plugin.
- Use one active `themes/<id>/theme.css`, listed first; extend it through later ordinary styles.
- Keep any image used in Markdown prose inside the book folder — a `../` or absolute reference is a build error.
- Treat direct DOM tuning on the HTTP preview as temporary context, never as the durable edit.
- Reject a `bookPath` that is absolute or escapes the imported project root.

## Workflow

### 1. Resolve the target book

1. Resolve `bookPath` beneath the imported Open Design project root.
2. Find the first existing manifest in this order: `manifest.yaml`, `manifest.yml`, `print-md.yaml`.
3. Stop without writing when no manifest exists at the exact target path.
4. Read the manifest before scanning or editing project files.
5. If `source.files` is absent or empty, remember that every **top-level** `.md` file in the book is manuscript content, and that discovery never recurses — a `chapters/` folder only renders when it is listed explicitly.

### 2. Inspect the publication contract

Read and summarize:

- explicit or implicit manuscript files;
- the ordered `styles` list, with the active `themes/<id>/theme.css` first, noting which entries escape the book root (shared foundation) and which are book-local;
- page, preset, PDF/X, and validation constraints relevant to the request;
- authored local plugins and Print-MD-managed npm plugins;
- repository-level and book-level design guidance; and
- which stylesheet actually declares the property you intend to change.

Every `styles` entry names a real file at that exact path. Print-MD reads and
inlines it; nothing is staged, flattened, or renamed, so there is no output path
to reverse-map. An entry such as `../../shared/styles/components.css` is the
shared foundation itself — editing it changes every book that lists it.

Each stylesheet's `url()` references resolve relative to **that stylesheet**, so
a shared theme's fonts and images already travel with it. Fonts are embedded;
images are embedded or copied by size.

### 3. Enforce ownership and edit scope

Follow `changeScope`:

- `shared-foundation`: edit a shared source only when the treatment is intended for multiple books.
- `book-only`: edit only files owned by the target book. Do not modify shared foundations. To override a shared declaration, add the rule to a book stylesheet that is listed later in `styles` — the cascade settles it.

Follow `editScope`:

- `theme`: CSS, theme-owned fonts/images, and design guidance only.
- `layout`: theme scope plus semantic layout markers, manifest style configuration, and authored local plugin source when necessary.
- `content`: layout scope plus manuscript prose and structure.

Never broaden either scope silently.

### 4. Implement the smallest stable change

Use this preference order:

1. Existing CSS custom property in the owning stylesheet.
2. Existing reusable component rule.
3. New reusable semantic component rule in an existing stable stylesheet.
4. Stable book-specific rule in the existing local stylesheet.
5. Semantic Markdown marker/class change when layout scope permits it.
6. Authored Print-MD plugin change only when the behavior cannot be expressed in CSS or semantic Markdown.

Do not add a tool-specific override stylesheet. Integrate the accepted result
into the file that should own it permanently.

### 5. Verify

- Re-read every changed source file.
- Confirm no generated output or managed npm plugin file changed.
- Inspect the Print-MD preview at `previewUrl` when one was provided.
- Use existing `data-source-line`, `data-chapter-src`, IDs, classes, and semantic structure to relate preview elements to source.
- After typography, page geometry, columns, spacing, font, image-size, or break-rule changes, confirm the preview finished a complete pagination. Print-MD rebuilds and repaginates on every stylesheet edit — including an edit to a shared stylesheet the manifest names — so allow the rebuild to land before judging layout, and reload the Browser tab if page counts or boundaries look stale.
- Report the files changed, their shared or book-local ownership, and any remaining preview limitation.
