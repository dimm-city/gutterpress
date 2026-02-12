# Core Directives Reference

Print-md provides three systems for controlling page layout and behavior:

1. **Markdown page markers** - Using horizontal rules with `{page}` attributes
2. **Container blocks** - Using triple-colon syntax for layouts
3. **Plugin directives** - Custom syntax from loaded plugins (e.g., TTRPG)

## Page Breaks & Markers

### Markdown Page Markers

The primary way to create page breaks and apply page styling is using markdown horizontal rules with optional class names:

```markdown
---

This creates a simple page break.

--- {page}

This also creates a page break and wraps content in a page marker section.

--- {page chapter}

Page break with the "chapter" class applied.

--- {page .my-custom-class}

Page break with custom CSS class (dot prefix optional).

--- {page chapter .right-align}

Multiple classes can be combined.
```

The `{page ...}` syntax creates a page break and wraps subsequent content in a `<section>` with the `page` class plus any additional classes you specify. Content continues until the next page marker.

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
- `page` - Manual page container (alternative to `--- {page}`)
- `ability` - Ability/feature block (TTRPG)
- `specialty` - Specialty/skill block (TTRPG)
- `learning-path` - Learning path block (TTRPG)

Containers can accept classes and attributes:

```markdown
::: container .highlight
Highlighted content in a container.
:::

::: sidebar: Optional Title
Sidebar with a title and custom class.
:::
```

## Plugin Directives

When plugins are loaded via the manifest configuration, they can provide additional directives. The examples below are **hypothetical** -- they illustrate what a plugin *could* provide, not what is built-in. The built-in ways to create page breaks are `--- {page}` and `::: page`.

```markdown
@page-break

Hypothetical plugin directive that forces a page break.
(Built-in alternative: use `--- {page}` or `::: page ... :::`)

@roll{Skill DC 15}

Hypothetical plugin directive that renders a dice roll.

@table{2d6 damage}

Hypothetical plugin directive that renders a formatted table.
```

> **Note:** None of the directives above (`@page-break`, `@roll{...}`, `@table{...}`) are built-in. They would need to be provided by a plugin. See your plugin's documentation for its actual syntax.

## Preventing Page Breaks

Use the `container` class or CSS to keep content together:

```markdown
::: container
This content will try to stay together on one page
and avoid breaking across pages.
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

### Page Markers (Markdown)

```markdown
---                           Simple page break
--- {page}                    Page break with page marker
--- {page chapter}            Page break with page class and chapter class
--- {page .my-custom-class}   Page break with custom CSS class
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

### Plugin Directives

Plugin directives depend on the plugins loaded in your manifest. Common examples:

```markdown
@page-break                   TTRPG plugin page break
@roll{2d6}                   TTRPG plugin dice roll
```

## Implementation Notes

- Page markers use the `{page ...}` syntax on horizontal rules
- Classes can be specified with or without the dot prefix (`.class` or `class`)
- Multiple classes are space-separated
- Container blocks use `::: name ... :::` syntax with colon markers
- Plugin directives depend on which plugins are loaded in your manifest
- H1 headings automatically create page breaks and set running headers
