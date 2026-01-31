# Typography & Formatting

Professional typography options for print documents.

## Headings

Print-md provides six heading levels with automatic styling:

```markdown
# H1 - Chapter Title (24pt, auto-starts on right page)

## H2 - Major Section (18pt)

### H3 - Subsection (14pt)

#### H4 - Minor Heading (12pt)

##### H5 - Small Heading (10.5pt)

###### H6 - Tiny Heading (9pt)
```

### Auto-rules

- H1 headings automatically start chapters on right-hand pages
- H1 sets the section title in page headers
- All headings respect widow/orphan control

## Text Formatting

### Emphasis

```markdown
*Italic text* or _italic text_

**Bold text** or __bold text__

***Bold italic*** or ___bold italic___

`Inline code or monospace`

~~Strikethrough~~
```

### Lists

```markdown
Unordered list:
- First item
- Second item
  - Nested item
  - Another nested item
- Third item

Ordered list:
1. First step
2. Second step
   1. Substep A
   2. Substep B
3. Third step
```

### Blockquotes

```markdown
> This is a blockquote.
> It can span multiple lines.
>
> And have multiple paragraphs.

> Nested blockquotes are also supported:
>
> > Inner quote
> > - With lists
> > - And formatting
```

## Tables

```markdown
| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |

Alignment:
| Left | Center | Right |
|:-----|:------:|------:|
| A    | B      | C     |
| D    | E      | F     |
```

### Table Features

Tables automatically:
- Break across pages intelligently
- Repeat headers on new pages
- Apply striped row styling
- Use professional borders and spacing

## Writing Guidelines

### Headings

- Use H1 for chapter titles only (one per file)
- Use H2-H3 for main sections
- Use H4-H6 sparingly
- Keep headings concise (under 60 characters)

### Paragraphs

- One idea per paragraph
- Break up long paragraphs (6-8 sentences max)
- Use blank lines between paragraphs

### Lists

- Use ordered lists for sequential steps
- Use unordered lists for non-ordered items
- Keep list items concise
- Use nested lists sparingly (2 levels max)

### Tables

- Keep tables simple (5-7 columns max)
- Use descriptive headers
- Align numbers right, text left
- Consider rotating wide tables to landscape

## Typography Best Practices

### Print Optimization

- Don't override widow/orphan control
- Maintain consistent line height
- Use proper spacing (avoid manual line breaks)
- Test font embedding in final PDF

### Readability

- Use 10-12pt body text for most formats
- Maintain 1.4-1.6 line height for body text
- Avoid overly long line lengths (45-75 characters)
- Use proper heading hierarchy (no skipping levels)

## Advanced Typography

### Markdown Attributes

Add CSS classes, IDs, and attributes to any element:

```markdown
# Heading {#custom-id .special-class}

Paragraph with custom styling {.highlight}

[Link](https://example.com){target="_blank" rel="noopener"}
```

### Anchors & Cross-References

```markdown
# Chapter One {#chapter-one}

Content here...

Later, reference the chapter: [See Chapter One](#chapter-one)
```

Auto-generated anchors are created for all headings, using slugified text.
