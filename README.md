# print-md

**Write a book in Markdown. Lay it out with CSS. Export a print-ready PDF.**

print-md is a desktop application (with a CLI for power users) that turns a folder of markdown files into a professionally typeset PDF — the kind you'd send to an offset printer or a print-on-demand service. Under the hood it uses [Paged.js](https://pagedjs.org/) and Chromium for layout, just like the W3C-recommended CSS Paged Media spec. You write content; print-md handles page breaks, running headers, columns, page numbers, and all the print-specific work that web browsers usually skip.

## Get the desktop app

**[→ Download the latest release](https://github.com/dimm-city/print-md/releases/latest)**

| Platform | Download (from the latest release) | What to do |
|---|---|---|
| **Windows** | `print-md-viewer-<version>-win.zip` | Extract, then run `print-md-viewer.exe` |
| **macOS** | `print-md-viewer-<version>-arm64.dmg` | Open the disk image, drag the app to Applications |
| **Linux** | `print-md-viewer-<version>.AppImage` | `chmod +x` the file, then double-click or run it |

The desktop app is fully self-contained — no Bun, Node, or other runtime to install. The only thing you may need is a Chromium-based browser (Chrome, Edge, Brave, etc) installed on the machine for the **Save PDF** feature; see the [User Guide: Chapter 8 — System Setup](./examples/print-md-user-guide/08-system-setup.md) for details.

## Your first book

1. **Make a folder** anywhere on your computer with a couple of markdown files in it:

   ```
   my-book/
     ├─ chapter-01.md
     └─ chapter-02.md
   ```

2. **Launch the desktop app**, click **Open Folder**, pick your `my-book/` folder. You'll see a paginated preview update live as you edit the files.

3. **Click Save PDF**. Done.

For richer projects (cover art, fonts, a multi-chapter book with running headers, page numbers, etc), copy one of the example projects in [`examples/`](./examples/) as a starting point — `with-design-guide` is the most complete reference.

## Learn more

| If you want to… | Start here |
|---|---|
| **Learn all print-md features** | [Print-md User Guide](./examples/print-md-user-guide/) — 48-page comprehensive guide covering all core features |
| Understand markdown extensions (page breaks, columns, callouts) | [User Guide: Chapter 2 — Writing Your Content](./examples/print-md-user-guide/02-writing-content.md) |
| Style your book with CSS (fonts, colors, page size, margins) | [User Guide: Chapter 4 — Styling & Theming](./examples/print-md-user-guide/04-styling-theming.md) |
| **Structure your CSS like a pro** — the recommended pattern for variant assignment | [Contextual Cascade Principle](./docs/contextual-cascade-principle.md) |
| Create TTRPG/games content (stat blocks, dice notation, etc) | [User Guide: Chapter 5 — TTRPG Extensions](./examples/print-md-user-guide/05-ttrpg-extensions.md) |
| **Use the CLI** for scripting, CI builds, or batch work | [CLI README](./packages/cli/README.md) |
| **Run the whole pipeline in Docker** (all print tools pre-installed) | [Docker guide](./docs/docker.md) |
| Add custom markdown plugins | [User Guide: Chapter 6 — Plugins](./examples/print-md-user-guide/06-plugins.md) |
| Validate output for print production (TAC, ICC, PDF/X) | [User Guide: Chapter 7 — Validation](./examples/print-md-user-guide/07-validation.md) |
| Set up system tools (Chromium, Ghostscript, qpdf, etc) | [User Guide: Chapter 8 — System Setup](./examples/print-md-user-guide/08-system-setup.md) |
| Develop / contribute to print-md itself | [CONTRIBUTING](./CONTRIBUTING.md) · [Architecture](./docs/ARCHITECTURE.md) |

See [docs/](./docs/) for technical architecture, ADRs, and developer references.

## What print-md can do

- **Live preview** with paginated layout — your book renders the way it'll print, while you edit
- **PDF export** — directly from the app, or via the `print-md` CLI
- **Print-ready output** — PDF/X (CMYK + ICC profile) for offset printers and PDF/A
- **Custom CSS** for everything: typography, page size, margins, columns, running headers/footers, page numbers, bleed
- **Plugin system** for custom markdown — use any of hundreds of existing `markdown-it-*` plugins, or write your own
- **Validation** — pre/post-build checks for image DPI, color space, font embedding, structural PDF correctness
- **CI-friendly** — single-binary CLI runs in GitHub Actions, GitLab CI, Docker, anywhere

## Examples

Browse the [`examples/`](./examples/) directory for real projects you can copy:

- **`with-design-guide`** — the most complete reference. A multi-chapter design guide that exercises the layout features: custom fonts, page templates, columns, sidebars, callouts, and a custom plugin.
- **`print-md-user-guide`** — the comprehensive user guide, authored in print-md itself.
- **`with-validation`** — focused on the pre-/post-build validation pipeline.

## Project layout

```
print-md/
├─ packages/
│  ├─ cli/        — @dimm-city/print-md       — npm CLI + standalone binary
│  ├─ lib/        — @dimm-city/print-md-lib   — shared runtime (markdown, preview, build, lint)
│  └─ viewer/     — @dimm-city/print-md-viewer — Electron desktop app
├─ examples/      — Sample projects
└─ docs/          — Authoring, architecture, system requirements
```

The desktop app, CLI, and the library all use the same rendering pipeline under the hood. What you preview is what you build.

## License

[MPL-2.0](./LICENSE)

---

*print-md is open source. Issues, ideas, and pull requests welcome at <https://github.com/dimm-city/print-md/issues>.*
