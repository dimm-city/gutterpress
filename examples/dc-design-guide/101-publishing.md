@chapter #ch-cli .cli .chapter-02 ch="2"

# Publishing

::: wrapper {.dc-intro}
Three commands cover the full authoring lifecycle: preview for live editing, build for output, run for print-ready PDFs.
:::

---

## Essential Commands

| Command | What it does |
|---------|-------------|
| `print-md preview <project>` | Live preview server with hot reload — edits to markdown, CSS, or assets reflect immediately |
| `print-md build <project> --format pdf` | Render a PDF via Chromium |
| `print-md build <project> --format html` | Build a static HTML viewer for browser or deploy |
| `print-md run <project>` | Full validated pipeline: lint → validate → convert → build → validate |
| `print-md validate <project>` | Run checks against source files or a built PDF |

---

## Common Usage

```bash
# Live preview on a dedicated port
print-md preview examples/dc-design-guide --port 3580

# Build a print-ready PDF
print-md build examples/dc-design-guide --format pdf --out ./dist/guide.pdf

# Build a deployable HTML viewer
print-md build examples/dc-design-guide --format html --out ./_site

# Full validated pipeline (use before final print submission)
print-md run examples/dc-design-guide --out ./dist/
```

---

## Key Flags

| Flag | Commands | Purpose |
|------|----------|---------|
| `--port N` | preview | Port to listen on (default: 3579) |
| `--format` | build | `pdf` or `html` |
| `--out` | build, run | Output path |
| `--pdfx` | build, run | PDF/X flavor: `x1a` or `x3` |
| `--icc` | build, run | ICC profile path (required with `--pdfx`) |
| `--category` | validate | `source`, `pdf`, `asset`, or `heuristic` |
