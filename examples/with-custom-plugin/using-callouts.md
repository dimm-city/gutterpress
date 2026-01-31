# Using Callouts

This page demonstrates all the callout types supported by the custom plugin.

## Note Callouts

Use notes for general information that readers should be aware of:

> [!note]
> This is a basic note callout. It uses a blue color scheme to indicate informational content.

> [!note] Custom Title
> You can also provide a custom title after the callout marker. This helps organize different types of notes.

## Tip Callouts

Tips provide helpful suggestions or best practices:

> [!tip] Pro Tip
> Use callouts sparingly to maintain their impact. Too many callouts can make your document feel cluttered.

> [!tip]
> Callouts automatically prevent page breaks inside them, so they stay together in the PDF output.

## Warning Callouts

Warnings alert readers to potential issues or gotchas:

> [!warning] Important
> Make sure you understand the implications before proceeding with this step.

> [!warning]
> Plugin files must be relative to your manifest.yaml file. Absolute paths are not allowed for security reasons.

## Danger Callouts

Use danger callouts for critical information or errors:

> [!danger] Critical
> This action cannot be undone. Make sure you have a backup before proceeding.

> [!danger]
> Never commit sensitive information like API keys or passwords to your repository.

## Info Callouts

Info callouts are similar to notes but can be used for supplementary information:

> [!info] Did you know?
> print-md plugins can include CSS that gets automatically injected into your PDF output.

> [!info]
> The plugin system supports local files, npm packages, and built-in plugins.

## Nested Content

Callouts can contain rich markdown content:

> [!note] Markdown Support
> Callouts fully support markdown formatting:
>
> - **Bold text**
> - *Italic text*
> - `inline code`
> - [Links](https://example.com)
>
> You can even include code blocks:
>
> ```javascript
> function example() {
>   return "Hello from a callout!";
> }
> ```

## Multiple Paragraphs

> [!tip] Multi-paragraph Tips
> Callouts can contain multiple paragraphs of content.
>
> Just use standard markdown paragraph breaks (blank lines) within the blockquote.
>
> This makes callouts perfect for longer explanations or step-by-step instructions.

## Combining Callouts

You can use multiple callouts on the same page to organize information:

> [!note] Step 1: Install Dependencies
> First, install the required npm packages.

> [!warning] Check Node Version
> Make sure you're using Node.js version 18 or higher.

> [!tip] Use a Package Manager
> We recommend using `npm` or `bun` for package management.

> [!info] More Information
> See the official documentation for advanced configuration options.

## Styling

The callout styles are provided by the plugin's CSS export. Each callout type has:

- **Color-coded border** - Visual distinction between types
- **Background color** - Subtle tint for readability
- **Title bar** - Prominent heading with darker background
- **Print optimization** - Looks good in PDF output

The styles use CSS custom properties, so you can customize them in your own CSS:

```css
.callout-note {
  --callout-border: #3b82f6;
  --callout-bg: #eff6ff;
  --callout-title-bg: #dbeafe;
  --callout-title-color: #1e40af;
}
```
