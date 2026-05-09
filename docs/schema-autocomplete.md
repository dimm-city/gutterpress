# JSON Schema Autocomplete for manifest.yaml

print-md includes a JSON schema for `manifest.yaml` that provides autocomplete, validation, and documentation directly in your editor.

## Quick Setup

Add this line to the top of your `manifest.yaml`:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/dimm-city/print-md/main/src/assets/manifest.schema.json

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
   # yaml-language-server: $schema=https://raw.githubusercontent.com/dimm-city/print-md/main/src/assets/manifest.schema.json

   title: "My Document"
   authors:
     - "Your Name"
   ```

3. **Use autocomplete:**
   - Press `Ctrl+Space` (Windows/Linux) or `Cmd+Space` (macOS) to trigger suggestions
   - Hover over properties to see documentation
   - Validation errors appear with red squiggles

### Local Schema (Offline)

If you prefer to use a local schema file:

```yaml
# yaml-language-server: $schema=./src/assets/manifest.schema.json

title: "My Document"
authors:
  - "Your Name"
```

Copy `src/assets/manifest.schema.json` from the print-md repository to your project directory.

### Global Configuration (VS Code)

To apply the schema automatically to all `manifest.yaml` files:

1. Open VS Code settings (File → Preferences → Settings)

2. Search for "YAML Schemas"

3. Click "Edit in settings.json"

4. Add:
   ```json
   {
     "yaml.schemas": {
       "https://raw.githubusercontent.com/dimm-city/print-md/main/src/assets/manifest.schema.json": ["manifest.yaml"]
     }
   }
   ```

Now all `manifest.yaml` files automatically use the schema without the header comment.

---

## JetBrains IDEs (IntelliJ, WebStorm, etc.)

1. **JetBrains IDEs have built-in YAML support**

2. **Add schema reference:**
   ```yaml
   # yaml-language-server: $schema=https://raw.githubusercontent.com/dimm-city/print-md/main/src/assets/manifest.schema.json

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
   - **Name:** print-md Manifest
   - **Schema file or URL:** `https://raw.githubusercontent.com/dimm-city/print-md/main/src/assets/manifest.schema.json`
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
       "https://raw.githubusercontent.com/dimm-city/print-md/main/src/assets/manifest.schema.json": ["manifest.yaml"]
     }
   }
   ```

3. **Or use file header:**
   ```yaml
   # yaml-language-server: $schema=https://raw.githubusercontent.com/dimm-city/print-md/main/src/assets/manifest.schema.json

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
         "https://raw.githubusercontent.com/dimm-city/print-md/main/src/assets/manifest.schema.json": ["manifest.yaml"]
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
#   - page (object) - Page format configuration
#   - pageFormat (object) - Alias for page
```

### Validation

The schema validates:
- **Required fields** - `title` and `authors` must be present
- **Types** - Strings must be strings, arrays must be arrays
- **Constraints** - Minimum lengths, allowed values, path formats
- **Path security** - Prevents `../` in style paths, requires relative paths

**Example errors:**
```yaml
title: ""  # ❌ Error: Title cannot be empty
authors: "John Doe"  # ❌ Error: authors must be an array
styles:
  - "../evil.css"  # ❌ Error: Cannot reference parent directories
```

### Documentation on Hover

Hover over any property to see:
- Description of what it does
- Valid values and examples
- Default value (if any)

---

## Schema Properties Reference

### Required Properties

#### `title` (string)
Document title. Must be non-empty.

**Example:**
```yaml
title: "The Complete Guide to print-md"
```

#### `authors` (array of strings)
List of document authors. At least one required.

**Example:**
```yaml
authors:
  - "Jane Smith"
  - "John Doe"
```

### Optional Properties

#### `description` (string)
Document description or summary.

**Example:**
```yaml
description: "A comprehensive guide to creating PDFs from markdown"
```

#### `page` (object)
Page format configuration.

**Properties:**
- `size` (string) - Page size: `letter`, `a4`, `a5`, `legal`, or custom like `8.5in 11in`
- `margins` (object) - Page margins:
  - `top` (string) - Top margin with CSS units
  - `bottom` (string) - Bottom margin
  - `inside`/`left` (string) - Inside or left margin
  - `outside`/`right` (string) - Outside or right margin
- `bleed` (string) - Bleed area for printing (typically `0.125in`)

**Example:**
```yaml
page:
  size: "letter"
  margins:
    top: "1in"
    bottom: "1in"
    inside: "0.875in"
    outside: "0.625in"
  bleed: "0.125in"
```

#### `styles` (array of strings)
List of CSS files to include, applied in order.

**Rules:**
- Must be relative paths (not absolute)
- Cannot use `../` to reference parent directories
- Must end with `.css`

**Example:**
```yaml
styles:
  - "themes/classic.css"
  - "custom-styles.css"
```

#### `files` (array of strings)
Explicit markdown file ordering. If omitted, files are processed alphabetically.

**Rules:**
- Must be relative paths
- Must end with `.md`

**Example:**
```yaml
files:
  - "frontmatter/title.md"
  - "chapters/01-intro.md"
  - "chapters/02-getting-started.md"
  - "appendix/glossary.md"
```

#### `extensions` (array of strings)
Markdown extensions to enable. Empty array enables all extensions.

**Allowed values:**
- `"ttrpg"` - TTRPG directives (stat blocks, dice notation)
- `"dimmCity"` - Dimm City game syntax
- `"containers"` - Container syntax

**Example:**
```yaml
extensions:
  - "ttrpg"
  - "dimmCity"
```

#### `disableDefaultStyles` (boolean)
Disable default foundation CSS styles. Use this to completely replace print-md's base styles.

**Default:** `false`

**Example:**
```yaml
disableDefaultStyles: true
styles:
  - "my-complete-theme.css"
```

#### `version` (string)
Document version number.

**Example:**
```yaml
version: "1.0.0"
```

#### `date` (string)
Publication or revision date.

**Example:**
```yaml
date: "2025-11-19"
```

---

## Complete Example

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/dimm-city/print-md/main/src/assets/manifest.schema.json

title: "The Complete Guide to print-md"
authors:
  - "Technical Writing Team"
description: "Comprehensive guide to creating professional PDFs from markdown"
version: "1.0.0"
date: "2025-11-19"

page:
  size: "letter"
  margins:
    top: "0.75in"
    bottom: "0.75in"
    inside: "1in"
    outside: "0.75in"
  bleed: "0.125in"

styles:
  - "themes/modern.css"
  - "custom/typography.css"
  - "custom/layout.css"

files:
  - "frontmatter/title-page.md"
  - "frontmatter/copyright.md"
  - "frontmatter/table-of-contents.md"
  - "chapters/01-introduction.md"
  - "chapters/02-installation.md"
  - "chapters/03-quick-start.md"
  - "appendix/glossary.md"

extensions:
  - "ttrpg"

disableDefaultStyles: false
```

---

## Troubleshooting

### Autocomplete Not Working

1. **Verify schema header is present:**
   ```yaml
   # yaml-language-server: $schema=https://raw.githubusercontent.com/dimm-city/print-md/main/src/assets/manifest.schema.json
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
   - Must be exactly: `https://raw.githubusercontent.com/dimm-city/print-md/main/src/assets/manifest.schema.json`

3. **Try local schema:**
   ```yaml
   # yaml-language-server: $schema=./src/assets/manifest.schema.json
   ```

### Schema Shows Warnings

Some warnings are informational:
- "Property 'xyz' is not allowed" - Check spelling or see schema reference
- "Missing required property" - Add required `title` and `authors` fields
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

The schema is maintained in sync with print-md's Zod validation schema. When new features are added, the JSON schema is updated to match.

**Latest schema:** https://raw.githubusercontent.com/dimm-city/print-md/main/src/assets/manifest.schema.json

**Local copy:** Include `src/assets/manifest.schema.json` in your project for offline use.

---

## Related Documentation

- [User Guide](./user-guide.md) - Complete print-md usage guide
- [Theme Customization](./theme-customization.md) - CSS styling guide
- [README](../README.md) - Project overview and quick start

---

**Questions or issues?** [Open an issue on GitHub](https://github.com/dimm-city/print-md/issues)
