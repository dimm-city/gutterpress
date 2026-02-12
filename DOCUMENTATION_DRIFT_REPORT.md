# Documentation Drift Report

**Generated:** 2026-02-11
**Compared against:** Current implementation in `src/`

This report identifies all discrepancies between documentation/examples and the actual implementation. Issues are categorized by severity.

---

## Severity Legend

- **CRITICAL** - Will cause user errors/confusion; completely wrong information
- **HIGH** - Significant inaccuracy that misleads users
- **MEDIUM** - Partially incorrect or outdated information
- **LOW** - Minor inconsistency or cosmetic issue

---

## 1. README.md

### CRITICAL: `build` command described incorrectly (lines 86-97, 388-401)

**Documentation says:**
```bash
print-md build
print-md build ./my-book
print-md build --out my-book.pdf
```
With options: `--out <file>` (default: output.pdf)

**Implementation (`src/commands/build.ts`):**
The `build` command takes two **required** positional arguments: `input` (path to HTML file) and `out` (output PDF path). It also has `--pdfx`, `--icc`, `--manifest`, `--strip-annotations` options. It builds HTML-to-PDF, **not** markdown-to-PDF. The command that takes a directory and runs the full pipeline is `run`.

### CRITICAL: Manifest `page` config uses non-existent fields (lines 160-167)

**Documentation says:**
```yaml
page:
  size: letter
  margins:
    top: 0.75in
    bottom: 0.75in
    inside: 0.875in
    outside: 0.625in
  bleed: 0.125in
```

**Implementation (`src/schema/manifest.types.ts`):**
```yaml
page:
  width: 621    # points (number)
  height: 810   # points (number)
  tolerance: 0.5
```
The fields `size`, `margins`, and `bleed` do not exist. Dimensions are in points only.

### HIGH: `files` shown at root level (line 173)

**Documentation says:** `files:` as a top-level manifest key.
**Implementation:** File ordering is at `source.files`, not top-level `files`.

### HIGH: `extensions` key shown (lines 187-191)

**Documentation says:**
```yaml
extensions:
  - ttrpg
  - dimmCity
```

**Implementation:** The `extensions` key does not exist in `PrintMdManifest`. The correct key is `plugins`.

### HIGH: Troubleshooting references Prince XML (line 519)

**Documentation says:** "PDF Generation Fails with 'Prince Not Found'"
**Implementation:** Uses Chromium + Paged.js, not Prince XML.

### MEDIUM: Port reference wrong (line 583)

**Documentation says:** "Check what's using the default port (3000)"
**Implementation:** Default port is 3579.

### MEDIUM: "title is required" error message (line 783)

**Documentation says:** `"Invalid manifest.yaml: title is required"`
**Implementation:** `title` is optional in `PrintMdManifest`.

### MEDIUM: Project structure outdated (lines 455-468)

**Documentation shows:** `src/build/`, `src/markdown/`, `src/utils/` with subdirectories `core/`, `themes/`, `plugins/`
**Actual structure:** `src/commands/`, `src/lib/`, `src/lib/markdown/`, `src/checks/`, `src/preview/`, `src/schema/`, `src/utils/`. No `src/assets/core/`, `src/assets/themes/`, or `src/assets/plugins/` directories exist.

### LOW: `description` field shown in manifest (line 159)

`description` is not a field in `PrintMdManifest`.

### LOW: Plugin section header duplicated (lines 262-263)

Two consecutive `## Plugin System` headers.

---

## 2. docs/authoring-guide.md

### CRITICAL: References Prince XML and Vivliostyle (lines 23, 1067-1069)

**Documentation says:** "Uses Prince XML for PDF generation and Vivliostyle for live preview"
**Implementation:** Uses Chromium + Paged.js for PDF generation. Preview uses Vite + Paged.js polyfill.

Also links to Prince XML and Vivliostyle documentation URLs at lines 1067-1069 — both are irrelevant.

### CRITICAL: HTML comment directives don't exist (lines 127-188)

**Documentation says:**
```markdown
<!-- @page: chapter -->
<!-- @break -->
<!-- @spread: right -->
<!-- @spread: left -->
<!-- @spread: blank -->
<!-- @columns: 2 -->
<!-- @columns: 1 -->
```

**Implementation:** These comment-based directives are **not implemented**. Grep for `@page:|@break|@spread|@columns` in `src/` returns zero matches. The actual page break system uses:
- `--- {page}` — horizontal rule with `{page}` attribute
- `::: container` — triple-colon container blocks

### CRITICAL: `format` config section doesn't exist (lines 69-76)

**Documentation says:**
```yaml
format:
  size: "6in 9in"
  margins:
    top: "0.75in"
    ...
  bleed: "0.125in"
```

**Implementation:** No `format` key exists. Page configuration uses `page.width`, `page.height`, `page.tolerance` (in points).

### HIGH: `--output` flag (line 36)

**Documentation says:** `print-md build ./my-book --output my-book.pdf`
**Implementation:** The flag is `--out`, not `--output`. And `build` takes HTML input, not a directory.

### HIGH: `extensions` key used throughout (lines 89-92, 598-601, 689-691)

Should be `plugins:`.

### HIGH: Named page templates don't exist as documented (lines 142-154)

Lists 11 named templates (chapter, body, art, appendix, frontmatter, cover, title-page, credits, toc, glossary, blank). These are described as selectable via `<!-- @page: template -->` directive which doesn't exist.

### MEDIUM: `disableDefaultStyles` field (lines 879-884)

`disableDefaultStyles: true` does not exist in `PrintMdManifest`.

### MEDIUM: "Prince XML handles CMYK conversion" (line 513)

Ghostscript handles CMYK/PDF-X conversion (`src/lib/ghostscript.ts`).

---

## 3. docs/user-guide.md

### CRITICAL: Installation shows unpublished package (lines 23-24, 62-63)

**Documentation says:** `bun install -g @dimm-city/print-md`
**README says:** Package is not published to npm yet. These instructions contradict each other.

### HIGH: `extensions` key (lines 224-229, 647-651, 688-691, 708-711)

Multiple sections use `extensions:` key with `ttrpg`, `dimmCity`, `containers`. All should use `plugins:`.

### HIGH: `files` at root level (lines 93-97, 186-192)

Shows `files:` as top-level manifest key. Should be `source.files`.

### HIGH: `build` command misrepresented (lines 611-615)

Shows `print-md build` building from current directory. `build` takes an HTML file as input. `run` is the directory-based pipeline command.

### HIGH: `version` and `date` fields (lines 181-182)

Shows `version: "1.0"` and `date: "2025-11-19"` in manifest. Neither field exists in `PrintMdManifest`.

### HIGH: `build --input <html> --out <pdf>` (line 252)

`input` and `out` are positional args in `build.ts`, not named `--input`/`--out` options.

### MEDIUM: `description` field (line 91)

Not a valid manifest field.

### MEDIUM: Built-in themes may not exist as bundled files (lines 377-386)

Lists classic.css, modern.css, dark.css, parchment.css. No `src/assets/themes/` directory exists. The JSON schema references them as examples but they are not actually bundled with the tool.

### MEDIUM: "HTML output is not supported" (line 629)

The `convert` command produces HTML. Architecture references `HtmlFormatStrategy`. This claim is misleading.

---

## 4. docs/getting-started.md

### HIGH: `margins` field in manifest (lines 52-57)

Shows `margins:` as a top-level field with `top`, `bottom`, `inner`, `outer`. This field doesn't exist in `PrintMdManifest`.

### HIGH: `files` at root level (lines 64-68)

Should be `source.files`.

### MEDIUM: `description` field (lines 43-44)

Not a valid manifest field.

---

## 5. docs/ARCHITECTURE.md

### HIGH: File path references are wrong (lines 166, 192, 246, 283, 321, 440)

| Documentation says | Actual location |
|---|---|
| `src/config/config-state.ts` | `src/lib/manifest.ts` |
| `src/markdown/markdown.ts` | `src/lib/markdown/index.ts` |
| `src/build/formats/` | Does not exist |
| `src/build/watch.ts` | `src/preview/file-watcher.ts` |
| `src/utils/config.ts` | `src/lib/manifest.ts` |

### HIGH: Strategy pattern classes may not exist (lines 246-278)

References `FormatStrategy` interface with `PdfFormatStrategy`, `HtmlFormatStrategy`, `PreviewFormatStrategy` — actual build is directly in `src/commands/build.ts` without a strategy pattern directory.

### MEDIUM: Version is "0.1.0" (line 665)

**Documentation says:** Version 0.1.0
**Implementation (`src/cli.ts`):** Version 2.0.0

### MEDIUM: Code examples don't match current API (lines 201-215)

Shows `createPagedMarkdownEngine()` and `configureMarkdownRules()`. Actual implementation uses `createMarkdownRenderer()`.

---

## 6. docs/core-directives.md

### MEDIUM: `@page-break` shown as plugin directive (lines 103-113)

```markdown
@page-break
@roll{Skill DC 15}
@table{2d6 damage}
```

`@page-break` is not implemented as a markdown directive (grep returns zero matches). `@table` doesn't appear to exist. The `::: page` container or `--- {page}` syntax is used instead.

---

## 7. docs/ttrpg-extensions.md

### HIGH: `extensions` key (lines 9-12)

Shows `extensions: - "ttrpg"`. Should be `plugins: - ttrpg`.

### MEDIUM: `<!-- @page: body -->` directive (line 229)

References HTML comment directive that doesn't exist.

---

## 8. docs/images.md

### HIGH: "Prince XML handles CMYK conversion" (lines 120-121)

Should reference Ghostscript for CMYK conversion.

---

## 9. docs/styling-theming.md

### HIGH: `disableDefaultStyles` field (lines 299-301)

`disableDefaultStyles: true` is not a valid manifest field.

### HIGH: Built-in themes directory doesn't exist (lines 8-18)

Lists 7 themes (classic, modern, dark, parchment, dimm-city, zine, bw). No `src/assets/themes/` directory exists.

### MEDIUM: `<!-- @page: gallery -->` directive (line 224)

References HTML comment directive that doesn't exist.

---

## 10. docs/README.md

### MEDIUM: `<!-- @page: chapter -->` directives (lines 104-107)

Quick reference shows HTML comment directives that don't exist.

---

## 11. docs/callouts.md

### MEDIUM: GitHub-style syntax may be plugin-only

Documents `> [!note]`, `> [!tip]`, etc. as if built-in. The `examples/with-custom-plugin/callouts-plugin.js` implements this syntax as a custom plugin, suggesting it's **not** part of core. Users without the callouts plugin would not have this syntax.

---

## 12. Example Files

### HIGH: `examples/with-custom-plugin/manifest.yaml` — YAML syntax error (lines 18-21)

```yaml
plugins:
  - path: "./callouts-plugin.js"
    priority: 100
    options:
      types: ["note", "tip", "warning", "danger", "info"]
      className: "callout"

# Also load built-in TTRPG plugin for comparison
  - name: "ttrpg"
    priority: 50
```

The second plugin entry (`- name: "ttrpg"`) is incorrectly indented under the comment, breaking the YAML list. It should be at the same indentation level as the first `- path:` entry.

### MEDIUM: Theme references in examples (multiple files)

`examples/ttrpg-module/manifest.yaml` and `examples/field-guide/manifest.yaml` reference `themes/classic.css` which is not bundled with the tool.

### MEDIUM: `examples/novel/frontmatter.md` uses `@page-break`

The `@page-break` inline directive is not implemented in core. Correct syntax is `--- {page}` or `::: page ... :::`.

---

## Summary

### By Severity

| Severity | Count |
|----------|-------|
| CRITICAL | 7 |
| HIGH | 22 |
| MEDIUM | 19 |
| LOW | 3 |
| **Total** | **51** |

### Top Recurring Issues (by frequency)

| Issue | Occurrences | Files affected |
|-------|-------------|----------------|
| `extensions` vs `plugins` key | 8+ | 5 docs, 1 example |
| HTML comment directives not implemented | 6+ | 4 docs |
| Prince XML / Vivliostyle references | 5+ | 3 docs |
| Non-existent manifest fields (`description`, `version`, `date`, `format`, `margins`, `bleed`, `files`, `disableDefaultStyles`) | 12+ | 6 docs |
| `build` command takes HTML not directory | 4+ | 3 docs |
| `page` config wrong field names | 3+ | 3 docs |
| Architecture file paths wrong | 6 | ARCHITECTURE.md |
| Built-in themes not bundled | 4+ | 3 docs, 2 examples |

### Recommended Fix Priority

1. **docs/authoring-guide.md** — Most heavily drifted; nearly every section has issues
2. **README.md** — User-facing entry point; `build` command and manifest config are wrong
3. **docs/user-guide.md** — `extensions`, `build`, `files` all wrong
4. **docs/ARCHITECTURE.md** — File paths and code patterns don't match current code
5. **Example manifests** — YAML syntax error in with-custom-plugin, non-existent theme files
6. **Global find/replace across all docs:**
   - `extensions:` -> `plugins:`
   - Remove all `<!-- @page: -->` / `<!-- @break -->` / `<!-- @spread: -->` / `<!-- @columns: -->` directives
   - Replace Prince XML/Vivliostyle references with Chromium + Paged.js / Ghostscript
   - Replace `format.size`/`format.margins`/`format.bleed` with `page.width`/`page.height`/`page.tolerance`
   - Replace `files:` (root level) with `source.files`
   - Remove `description`, `version`, `date`, `disableDefaultStyles` from manifest examples
