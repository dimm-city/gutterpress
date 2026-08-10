# Gutterpress

**Write a book in Markdown. Lay it out with CSS. Export a print-ready PDF.**

Gutterpress is a desktop application (with a CLI for power users) that turns a folder of markdown files into a professionally typeset PDF — the kind you'd send to an offset printer or a print-on-demand service. Under the hood it uses a native Chromium print engine for layout, following the W3C-recommended CSS Paged Media spec. You write content; Gutterpress handles page breaks, running headers, columns, page numbers, and all the print-specific work that web browsers usually skip.

## Get the desktop app

**[→ Download the latest release](https://github.com/dimm-city/gutterpress/releases/latest)**

| Platform | Download (from the latest release) | What to do |
|---|---|---|
| **Windows** | `gutterpress-setup-win-x64.exe` | Download and run the stable-named installer. The versioned `.zip` is a separate portable extract-and-run copy. |
| **macOS Apple Silicon** | `gutterpress-<version>-arm64.dmg` | Open the disk image, then drag the app to Applications. |
| **macOS Intel** | `gutterpress-<version>-x64.dmg` | Open the disk image, then drag the app to Applications. |
| **Linux** | `gutterpress-<version>.AppImage` | `chmod +x` the file, then double-click or run it. To get it in your KDE/GNOME application menu, open **Settings → App → Desktop integration → Add to application menu** — see [Desktop integration](./docs/desktop-shortcut.md#linux-appimage-application-menu-integration-desktop-app). |

The desktop app is fully self-contained — no Bun, Node, Chromium, or other runtime to install. **Save PDF** renders through Electron's own bundled Chromium (`webContents.printToPDF`), so there's nothing extra to set up. (The separate `gutterpress` CLI, for scripting and CI, does need a Chromium-based browser on the machine it runs on — see [User Guide: Chapter 7 — System Setup](./examples/gutterpress-user-guide/07-system-setup.md) if you're using that instead.)

The downloads are currently unsigned. Each new release includes SHA-256
checksums plus macOS Gatekeeper and Windows SmartScreen instructions. See the
[installation and supported-platform guide](./docs/installing.md) for package
manager installs, architecture gaps, checksum verification, and first-run
guidance.

## Your first book

**Prefer the command line?** `gutterpress new "My Book"` scaffolds a project
folder with a manifest, a starter chapter, and a stylesheet in one command —
no hand-written `manifest.yaml` required (see the [CLI README](./packages/cli/README.md)).
Otherwise, start from the desktop app:

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
| **Learn all Gutterpress features** | [Gutterpress User Guide](./examples/gutterpress-user-guide/) — comprehensive guide covering all core features |
| Understand markdown extensions (page breaks, columns, callouts) | [User Guide: Chapter 2 — Writing Your Content](./examples/gutterpress-user-guide/02-writing-content.md) |
| Style your book with CSS (fonts, colors, page size, margins) | [User Guide: Chapter 4 — Styling & Theming](./examples/gutterpress-user-guide/04-styling-theming.md) |
| **Structure your CSS like a pro** — the recommended pattern for variant assignment | [Contextual Cascade Principle](./docs/contextual-cascade-principle.md) |
| **Use the CLI** for scripting, CI builds, or batch work | [CLI README](./packages/cli/README.md) |
| **Install or verify a download** | [Installation and supported platforms](./docs/installing.md) |
| **Run the whole pipeline in Docker** (all print tools pre-installed) | [Docker guide](./docs/docker.md) |
| Add custom markdown plugins | [User Guide: Chapter 5 — Plugins](./examples/gutterpress-user-guide/05-plugins.md) |
| Refine a publication with Open Design | [Using Open Design with Gutterpress](./docs/open-design/using-open-design-with-gutterpress.md) |
| Validate output for print production (TAC, ICC, PDF/X) | [User Guide: Chapter 6 — Validation](./examples/gutterpress-user-guide/06-validation.md) |
| Set up system tools (Chromium, Ghostscript, qpdf, etc) | [User Guide: Chapter 7 — System Setup](./examples/gutterpress-user-guide/07-system-setup.md) |
| Develop / contribute to Gutterpress itself | [CONTRIBUTING](./CONTRIBUTING.md) · [Architecture](./docs/ARCHITECTURE.md) |

See [docs/](./docs/) for technical architecture and developer references.

## What Gutterpress can do

- **Live preview** with paginated layout — your book renders the way it'll print, while you edit
- **PDF export** — directly from the app, or via the `gutterpress` CLI
- **Print-ready output** — PDF/X (CMYK + ICC profile) for offset printers and PDF/A
- **Custom CSS** for everything: typography, page size, margins, columns, running headers/footers, page numbers, bleed
- **Plugin system** for custom markdown — use any of hundreds of existing `markdown-it-*` plugins, or write your own
- **Validation** — pre/post-build checks for image DPI, color space, font embedding, structural PDF correctness
- **CI-friendly** — single-binary CLI runs in GitHub Actions, GitLab CI, Docker, anywhere

## Examples

Browse the [`examples/`](./examples/) directory for real projects you can copy:

- **`with-design-guide`** — the most complete reference. A multi-chapter design guide that exercises the layout features: custom fonts, page templates, columns, sidebars, and callouts.
- **`gutterpress-user-guide`** — the comprehensive user guide, authored in Gutterpress itself.
- **`with-validation`** — focused on the pre-/post-build validation pipeline.

## Project layout

```
gutterpress/
├─ packages/
│  ├─ cli/        — gutterpress              — library + CLI + standalone binary (markdown, preview, build, lint)
│  └─ desktop/    — @dimm-city/gutterpress-desktop — Electron desktop app
├─ examples/      — Sample projects
└─ docs/          — Authoring, architecture, system requirements
```

The desktop app, CLI, and the library all use the same rendering pipeline under the hood. What you preview is what you build.

## License

[MPL-2.0](./LICENSE)

---

*Gutterpress is open source. Issues, ideas, and pull requests welcome at <https://github.com/dimm-city/gutterpress/issues>.*
