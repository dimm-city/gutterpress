# Academic Paper Example

A complete journal-style research article, written in Markdown with LaTeX
mathematics and built into a US Letter PDF. The paper is about Gutterpress
itself: how it compiles CSS Paged Media on an unmodified Chromium, how it
holds the live preview and the printed PDF to the same pages, and the
geometry it uses to turn a print vendor's specification (trim, bleed, safe
areas, signatures, ink limits) into checks. Its measurements are genuine and
its method is stated in the paper's Section 8.1; its references were
verified against the sources cited. Section 7 is a worked demonstration of
the math feature, from piecewise definitions and matrices to formulas inside
table cells.

There is no HTML in the source: the look is Gutterpress's built-in
`academic` look, and math is Gutterpress's bundled Math feature. The paper's
own `paper.css` has one rule, to keep long reference URLs inside the text
column whatever fonts the building machine has. Copy this folder to start
your own paper, or start one from the `paper` template:

```bash
gutterpress new "My Paper" --template paper --preset book
```

## What's included

- `manifest.yaml`: the language, US Letter page size and margins, the two
  source files, the stylesheet, and the three extensions: superscripts, math,
  and the look
- `paper.css`: one rule that keeps long reference URLs inside the text column
  on any machine's fonts
- `paper.md`: the article, from the title block to the availability statement
- `references.md`: the numbered bibliography (alphabetical, SIAM style)
- `figures/pipeline.svg`: Figure 1, the pipeline, as hand-written SVG
- `figures/fixpoint.svg`: Figure 2, the Tier 3 fixpoint with a predicted seed
- `figures/page-boxes.svg`: Figure 3, the boxes of one page for the
  DriveThruRPG preset

The figures are plain SVG with text as text, so they stay vector in the PDF
and set in whatever sans-serif the building machine has.

## Build

```bash
gutterpress build examples/academic-paper
```

Nothing is downloaded: every extension the paper uses ships inside
Gutterpress. Use `gutterpress preview examples/academic-paper` to write with a
live, paginated preview. The example is a registered fixture of the
preview/print parity gate (`bun run parity:gate` in `packages/cli`), so a
change that makes the preview and the PDF disagree fails CI.

## How the article is written

Every part of the paper is ordinary Markdown, plus the Gutterpress `@section`
marker where a block needs its own style.

| Part of the paper | What you write |
|---|---|
| Title block | `@section .title` holding the `# Title`, authors, affiliations and date |
| Author marks | `Contributors^1,\*^` (superscripts from `markdown-it-sup`) |
| Abstract, keywords | `@section .abstract` around a `**Abstract.**` paragraph |
| Numbered sections | `## 2 Background and related work`; you number them yourself, as you would cite them |
| Inline math | `$\kappa = \min(1, W_c / \max_i w_i)$` |
| Numbered equations | a `$$ ... $$` block ending in `\tag{9}`; refer to it in the text as (9) |
| Figures | `![alt text](figures/pipeline.svg){.gp-full}` and a caption paragraph ending in `{.caption}`, inside `@section .figure` so they stay on one page |
| Tables | a Markdown table with its caption above it, inside `@section .figure`; a `\|` or a `$…$` formula inside a cell is safe |
| Footnotes | `text.[^pin]` and, anywhere in the file, `[^pin]: The note.` |
| Citations | `[[12]]` in the text, with `[12]: #ref-12` listed once at the end of `paper.md` |
| References | a numbered list in `references.md`, each entry ending in `{#ref-12}` |

Citations are standard Markdown reference links, so each number is a link to
its entry in the PDF. Footnotes are collected at the end of the file that uses
them. Because the bibliography lives in its own file, the notes print after the
paper's text and before the references, as in a journal.

Before submitting a paper based on this one, replace the collective author
line in `paper.md` and `manifest.yaml` with the authors' names and
affiliations.

## How math rendering is enabled

One line in `manifest.yaml`:

```yaml
extensions:
  - gutterpress-math
```

That is the bundled **Math** feature (in the desktop, open Setup, then
Features, and turn on Math): `$...$` in a line and `$$...$$` on lines of their
own, typeset by MathJax, the engine arXiv and Wikipedia print with. It
understands the LaTeX you already write: `aligned`, `cases` and matrix
environments, `\operatorname`, `\mathbb`, `\tag`, `\newcommand` and the rest
of MathJax's set.

It writes each formula as a drawing of its own glyphs, so the PDF needs no
math font on the computer that builds it, no stylesheet and no font files in
the project, and prints the same everywhere; and the formula is drawn when the
Markdown is rendered, so the live preview paginates exactly like the PDF. A
dollar sign that opens no formula is a dollar sign: `$5 and $10` prints as
typed. A formula MathJax cannot typeset prints in red and is reported in
Problems with its line and what is wrong. The paper's Section 7 explains why
SVG was chosen over MathML and HTML output.

## Styling

`academic` is a built-in look, in the spirit of LaTeX's `article` class: a
serif text face, justified and hyphenated text, 1 in margins and a centered
page number, with the title block, abstract, figures, tables, notes and
references styled by the `@section` each sits in. It is listed by name in
`manifest.yaml`, nothing is copied into the project. To change it, set the
tokens in `paper.css` (or another stylesheet listed under `styles:`); your
sheet loads after every extension, so it wins. The names are the same every
built-in look uses:

```css
:root {
  --font-body: "Latin Modern Roman", "CMU Serif", "STIX Two Text", "Times New Roman", "Liberation Serif", serif;
  --fs-body: 10.5pt;
  --leading: 1.38;
  --color-ink: #111111;
}
```

The page size and margins are set in `manifest.yaml` (`page.width`,
`page.height` and `page.margin`, in points). For A4, use `595` × `842`. The
`language` there sets the quotation marks straight quotes print as and the
hyphenation rules.
