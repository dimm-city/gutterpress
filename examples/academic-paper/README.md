# Academic Paper Example

A complete journal-style research article, written in Markdown with LaTeX
mathematics and built into an 8-page, US Letter PDF. There is no HTML in the
source and no stylesheet of its own: the look is Gutterpress's built-in
`academic` look, and math is Gutterpress's bundled Math feature. Copy this
folder to start your own paper, or start one from the `paper` template:

```bash
gutterpress new "My Paper" --template paper --preset book
```

The paper is real: its numbers and its figure are genuine, and the 30-line
program printed in it (Listing 1) reproduces every result.

## What's included

- `manifest.yaml`: the language, US Letter page size, the two source files,
  and the three extensions: superscripts, math, and the look
- `paper.md`: the article, from the title block to the acknowledgments
- `references.md`: the numbered bibliography
- `figures/convergence.svg`: the figure, an SVG drawn with matplotlib
- `figures/convergence.py`: the matplotlib script that draws it
- `extensions/academic/`: the built-in look, copied in by
  `gutterpress ext add academic --look` so it is this paper's own file

## Build

```bash
gutterpress build examples/academic-paper
```

Nothing is downloaded: every extension the paper uses ships inside
Gutterpress. Use `gutterpress preview examples/academic-paper` to write with a
live, paginated preview.

## How the article is written

Every part of the paper is ordinary Markdown, plus the Gutterpress `@section`
marker where a block needs its own style.

| Part of the paper | What you write |
|---|---|
| Title block | `@section .title` holding the `# Title`, authors, affiliations and date |
| Author marks | `Quill^1,\*^` (superscripts from `markdown-it-sup`) |
| Abstract, keywords | `@section .abstract` around a `**Abstract.**` paragraph |
| Numbered sections | `## 2 The error expansion`; you number them yourself, as you would cite them |
| Inline math | `$\tau_k h^{2k}$` |
| Numbered equations | a `$$ ... $$` block ending in `\tag{2}`; refer to it in the text as (2) |
| Theorems and proofs | `**Theorem 1** (Euler--Maclaurin). *Statement...*` and `*Proof.* ... $\square$` |
| Figures | `![alt text](figures/convergence.svg){.gp-full}` and a caption paragraph ending in `{.caption}`, inside `@section .figure` so they stay on one page |
| Tables | a Markdown table with its caption above it, inside `@section .figure` |
| Code listings | a fenced code block with its caption, inside `@section .figure` |
| Footnotes | `text.[^delta]` and, anywhere in the file, `[^delta]: The note.` |
| Citations | `[[3]]` in the text, with `[3]: #ref-3` listed once at the end of `paper.md` |
| References | a numbered list in `references.md`, each entry ending in `{#ref-3}` |

Citations are standard Markdown reference links, so each number is a link to
its entry in the PDF. Footnotes are collected at the end of the file that uses
them. Because the bibliography lives in its own file, the notes print after the
paper's text and before the references, as in a journal.

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
Problems with its line and what is wrong.

## Styling

`extensions/academic/theme.css` is the built-in `academic` look, in the spirit
of LaTeX's `article` class: a serif text face, justified and hyphenated text,
1 in margins and a centered page number, with the title block, abstract,
figures, tables, notes and references styled by the `@section` each sits in.
Change the look by editing the tokens at the top of that file, the same names
every built-in look uses:

```css
:root {
  --font-body: "Latin Modern Roman", "CMU Serif", "STIX Two Text", "Times New Roman", "Liberation Serif", serif;
  --fs-body: 10.5pt;
  --leading: 1.38;
  --color-ink: #111111;
}
```

The page size is set in `manifest.yaml` (`page.width` and `page.height`, in
points). For A4, use `595` × `842`. The `language` there sets the quotation
marks straight quotes print as and the hyphenation rules.
