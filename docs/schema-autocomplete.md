# JSON Schema Autocomplete for manifest.yaml

Gutterpress includes a JSON schema for `manifest.yaml` that provides autocomplete, validation, and documentation directly in your editor.

The schema is **editor-facing only**. Gutterpress itself does not validate `manifest.yaml` against it at build or preview time — an unknown key is simply ignored by `resolveConfig`. Wiring the schema into your editor (below) is what turns a typo into visible feedback.

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
#   - page (object) - Expected page geometry, in points (validation bounds)
#   - pdfx (object) - PDF/X conversion settings
#   - plugins (array) - markdown-it plugins to load
#   - preset (string) - Vendor preset supplying every other default
#   - publish (object) - Publish provider settings
```

### Validation

The schema validates:
- **Types** - Strings must be strings, arrays must be arrays, `page.width` must be a number
- **Allowed values** - e.g. `preset` must be `dtrpg` or `book`, `pdfx.flavor` must be `x1a` or `x3`
- **Structure** - Nested sections (`source`, `validate`, `pdfx`, …) and their property names

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

#### `preset` (string)
Vendor preset supplying the defaults for every other section — page geometry, ink limits, PDF/X settings, validation checks. One of `dtrpg` or `book`. Omitting it defaults to `dtrpg` and logs a warning, so set it explicitly.

```yaml
preset: book
```

#### `engine` (string)
Pagination engine. `"paged"` (default) is the shipped Chromium+Paged.js pipeline; `"native"` routes both `gutterpress build` and `gutterpress preview` through the Gutterpress engine — native Chromium pagination, no Paged.js polyfill. Preview and PDF always use the same engine for a given project (they switch together, never independently). The CLI `--engine` flag overrides this per invocation for either command.

```yaml
engine: native
```

#### `styles` (array of strings)
CSS files to link into the rendered book, applied in order, relative to the manifest directory. If omitted, Gutterpress discovers one: `styles/book.css`, then `css/print.css`, `css/index.css`, `css/style.css`, `css/main.css`, then the first `.css` it finds, then none.

```yaml
styles:
  - "styles/book.css"
```

#### `plugins` (array)
markdown-it plugins to load, highest `priority` first. Each entry is either a shorthand string or an object.

A string is treated as a local file path when it starts with `./`, `../`, `/` or a Windows drive letter, or when it contains a path separator and ends in `.js`/`.mjs`/`.cjs`; otherwise it is an npm package name.

An object takes `path` (local module) or `name` (npm package), plus optional `version`, `priority` (default `100`), `options`, and `enabled` (set `false` to keep the entry but skip loading it). The explicit npm installer records an exact `version` and vendors a receipt-backed runtime dependency tree under `plugins/npm/`; builds verify and resolve pinned entries there without network access.

```yaml
plugins:
  - name: "gutterpress-plugin-callouts"
    version: "1.2.3"
  - path: "plugins/dimm-city-plugin.js"
    priority: 100
```

#### `source` (object)
Where the content comes from.

- `files` (array of strings, or `null`) - Explicit, ordered markdown files relative to the manifest directory. Omit or set `null` to include every `.md` file alphabetically.

There is no `assets` field: Gutterpress discovers every file the book actually
references — image `src` attributes, CSS `url()`/`@font-face` — and copies
exactly those. An author-maintained directory list could drift from what the
book uses; this can't.

```yaml
source:
  files:
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

> **These are validation bounds only — they do not set the trim size.** The real PDF page size comes from the `@page` rule in your CSS. `page.width`/`page.height` are what the `pdf.print.page-size` check compares the produced PDF against, so set them to the trim size you expect and a CSS mistake gets caught. A bleed-inclusive `@page` size will legitimately differ from the trim size recorded here.

- `width` / `height` (number) - Expected size in points. Preset defaults: `dtrpg` 621x810, `book` 432x648 (6x9in).
- `tolerance` (number) - Allowed deviation in points. Default `0.5`.

```yaml
# US Letter trim: 8.5 x 11in
page:
  width: 612
  height: 792
  tolerance: 0.5
```

#### `pdfx` (object)
PDF/X conversion settings, used by `gutterpress build --format pdfx`.

- `flavor` (string) - `x1a` (default) or `x3`.
- `icc` (string) - Path to the ICC output-intent profile. Default `profiles/CGATS21_CRPC1.icc`.
- `stripAnnotations` (boolean) - Strip links/comments, which PDF/X-1a forbids. Default `true`.

#### `ink` (object)
- `maxTac` (number) - Maximum total area coverage, summed across C+M+Y+K. Preset defaults: `dtrpg` 240, `book` 400 (the physical ceiling, i.e. effectively no cap).
- `tacTolerance` (number) - Percentage of sampled pixels allowed to exceed `maxTac`. Default `0.5`.

#### `lint` (object)
- `enabled` (boolean) - Default `true`.
- `configPath` (string or `null`) - markdownlint config path. `null` uses the built-in defaults.

#### `validate` (object)
Preflight configuration.

- `enabled` (boolean) - Default `true`.
- `checks` (object) - Per-check overrides keyed by check id. This is an **open dictionary**: any registered check id may appear, including ids contributed by plugins. Built-in ids are namespaced `source.*`, `asset.*`, `pdf.*`, `heuristic.*`. A value is either a boolean (shorthand for enabled/disabled) or `{ enabled, severity, options }`, where `severity` is `error`, `warning`, or `info`.
- `source` (object) - `markdownlint`, `htmlhint`: a config file path, or `false` to disable that check. `stylelint`: `false` disables the `source.stylelint` check; any other value leaves it enabled — the key is kept only for manifest back-compat, the check itself runs the same postcss-based print-safety rules as `checkCss` and does not read a stylelint config. `allowedCallouts` is **deprecated and ignored** — the `:::` container syntax it gated was removed.
- `assets` (object) - `maxImageSize`, `minImageDpi`, `allowedColorSpaces`, `allowAlpha`, `approvedFontFiles`, `requireFontLicense`.
- `pdf` (object) - `requireBookmarks`, `requireTocLinks`, `minImageResolution`, `forbidTransparency`, `requireBleed`, `bleedSize` (points).
- `heuristics` (object) - `maxDecorativeLayers`, `textDensityRange` (`min`/`max`), `maxParagraphsPerSection`.

```yaml
validate:
  enabled: true
  checks:
    pdf.nav.bookmarks:
      enabled: true
      severity: warning
    pdf.print.pdfx-markers: false
  pdf:
    requireBookmarks: true
```

#### `publish` (object)
Non-secret publish settings per provider (`itch`, `drivethrurpg`, `kdp`, `azure-swa`, `shopify`), keyed by the same id `gutterpress publish --provider <id>` takes. API keys and tokens are **never** stored here — they live in the host credential store. See [publishing.md](./publishing.md).

#### `themePrevious` (string)
Managed automatically by Gutterpress's Theme Manager (the "revert to previous theme" target). Not authored by hand.

---

## Complete Example

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/dimm-city/gutterpress/main/packages/cli/src/assets/manifest.schema.json

title: "The Complete Guide to Gutterpress"
authors:
  - "Technical Writing Team"
preset: book

plugins:
  - path: "plugins/callouts.js"
    priority: 100

styles:
  - "styles/book.css"

source:
  files:
    - "frontmatter/title-page.md"
    - "frontmatter/copyright.md"
    - "chapters/01-introduction.md"
    - "chapters/02-installation.md"
    - "appendix/glossary.md"

# Validation bounds only — the CSS @page rule sets the real trim size.
page:
  width: 432
  height: 648
  tolerance: 0.5

validate:
  enabled: true
  checks:
    pdf.nav.bookmarks:
      enabled: true
      severity: warning
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
