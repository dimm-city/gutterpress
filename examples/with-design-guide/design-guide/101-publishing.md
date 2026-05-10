# Print-md CLI Reference {#cli-reference}

<div class="lede">Commands for authoring, building, and publishing — updated for print-md v2.0.0. The design guide itself is a first-class output target alongside the book.</div>

---

## Command Overview {#cli-overview}

### print-md preview

Starts the live preview server with hot reload. Edits to markdown, CSS, or assets reflect immediately.

**Syntax** — `print-md preview [INPUT] [OPTIONS]`

`INPUT` defaults to the current directory.

| Flag | Default | Description |
|------|---------|-------------|
| `--port N` | `3579` | Port to listen on |
| `--open` | `true` | Auto-open browser on start |
| `--no-watch` | — | Disable file watching |
| `--verbose` | — | Enable verbose output |
| `--debug` | — | Preserve temporary files |

**Examples**:

```
print-md preview field-guide --port 3579 --open false
print-md preview design-guide --port 3580 --open false
```

The preview opens at `http://localhost:PORT/` (root) — not `/preview.html` as in pre-v2 versions.

<div class="callout-note">
<span class="callout-label">Note</span>
If the port is in use, print-md automatically increments to the next available port and logs which port was chosen.
</div>

### print-md build

Produces output from a manifest directory. Use `--format html` for a deployable static site; `--format pdf` (default) for a Chromium-rendered PDF.

**Syntax** — `print-md build [INPUT] [OPTIONS]`

`INPUT` is a positional argument pointing to the manifest directory (defaults to cwd).

| Flag | Default | Description |
|------|---------|-------------|
| `--format` | `pdf` | Output format: `html` or `pdf` |
| `--out` | — | Output directory (or `.pdf` path for pdf format) |
| `--title` | manifest | Overrides the document title |
| `--pdfx` | — | PDF/X flavor: `x1a` or `x3` (pdf only) |
| `--icc` | — | ICC profile path (required with `--pdfx`) |
| `--manifest` | — | Override manifest.yaml path |
| `--strip-annotations` | auto | Strip PDF annotations (default when `--pdfx` is set) |

**Examples**:

```
# HTML static site (design guide → deployable viewer)
print-md build design-guide --format html --out ./_site

# PDF (plain Chromium)
print-md build field-guide --format pdf --out ./field-guide.pdf

# PDF/X (CMYK, embedded fonts)
print-md build field-guide --format pdf --pdfx x1a --icc ./profiles/CGATS21_CRPC1.icc
```

### print-md run

The full validated PDF pipeline: `lint → validate:pre → build → validate:post`. Use this for print-ready PDF production, not for HTML output or the design guide.

**Syntax** — `print-md run --input [DIR] [OPTIONS]`

Note: `--input` is a required named flag (not positional), unlike `build`.

| Flag | Default | Description |
|------|---------|-------------|
| `--input` | required | Input directory |
| `--out` | — | Output directory |
| `--pdfx` | — | PDF/X flavor: `x1a` or `x3` |
| `--icc` | — | ICC profile path |
| `--manifest` | — | Override manifest path |
| `--skip-lint` | — | Skip CSS linting |
| `--skip-validate` | — | Skip post-build PDF validation |
| `--skip-pre-validate` | — | Skip pre-build validation |

**Example**:

```
print-md run --input field-guide/ --out .print-md/build/field-guide-print-pdf \
  --pdfx x1a --icc .print-md/profiles/CGATS21_CRPC1.icc
```

### print-md lint / validate / audit / preflight

| Command | Description |
|---------|-------------|
| `lint [DIR]` | Check CSS for print-safety issues |
| `validate [FILE]` | Validate source files or a built PDF for print compliance |
| `audit [DIR]` | Asset-only validation checks |
| `preflight [FILE]` | Deterministic print preflight for a built PDF |

---

## Design Guide as Static Site {#publishing}

The design guide is a first-class output target in print-md v2.0.0. `build --format html` produces a complete deployable directory with the same viewer chrome as the preview server — toolbar, page nav, zoom, print button — but with no backing server.

### Build the static site

```
print-md build design-guide --format html --out .print-md/build/design-guide-site
```

Output structure:

```
design-guide-site/
├── index.html       ← the print-md viewer (same UI as preview)
├── book.html        ← the rendered guide content
├── preview/         ← viewer scripts and styles
│   ├── scripts/
│   └── styles/
├── css/             ← copied from manifest assets
└── fonts/
```

Open `index.html` in any browser — no server needed. The viewer loads `book.html` (the rendered guide content) into an iframe alongside the toolbar chrome.

### npm scripts (optional)

If your project uses a `package.json`, add these as convenience scripts:

```json
"scripts": {
  "preview": "print-md preview design-guide --port 3580 --open false",
  "build:guide": "print-md build design-guide --format html --out ./_site"
}
```

### Publish to GitHub Pages

1. Copy the workflow from `print-md/examples/with-design-guide/.github/workflows/publish-design-guide.yml` into your repo.
2. Set **Settings → Pages → Source: GitHub Actions**.
3. Push to `main` — the workflow runs `build --format html` and deploys.

The guide is reachable at `https://<owner>.github.io/<repo>/`. The viewer uses relative paths, so subpath hosting works without configuration.

### Publish to Azure Static Web Apps

1. Copy the same workflow into your repo.
2. In Azure, create a Static Web App and copy its deployment token.
3. Add the token to your repository as **Settings → Secrets and variables → Actions → `AZURE_STATIC_WEB_APPS_API_TOKEN`**.
4. In `.github/workflows/publish-design-guide.yml`, uncomment the **Deploy to Azure Static Web Apps** step.
5. If you are only deploying to Azure, remove or comment out the GitHub Pages upload/deploy pieces.

The Azure deployment uses the already-built `design-guide-site/` directory, so Static Web Apps serves the exact same `index.html` + `book.html` viewer bundle produced by `print-md build --format html`.

### Include a downloadable PDF

To publish a PDF alongside the HTML guide:

```
# Build the HTML site first
print-md build design-guide --format html --out ./_site

# Add the PDF into the same output dir
print-md build design-guide --format pdf --out ./_site

# Or use run for a validated PDF/X:
print-md run --input design-guide --out ./_site
```

Link to it from `00-toc.md`: `[Download PDF](book.pdf){.download}`.

---

## Deleted Commands (v2.0.0) {#deprecated}

The following commands were removed in v2.0.0:

| Old command | Replacement |
|-------------|-------------|
| `print-md assets` | Assets are now copied automatically during `build` |
| `print-md convert` | Use `build --format html` or `build --format pdf` |

If any scripts reference `print-md assets` or `print-md convert`, update them to use `build` with the appropriate `--format` flag.
