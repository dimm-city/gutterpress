# JSON Schema Autocomplete for manifest.yaml

Gutterpress includes a JSON schema for `manifest.yaml` that provides autocomplete, validation, and documentation directly in your editor.

The schema is **editor-facing only**. Gutterpress itself does not validate `manifest.yaml` against it at build or preview time — an unknown key is simply ignored by `resolveConfig`. (The removed keys are the exception: `plugins`, `engine`, `engineStyles`, `output` and `source.assets` each fail with a message naming their replacement — see `extensions` below. The keys 0.11.23 replaced — `source.files`, `validate`, `lint`, `ink` and `page.tolerance` — still work in 0.11.23, with one notice naming each new spelling; a threshold among them becomes an option of its check under `checks:`.) Wiring the schema into your editor (below) is what turns a typo into visible feedback.

## Quick Setup

Add this line to the top of your `manifest.yaml`:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/dimm-city/gutterpress/main/packages/cli/src/assets/manifest.schema.json

title: "My Book"
authors:
  - "Author Name"
```

That's it! Your editor will now provide:
- **Autocomplete** - Suggestions for property names and values
- **Validation** - Real-time error checking
- **Documentation** - Hover tooltips explaining each field

---

## Editor Setup

### VS Code

1. **Install YAML extension:**
   ```
   ext install redhat.vscode-yaml
   ```

2. **Add schema reference to your manifest.yaml:**
   ```yaml
   # yaml-language-server: $schema=https://raw.githubusercontent.com/dimm-city/gutterpress/main/packages/cli/src/assets/manifest.schema.json

   title: "My Document"
   authors:
     - "Your Name"
   ```

3. **Use autocomplete:**
   - Press `Ctrl+Space` (Windows/Linux) or `Cmd+Space` (macOS) to trigger suggestions
   - Hover over properties to see documentation
   - Validation errors appear with red squiggles

### Local Schema (Offline)

If you prefer to use a local schema file, copy `packages/cli/src/assets/manifest.schema.json` from the Gutterpress repository into your project directory, then point at your copy (the path is resolved relative to the `manifest.yaml` that carries the comment):

```yaml
# yaml-language-server: $schema=./manifest.schema.json

title: "My Document"
authors:
  - "Your Name"
```

### Global Configuration (VS Code)

To apply the schema automatically to all `manifest.yaml` files:

1. Open VS Code settings (File → Preferences → Settings)

2. Search for "YAML Schemas"

3. Click "Edit in settings.json"

4. Add:
   ```json
   {
     "yaml.schemas": {
        "https://raw.githubusercontent.com/dimm-city/gutterpress/main/packages/cli/src/assets/manifest.schema.json": ["manifest.yaml"]
     }
   }
   ```

Now all `manifest.yaml` files automatically use the schema without the header comment.

---

## JetBrains IDEs (IntelliJ, WebStorm, etc.)

1. **JetBrains IDEs have built-in YAML support**

2. **Add schema reference:**
   ```yaml
    # yaml-language-server: $schema=https://raw.githubusercontent.com/dimm-city/gutterpress/main/packages/cli/src/assets/manifest.schema.json

   title: "My Document"
   authors:
     - "Your Name"
   ```

3. **Autocomplete works automatically:**
   - `Ctrl+Space` to trigger suggestions
   - Hover for documentation
   - Validation in real-time

### Global Schema (JetBrains)

1. Go to: Settings → Languages & Frameworks → Schemas and DTDs → JSON Schema Mappings

2. Click `+` to add a new schema

3. Configure:
    - **Name:** Gutterpress Manifest
    - **Schema file or URL:** `https://raw.githubusercontent.com/dimm-city/gutterpress/main/packages/cli/src/assets/manifest.schema.json`
   - **Schema version:** JSON Schema version 7

4. Add file path pattern: `**/manifest.yaml`

---

## Vim/Neovim

### With yaml-language-server

1. **Install yaml-language-server:**
   ```bash
   npm install -g yaml-language-server
   ```

2. **Configure in coc-settings.json (coc.nvim):**
   ```json
   {
     "yaml.schemas": {
        "https://raw.githubusercontent.com/dimm-city/gutterpress/main/packages/cli/src/assets/manifest.schema.json": ["manifest.yaml"]
     }
   }
   ```

3. **Or use file header:**
   ```yaml
    # yaml-language-server: $schema=https://raw.githubusercontent.com/dimm-city/gutterpress/main/packages/cli/src/assets/manifest.schema.json

   title: "My Document"
   ```

---

## Sublime Text

1. **Install LSP and LSP-yaml packages**

2. **Configure LSP-yaml settings:**
   ```json
   {
     "settings": {
       "yaml.schemas": {
          "https://raw.githubusercontent.com/dimm-city/gutterpress/main/packages/cli/src/assets/manifest.schema.json": ["manifest.yaml"]
       }
     }
   }
   ```

---

## Features

### Autocomplete

When typing property names, you'll see:
- All available properties
- Their types (string, array, object, boolean)
- Default values
- Example values

**Example:**
```yaml
title: "My Book"
# Type 'p' and you'll see:
#   - page (object) - Page geometry, in points (the trim, unless a stylesheet's @page sets one)
#   - pdfx (object) - PDF/X conversion settings
#   - preset (string) - Preset supplying every other default
#   - publish (object) - Publish provider settings
```

### Validation

The schema validates:
- **Types** - Strings must be strings, arrays must be arrays, `page.width` must be a number
- **Allowed values** - e.g. `preset` must be `dtrpg` or `book`, `pdfx.flavor` must be `x1a` or `x3`
- **Structure** - Nested sections (`page`, `pdfx`, `checks`, …) and their property names

Every property is optional: an omitted field falls back to the resolved preset default.

**Example errors:**
```yaml
authors: "John Doe"  # ❌ Error: authors must be an array
preset: "a4"  # ❌ Error: must be one of dtrpg, book
page:
  width: "6in"  # ❌ Error: must be a number (points, e.g. 432)
```

### Documentation on Hover

Hover over any property to see:
- Description of what it does
- Valid values and examples
- Default value (if any)

---

## Schema Properties Reference

Every property is optional. An omitted field falls back to the default supplied by the resolved `preset`.

#### `title` (string)
Document title, used for the HTML `<title>` and PDF metadata. Defaults to `"Document"`.

```yaml
title: "The Complete Guide to Gutterpress"
```

#### `authors` (array of strings)
List of document authors.

```yaml
authors:
  - "Jane Smith"
  - "John Doe"
```

#### `language` (string)
The book's language as a BCP 47 tag (`en`, `de`, `de-CH`, `pt-BR`). It is the `lang` of the built HTML, which hyphenation follows, and sets the quotation marks straight quotes print as. Defaults to `"en"`. See the user guide's [Getting Started](../examples/gutterpress-user-guide/01-getting-started.md#reference-manifest-configuration) chapter.

```yaml
language: de
```

#### `preset` (string)
Preset supplying the defaults for every other section — page geometry, ink limits, PDF/X settings, validation checks. One of `dtrpg`, `book`, or `custom` (you supply `page.width` and `page.height` yourself). Omitting it defaults to `dtrpg` and logs a warning, so set it explicitly.

```yaml
preset: book
```

#### `targets` (array of strings)
Publish targets to record and validate against (ADR 0008): `gutterpress validate`/`gutterpress preflight` check the built PDF against each target's requirements, one target at a time, so one book can target several destinations. `--target`/`--targets` on the CLI override this at invocation time. One of `dtrpg`, `itch`. Omitting it uses the preset's default (`dtrpg` -> `["dtrpg"]`; `book`/`custom` -> `[]`).

```yaml
targets:
  - dtrpg
  - itch
```

#### `styles` (array of strings)
CSS files to link into the rendered book, applied in order, relative to the manifest directory. If omitted, Gutterpress discovers one: `styles/book.css` (what `gutterpress new` scaffolds), then four **legacy** names kept so pre-existing projects keep working — `css/print.css`, `css/index.css`, `css/style.css`, `css/main.css`, in that order — then the first `.css` it finds in the project root, `styles/` or `css/`, then none. New projects should set `styles:` explicitly or use `styles/book.css`; the `css/*.css` fallback names are not a recommended convention.

```yaml
styles:
  - "styles/book.css"
```

#### `extensions` (array)
Extensions, in load order: markdown-it plugins, looks (stylesheets), component libraries — anything from npm or a folder. Each entry is a specifier string, and its form says what it is:

- a **bundled name** — a markdown feature (`markdown-it-mark`, `markdown-it-sub`, `markdown-it-sup`, `markdown-it-abbr`, `gutterpress-gfm-alerts`, `gutterpress-math`) or a built-in look (`clean-book`, `zine`, `technical-doc`, `academic`) — resolves to the copy compiled into Gutterpress (nothing to install, works offline; a bundled name shadows npm and cannot be pinned);
- a **path** starting with `./` or `../` (or `/`, or a Windows drive letter), relative to this file — a folder holding a `package.json`, or a bare `.js` markdown-it plugin file — referenced in place, never copied;
- anything else is an **npm package name**, optionally pinned as `name@version`. `gutterpress ext add <name>` installs it: it vendors the runtime dependency tree under `extensions/npm/` and writes the exact pin back; builds resolve pinned entries there without network access. The downloaded copy is gitignored, so a fresh clone has only the pin: `build`, `validate`, `preview` and the desktop's book-open download a missing pinned version first.

A later entry loads later: its markdown runs after earlier entries' and its CSS wins ties. The project's own `styles` always load after every extension. There is no `priority` (reorder the list instead) and no `path`/`name` wrapper keys — a manifest that still carries `plugins:` fails with a message that prints its entries rewritten as `extensions:`.

The object form is for an entry that needs more than its specifier. `use` carries the same specifier the bare form would, plus optional `export` (named module export to use as the plugin function when the package has no default export), `options` (passed straight through to the markdown-it plugin; default `{}`), and `enabled` (default `true`; `false` keeps the entry in the manifest but skips loading it at build and preview time).

```yaml
extensions:
  - "./extensions/house-style"
  - "markdown-it-footnote"
  - "@dimm-city/components@2.1.0"
  - use: "markdown-it-attrs"
    options:
      leftDelimiter: "["
```

#### `chapters` (array of strings, or `null`)
The chapters, in order, as markdown files relative to the manifest directory.
Omit it or set `null` to include every top-level `.md` file alphabetically.

There is no assets list: Gutterpress discovers every file the book actually
references — image `src` attributes, CSS `url()`/`@font-face` — and copies
exactly those. An author-maintained directory list could drift from what the
book uses; this can't.

```yaml
chapters:
  - "frontmatter/title-page.md"
  - "chapters/01-introduction.md"
  - "appendix/glossary.md"
```

#### Output location (not a manifest field)

There is no `output` block. Every build writes to
`<manifestDir>/dist/<title-slug>/`, and artifacts are named
`<title-slug>-<format>.<ext>` (e.g. `dragon-heist-pdf.pdf`,
`dragon-heist-pdfx.pdf`) — a convention, not configuration, so `pdf` and
`pdfx` builds never overwrite each other and multiple books in one tree
always separate themselves. Use `--out <path>` on the command line for a
per-invocation override (CI staging, one-offs).

#### `page` (object)
Expected page geometry, in **points** (1in = 72pt).

> **This is the size the book prints at, and `margin` the margins.** The build writes `@page { size: <width> <height> }` from these values after every stylesheet, so a `size` in a stylesheet's own `@page` (plain or `:first`/`:left`/`:right`; a named page's size is its own) is overridden and reported by the `printsafe/page-size-in-stylesheet` check, and the PDF, the preview and the checks share one size. `page.width`/`page.height` are also what the `pdf.print.page-size` check compares the produced PDF against. In the app, Book setup > Book edits the size and the margins.

- `width` / `height` (number) - Expected size in points. Preset defaults: `dtrpg` 621x810, `book` 432x648 (6x9in).
- `bleed` (number) - A bleed in points that `width` x `height` **already contain**, on the top, bottom and outer edges only (the binding edge has none). This is how DriveThruRPG's interior file is cut (8.625x11.25in for an 8.5x11in book), so the `dtrpg` preset sets `9` (0.125in); `book` and `custom` set none. It tells the preview's print overlays, `pdf.print.safe-margins` and pinned art where the trim is; it changes nothing else in the PDF.
- `safe` (number) - The text rule: how far inside the trim, in points, text must stay on every edge. The preview's **Safe area: text** layer draws it as the dashed line and flags text outside it, and `pdf.print.safe-margins` fails a built PDF whose text is closer. `dtrpg` sets `36` (0.5in, DriveThruRPG's rule), `book` `18` (0.25in); `custom` sets none, and the check is skipped. It is also where every pin sits where `artSafe` is not set; no CSS moves it. At the binding edge `gutter` takes over where it is set.
- `artSafe` (number) - The art rule: how far inside the trim, in points, art that does not bleed (images, backgrounds, borders, rules) must stay on the top, bottom and outer edges; the binding edge uses `gutter`. Art that runs out to the page's edge is a bleed and is not judged on that edge. The preview's **Safe area: art** layer draws it as the dotted line and flags art outside it, and `pdf.print.safe-margins` fails a built PDF with an image closer, or one that stops in the bleed band (backgrounds and borders are judged in the overlay only). Where none is set, art follows `safe`. `dtrpg` sets `18` (0.25in, DriveThruRPG's rule for non-bleeding art); `book` and `custom` set none. An image pinned to the top, bottom or outside edge (`.gp-pin`) sits on this line, unless it carries `.gp-flush`; no CSS moves it.
- `margin` (object: `top`, `bottom`, `inside`, `outside`, numbers) - The page margins in points, the space between the trim and the text on each edge; `inside` is the binding edge (the left of a right-hand page, the right of a left-hand one). When set, the build writes them as the `@page` margins for both page sides after every stylesheet, so they win over a look's `@page` margins; when left out, the stylesheets' `@page` margins apply, else 1in. All four edges are required together. The templates record each bundled look's margins here (the Book template's 61.2 / 61.2 / 54 / 54, for example), and Book setup > Book edits them in inches.
- `gutter` (number) - The binding allowance: how far from the spine, in points, content stays, measured from the trim at the binding edge (the left edge of a right-hand page, the right edge of a left-hand page). It stands in for `safe` at that edge, for text and for art alike: the preview's text and art lines, the tinted strip and the legend, `pdf.print.safe-margins`, and an image pinned to the binding edge (`.gp-pin`) all use it. The other edges keep `safe` and `artSafe`. Use it when your book keeps its text further from the spine than the printer's minimum, for example `gutter: 54` for 0.75in where DriveThruRPG asks for 0.5in. Where none is set it is `safe`; `dtrpg` sets `36` (0.5in, DriveThruRPG's rule at the binding for text and non-bleeding art, the same as its `safe`), `book` and `custom` none.

```yaml
# US Letter trim: 8.5 x 11in, 1in margins
page:
  width: 612
  height: 792
  margin:
    top: 72
    bottom: 72
    inside: 72
    outside: 72
```

#### `pdfx` (object)
PDF/X conversion settings, used by `gutterpress build --format pdfx`.

- `flavor` (string) - `x1a` (default) or `x3`.
- `icc` (string) - Path to the ICC output-intent profile. Default `profiles/CGATS21_CRPC1.icc`.
- `stripAnnotations` (boolean) - Strip links/comments, which PDF/X-1a forbids. Default `true`.
- `blackText` (string) - `icc` converts near-black text through the ICC profile (rich four-colour black); `k-only` prints it on the black plate alone (100% K), as DriveThruRPG requires for small text: text at or below 24pt, and the underline or strike-through drawn with it. Text larger than 24pt stays rich black, as DriveThruRPG recommends; other black (rules, panels) is unaffected. With `k-only`, `pdf.print.black-text` warns when small text is still printed in a dark four-colour mix (black, or a dark colour such as a dark brown, which keeps its colour), and the choice is recorded in `build-fingerprint.json`. Preset defaults: `dtrpg` `k-only`, `book`/`custom` `icc`.
- `transparency` (string) - `flatten-page` (default) leaves a page that uses transparency to Ghostscript, which flattens the whole page and loses its text; `preserve-text` flattens only the artwork to a picture (300 DPI, or `rasterDpi`) and keeps the text live on top, except on pages whose text is itself translucent or blended, uses a Type 3 font, or is pattern-filled or a clip, and pages with a repeating or conic gradient, which fall back to `flatten-page`. See `docs/publishing.md`.
- `flattenPages` (integer[]) - with `preserve-text`, pages (as the build numbers them) flattened whole anyway, e.g. a page with a cover or tint over its text. Default: none.
- `rasterDpi` (integer, 72-1200) - resolution of every picture made from a transparent page (whole-page flattening and `preserve-text` artwork). Unset: 720 for whole pages, 300 for `preserve-text` artwork.

#### `print` (object)
Page-count rules applied when the PDF is built.

- `signature` (number) - Pad the PDF with blank pages until the page count is a multiple of this; `1` means no padding. Preset defaults: `dtrpg` 4, `book` 1.
- `reserveLastPage` (boolean) - Guarantee the final page is a blank page added by the build (no background, no page number). When the content already fills a signature exactly, a full signature of blank pages is added. DriveThruRPG reserves the last page for printer information. Preset defaults: `dtrpg` `true`, `book` `false`. Same as `lastPage: blank`.
- `lastPage` (string) - `blank` or `short-by-one`; wins over `reserveLastPage`, and no preset sets it. `blank` ends the interior on a blank page the build adds. `short-by-one` pads to one page short of a multiple of `signature` (`k x signature - 1`, e.g. 227 for a signature of 4) and leaves the last page to the printer, DriveThruRPG's other accepted form.

When `signature` is above 1, `pdf.print.signature` fails a PDF whose page count is not a multiple of it (or one short of one), and, for a book that reserves its last page, one whose last page has content. The `dtrpg` default signature of 4 is valid for every trim size DriveThruRPG accepts (it asks for multiples of 4 from 6.69 x 9.61in up, and 4 or 6 below that); set `signature: 6` explicitly if you prefer 6 on a small trim.

```yaml
# Opt a dtrpg book out of the reserved blank page
print:
  reserveLastPage: false

# Or: stop one page short and let DriveThruRPG add the last page
print:
  lastPage: short-by-one
```

#### `checks` (object)
Each check's level, keyed by check id. Any registered check id may appear,
including ids contributed by plugins (built-in ids are namespaced `source.*`,
`asset.*`, `pdf.*`, `heuristic.*`), and so may a CSS print-safety rule id
(`printsafe/...`). A value is one of:

- `off` - the check does not run (a rule is not reported).
- `on` - the check runs at its own severity, for a check the preset or target leaves off.
- `info`, `warn`, `error` - the check runs and reports at that severity. `error` fails `gutterpress validate` and stops a build.

The limits a check measures against (ink coverage, the page-size tolerance,
image size and resolution, bleed size, the approved font files, the
heuristics' ranges) come from the preset and the publish target. A book
overrides one as an option of its check: the entry becomes a map, with an
optional `level` beside the options (see the user guide's validation chapter
for every option and its default). The Markdown, HTML and CSS-ownership
checks are configured by their own files (`.markdownlint.yaml`, `.htmlhintrc`,
`.gutterpress/css-contract.yaml`), found in the book's folder or the nearest
folder above it, up to the repository root.

```yaml
checks:
  pdf.nav.bookmarks: warn
  pdf.print.pdfx-markers: off
  asset.image.alpha-channel: off
  printsafe/page-containment: warn
  pdf.print.ink-coverage:
    maxTac: 300
  pdf.print.image-resolution:
    level: error
    minImageResolution: 200
```

#### `publish` (object)
Non-secret publish settings per provider (`itch`, `drivethrurpg`, `kdp`, `azure-swa`, `shopify`, `gdrive`), keyed by the same id `gutterpress publish --provider <id>` takes. API keys and tokens are **never** stored here — they live in the host credential store. Everything here is the team's: `enabled: true` marks a destination the book publishes to, and `local.dir` is a folder inside the book, relative to it. Which saved account you publish with, and an output folder outside the book, stay in your own settings on your computer. See [publishing.md](./publishing.md).

---

## Complete Example

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/dimm-city/gutterpress/main/packages/cli/src/assets/manifest.schema.json

title: "The Complete Guide to Gutterpress"
authors:
  - "Technical Writing Team"
preset: book

extensions:
  - clean-book
  - "./plugins/callouts.js"

styles:
  - "styles/book.css"

chapters:
  - "frontmatter/title-page.md"
  - "frontmatter/copyright.md"
  - "chapters/01-introduction.md"
  - "chapters/02-installation.md"
  - "appendix/glossary.md"

# The trim the book prints at, unless a stylesheet's plain @page rule sets its own size.
page:
  width: 432
  height: 648

checks:
  pdf.nav.bookmarks: warn
```

---

## Troubleshooting

### Autocomplete Not Working

1. **Verify schema header is present:**
   ```yaml
   # yaml-language-server: $schema=https://raw.githubusercontent.com/dimm-city/gutterpress/main/packages/cli/src/assets/manifest.schema.json
   ```

2. **Check YAML extension is installed:**
   - VS Code: Look for "YAML" in extensions
   - Status bar should show "YAML Language Server"

3. **Restart editor/language server:**
   - VS Code: Cmd/Ctrl+Shift+P → "Reload Window"
   - Vim: `:CocRestart`

### Validation Not Working

1. **Check for YAML syntax errors:**
   - Indentation must be consistent (2 or 4 spaces)
   - No tabs allowed
   - Proper array syntax (`- item`)

2. **Verify schema URL is correct:**
    - Must be exactly: `https://raw.githubusercontent.com/dimm-city/gutterpress/main/packages/cli/src/assets/manifest.schema.json`

3. **Try local schema** (a copy of `manifest.schema.json` next to your `manifest.yaml`):
   ```yaml
   # yaml-language-server: $schema=./manifest.schema.json
   ```

### Schema Shows Warnings

Some warnings are informational:
- "Property 'xyz' is not allowed" - Check spelling or see schema reference
- "Type mismatch" - Check that strings are quoted, arrays use `-` syntax

---

## Benefits

### Faster Development

- No need to remember property names
- Instant validation catches errors before build
- Examples and documentation in-editor

### Fewer Errors

- Typos caught immediately
- Type mismatches highlighted
- Path security enforced

### Better Documentation

- Hover tooltips explain each field
- Examples show correct usage
- No need to context-switch to documentation

---

## Schema Maintenance

The schema mirrors the `GutterpressManifest` interface in `packages/cli/src/schema/manifest.types.ts`, with defaults taken from `packages/cli/src/lib/presets.ts`. When either changes, update `manifest.schema.json` to match — nothing enforces this automatically.

**Latest schema:** https://raw.githubusercontent.com/dimm-city/gutterpress/main/packages/cli/src/assets/manifest.schema.json

**Local copy:** Include `packages/cli/src/assets/manifest.schema.json` in your project for offline use.

---

## Related Documentation

- [User Guide](../examples/gutterpress-user-guide/) - Complete Gutterpress usage guide
- [Design Guides](./design-guides.md) - CSS styling and companion design-guide pattern
- [README](../README.md) - Project overview and quick start

---

**Questions or issues?** [Open an issue on GitHub](https://github.com/dimm-city/gutterpress/issues)
