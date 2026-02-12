# Print Production

This chapter covers the print production checks that validate your PDF output.

## Page Dimensions

The `pdf.print.page-size` check verifies that every page in your PDF matches the configured dimensions. For DTRPG products, the standard size is 621 x 810 points (8.625" x 11.25").

Configure tolerance in your manifest:

```yaml
page:
  width: 621
  height: 810
  tolerance: 0.5
```

## Color Compliance

Print vendors typically require CMYK color spaces. The validation system checks:

- **Source images** via `asset.image.color-space` (pre-build)
- **Rendered PDF** via `pdf.print.color-spaces` (post-build)

> [!sidebar]
> This callout type is specific to TTRPG projects. Because it is not in this project's `allowedCallouts` list, the `source.callout-validation` check will flag it.

## Font Embedding

All fonts must be fully embedded in the PDF. The `pdf.print.embedded-fonts` check verifies this using `pdffonts`. Missing or partially embedded fonts will cause errors.

## Ink Coverage

Total Area Coverage (TAC) measures the combined ink density on a page. Most print vendors require TAC below 300-340%. The `pdf.print.ink-coverage` check uses Ghostscript to measure this.

> [!note]
> High ink coverage can cause paper curling, slow drying, and ink smearing. Keep decorative elements in check.
