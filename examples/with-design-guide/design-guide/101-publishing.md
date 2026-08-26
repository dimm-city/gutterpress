@chapter #ch-cli .cli

# Gutterpress CLI Reference {#cli-reference}

<div class="lede">Commands for authoring, building, and publishing. The design guide itself is a first-class output target alongside the book.</div>

---

## Command Overview {#cli-overview}

### gutterpress preview

Starts the live preview server with hot reload. Edits to markdown, CSS, or assets reflect immediately.

**Syntax** — `gutterpress preview [INPUT] [OPTIONS]`

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
gutterpress preview field-guide --port 3579 --no-open
gutterpress preview design-guide --port 3580 --no-open
```

The preview opens at `http://localhost:PORT/` (root).

<div class="callout-note">
<span class="callout-label">Note</span>
If the port is in use, Gutterpress automatically increments to the next available port and logs which port was chosen.
</div>

### gutterpress build

Produces output from a manifest directory. Use `--format html` for a deployable static site; `--format pdf` (default) for a Chromium-rendered PDF; `--format pdfx` for a validated CMYK PDF/X.

**Syntax** — `gutterpress build [INPUT] [OPTIONS]`

`INPUT` is a positional argument pointing to the manifest directory (defaults to cwd).

| Flag | Default | Description |
|------|---------|-------------|
| `--format` | `pdf` | Output format: `html`, `pdf`, or `pdfx` |
| `--out` | — | Output directory (or `.pdf` path for pdf format) |
| `--title` | manifest | Overrides the document title |
| `--pdfx-flavor` | — | PDF/X flavor: `x1a` or `x3` (`--format pdfx` only) |
| `--icc` | — | ICC profile path (required with `--format pdfx`) |
| `--manifest` | — | Override manifest.yaml path |
| `--strip-annotations` | auto | Strip PDF annotations (default when `--format pdfx` is set) |

**Examples**:

```
# HTML static site (design guide → deployable desktop output)
gutterpress build design-guide --format html --out ./_site

# PDF (plain Chromium)
gutterpress build field-guide --format pdf --out ./field-guide.pdf

# PDF/X (CMYK, embedded fonts)
gutterpress build field-guide --format pdfx --pdfx-flavor x1a --icc ./profiles/CGATS21_CRPC1.icc
```

> Plain `--format pdf` needs only a Chromium-based browser. **PDF/X (CMYK)
> additionally requires Ghostscript + qpdf** on the host — install them (see
> [System Setup](../../gutterpress-user-guide/07-system-setup.md)) or run the build
> via the [Gutterpress Docker image](../../../docs/docker.md), which bundles all
> three tools.

There is no separate "full pipeline" command — `gutterpress build` already runs
the validated pipeline on its own:
`lint → validate:pre-build → convert → assets → build → validate:post-build`.
Note that the final `validate:post-build` phase runs for `--format pdfx` ONLY;
a plain `--format pdf` build stops after the build step
(see [User Guide, Chapter 6 — Validation](../../gutterpress-user-guide/06-validation.md)).
Skip individual phases with flags on `build` itself:

| Flag | Description |
|------|-------------|
| `--skip-lint` | Skip CSS linting |
| `--skip-pre-validate` | Skip pre-build validation |
| `--skip-post-validate` | Skip post-build PDF validation (`--format pdfx` only) |

**Example** — validated PDF/X build:

```
gutterpress build field-guide --format pdfx --out .gutterpress/build/field-guide-print-pdf \
  --pdfx-flavor x1a --icc .gutterpress/profiles/CGATS21_CRPC1.icc
```

### gutterpress lint / validate / audit / preflight

| Command | Description |
|---------|-------------|
| `lint [DIR]` | Check CSS for print-safety issues |
| `validate [FILE]` | Validate source files or a built PDF for print compliance |
| `audit [DIR]` | Asset-only validation checks |
| `preflight [FILE]` | Deterministic print preflight for a built PDF |

---

## Design Guide as Static Site {#publishing}

The design guide is a first-class output target, the same as any book project.
`build --format html` produces a complete deployable directory with no backing
server or toolbar chrome. `book.html` is pre-paginated with stylesheets and fonts
inlined; serve it together with the generated navigation scripts and any copied
images in the output directory.

### Build the static site

```
gutterpress build design-guide --format html --out .gutterpress/build/design-guide-site
```

Output structure:

```
design-guide-site/
├── index.html       ← redirects to book.html (a default entry point for static hosts)
├── book.html        ← the rendered guide, CSS + fonts inlined, pre-paginated
└── preview/
    └── scripts/      ← preview-interface.js and preview-bridge.js (page nav, zoom)
```

There's no `css/` or `fonts/` folder in the output — stylesheets are read and
inlined into `book.html`, not copied. If the guide references any images too
large to inline, they travel with the build at their own project-relative
path (or under `assets/` for one that lives outside the project).

Open `book.html` directly in a browser — no server needed. The desktop app's
toolbar (page nav, zoom, print, folder picker) is a separate application
(`packages/desktop`) and is not part of this static build output; the nav
scripts here only let *your own* embedding page drive `window.previewAPI` if
you build one, similar to how the Electron desktop app does.

### npm scripts (optional)

If your project uses a `package.json`, add these as convenience scripts:

```json
"scripts": {
  "preview": "gutterpress preview design-guide --port 3580 --no-open",
  "build:guide": "gutterpress build design-guide --format html --out ./_site"
}
```

### Publish to GitHub Pages

1. Copy the workflow from `gutterpress/examples/with-design-guide/.github/workflows/publish-design-guide.yml` into your repo.
2. Set **Settings → Pages → Source: GitHub Actions**.
3. Push to `main` — the workflow runs `build --format html` and deploys.

The guide is reachable at `https://<owner>.github.io/<repo>/`. The desktop output uses relative paths, so subpath hosting works without configuration.

### Publish to Azure Static Web Apps

1. Copy the same workflow into your repo.
2. In Azure, create a Static Web App and copy its deployment token.
3. Add the token to your repository as **Settings → Secrets and variables → Actions → `AZURE_STATIC_WEB_APPS_API_TOKEN`**.
4. In `.github/workflows/publish-design-guide.yml`, uncomment the **Deploy to Azure Static Web Apps** step.
5. If you are only deploying to Azure, remove or comment out the GitHub Pages upload/deploy pieces.

The Azure deployment uses the already-built `design-guide-site/` directory, so Static Web Apps serves the exact same `index.html` + `book.html` output produced by `gutterpress build --format html`.

### Include a downloadable PDF {#include-a-downloadable-pdf}

To publish a PDF alongside the HTML guide:

```
# Build the HTML site first
gutterpress build design-guide --format html --out ./_site

# Add the PDF into the same output dir
gutterpress build design-guide --format pdf --out ./_site

# Or build a fully validated PDF/X:
gutterpress build design-guide --format pdfx --out ./_site --pdfx-flavor x1a --icc ./profiles/CGATS21_CRPC1.icc
```

The PDF is named `<title-slug>-pdf.pdf` (a slug of the manifest `title`) — link
to it from `00-toc.md`, e.g. `[Download PDF](your-book-title-design-guide-pdf.pdf){.download}`.

---

## Next steps

With the design guide published and the PDF generated, you're ready to ship:

1. **Proof the PDF** — open the built PDF in Acrobat or Preview and page through it at 100%. Check running headers, folios, page breaks, and component rendering.
2. **Preflight** — run `gutterpress preflight --pdf your-book.pdf` to validate trim, bleed, font embedding, and ink limits before sending to the printer.
3. **Submit** — upload the preflighted PDF to your print provider (DriveThruRPG, IngramSpark, Lulu, or your offset print partner).

*Design guide · Gutterpress · MPL-2.0*
