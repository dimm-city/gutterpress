# Core Directives Reference

Print-md provides powerful directives to control page layout and behavior. Directives are HTML comments that control print layout rendering.

## Page Templates

Apply named page templates to sections of your document:

```markdown
<!-- @page: chapter -->
# Chapter One: The Beginning

This content will use the chapter page template with extra top margin
and special header/footer treatment.

<!-- @page: body -->
Regular content continues here with standard body template.

<!-- @page: appendix -->
# Appendix A: Reference Tables

Back matter content uses appendix styling.
```

### Available Page Templates

- `chapter` - Chapter opening pages (right-hand, extra top margin, minimal headers)
- `body` - Standard body content (default)
- `art` - Full-bleed artwork (zero margins, no headers/footers)
- `appendix` - Back matter (appendix header in page margins)
- `frontmatter` - Front matter pages (title, credits, etc.)
- `cover` - Book cover (full bleed)
- `title-page` - Title page (centered, no page numbers)
- `credits` - Credits/copyright page (roman numerals)
- `toc` - Table of contents (roman numerals)
- `glossary` - Glossary/index (reduced margins for multi-column)
- `blank` - Blank pages (with "intentionally left blank" note)

## Page Breaks

### Manual Page Breaks

Control when and where page breaks occur:

```markdown
<!-- @break -->
Content after this directive starts on a new page.

<!-- @spread: right -->
Forces the next content to start on a right-hand page (odd number).

<!-- @spread: left -->
Forces the next content to start on a left-hand page (even number).

<!-- @spread: blank -->
Inserts a blank page.
```

### Automatic Page Breaks

Print-md provides automatic page breaks with simple markdown:

```markdown
# Chapter One

Content here...

---

This horizontal rule becomes a page break.
New content starts on the next page.
```

**Auto-rule:** Any horizontal rule (`---`, `***`, `___`) becomes a page break.

### Chapter Starts

```markdown
# Chapter Title

This H1 heading automatically:
- Starts on a right-hand (odd-numbered) page
- Adds extra top margin for dramatic impact
- Removes headers to let the chapter title stand alone
- Sets the section title for subsequent page headers
```

### Preventing Page Breaks

Use CSS classes to control breaking behavior:

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

## Column Layouts

Set multi-column layouts for specific sections:

```markdown
<!-- @columns: 2 -->
This content will flow in a two-column layout, perfect for
glossaries, indexes, or dense reference material.

<!-- @columns: 1 -->
Back to single column layout.

<!-- @columns: 3 -->
Three columns for very dense content (use sparingly).
```

**Important:** Columns apply to subsequent content until changed by another `@columns` directive or reset by a chapter heading (H1).

## Running Headers

Set custom running headers for page margins:

```markdown
<!-- H1 automatically sets section title -->
# Chapter Title

This sets the running header for subsequent pages.

<!-- Override with manual directive -->
<h1 style="string-set: section-title 'Custom Header';">Section</h1>
```

## Directive Syntax

### Valid Directive Format

Directives must follow this exact format:

```markdown
<!-- @directive -->           ✓ Correct
<!-- @directive: value -->    ✓ Correct
<!--@directive-->             ✗ Wrong (no space)
<!-- @ directive -->          ✗ Wrong (space in directive)
```

### Error Handling

Print-md provides helpful error messages with suggestions:

- Unknown directives suggest closest match
- Invalid values show valid options
- Missing required values show usage examples
- Line numbers included for easy debugging

## Quick Reference

### All Directives

```markdown
<!-- @page: template -->    Apply named page template
<!-- @break -->             Force page break
<!-- @spread: right -->     Start on right page
<!-- @spread: left -->      Start on left page
<!-- @spread: blank -->     Insert blank page
<!-- @columns: 1 -->        Single column layout
<!-- @columns: 2 -->        Two column layout
<!-- @columns: 3 -->        Three column layout
```

### Valid Page Template Names

```
chapter, body, art, appendix, frontmatter, cover,
title-page, credits, toc, glossary, blank
```

### Valid Spread Values

```
left, right, blank
```

### Valid Column Counts

```
1, 2, 3
```
