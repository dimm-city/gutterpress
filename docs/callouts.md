# Callouts & Admonitions

Print-md supports five professional callout types for highlighting important information. These use GitHub-style syntax and are universally applicable to any document type.

## Callout Syntax

```markdown
> [!note]
> This is a note callout with the default "Note" title.
> It uses blue styling and a circle icon.

> [!note] Custom Title Here
> You can override the title by adding text after [!note].
> This is useful for context-specific callouts.

> [!tip]
> This is a tip callout (green) with helpful advice.
> Great for best practices and shortcuts.

> [!warning]
> This is a warning callout (orange/yellow).
> Use for important considerations or potential issues.

> [!danger]
> This is a danger callout (red).
> Use for critical warnings and things that will break.

> [!info]
> This is an info callout (gray).
> Use for neutral information and definitions.
```

## Callout Types

### Note (Blue)

- **Default title:** "Note"
- **Use for:** General information, context, explanations
- **Example:** "Note: This section requires prior knowledge of..."

```markdown
> [!note]
> This is important background information that helps readers
> understand the following content.
```

### Tip (Green)

- **Default title:** "Tip"
- **Use for:** Helpful advice, best practices, shortcuts
- **Example:** "Tip: You can speed this up by..."

```markdown
> [!tip]
> Save time by using keyboard shortcuts instead of menu navigation.
```

### Warning (Orange)

- **Default title:** "Warning"
- **Use for:** Cautions, important considerations, potential issues
- **Example:** "Warning: This operation cannot be undone"

```markdown
> [!warning]
> Make sure to backup your data before proceeding with this operation.
```

### Danger (Red)

- **Default title:** "Danger"
- **Use for:** Critical warnings, errors, things that will break
- **Example:** "Danger: This will delete all your data"

```markdown
> [!danger]
> Running this command will permanently delete all files in the directory.
> This action cannot be reversed!
```

### Info (Gray)

- **Default title:** "Info"
- **Use for:** Neutral information, definitions, references
- **Example:** "Info: See Chapter 5 for more details"

```markdown
> [!info]
> For more detailed information about this topic, refer to the
> Advanced Topics section in Chapter 5.
```

## Multi-paragraph Callouts

```markdown
> [!warning] Read This Carefully
> This callout has multiple paragraphs.
>
> Each paragraph must be prefixed with `>` to stay in the blockquote.
>
> - You can include lists
> - And other formatting
> - Within callouts
>
> Even **bold**, *italic*, and `code` formatting works!
```

## Styling Features

### Visual Design

Callouts include:
- Type-specific colors (blue, green, orange, red, gray)
- CSS-based geometric icons (no emoji dependencies)
- Left border accent
- Subtle shadows and backgrounds
- Professional typography

### Icon Styles

- **Note:** Circle with "i"
- **Tip:** Square with lightbulb
- **Warning:** Triangle with "!"
- **Danger:** Octagon with "×"
- **Info:** Rounded square with "i"

## Print Considerations

Callouts automatically:
- Avoid page breaks within the content (stay together)
- Use WCAG AA compliant color contrast (4.5:1 minimum)
- Work in both color and grayscale printing
- Use CSS-based icons (no emoji dependencies)
- Respect widow/orphan control

## Best Practices

### When to Use Callouts

**Do use callouts for:**
- Important warnings that readers must see
- Helpful tips that enhance understanding
- Critical safety or data loss warnings
- Cross-references to other sections
- Key definitions or concepts

**Don't overuse callouts:**
- Too many callouts reduce their impact
- Reserve them for truly important information
- Aim for no more than 2-3 callouts per page
- Consider regular text for less critical information

### Choosing the Right Type

```markdown
> [!note]
> Use notes for context and background that enhances understanding.

> [!tip]
> Use tips for optional improvements or alternative approaches.

> [!warning]
> Use warnings for things that could go wrong or need attention.

> [!danger]
> Use danger only for critical issues that could cause data loss or harm.

> [!info]
> Use info for neutral references, definitions, or supplementary details.
```

### Custom Titles

Custom titles make callouts more specific and actionable:

```markdown
> [!warning] Browser Compatibility
> Internet Explorer 11 does not support this feature.

> [!tip] Performance Optimization
> Cache frequently accessed data to improve response times.

> [!danger] Breaking Change in v2.0
> The API signature has changed. Update your code before upgrading.
```

## Accessibility

Callouts are designed with accessibility in mind:

- Semantic HTML structure with `role="note"`
- Color is not the only indicator (icons + borders)
- High contrast ratios meet WCAG AA standards
- Descriptive aria-labels for screen readers
- Keyboard navigable in preview mode
