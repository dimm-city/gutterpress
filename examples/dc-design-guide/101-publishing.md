@chapter #ch-cli .cli .chapter-02 ch="2"

# Print-md CLI Reference

::: wrapper {.dc-intro}
Commands for authoring, building, and publishing the Dimm City Field Guide.
:::

---

## print-md preview

Starts the live preview server with hot reload. Edits to markdown, CSS, or assets reflect immediately in the browser without a manual refresh.

**Syntax** — `print-md preview <project> [OPTIONS]`

`<project>` is a path to the manifest directory, or a named project registered in your workspace.

| Flag | Default | Description |
|------|---------|-------------|
| `--port N` | `3579` | Port to listen on |
| `--open` | `true` | Auto-open browser on start |
| `--no-watch` | — | Disable file watching |
| `--verbose` | — | Enable verbose output |
| `--debug` | — | Preserve temporary build files |

The preview opens at `http://localhost:PORT/`. If the port is in use, print-md increments to the next available port and logs which one was chosen.

---

## print-md build

Produces output from a manifest directory. Use `--format html` for a deployable static site; `--format pdf` for a Chromium-rendered PDF.

**Syntax** — `print-md build <project> [OPTIONS]`

| Flag | Default | Description |
|------|---------|-------------|
| `--format` | `pdf` | Output format: `html` or `pdf` |
| `--out` | — | Output path (directory for html; `.pdf` path for pdf) |
| `--title` | manifest | Overrides the document title |
| `--pdfx` | — | PDF/X flavor: `x1a` or `x3` (pdf only) |
| `--icc` | — | ICC profile path (required with `--pdfx`) |
| `--manifest` | — | Override manifest.yaml path |

---

## print-md validate

Runs the check suite against source files or a built PDF. Use `--category` to narrow to a single check category.

**Syntax** — `print-md validate <project> [OPTIONS]`

| Flag | Default | Description |
|------|---------|-------------|
| `--category` | all | `source`, `pdf`, `asset`, or `heuristic` |
| `--only` | — | Comma-separated list of check IDs to run |
| `--skip` | — | Comma-separated list of check IDs to skip |
| `--format` | `text` | Output format: `text` or `json` |
| `--phase` | both | `pre` or `post` — which pipeline phase to run |

---

## print-md run

The full validated build pipeline: `lint → validate:pre → convert → assets → build → validate:post`. Use for print-ready PDF production.

**Syntax** — `print-md run <project> [OPTIONS]`

| Flag | Default | Description |
|------|---------|-------------|
| `--out` | — | Output directory |
| `--pdfx` | — | PDF/X flavor: `x1a` or `x3` |
| `--icc` | — | ICC profile path |
| `--manifest` | — | Override manifest path |
| `--skip-pre-validate` | — | Skip pre-build source validation |
| `--skip-validate` | — | Skip post-build PDF validation |

---

## dc-design-guide Examples

```bash
# Live preview on a dedicated port
print-md preview dc-design-guide --port 3580

# Build a validated PDF for print
print-md build dc-design-guide --format pdf --out ./dist/dc-design-guide.pdf

# Build a deployable HTML viewer
print-md build dc-design-guide --format html --out ./_site
```

The HTML viewer (`--format html`) produces the same toolbar and page-nav chrome as the preview server — no backing server needed. Open `_site/index.html` in any browser.

---

## Next Steps

With the design guide authored and building cleanly, here are the next steps for adapting it to a new book:

- **Add chapters** — create numbered markdown files (`01-`, `02-`, …) in the project directory and register them in `manifest.yaml` under `files`. The pipeline processes them in filename order.
- **Customize design tokens** — edit `css/dc-brand.css` to override `--color-*`, `--font-*`, and `--fs-*` custom properties for the new book's brand. Changes cascade to all components that use the tokens.
- **Register new containers** — add custom `:::` container types in `manifest.yaml` under `containers`, then define matching CSS rules in a book-layer stylesheet. Any class from the stylesheet can also be applied via `:::wrapper {.class}`.
- **Commit the guide alongside book source** — keep the design guide in the same repository as the book content. This ensures the guide always reflects the CSS and plugin versions in use, and CI can build both the guide and the book PDF from the same workflow run.
