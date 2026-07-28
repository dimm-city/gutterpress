---
name: print-md-publishing
description: Use this plugin when the user wants to design or refine an existing Print-MD paged publication without replacing its renderer or editing generated output.
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

Resolve the runtime brief from the latest user message, submitted form answers,
the imported project, and the active Browser context. Explicit user statements
are authoritative; inferred values are conservative defaults. This skill is the
complete workflow contract. Packaged reference documents are optional background
when the host makes them available; never block or guess because they cannot be
opened from the active run.

## Resolve the runtime brief

Resolve these values before writing:

- **Book path:** use the project root when it contains a recognized manifest. If
  it does not, use the only obvious nested book. Ask when several books are
  plausible; never guess between them.
- **Goal:** use the user's concrete request. Ask when no requested outcome is
  present; do not invent a redesign.
- **Edit scope:** default to `theme`. Use `layout` only when the goal requires
  semantic markers, manifest layout configuration, or authored plugin code. Use
  `content` only when the user explicitly requests prose or structural edits.
- **Change ownership:** default to `book-only`. Use `shared-foundation` only when
  the user explicitly wants the decision to affect multiple books.
- **Preview URL:** prefer an active loopback Print-MD Browser tab, otherwise try
  `http://localhost:3579/`. Confirm `/api/status` identifies the intended book
  before relying on it. Never invent a remote URL.

Do not ask merely to confirm a safe inference. If a required value is still
ambiguous, emit exactly one `<question-form id="print-md-brief">` containing
only the unresolved questions, then stop the turn without writing. Use `text`
for `bookPath`, `textarea` for `goal`, `select` with
`theme`/`layout`/`content` for `editScope`, `select` with
`book-only`/`shared-foundation` for `changeScope`, and `url` for `previewUrl`.
Answers arrive in the next user message beginning with
`[form answers — print-md-brief]` and override inferred defaults.

Use this shape, deleting questions that are already resolved:

```html
<question-form id="print-md-brief" title="Confirm publication scope">
{
  "description": "Only the unresolved decisions are shown. No files will change until you submit this brief.",
  "questions": [
    { "id": "bookPath", "label": "Which Print-MD book should change?", "type": "text", "required": true },
    { "id": "goal", "label": "What should change?", "type": "textarea", "required": true },
    { "id": "editScope", "label": "How far may the edit reach?", "type": "select", "options": ["theme", "layout", "content"], "allowCustom": false, "required": true },
    { "id": "changeScope", "label": "Who should own the change?", "type": "select", "options": ["book-only", "shared-foundation"], "allowCustom": false, "required": true },
    { "id": "previewUrl", "label": "What is the running Print-MD preview URL?", "type": "url", "required": false }
  ]
}
</question-form>
```

After `</question-form>`, stop. Do not narrate next steps or begin inspection.

## Non-negotiable rules

- Do not create a new web application, `index.html`, React project, or replacement renderer.
- Do not edit generated `book.html`, `dist/`, preview temp files, or `.od-skills/`.
- Do not create Open Design-specific CSS, token JSON, manifest fields, or state files.
- Do not add `source.assets` or `output` to a manifest — both were removed from Print-MD and now fail the build outright.
- Do not edit Print-MD-managed files beneath `plugins/npm/`.
- Preserve semantic Markdown and existing Print-MD layout markers.
- Prefer the smallest stable change in an existing theme, stylesheet, component, manifest, or authored local plugin.
- Keep one active local `themes/<id>/theme.css`. A first application defaults to
  the front of `styles`; replacing a theme preserves its established cascade
  position. Do not reorder a valid stylesheet list merely to force the theme
  first.
- Keep any image used in Markdown prose inside the book folder — a `../` or absolute reference is a build error.
- Change page geometry through the owning CSS `@page` rule. The manifest `page:`
  block records expected trim dimensions for validation; it does not resize the
  rendered page.
- Never target generated `.pagedjs_*` structure or a page by ordinal. Style
  semantic Markdown, marker classes, and stable project selectors instead.
- Treat direct DOM tuning on the HTTP preview as temporary context, never as the durable edit.
- Reject a book path that is absolute or escapes the imported project root.
- Do not run Git, package managers, or start/stop the Print-MD preview. Ask the
  user to run Print-MD commands when they are needed.

## Workflow

### 1. Resolve the target book

1. Resolve the selected book beneath the imported Open Design project root.
2. Find the first existing manifest in this order: `manifest.yaml`, `manifest.yml`, `print-md.yaml`.
3. Stop without writing when no manifest exists at the exact target path.
4. Read the manifest before scanning or editing project files.
5. If `source.files` is absent or empty, remember that every **top-level** `.md` file in the book is manuscript content, and that discovery never recurses — a `chapters/` folder only renders when it is listed explicitly. Never add a root `DESIGN.md`, `README.md`, or notes file in that case; put control documents under `design/`.

### 2. Inspect the publication contract

Read and summarize:

- explicit or implicit manuscript files;
- the ordered `styles` list and the active local `themes/<id>/theme.css` entry,
  noting its established cascade position and which entries escape the book
  root (shared foundation) or remain book-local;
- page, preset, PDF/X, and validation constraints relevant to the request;
- authored local plugins and Print-MD-managed npm plugins;
- repository-level and book-level design guidance; and
- which stylesheet actually declares the property you intend to change.

Every `styles` entry names a real file at that exact path. Print-MD reads and
inlines it; nothing is staged, flattened, or renamed, so there is no output path
to reverse-map. An entry such as `../../shared/styles/components.css` is the
shared foundation itself — editing it changes every book that lists it.

When `styles` is omitted, inspect the first existing file in this order:
`styles/book.css`, `css/print.css`, `css/index.css`, `css/style.css`,
`css/main.css`; Print-MD then falls back to the first discovered CSS file. Do
not assume a conventional file is active when it does not exist.

Each stylesheet's `url()` references resolve relative to **that stylesheet**, so
a shared theme's fonts and images already travel with it. Fonts are embedded;
images are embedded or copied by size.

### 3. Enforce ownership and edit scope

Follow the resolved change ownership:

- `shared-foundation`: edit a shared source only when the treatment is intended for multiple books.
- `book-only`: edit only files owned by the target book. Do not modify shared foundations. To override a shared declaration, add the rule to a book stylesheet that is listed later in `styles` — the cascade settles it.

Follow the resolved edit scope:

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
- Inspect the resolved Print-MD preview when it is available. An active Browser
  tab guarantees URL/title context, not an element-selection attachment. Use
  Browser automation only when the current agent exposes it; otherwise inspect
  source and ask the user for the specific visual target.
- When DOM inspection is available, use existing `data-source-line`,
  `data-chapter-src`, IDs, classes, and semantic structure as hints that must be
  confirmed against source.
- After typography, page geometry, columns, spacing, font, image-size, or
  break-rule changes, wait for a complete pagination before judging layout.
  Print-MD rebuilds and full-reloads the complete document after every watched
  source change. Reload the Browser tab if a page count or boundary still looks
  stale.
- Report the files changed, their shared or book-local ownership, and any remaining preview limitation.
