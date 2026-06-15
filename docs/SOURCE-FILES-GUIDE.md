# Source Files Configuration Guide

## Overview

The `source.files` property in `manifest.yaml` lets you specify exactly which markdown files to include in your document and in what order.

## Two Modes

### Mode 1: Explicit File List (Recommended for Print)

Specify the exact files in the desired order:

```yaml
source:
  files:
    - intro.md
    - chapter-01.md
    - chapter-02.md
    - appendix.md
  assets:
    - css
    - fonts
    - images
```

**Behavior**: Only these files are included, in this exact order.

### Mode 2: Fallback to All Files (Default)

Omit `source.files` or set it to `null`:

```yaml
source:
  assets:
    - css
    - fonts
    - images
```

**Behavior**: All `.md` files in the directory are included in alphabetical order.

## File Path Format

Files in `source.files` are **relative to the manifest directory**:

```
my-book/
├── manifest.yaml          ← base directory
├── intro.md               ← "intro.md"
├── chapters/
│   ├── ch1.md             ← "chapters/ch1.md"
│   ├── ch2.md             ← "chapters/ch2.md"
└── appendix.md            ← "appendix.md"

# manifest.yaml
source:
  files:
    - intro.md
    - chapters/ch1.md
    - chapters/ch2.md
    - appendix.md
```

## Usage Examples

### Example 1: Simple Book

```yaml
title: "My Novel"
authors:
  - "Jane Doe"

source:
  files:
    - 00-cover.md
    - 01-introduction.md
    - 02-chapter-one.md
    - 03-chapter-two.md
    - 04-conclusion.md
  assets:
    - images

output:
  dir: dist
  filename: novel.pdf
  html: novel.html
```

### Example 2: Complex Structure with Subdirectories

```yaml
title: "Field Guide"

source:
  files:
    - title-page.md
    - frontmatter/preface.md
    - frontmatter/table-of-contents.md
    - chapters/01-basics.md
    - chapters/02-intermediate.md
    - chapters/03-advanced.md
    - appendix/glossary.md
    - appendix/index.md
  assets:
    - css
    - fonts
    - images
    - icons
```

### Example 3: Conditional Chapters

```yaml
title: "Game Rulebook"

# Include different chapters based on edition
source:
  files:
    - intro.md
    - core-rules.md
    - # Uncomment for expanded edition:
    - # - optional-rules.md
    - # - advanced-combat.md
    - appendix.md
  assets:
    - css
    - images
```

## Common Patterns

### Content Before/After Main Chapters

```yaml
source:
  files:
    # Front matter
    - title.md
    - credits.md
    - table-of-contents.md

    # Main content
    - introduction.md
    - chapter-01.md
    - chapter-02.md
    - chapter-03.md

    # Back matter
    - conclusion.md
    - glossary.md
    - index.md
```

### Organizing by Contributor

```yaml
source:
  files:
    - intro.md

    # Author A's chapters
    - chapters/author-a-01.md
    - chapters/author-a-02.md

    # Author B's chapters
    - chapters/author-b-01.md
    - chapters/author-b-02.md

    - conclusion.md
```

## Using the Build Command

The standalone `convert` command was removed; `print-md build` now runs
markdown → HTML rendering, asset copy, and viewer emission in a single
step (and adds a Chromium PDF render with `--format pdf`).

### With Files Specified

```bash
# manifest.yaml has source.files list
print-md build ./my-book --format html --out ./_site

# Output shows which files are being used:
# INFO: Using specified files (5 total)
```

### Without Files (Fallback)

```bash
# manifest.yaml omits source.files
print-md build ./my-book --format html --out ./_site

# Output shows fallback:
# INFO: Using all .md files in alphabetical order
```

## Debugging

### Check What Files Are Being Used

```bash
# Use the debug script
bun packages/cli/tools/debug-manifest.ts ./my-book

# Output will show:
# 🔍 Source configuration analysis:
#   files: ✅ Specified
#   file count: 5
#   files in order:
#     1. intro.md
#     2. chapter-01.md
#     3. chapter-02.md
#     4. chapter-03.md
#     5. appendix.md
```

### File Not Found Error

```
❌ Error: Failed to read file chapters/missing.md: ENOENT: no such file or directory
```

**Solution**: Check file paths are correct and relative to the manifest directory.

## Migration from Glob Patterns

**Old way** (no longer supported):
```yaml
source:
  chapters: "chapter-*.md"  # ❌ This doesn't work anymore
```

**New way**:
```yaml
source:
  files:
    - chapter-01.md
    - chapter-02.md
    - chapter-03.md
```

Or just omit `source.files` to get all `.md` files alphabetically.

## Best Practices

1. **Explicit > Implicit**: Always specify `source.files` for print documents where order matters
2. **Clear Naming**: Use descriptive filenames (not just numbers)
3. **Organize Logically**: Consider directory structure (frontmatter/, chapters/, appendix/, etc.)
4. **Version Control**: Commit manifest.yaml with your file ordering
5. **Comment Changes**: Document why file order changed in commit messages

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Files in wrong order | Check manifest.yaml - files are processed in list order |
| Files are missing | Use debug script to verify paths are correct |
| Some files not included | Ensure all markdown files are listed if using explicit mode |
| Fallback to alphabetical | You omitted `source.files` - files go alphabetically |
| Spaces in filenames | Use quotes in manifest.yaml: `"file name.md"` |

## See Also

- [Schema autocomplete & manifest reference](./schema-autocomplete.md)
- [Example Manifest](../examples/print-md-user-guide/manifest.yaml)
- [Debug Script](../packages/cli/tools/debug-manifest.ts)
