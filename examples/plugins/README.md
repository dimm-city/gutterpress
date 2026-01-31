# Custom Plugin Examples

This directory contains example plugins for print-md that demonstrate how to create your own markdown-it plugins.

## Plugin Structure

A print-md plugin is a JavaScript or TypeScript file that exports:

1. **Plugin function** (required) - The main markdown-it plugin
2. **Metadata** (optional) - Information about the plugin
3. **CSS** (optional) - Styles to inject into the output

### Basic Example

```javascript
/**
 * Plugin function that modifies markdown-it
 * @param {import('markdown-it')} md - The markdown-it instance
 * @param {Object} options - Plugin configuration options
 */
export default function myPlugin(md, options = {}) {
  // Add custom rules, renderers, or modify existing ones
  md.core.ruler.push('my_rule', function(state) {
    // Your plugin logic here
  });
}

/**
 * Plugin metadata (optional but recommended)
 */
export const metadata = {
  name: 'my-plugin',
  version: '1.0.0',
  description: 'What my plugin does',
  author: 'Your Name',
  keywords: ['tag1', 'tag2'],
};

/**
 * Plugin CSS (optional)
 * This will be automatically injected into the HTML
 */
export const css = `
.my-custom-class {
  color: blue;
}
`;
```

## Available Examples

### callouts-plugin.js

Adds support for callout/admonition boxes with different styles:

```markdown
> [!note] This is a note
> Additional content here

> [!tip] Pro Tip
> This is helpful information

> [!warning] Be careful!
> This could cause issues

> [!danger] Critical
> This is dangerous
```

**Features:**
- 5 callout types: note, tip, warning, danger, info
- Automatic title extraction
- Custom CSS with color-coded variants
- Print-friendly styles
- Configurable via options

**Usage in manifest.yaml:**

```yaml
plugins:
  # Simple usage (default options)
  - "./plugins/callouts-plugin.js"

  # With custom options
  - path: "./plugins/callouts-plugin.js"
    options:
      types: ["note", "warning"]  # Only enable specific types
      className: "admonition"     # Custom CSS class prefix
```

## Creating Your Own Plugin

### 1. Choose What to Extend

Decide what markdown feature you want to add or modify:
- **Inline elements** - Custom syntax within text (e.g., `@mention`, `==highlight==`)
- **Block elements** - Custom blocks (e.g., custom containers, special sections)
- **Rendering** - Modify how existing elements are rendered to HTML
- **Processing** - Add post-processing or transformations

### 2. Learn markdown-it API

print-md uses [markdown-it](https://github.com/markdown-it/markdown-it) as the markdown parser. Key concepts:

- **Core rules** - Process the entire document
- **Block rules** - Parse block-level elements
- **Inline rules** - Parse inline elements
- **Renderers** - Convert tokens to HTML

See [markdown-it plugins documentation](https://github.com/markdown-it/markdown-it/blob/master/docs/architecture.md)

### 3. File Structure

Create your plugin file in your project:

```
my-project/
├── plugins/
│   └── my-custom-plugin.js
├── chapters/
│   └── chapter-01.md
└── manifest.yaml
```

### 4. Configure in manifest.yaml

```yaml
title: "My Book"
authors:
  - "Your Name"

# Add your plugin
plugins:
  - "./plugins/my-custom-plugin.js"

# Or with options
plugins:
  - path: "./plugins/my-custom-plugin.js"
    priority: 200  # Load before other plugins
    options:
      myOption: true
```

### 5. Test Your Plugin

Build your document to see the plugin in action:

```bash
print-md build .
```

Use `--verbose` to see plugin loading details:

```bash
print-md build . --verbose
```

## Plugin Options

Plugins can accept configuration options:

```javascript
export default function myPlugin(md, options = {}) {
  const {
    enabled = true,
    customValue = 'default',
  } = options;

  if (!enabled) return;

  // Use options in your plugin logic
}
```

Configure in manifest.yaml:

```yaml
plugins:
  - path: "./plugins/my-plugin.js"
    options:
      enabled: true
      customValue: "custom"
```

## CSS Best Practices

When adding CSS to your plugin:

1. **Use specific selectors** to avoid conflicts
2. **Use CSS custom properties** for easy customization
3. **Include print styles** for PDF output
4. **Avoid page breaks inside** important elements

```javascript
export const css = `
.my-component {
  /* Use custom properties for easy theming */
  background: var(--my-bg, #fff);
  color: var(--my-color, #000);

  /* Prevent breaking across pages */
  page-break-inside: avoid;
}

/* Print-specific styles */
@media print {
  .my-component {
    border: 1px solid #000;
  }
}
`;
```

## Priority and Load Order

Control when your plugin runs relative to others:

```yaml
plugins:
  # High priority - runs first (higher number = earlier)
  - path: "./plugins/preprocessor.js"
    priority: 500

  # Default priority (100)
  - "./plugins/normal-plugin.js"

  # Low priority - runs last
  - path: "./plugins/postprocessor.js"
    priority: 50
```

## Advanced Examples

### Inline Rule Example

```javascript
export default function hashtagPlugin(md, options = {}) {
  // Add inline rule for #hashtags
  md.inline.ruler.push('hashtag', function(state, silent) {
    const start = state.pos;
    const max = state.posMax;

    // Check for #
    if (state.src.charCodeAt(start) !== 0x23) return false;

    // Match word characters after #
    let pos = start + 1;
    while (pos < max && /\w/.test(state.src[pos])) {
      pos++;
    }

    if (pos === start + 1) return false; // No word after #

    if (!silent) {
      const token = state.push('hashtag', 'span', 0);
      token.content = state.src.slice(start + 1, pos);
      token.markup = '#';
    }

    state.pos = pos;
    return true;
  });

  // Render hashtags
  md.renderer.rules.hashtag = function(tokens, idx) {
    const tag = tokens[idx].content;
    return `<span class="hashtag" data-tag="${md.utils.escapeHtml(tag)}">#${md.utils.escapeHtml(tag)}</span>`;
  };
}

export const css = `
.hashtag {
  color: #1d4ed8;
  font-weight: 600;
}
`;
```

### Block Rule Example

```javascript
export default function alertBoxPlugin(md, options = {}) {
  // Add block rule for alert boxes
  md.block.ruler.before('fence', 'alert', function(state, startLine, endLine, silent) {
    const marker = ':::';
    const pos = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];

    // Check for ::: marker
    if (pos + 3 > max) return false;
    if (state.src.slice(pos, pos + 3) !== marker) return false;

    // Get alert type
    const type = state.src.slice(pos + 3, max).trim();

    if (!silent) {
      // Create opening token
      const tokenO = state.push('alert_open', 'div', 1);
      tokenO.attrSet('class', `alert alert-${type}`);

      // Find closing marker
      let nextLine = startLine + 1;
      while (nextLine < endLine) {
        const linePos = state.bMarks[nextLine] + state.tShift[nextLine];
        const lineMax = state.eMarks[nextLine];

        if (state.src.slice(linePos, linePos + 3) === marker) {
          break;
        }
        nextLine++;
      }

      // Parse content between markers
      state.md.block.tokenize(state, startLine + 1, nextLine);

      // Create closing token
      state.push('alert_close', 'div', -1);

      state.line = nextLine + 1;
    }

    return true;
  });
}
```

## npm Package Plugins

You can also install and use plugins from npm:

```bash
npm install markdown-it-footnote
```

```yaml
plugins:
  - name: "markdown-it-footnote"
    version: "^3.0.0"
```

## Resources

- [markdown-it documentation](https://markdown-it.github.io/)
- [markdown-it plugin development guide](https://github.com/markdown-it/markdown-it/blob/master/docs/development.md)
- [markdown-it architecture](https://github.com/markdown-it/markdown-it/blob/master/docs/architecture.md)
- [Existing markdown-it plugins](https://www.npmjs.com/search?q=keywords:markdown-it-plugin)

## Troubleshooting

### Plugin not loading

Check that:
1. File path is correct and relative to manifest.yaml
2. Plugin exports a default function
3. No syntax errors in plugin code
4. Use `--verbose` flag to see loading details

### CSS not applying

Verify that:
1. CSS is exported as `export const css = '...'`
2. CSS selectors match your HTML output
3. Check for specificity conflicts with other styles

### Plugin conflicts

If plugins conflict:
1. Adjust priorities to control load order
2. Use more specific CSS selectors
3. Check if plugins modify the same markdown-it rules

## Contributing

Have a useful plugin? Consider:
1. Publishing it as an npm package
2. Sharing it in print-md discussions
3. Contributing to the examples directory
