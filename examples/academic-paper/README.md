# Academic Paper Example

A complete journal-style research article, written in Markdown with LaTeX
mathematics and built into an 8-page, US Letter PDF. There is no HTML in the
source, and the only CSS is one short stylesheet of plain rules. Copy this folder
to start your own paper.

The paper is real: its numbers and its figure are genuine, and the 30-line
program printed in it (Listing 1) reproduces every result.

## What's included

- `manifest.yaml`: US Letter page size, the two source files, the stylesheet,
  and the two extensions that add superscripts and math
- `paper.md`: the article, from the title block to the acknowledgments
- `references.md`: the numbered bibliography
- `figures/convergence.svg`: the figure, an SVG drawn with matplotlib
- `styles/paper.css`: the journal look

## Build

```bash
gutterpress build examples/academic-paper
```

The first build downloads the pinned math plugin into `plugins/npm/` (which is
git-ignored); later builds work offline. Use `gutterpress preview
examples/academic-paper` to write with a live, paginated preview.

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
| Numbered equations | a `$$ … $$` block ending in `\tag{2}`; refer to it in the text as (2) |
| Theorems and proofs | `**Theorem 1** (Euler--Maclaurin). *Statement…*` and `*Proof.* … $\square$` |
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
  - markdown-it-mathjax3@4.3.2
```

[markdown-it-mathjax3](https://www.npmjs.com/package/markdown-it-mathjax3) is
an existing markdown-it plugin that typesets `$…$` and `$$…$$` with MathJax. It
understands the LaTeX you already write: `aligned`, `cases` and matrix
environments, `\operatorname`, `\mathbb`, `\tag` and so on. It is the best fit
for print because it writes each formula as an SVG drawing:

- **No fonts and no CSS.** The formulas carry their own glyphs, so the PDF looks
  the same on every computer and needs no math font installed.
- **The same in preview and PDF.** The math is drawn when the Markdown is
  rendered, so the live preview paginates exactly like the printed PDF.

It is pinned to version 4.3.2 because version 5 depends on a native addon,
which Gutterpress does not install. To add it to another book, run
`gutterpress ext add markdown-it-mathjax3@4.3.2 <book>`.

KaTeX plugins such as `@vscode/markdown-it-katex` also work. KaTeX's normal
output needs its stylesheet and about 20 font files copied into your project.
Its MathML-only output needs neither, but then depends on a math font being
installed where the PDF is built, and without one the formulas print poorly.

## Styling

`styles/paper.css` follows LaTeX's `article` class: a serif text face,
justified and hyphenated text, 1 in margins and a centered page number. Change the
look by editing the tokens at the top, using the names the built-in looks use:

```css
:root {
  --font-body: "Latin Modern Roman", "CMU Serif", "STIX Two Text", "Times New Roman", "Liberation Serif", serif;
  --fs-body: 10.5pt;
  --leading: 1.38;
  --color-ink: #111111;
}
```

The page size is set in `manifest.yaml` (`page.width` and `page.height`, in
points). For A4, use `595` × `842`.

## Tips

- Typographic replacements are on, so `--` prints as an en dash and `---` as an
  em dash (write page ranges as `pp. 307--357`, as in LaTeX). They also turn
  `(c)` into ©. Write `\(c)` when you mean the letter.
- `$` starts math. Write a literal dollar sign as `\$`.
- Inside a table, `|` separates cells, even inside math. Write `\lvert x \rvert`
  for an absolute value in a table.
