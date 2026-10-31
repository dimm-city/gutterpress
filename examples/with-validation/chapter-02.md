# Print Production

This chapter covers the print production checks that validate your PDF output.

## Page Dimensions

The `pdf.print.page-size` check verifies that every page in your PDF matches the
configured dimensions. For DTRPG products, the standard size is 621 x 810
points (8.625" x 11.25").

The preset sets the size; a book printed at another size sets its own in the
manifest, and how far the PDF may differ from it as the check's `tolerance`:

```yaml
page:
  width: 621
  height: 810
checks:
  pdf.print.page-size:
    tolerance: 0.5
```

## Color Compliance

Print vendors typically require CMYK color spaces. A PDF/X build converts
every image to the output intent, so source images can stay RGB. The
validation system checks the result:

- **Rendered PDF** via `pdf.print.color-spaces` (post-build)

## Font Embedding

All fonts must be fully embedded in the PDF. The
`pdf.print.embedded-fonts` check verifies this in-process via the bundled PDF.js
engine, with no external tool. Missing or partially embedded fonts cause
errors.

## Ink Coverage

Total Area Coverage (TAC) measures the combined ink density on a page. This
project's `dtrpg` preset caps it at 240% (the check's `maxTac` option). The `pdf.print.ink-coverage` check
uses Ghostscript to measure this.

> **Note:** High ink coverage can cause paper curling, slow drying, and ink smearing. Keep decorative elements in check.
