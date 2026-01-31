/**
 * Example local plugin for print-md
 *
 * This plugin adds callout/admonition boxes with different styles:
 * - [!note] - Information callouts
 * - [!tip] - Helpful tips
 * - [!warning] - Warning messages
 * - [!danger] - Danger/error messages
 *
 * Usage in markdown:
 * ```markdown
 * > [!note] This is a note
 * > Additional content here
 *
 * > [!tip] Pro Tip
 * > This is helpful information
 * ```
 */

/**
 * Main plugin function
 *
 * @param {import('markdown-it')} md - The markdown-it instance
 * @param {Object} options - Plugin options
 * @param {string[]} options.types - Enabled callout types (default: all)
 * @param {string} options.className - Custom CSS class prefix
 */
export default function calloutsPlugin(md, options = {}) {
  const {
    types = ['note', 'tip', 'warning', 'danger', 'info'],
    className = 'callout',
  } = options;

  // Store original blockquote renderer
  const defaultRender = md.renderer.rules.blockquote_open || function(tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
  };

  // Override blockquote renderer to detect callouts
  md.renderer.rules.blockquote_open = function(tokens, idx, options, env, self) {
    const token = tokens[idx];
    const nextToken = tokens[idx + 1];

    // Check if this blockquote contains a callout
    if (nextToken && nextToken.type === 'paragraph_open') {
      const contentToken = tokens[idx + 2];
      if (contentToken && contentToken.type === 'inline') {
        const content = contentToken.content;

        // Match callout syntax: [!type] or [!type]Title
        const match = content.match(/^\[!(note|tip|warning|danger|info)\](?:\s+(.+))?/i);

        if (match) {
          const type = match[1].toLowerCase();
          const title = match[2] || type.charAt(0).toUpperCase() + type.slice(1);

          // Only process if this type is enabled
          if (types.includes(type)) {
            // Remove the callout syntax from content
            contentToken.content = content.replace(/^\[!.*?\](?:\s+.*)?/, '').trim();

            // Add callout classes and data attributes
            token.attrSet('class', `${className} ${className}-${type}`);
            token.attrSet('data-callout-type', type);
            token.attrSet('data-callout-title', title);

            // Return custom HTML with title
            return `<blockquote class="${className} ${className}-${type}" data-callout-type="${type}">
  <div class="${className}-title">${self.utils.escapeHtml(title)}</div>
  <div class="${className}-content">`;
          }
        }
      }
    }

    // Not a callout, use default renderer
    return defaultRender(tokens, idx, options, env, self);
  };

  // Override blockquote_close to match opening tag
  const defaultCloseRender = md.renderer.rules.blockquote_close || function(tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
  };

  md.renderer.rules.blockquote_close = function(tokens, idx, options, env, self) {
    const openToken = tokens.slice(0, idx).reverse().find(t => t.type === 'blockquote_open');

    if (openToken && openToken.attrGet('class')?.includes(className)) {
      return '</div>\n</blockquote>\n';
    }

    return defaultCloseRender(tokens, idx, options, env, self);
  };
}

/**
 * Plugin metadata
 *
 * This is used by print-md to display plugin information
 */
export const metadata = {
  name: 'callouts-plugin',
  version: '1.0.0',
  description: 'Adds support for callout/admonition boxes in markdown',
  author: 'print-md Example',
  keywords: ['callout', 'admonition', 'note', 'warning'],
};

/**
 * Plugin CSS
 *
 * This will be automatically injected into the HTML output
 */
export const css = `
/* Callout/Admonition styles */
.callout {
  margin: 1em 0;
  padding: 0;
  border-left: 4px solid var(--callout-border, #3b82f6);
  border-radius: 4px;
  background: var(--callout-bg, #f0f9ff);
  overflow: hidden;
  page-break-inside: avoid;
}

.callout-title {
  font-weight: 600;
  padding: 0.75em 1em;
  background: var(--callout-title-bg, #dbeafe);
  color: var(--callout-title-color, #1e40af);
  margin: 0;
}

.callout-content {
  padding: 0.75em 1em;
}

.callout-content > *:first-child {
  margin-top: 0;
}

.callout-content > *:last-child {
  margin-bottom: 0;
}

/* Note variant (blue) */
.callout-note {
  --callout-border: #3b82f6;
  --callout-bg: #eff6ff;
  --callout-title-bg: #dbeafe;
  --callout-title-color: #1e40af;
}

/* Info variant (cyan) */
.callout-info {
  --callout-border: #06b6d4;
  --callout-bg: #ecfeff;
  --callout-title-bg: #cffafe;
  --callout-title-color: #155e75;
}

/* Tip variant (green) */
.callout-tip {
  --callout-border: #10b981;
  --callout-bg: #f0fdf4;
  --callout-title-bg: #dcfce7;
  --callout-title-color: #166534;
}

/* Warning variant (yellow/orange) */
.callout-warning {
  --callout-border: #f59e0b;
  --callout-bg: #fffbeb;
  --callout-title-bg: #fef3c7;
  --callout-title-color: #92400e;
}

/* Danger variant (red) */
.callout-danger {
  --callout-border: #ef4444;
  --callout-bg: #fef2f2;
  --callout-title-bg: #fee2e2;
  --callout-title-color: #991b1b;
}

/* Print optimization */
@media print {
  .callout {
    border: 1px solid var(--callout-border);
  }
}
`;
