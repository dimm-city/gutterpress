# Core Directives Reference

Print-md provides three systems for controlling page layout:

1. **Layout Markers** - `@` markers for page breaks and content grouping (primary)
2. **Container Blocks** - Triple-colon `:::` syntax for styling blocks
3. **Legacy Page Markers** - Horizontal rules with `{page}` attributes (deprecated)

## Layout Markers

The primary way to control page layout uses `@` markers provided by the `markdown-it-paged` plugin. These emit clean, semantic HTML compatible with Paged.js and CSS Paged Media.

### @page

Starts a new page. Optionally accepts CSS class names:

```markdown
@page

Content starts on a new page.

@page chapter

Content starts on a new page with the "chapter" CSS class.

@page chapter right-align

Multiple classes can be combined.
```

Emits: `<div class="page">` (or `<div class="page chapter">`, etc.)

### @break

Forces a hard page break without wrapping content:

```markdown
Some content here.

@break

This starts on the next page.
```

Emits: `<div class="md-break"></div>`

### @spread

Starts a two-page spread group. Content within a spread is logically grouped:

```markdown
@spread

## Map Section

![World Map](assets/map.png){.full-width}

Additional map details...
```

Emits: `<div class="spread">`

### @section

Groups content to avoid page breaks within the section:

```markdown
@section

## Character Stats

| Stat | Value |
|------|-------|
| HP   | 45    |
| AC   | 16    |

This table and heading stay together on one page.
```

Emits: `<div class="region">`

### Chapter Starts

H1 headings automatically start on a right-hand (odd-numbered) page:

```markdown
# Chapter Title

This heading automatically:
- Starts on a right-hand (odd-numbered) page
- Adds extra top margin for dramatic impact
- Removes headers to let the chapter title stand alone
- Sets the section title for subsequent page headers
```

## Container Blocks

Use container syntax to apply layouts and styling to sections of content:

```markdown
::: container
This content will try to stay together on one page
and avoid breaking across pages.
:::

::: two-column
Content in this section flows in a two-column layout.
:::

::: wrapper
A generic wrapper for grouping content.
:::

::: sidebar
Content for a sidebar or callout box.
:::
```

Available containers:
- `container` - General grouping with `break-inside: avoid`
- `two-column` - Two-column layout
- `wrapper` - Generic wrapper
- `sidebar` - Sidebar/callout styling
- `page` - Manual page container (legacy, use `@page` instead)
- `ability` - Ability/feature block (TTRPG)
- `specialty` - Specialty/skill block (TTRPG)
- `learning-path` - Learning path block (TTRPG)

Containers can accept classes and attributes:

```markdown
::: container .highlight
Highlighted content in a container.
:::

::: sidebar: Optional Title
Sidebar with a title.
:::
```

## Legacy Page Markers

> **Deprecated:** Use `@page` and `@break` instead. The legacy syntax is kept for backward compatibility.

The older horizontal-rule syntax still works:

```markdown
--- {page}

This creates a page break with a page marker.

--- {page chapter}

Page break with the "chapter" class applied.

--- {page .my-custom-class}

Page break with custom CSS class (dot prefix optional).

--- {page chapter .right-align}

Multiple classes can be combined.
```

## Preventing Page Breaks

Use `@section` or the `container` class to keep content together:

```markdown
@section
This content will try to stay together on one page
and avoid breaking across pages.
```

Or with container syntax:

```markdown
::: container
This content will try to stay together on one page.
:::
```

Or in custom CSS:

```css
.keep-together {
  break-inside: avoid;
  page-break-inside: avoid;
}
```

## Quick Syntax Reference

### Layout Markers (Primary)

```markdown
@page                         Start a new page
@page chapter                 New page with CSS class
@break                        Hard page break
@spread                       Start a two-page spread
@section                      Group content (avoid breaks)
```

### Container Blocks

```markdown
::: container                 General grouping
::: two-column               Two-column layout
::: wrapper                  Generic wrapper
::: sidebar                  Sidebar/callout
::: ability                  TTRPG ability block
::: specialty                TTRPG specialty block
```

### Legacy Page Markers

```markdown
--- {page}                    Page break with marker (deprecated)
--- {page chapter}            Page break with class (deprecated)
--- {page .custom-class}      Page break with CSS class (deprecated)
```

## Implementation Notes

- Layout markers (`@page`, `@break`, `@spread`, `@section`) are provided by the `markdown-it-paged` plugin
- The `implicitPage` option is enabled, so a bare `@page` starts a new page div
- CSS classes `.page`, `.spread`, `.region`, `.md-break` are auto-injected from `markdown-it-paged/css/paged.css`
- Container blocks use `::: name ... :::` syntax with colon markers
- Legacy `--- {page}` syntax is still processed for backward compatibility
- H1 headings automatically create page breaks and set running headers
