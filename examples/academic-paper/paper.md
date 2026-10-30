@section .title

# Gutterpress: Print Publishing from Markdown on an Unmodified Browser Engine

**The Gutterpress Contributors**^1,\*^

^1^ Dimm City, gutterpress.dimm.city\
^\*^ Correspondence: github.com/dimm-city/gutterpress

October 2026 · Preprint. This article is the sample paper distributed with Gutterpress, and was typeset by it.

@end-section

@section .abstract

**Abstract.** Authors of research, fiction and tabletop-game material increasingly write in Markdown, yet turning that text into a file a print vendor will accept still means learning TeX or a desktop-publishing application, or accepting a browser's screen-oriented PDF. This paper describes Gutterpress, an open-source publishing system that treats an unmodified Chromium's print path as its typesetting engine. Authors write Markdown with a small family of layout markers and style the result through CSS custom properties; the system assembles one self-contained HTML document whose cascade order is fixed by CSS cascade layers, paginates it with Chromium, and synthesizes, outside the author's files, the parts of CSS Paged Media and Generated Content for Paged Media that Chromium does not implement: running strings, cross-reference page numbers, leaders, recto and verso breaks and folio restarts. Synthesis is tiered. A document that needs nothing missing prints natively; bleed and crop marks are a compile-time geometry transform; and a measure, synthesize and fixpoint loop reads element positions from the PDF's own named-destination tree, usually converging in one print because the page map is predicted from the on-screen preview. That preview paginates with CSS multi-column layout, which shares Chromium's fragmentation engine with printing; a shared policy module and two automated gates hold the two renderers to the same pages, and the one class of divergence that remains, a line whose box ends within a fraction of a pixel of the page bottom, is measured and classified rather than patched. Print-vendor specifications (trim, bleed, safe areas, binding allowance, ink limits, signatures) are formalized as pure geometry shared by the validator and the preview overlay, and mathematics is typeset by MathJax into resolution-independent SVG so that preview and PDF agree without a math font. We report measurements from the project's engineering record and from building its corpus of fourteen books and fixtures, all of which paginate identically on screen and in print on the engine tested.

**Keywords:** CSS Paged Media · document engineering · Markdown · print production · PDF/X · pagination · browser rendering engines · preview--print parity

**CCS Concepts:** Applied computing &rarr; Document preparation &rarr; Markup languages; Format and notation · Software and its engineering &rarr; Software design tradeoffs

@end-section

## 1 Introduction

The gap this paper addresses is between two things writers already have. On one side is Markdown, which a large population of non-technical authors now write fluently: researchers drafting manuscripts [[33], [45]], novelists, and the independent designers who publish tabletop role-playing material through print-on-demand services. On the other side is the print vendor, who accepts a PDF only when it meets a specification written in the language of prepress: a trim size, a bleed of an eighth of an inch on three edges, text no closer than half an inch to the cut, a total ink limit, PDF/X conformance with a named output intent, and a page count that fits a printing signature [[1], [15]]. The tools that bridge this gap today either ask the author to learn a second language (TeX and LaTeX [[30], [34]], or the layout vocabulary of a desktop-publishing application) or hand the Markdown to a web browser whose PDF output was designed for printing web pages, not books.

CSS Paged Media [[57]] and its companion, Generated Content for Paged Media (GCPM) [[54]], were written to close exactly this gap: to let a stylesheet describe page size, margins, running headers, page numbers, cross-references and leaders, so that a web document can be a book [[35], [36], [41]]. Twenty years on, the specifications are implemented in full only by dedicated formatters, several of them proprietary [[2], [60]], and partially by browsers. Chromium, the engine behind most installed browsers, paginates and prints well, emits tagged PDF with embedded font subsets, and since version 131 renders all sixteen page-margin boxes [[10]]; but it does not implement `string-set`, `target-counter()`, `leader()`, recto and verso forced breaks, or a restart of the page counter from the content flow. Projects that build books on a browser have therefore either reimplemented layout in JavaScript [[44]] or split the document into page-sized DOM fragments and laid them out one by one [[5], [46]].

Gutterpress takes a third position. It uses an unmodified Chromium as the one and only layout engine, for the live preview as well as for the PDF, and confines itself to synthesizing the few constructs the engine lacks, in generated CSS and DOM hooks that never touch the author's files. The argument for this position is empirical rather than aesthetic. A browser's print path is maintained by a large engineering organization, tested against the web, and improving; a second layout engine, however good, drifts from it, and preview-to-print divergence is the costliest failure a writing tool can produce, because the author only discovers it after the book is printed. The project's constitution states the consequence plainly: when Chrome ships a Paged Media feature, the corresponding synthesis is deleted and Chrome's behaviour is matched even where it is imperfect; upstream bugs are filed, not papered over [[19]].

The paper makes the following contributions.

1. **An authoring surface for print** in which content stays semantic Markdown, layout intent is expressed by a small family of `@`-prefixed markers, and design is a cascade of CSS custom properties whose precedence is fixed by cascade layers rather than by file order or specificity (Section 3).
2. **A tiered compilation strategy** for CSS Paged Media on a browser that does not implement all of it: native printing when nothing is missing, a compile-time geometry transform for bleed and marks, and a measure, synthesize and fixpoint loop whose measurement channel is the PDF's own named-destination tree and whose first print is usually the shipped one because the page map is predicted from the preview (Section 4).
3. **A preview-to-print parity contract**: pagination on screen by CSS multi-column layout, which shares the engine's fragmentation code with printing; a single shared policy module so that no rule is implemented twice; two automated gates; and a measured classification of the one remaining class of divergence (Section 5).
4. **A formalization of print-vendor geometry** (trim, bleed, safe areas, binding allowance, signatures, ink coverage, effective resolution, shrink-to-fit) as pure functions shared by the validator and the preview overlay, so that the number a printer quotes is checked and displayed from one definition (Section 6).
5. **Mathematics typeset to resolution-independent SVG** at Markdown-render time, so that formulas need no fonts in the project or on the building machine and paginate identically in preview and print; this article is the demonstration (Section 7).
6. **An evaluation** combining the project's recorded engine measurements with fresh builds of its corpus (Section 8), together with a frank account of what the approach cannot do (Section 9).

Gutterpress is free software under the Mozilla Public License 2.0. The system, its engineering record, the corpus used in Section 8 and the source of this article are in one repository [[19]].

## 2 Background and related work

### 2.1 Batch typesetting systems

TeX [[30]] remains the reference point for automated typesetting. Its paragraph builder chooses line breaks for a whole paragraph at once by minimizing a sum of demerits [[31]], and LaTeX [[34]] gave it the document-class abstraction that scholarly publishing still runs on. ConTeXt [[20]] and, more recently, SILE [[12]] and Typst [[21], [39]] keep the same architecture of a dedicated layout engine driven by a markup language, Typst with a modern language design and incremental compilation. Pagination has its own literature; Mittelbach [[42]] frames globally optimized pagination as an extension of the Knuth--Plass idea to pages. All of these systems own their layout engine, which is both their strength and the cost they ask of a user: output quality that a browser does not match in paragraph building, in exchange for a toolchain, a language and an error vocabulary of their own.

### 2.2 Lightweight markup for scholarly and long-form writing

Pandoc [[38]] made Markdown a serious input format for documents by converting it, through an abstract syntax tree, to LaTeX, HTML, Word and dozens of other formats. The scholarly tooling built on it, R Markdown [[59]], Quarto [[47]], Manubot [[22]], Pandoc Scholar [[33]], and the Jupyter Book and MyST ecosystem [[17]], delegates print to one of two back ends: LaTeX, inheriting its requirements, or HTML printed by a browser, inheriting the browser's limits. Gutterpress accepts the second back end and works on its limits directly. It also narrows the input language deliberately: CommonMark [[37]] with GitHub Flavored Markdown tables [[18]] as implemented by markdown-it [[48]], a fixed set of bundled extensions, and the marker family of Section 3.3, so that the author's dialect is the same in every project and every tool that reads it.

### 2.3 CSS as a print language and its implementations

Lie's thesis [[35]] and the "Boom!" article [[36]] argued that CSS could carry a book, and McKesson [[41]] showed a publisher doing it. The W3C modules involved are Paged Media Level 3 [[57]] (page size, margins, margin boxes, named pages, page selectors), GCPM [[54]] (running strings, `target-counter()`, `target-text()`, `leader()`, footnotes), Fragmentation Level 3 [[53]] (break control, widows and orphans), Multi-column Layout Level 1 [[56]], Cascading and Inheritance Level 5 [[51]] (cascade layers) and Counter Styles Level 3 [[52]]. Prince [[60]] and Antenna House Formatter [[2]] implement the print modules in proprietary engines. WeasyPrint [[32]] is an open-source Python implementation with a layout engine of its own. Vivliostyle [[44]] runs in the browser but performs pagination in its own JavaScript layout code. Paged.js [[46]], the subject of Blanc's doctoral study of a designers' community of practice [[5]], polyfills Paged Media by splitting the DOM into page-sized boxes and letting the browser lay out each one; Di Marco [[13]] compares several of these formatters. Gutterpress differs from all of them in letting the browser's own fragmentation engine decide every page, on screen and in print; its own code never chunks the DOM and never positions a line.

That engine is Chromium's LayoutNG. Stenshorne [[49]] describes its block fragmentation: a fragmentation context is established by a multi-column container or by printing, and the fragmentainers are columns in one case and pages in the other, laid out by the same code since Chrome 108. This shared engine is the load-bearing fact behind Section 5. Chromium exposes printing to tools through the DevTools Protocol method `Page.printToPDF` [[9]], whose `preferCSSPageSize` option makes the stylesheet's `@page { size }` the paper size and whose tagged-PDF and document-outline options are what Gutterpress requests; Electron exposes the same engine as `webContents.printToPDF` [[16]]. Layout positions inside Blink are fixed-point `LayoutUnit` values with six fractional bits, that is, 1/64 of a CSS pixel [[11]], a detail that becomes decisive in Section 5.4.

### 2.4 Print production standards

A print vendor's file requirements are a stack of standards. PDF itself is ISO 32000-2 [[28]]. The PDF/X family restricts it for prepress exchange: PDF/X-1a (ISO 15930-1 and ISO 15930-4) requires CMYK or spot colour only, embedded fonts and no live transparency [[25]]; PDF/X-3 allows colour-managed data [[26]]; PDF/X-4 admits transparency [[27]]. Accessibility of the PDF is governed by PDF/UA [[24]], and of the content by WCAG [[58]]. Process control for offset printing is ISO 12647-2 [[23]]. Characterized reference printing conditions, the CGATS 21 data sets [[8]], supply the ICC profiles vendors name; the CGATS21_CRPC1 profile, which DriveThruRPG prescribes, is the smallest-gamut of the seven conditions and carries a 240% total-area-coverage limit. The vendor documents themselves [[1], [15]] translate these into the few numbers an author sees: bleed, safe margins, ink limit, PDF/X flavour, signature rules and minimum image resolution. Gutterpress encodes them as data (Section 3.4) and checks them with the geometry of Section 6, converting Chromium's RGB PDF with Ghostscript [[3]], stripping annotations with qpdf [[4]], editing page boxes with pdf-lib [[14]], and reading the result back with PDF.js [[43]], a reader the project has no hand in.

### 2.5 Mathematics on the web

MathJax [[7], [40]] and KaTeX [[29]] typeset TeX mathematics in browsers, MathJax to HTML with CSS, to SVG, or to MathML; MathML Core [[55]] is now implemented natively by Chromium. Section 7 explains why, for a print pipeline whose preview must match its PDF on any machine, the SVG output is the one that works, and demonstrates it.

## 3 Design principles and system overview

### 3.1 Principles

Four rules shape the system, each adopted after a defect rather than before one; the project's design record [[19]] pairs every rule with the bug that taught it.

**The author's files are the only source of truth, and nothing rewrites them.** Generated CSS and DOM hooks go into the assembled document, never into the project. Measurement instruments the document through ids the author already wrote or through a zero-size custom element injected as a first child; it never assigns an attribute an author selector can see, because `h1[id] { counter-increment: chapter }` is real theme CSS and an injected id once renumbered every chapter in a book.

**The browser is the engine.** Chromium's print output is the product's output. Where Chromium lacks a Paged Media feature, Gutterpress synthesizes it with standard CSS the engine does execute, and removes the synthesis when the engine catches up. Where Chromium has a bug, Gutterpress reports it to the author and files it upstream rather than correcting it, since a corrective shim is what makes preview and print disagree. Three such bugs are documented with pixel measurements and removal triggers in the repository: a gradient in `@page { background }` paints nothing; margin boxes drop every property that establishes a stacking context; and an image referenced only from an `@page` rule is not painted on Chromium 151 and earlier (fixed upstream in 152, with the build's preload workaround scheduled for deletion when the engine floor reaches it).

**Measure, do not assume.** Every fact about the engine in Section 4 was obtained by printing a probe document and reading the PDF with an independent reader. The engine is pinned to a minimum Chromium milestone (148 at the time of writing)[^pin] because a milestone change silently flipped the semantics of `target-counter()` once, from dropped to parsed-but-rendering-nothing, and no feature test could have detected it: `CSS.supports('content', 'target-counter(...)')` returns true on an engine that renders nothing.

**One policy, two renderers.** Every rule that decides something (where a blank page goes, what a running string reads on a page, how far a leader fills) is a pure function in one shared module. The compiler and the viewer differ only in how they measure, by the PDF's destinations or by client rectangles, and in how they apply the result. The rule exists because recto and verso blanks were once implemented in the compiler alone, and the preview and the PDF disagreed by a page for exactly the books the feature was for.

### 3.2 Pipeline

Figure 1 shows the pipeline. A project is a folder: Markdown chapters, stylesheets, optional fonts and images, and a `manifest.yaml`. Assembly renders every chapter with one markdown-it instance and concatenates the result into a single self-contained `book.html`: all CSS is inlined in a fixed cascade order, fonts become data URIs, and images the book actually references are staged beside it. The same document is then either mounted in the viewer, which paginates it on screen, or handed to the compiler, which prints it through Chromium, post-processes the PDF, and optionally converts it to PDF/X. Validation runs before the build on the sources and assets and after it on the PDF. The library, the command-line tool, the Electron desktop application and the preview server all call the same functions; the desktop injects Electron's bundled Chromium where the command line launches the system one.

@section .figure

![Block diagram of the Gutterpress pipeline. Three inputs, Markdown chapters, stylesheets and looks, and the manifest, feed an assembly step that produces one self-contained HTML document with all CSS inlined in a fixed cascade order. From it two renderers branch: the preview, which paginates with Chromium multi-column layout, and the compiler, which prints over the DevTools Protocol in three tiers. Between them sits a shared policy module. The compiler's output passes through post-processing, an optional PDF/X hand-off, and validation.](figures/pipeline.svg){.gp-full}

**Figure 1.** The pipeline. One assembled document feeds two renderers; every rule that decides a page lives in the shared policy module between them, and the renderers differ only in how they measure. {.caption}

@end-section

### 3.3 The authoring surface

**Markdown.** The dialect is CommonMark plus GFM tables, with attributes (`{.class #id key=value}` after a block or inline), footnotes, definition lists and a source map always on, and six bundled features an author switches on by name in the manifest: highlight, subscript, superscript, abbreviations, GitHub-style callouts and mathematics. Any markdown-it plugin from npm can be added as well, pinned to an exact version and vendored into the project, so a build is reproducible offline.

**Layout markers.** A line beginning with `@` and one of a fixed set of words is a layout marker (Table 1). Markers emit plain structural `<div>` wrappers (`.chapter`, `.spread`, `.page`, `.section`) and nothing else: core Gutterpress never inserts a page break of its own, never styles a heading, and never guesses a chapter boundary. A marker takes a name, classes and an id, so `@section .figure` is the whole of what an author writes to opt a table into the figure styling of this article's look. Every block, heading and image also receives a stable `data-name` derived from its own first heading or file name, so that a stylesheet can address one block (`[data-name="sporos-hollow"] { break-inside: avoid }`) without the author touching the Markdown.

@section .figure

**Table 1.** The layout markers. Each is a line beginning with `@`; a backslash (`\@page`) or inline code escapes one in prose. Only `@chapter` with a label generates an element of its own, the chapter opener. {.caption}

| Marker | Emits | Purpose |
|:--|:--|:--|
| `@chapter` | `<div class="chapter">` | Wrap a chapter; a label adds a `.chapter-opener` on its first page |
| `@spread` | `<div class="spread">` | Group two facing pages |
| `@page` | `<div class="page">` | Start a page; a bare word names it (`data-page`), `.class` styles it |
| `@page-break` | `<div class="gp-page-break">` | A hard break with no wrapper |
| `@section` ... `@end-section` | `<div class="section">` | A styled structural group; the hook for component variants |
| `@continue` | `<div class="section gp-continued">` | Reopen the current section after a break, marked as a continuation |
| `@columns n` ... `@end-columns` | a multi-column run | One to five columns; `@column-break` moves to the next |

@end-section

**Design by tokens, precedence by layers.** The recommended stylesheet architecture, which the project calls the contextual cascade, keeps the Markdown free of presentational classes. Components are defined once, keyed by a section class (`.section.dc-stat-block table { ... }`), and expose their variable parts as CSS custom properties with defaults; per-book overrides set those properties through selector chains the document already has (`#ch-rules .dc-callout { --dc-callout-accent: ... }`). The same markdown therefore renders correctly in any book that defines the component, and a variant is one rule in one file rather than a class retyped on every table. Every built-in look exposes the same token vocabulary (`--font-body`, `--fs-body`, `--color-ink`, `--leading`, ...), so a non-technical author restyles a book by setting a dozen values.

Precedence is not left to file order. The assembled document declares `@layer gp.marker, gp.vocab;` for core, then one layer `ext.<name>` per extension in manifest order, and leaves the author's own stylesheets unlayered. By the cascade-layer rule of CSS Cascading Level 5 [[51]], for normal declarations a later layer beats an earlier one and unlayered declarations beat every layer, both regardless of specificity:

$$
\begin{gathered}
d_1 \in \mathcal{L}_i,\; d_2 \in \mathcal{L}_j,\; i < j \;\Longrightarrow\; d_2 \text{ wins}; \\[0.4ex]
d_1 \in \mathcal{L}_i,\; d_2 \notin \textstyle\bigcup_k \mathcal{L}_k \;\Longrightarrow\; d_2 \text{ wins}.
\end{gathered}
\tag{1}
$$

A look's most specific rule is thus overridden by a bare element selector in the book's own sheet, an extension cannot jump the queue by leaving its CSS unlayered, and `!important` is never needed. The manifest's page geometry (Section 3.4) is written last and unlayered, as the one decision that must win over everything.

### 3.4 Configuration: presets are trim, targets are policy

The manifest is a short YAML file: title, authors, a BCP 47 `language` (which sets hyphenation and the quotation marks straight quotes become), the ordered `chapters`, `styles`, `extensions`, a `page` block, and a `checks` map from check id to `off`, `on`, `info`, `warn` or `error`. Two keys carry the print-production model, and their separation is an architectural decision recorded as ADR 0008 [[19]]: a **preset** says how the book is designed, chiefly its sheet geometry; a **target** says where it will be published, as a validation-policy overlay that never changes how the book renders. The resolved configuration follows one precedence chain everywhere, command line over manifest over target over preset, leaf by leaf, so an author's explicit value always wins and a target's only hard enforcement is the set of checks that must actually run for it (a check skipped because a tool is missing becomes an error rather than a silent pass). One source can be validated for several destinations in one run (`targets: [dtrpg, itch]`): the digital target drops PDF/X, ink and safe-margin rules and keeps structure and embedded fonts.

@section .figure

**Table 2.** The DriveThruRPG preset, with the provenance the source records for each number. SPEC: stated in the vendor's specification [[15]]. DERIVED: follows from a standard the specification names (PDF/X-1a forbids transparency). CONVENTION: Gutterpress's own choice. {.caption}

| Setting | Value | Provenance |
|:--|:--|:--|
| Sheet (`page.width` × `page.height`) | 621 × 810 pt (8.625 × 11.25 in) | SPEC: US Letter trim plus 0.125 in bleed on three edges |
| In-sheet bleed `page.bleed` | 9 pt (0.125 in) | SPEC: top, bottom and outer edge; none at the binding |
| Text safe area `page.safe` | 36 pt (0.5 in) | SPEC |
| Art safe area `page.artSafe` | 18 pt (0.25 in) | SPEC: non-bleeding art, three outer edges |
| Binding allowance `page.gutter` | 36 pt (0.5 in) | SPEC: text and art at the binding edge |
| Total ink `ink.maxTac` | 240% (+0.5 tolerance) | SPEC; CONVENTION for the tolerance |
| PDF/X flavour and profile | X-1a, CGATS21_CRPC1.icc | SPEC |
| Signature | 4 pages, last page blank | SPEC: a multiple of the signature ending blank, or one short |
| Small black text | K only | CONVENTION: single plate for text at 24 pt and under |
| Minimum image resolution | 300 dpi | CONVENTION: the specification states none |
| Transparency | flattened | DERIVED from PDF/X-1a |

@end-section

A manifest without a preset resolves to the DriveThruRPG preset, which is the product default for its primary audience, and every creation path writes an explicit `preset:`, so the default only ever applies to a hand-written file; an unknown preset name is an error that lists the known ones rather than a silent fallback to someone else's trim size.

## 4 Compiling paged media on an unmodified browser

### 4.1 What the engine does and does not do

Table 3 summarizes the measured behaviour of the pinned engine, from the project's engineering record [[19]]; every row was obtained by printing a probe and reading the PDF with PyMuPDF or Poppler, and the record names the Chromium build (151.0.7922.75) on which the measurement was taken. The native half is the premise of the whole design: page size, margins, named pages, all sixteen margin boxes, `counter(page)` and `counter(pages)`, the `:first`, `:left` and `:right` selectors, forced and avoided breaks, widows and orphans, tagged PDF, the document outline and font subsetting all work with no help. The missing half is small and specific.

@section .figure

**Table 3.** Measured CSS Paged Media support on the pinned engine (Chromium 151), from the project's engineering record [[19]]. "Synthesized" names the tier that supplies the feature (Section 4.2). {.caption}

| Feature | Measured | Gutterpress |
|:--|:--|:--|
| `@page { size; margin }`, named pages, `:first/:left/:right` | native; 6 × 9 in gives a 432 × 648 pt media box exactly | used as is |
| All 16 margin boxes, `counter(page)`, `counter(pages)` | native | used as is |
| `break-before/after: page`, `break-inside: avoid`, `widows`, `orphans` | native, identical in multicol | used as is |
| Tagged PDF, outline, embedded font subsets | native via `Page.printToPDF` | used as is |
| `string-set` / `string()` | not implemented | Tier 2 or 3 |
| `target-counter()` / `target-text()` | parsed and kept, but renders nothing; `CSS.supports` reports true | Tier 3 |
| `leader()` | not implemented | Tier 3 |
| `break-before: recto/verso/right/left` | treated as a plain page break | Tier 3 |
| `@page :blank` | never matches | synthesized name |
| `counter-reset: page n` in content | ignored by the margin box | Tier 3 |
| `bleed` / `marks` descriptors | dropped by the parser | Tier 2 |
| `@page` specificity across stylesheets | not applied | flat emission (4.6) |
| `float: footnote`, `position: running()` | not implemented | not supplied |

@end-section

Two further measured facts constrain everything below. First, nothing in the content flow paints outside the page's content box: a `position: fixed` element, a negative margin, and even `html { background }` are clipped to it, so full-bleed art is reachable only on a page whose margin is zero, while a full-bleed background can still be obtained with margins by painting the sixteen margin boxes. Second, `break-before: recto` producing a plain break and `@page :blank` never matching mean that a bound book's chapter openers, the most ordinary requirement in book design, cannot be expressed natively at all.

### 4.2 Three tiers

The compiler reads the author's CSS with a deliberately narrow extractor that understands `@page` blocks (including the descriptors the browser's object model drops) and the four GCPM constructs, and classifies the document.

**Tier 1, native.** A document using only the native half prints in one pass with no synthesis.

**Tier 2, compile-time geometry.** When a `string-set` source also begins a named-page run, the running head is known per run and is emitted as a generated named page whose margin-box content is the literal heading text, still one pass. The `bleed` and `marks` descriptors are a pure transform of the page geometry (Section 6.5), also one pass.

**Tier 3, measurement.** Page-granular strings (a heading that does not start a page run), `target-counter()`, `target-text()`, `leader()`, recto and verso breaks and folio restarts all depend on which page an element lands on, which only the engine knows. Tier 3 prints, reads the result, synthesizes, and repeats to a fixpoint (Section 4.7).

### 4.3 The measurement channel

Chromium writes a `/Dests` name tree into the PDF keyed by the `id` of every element that some link in the document points at, resolving each to the page on which the element was printed. Gutterpress uses this as its measurement channel. The compiler injects, inside a `display: none` container, one link per element it needs to measure; the measurement is layout-neutral (the page count does not change), it produces no `/Link` annotations (which matters because Ghostscript rejects them under PDF/X), and it works with fourteen of fourteen probe ids in the record. An element the author gave an id is measured through that id; any other is measured through a zero-size `<gp-anchor>` injected as its first child, never through an attribute the author's selectors can observe (Section 3.1). The viewer measures the same elements with `getBoundingClientRect()` against its column grid; the two channels feed the same functions.

### 4.4 Running strings as counter-style maps

GCPM's `string(name, which)` reads, on each page, a value that `string-set` assigned somewhere in the content. Given the ordered assignments $A_p = (a_1, \dots, a_k)$ that land on page $p$ and the entry value $E_p$ in effect at the top of the page (the last assignment on any earlier page, or the empty string), the four `which` keywords of GCPM §2.4 [[54]] define

$$
\begin{aligned}
S_{\text{first}}(p) &= \begin{cases} a_1 & k > 0 \\ E_p & k = 0, \end{cases} &
S_{\text{start}}(p) &= E_p, \\[1ex]
S_{\text{last}}(p) &= \begin{cases} a_k & k > 0 \\ E_p & k = 0, \end{cases} &
S_{\text{first-except}}(p) &= \begin{cases} \varnothing & k > 0 \\ E_p & k = 0. \end{cases}
\end{aligned}
\tag{2}
$$

Once the page of every assignment is measured, $S(p)$ is known for every page, and the whole running-head mechanism becomes one standard construct: a `@counter-style` with `system: fixed` [[52]] whose `symbols` list is $S(1), S(2), \dots, S(P)$, and a rewrite of `string(name)` in every margin box to `counter(page, gp-name)`. Chromium executes the result natively. The record compares this against the earlier mechanism of renaming pages per chapter run: on the same 61-page book both produced 61 pages with identical content, but the counter-style map emitted 4.7 KB of generated CSS where renaming emitted 64.5 KB, left the author's `@page` rules untouched where renaming rewrote them, and allowed 342 lines of cascade re-implementation to be deleted. A folio restart (`counter-reset: page n`, which native print ignores) is the same trick with numbers: a per-page value list replaces `counter(page)` in every context that uses it, with one generated style per numeral system the author requested, so front matter in roman and body in arabic are two symbol lists over one value sequence.

### 4.5 Analytic planning instead of iteration

Several Tier 3 decisions have the property that a fix changes the thing it was derived from. A blank page inserted to put a chapter on a recto shifts every later page by one; a folio restart changes every later folio. The first implementation of recto blanks toggled spacers one measurement pass at a time and never converged: the spacer fixed the parity, the next pass saw it fixed and removed it. The rule the project drew is to compute the whole answer analytically from one clean measurement.

For blank planning, let the sites that demand a side be measured, in document order, on pages $p_1, \dots, p_n$ of a spacer-free layout, with $\rho_i = 1$ when site $i$ wants a recto (odd page) and $0$ for a verso. Carrying the count $\sigma$ of blanks inserted so far,

$$
\begin{gathered}
e_i = p_i + \sigma_{i-1},\qquad
w_i = \bigl[\, (e_i \bmod 2 = 1) \ne \rho_i \,\bigr], \\[0.4ex]
\sigma_i = \sigma_{i-1} + w_i,\qquad \sigma_0 = 0,
\end{gathered}
\tag{3}
$$

and a blank precedes site $i$ exactly when $w_i = 1$. For a folio restart, with resets $(q_1, n_1), \dots, (q_m, n_m)$ sorted by their final (post-blank) page $q_k$ and taking the last reset when two share a page, the value printed on physical page $p$ is

$$
v_p = \begin{cases} p & p < q_1 \\ n_k + (p - q_k) & q_k \le p < q_{k+1}, \end{cases}
\tag{4}
$$

and a cross-reference to physical page $p$ prints $v_p$, not $p$, so that the number a reference quotes is the number the target page carries in its own margin box. A leader fills a measured gap $\gamma$ with a glue string of width $\gamma_g$ repeated $\max(0, \lfloor \gamma / \gamma_g \rfloor - 1)$ times, one short of the exact quotient so that rounding can never wrap the line. Where an answer genuinely cannot be computed in one shot, the reservation of repeated table headers and footers in the viewer, the state is made monotone instead: claims only grow, and the loop ends when a pass adds nothing.

### 4.6 Generated CSS must win, and must be flat

Two cascade facts, both measured, shape how generated CSS is written. First, the engine keeps the author's `target-counter()` declaration while computing it to `none`, so an override must out-specify the author's own rule rather than rely on it being dropped. The compiler therefore reuses the author's selector and adds an attribute of its own: `a.xref::after` becomes `a.xref[data-gp-after]::after { content: attr(data-gp-after) }`, with specificity $(0,2,1) > (0,1,1)$ whatever the author's rule looked like. Second, Chromium does not apply `@page` selector specificity across stylesheets: a plain `@page` block in a later `<style>` overrides `@page :left` in an earlier one. A generated unnamed `@page` block therefore silently beat the author's left and right gutters, and every page of a bound book once collapsed to the same margin. The rule that followed is that every page context, name times pseudo-variant, is resolved by the compiler and emitted as one flat block including its suppressions (`content: none`), so that nothing is ever left to a cross-sheet cascade the engine does not perform.

### 4.7 The fixpoint loop and predict-then-verify

Figure 2 shows Tier 3. The loop prints at the top of each pass; the shipped bytes are those of the pass whose measured page map, together with the page count, equals the signature of the map that produced them. Cross-reference text lands in the content flow, so inserting "(p. 42)" can reflow a line and move content to a new page, which is why convergence must be verified rather than assumed; running heads alone cannot do this, because margin boxes sit outside the flow.

@section .figure

![Flowchart of the Tier 3 loop. A prediction step reads a page map from the viewer's multi-column layout without printing. Synthesis is applied from that map, the document is printed once over the DevTools Protocol, the page map is read back from the PDF's named destinations, and a decision compares its signature with the previous one. If equal, the bytes just printed are shipped; otherwise synthesis is re-applied from the measured map and the document is printed again.](figures/fixpoint.svg){.gp-full}

**Figure 2.** Tier 3 as a fixpoint with a predicted seed. The verification print is the shipped print when the prediction holds, so the common cost is one print. {.caption}

@end-section

Without prediction the first print exists only to read `/Dests` and its bytes are discarded; the second print, with synthesis applied, is the output. Prediction removes the need for the first print rather than the second: a throwaway tab navigates to the same document and runs the viewer's own fragmenter (the same code the desktop preview runs, unmodified) to produce a predicted id-to-page map and page count, synthesis is applied from the prediction, and the first real print is both the verification and, on a match, the shipped file. On a miss the loop proceeds exactly as before at the old two-print cost; correctness is unchanged because verification is retained. The engineering record reports two things worth repeating. Making measurement neutral (Section 3.1) removed a de-instrumentation reprint and cut Tier 3 from four prints to two, from 3.1 s to 1.8 s warm on a 61-page book; and on that same book the prediction currently misses, because its cover page assigns a named page to a descendant rather than the container, an idiom the multi-column viewer cannot follow, so the fallback fires and the output is byte-identical to the two-print baseline at a cost of 80 to 150 ms for the failed guess. Section 8 reports which books in the corpus converge in one print today.[^hit]

### 4.8 Pinned art and freed margins

Art pinned to a page edge (`.gp-pin.gp-top`, and so on) must reach the paper, but the printable area is the page area and a margin box in a near-zero margin does not render. The engine's answer is geometry per page: the compiler aliases the page context under a generated name, zeroes the pinned margins on the alias, and assigns the root to it; the root then gets the same margin back as padding (cloned onto every fragment), so its content box, and with it every line and page break, is exactly the author's. The pin box is the root's padding box inset to the printer's art-safe line, with the binding edge taking the binding allowance (Section 6.2):

$$
\iota_e = \begin{cases} 0 & e \notin \text{pinned edges} \\ g & e = \text{binding edge} \\ b + a & \text{otherwise}, \end{cases}
\tag{5}
$$

for bleed $b$, art safe $a$ and gutter $g$ in points, converted to pixels by $96/72$ on the way into the document. The viewer applies the identical function to its strip geometry. Margin-box furniture on a freed edge is redrawn by both renderers at its original coordinates, so nothing the author declared is lost.

### 4.9 Post-processing and the PDF/X hand-off

The compiler's output is Chromium's PDF at final media size, edited in place with pdf-lib: `MediaBox`, `BleedBox` and `TrimBox` from the geometry of Section 6.5, crop marks drawn in the slug when requested, blank pages appended by the signature rule of Section 6.6, and document metadata embedded. pdf-lib is told not to stamp itself as producer, since it edits boxes and did not produce the document. The hand-off to print vendors then runs Ghostscript's PDF/X output [[3]] with the preset's ICC profile. The record's round-trip measurement, Ghostscript 10.06 converting a Chromium PDF to PDF/X-1a with a FOGRA39 profile, found page boxes preserved to the point, text extraction byte-identical, 47 RGB fill operators converted to 34 CMYK operators with no `/DeviceRGB` remaining, fonts still embedded and no transparency; a missing or malformed ICC profile makes Ghostscript fail loudly, so there is no silent non-conformant output. Because Ghostscript rejects `/Link` annotations under PDF/X, qpdf [[4]] strips them first. Two further conventions serve print rather than the standard: near-black text at 24 pt and under is moved to the black plate alone, so small type does not depend on four-plate registration, and live transparency is flattened per page by default, with an opt-in that keeps text live and rasterizes only the artwork that needs it.

## 5 Preview-to-print parity

### 5.1 Pagination by multi-column layout

The viewer never paginates in JavaScript. For each named-page run it wraps the author's content in one shallow strip laid out as a CSS multi-column container whose column width and height equal the page's content box, converted from points to pixels at $96/72$; the browser's fragmentation engine then puts the same content on the same pages it would print, because, as Stenshorne describes [[49]], columns and pages are fragmentainers of one engine. The record's corpus measurement is 331 of 331 blocks on the same page across five documents. The viewer draws sheets, margins and margin-box furniture as decoration around the strips, slides each verso's sheet by the difference between the recto's and verso's inner margins (mirrored margins agree on content size, so pagination is unaffected), evaluates `string()` and `counter(page)` with the same shared functions the compiler feeds its counter-style maps, and never chunks the DOM: a block that spans pages is one element with several client rectangles. Four differences between print and multi-column fragmentation were found and are compensated: repeated `<thead>` and `<tfoot>` on continuation pages (the viewer reserves space with clones), a lone table header stranded at a column bottom (the viewer pushes the table), and the recto blank spacer whose `break-after: column` once combined with the author's `break-before: recto` into one break instead of two.

### 5.2 One policy module

Section 3.1's fourth principle is realized as a module of pure functions with direct unit tests: blank planning (3), string values (2), folio values (4), leader fill, the generated-content specificity rule, signature padding (Section 6.6), page boxes and the ink verdict (Sections 6.2 and 6.3), pin insets (5), and the parser and evaluator for `content` values. The compiler imports it under Node; the viewer imports it in the browser bundle. There is no "compiler feature awaiting its viewer twin", because there is no twin.

### 5.3 Two gates

**The native parity gate** stages every registered fixture exactly as a build would, builds it once, mounts the viewer on the same document in the same browser, and compares, per fixture, the page count, the page of every instrumented cross-reference target, the folio each resolves to, and the page of every heading (the gate gives each heading a stable id and a hidden self-link so the PDF carries a destination for it). Each fixture ends in one of three outcomes: CLEAN, EXACT-FIT BOUNDARY (Section 5.4), or DIVERGENCE, which fails the run unless listed with a reason in an allow-list the project keeps empty by rule.

**The render-parity gate** answers a different question: did a code change move the printed page? It builds the base and head revisions of the compiler in one CI job against the same fixture sources, so that the Chromium build and fonts are identical, and compares the two PDFs: page count and size exactly, every text run's string exactly and its extents within 0.5 pt, every image's placement within 0.5 pt, and optionally every page as pixels at 72 dpi with a 1% channel threshold. Waivers require a reason and are reviewed like code. The gate's one documented blind spot is that an element with a CSS `filter` is rasterized by Chromium into a bitmap, so a text change inside it is invisible to text comparison; the print-safety check warns on every `filter` declaration for the same reason, and the raster mode sees the change as pixels.

### 5.4 Knife-edge boundaries, measured and classified

The two fragmenters round differently at the bottom of a fragmentainer. Printing positions each line box on whole CSS pixels; multi-column layout keeps the 1/64 px precision of `LayoutUnit` [[11]]. When a line's box ends within roughly half a pixel of the column bottom, one fragmenter keeps the line and the other overflows it, and the break-avoidance rules above the line (`orphans`, `widows`, `break-after: avoid`) then make each side choose a different, equally correct break, so a heading several blocks earlier can land one page later on screen than in the PDF, and every heading after it reports a divergence. The record counts 91 such consequential divergences on the user guide from one 0.6 px input difference.

The gate therefore measures the boundary instead of listing its consequences. Taking the first disagreeing heading, it searches forward from the last agreeing one for the first page whose last line the two sides disagree on, and measures that line's box bottom $B$ against the column height $C$ on both sides as a slack $\varsigma = C - B$. With the side that kept the line marked "kept" and the other "pushed", the outcome is classified as an exact-fit boundary when

$$
\begin{aligned}
\varsigma_{\text{kept}} &\ge -\epsilon, \\
\varsigma_{\text{pushed}} &< 0, \\
\lvert\, \varsigma_{\text{kept}} - \varsigma_{\text{pushed}} \,\rvert &\le \epsilon, \qquad \epsilon = 1\ \text{px},
\end{aligned}
\tag{6}
$$

and as a divergence otherwise, for instance when the pushing side fits the line once its break rules are neutralized (a break-rule disagreement, not geometry). The committed repro fixture measures print keeping a line with $+0.02$ px of slack and the viewer pushing the same line at $-0.36$ px, a difference of $0.38$ px.

The obvious repair, a constant added to the viewer's column height, was tried twice and rejected on evidence. At the whole-book level, $+0.5$ px removed 77% of drift events on a 6 × 9 in book and matched its page count exactly, but did nothing for an A4 book set in millimetres (78 events became 73): the bias is font- and geometry-dependent, not constant, and fractional page metrics make it worse (35 events at 6 × 9 in against 78 at 210 × 297 mm for the same content). At the fragmentainer level, a $0.36$ px bump made the repro fixture clean and changed no page count in the registered corpus, but every registered fixture is a US Letter book, which is exactly the geometry the earlier experiment had also matched before failing on A4, and an existing invariant test (the strip's rendered box has zero slack against its own custom property) would have had to be weakened to admit it. The posture the project settled on is that the PDF is ground truth, printed page numbers always come from compiler measurement, and the exact-fit outcome is an accepted classification, not a defect pending a fudge factor.
## 6 Print-production geometry

This section states the mathematics the system uses to turn a vendor's specification into checks, overlays and PDF boxes. All of it is implemented as pure functions in the shared module, and the preview's print overlay and the post-build validator read the same functions, so a number is defined once.

### 6.1 Units and the sheet

Points are the unit of the manifest and the PDF, pixels the unit of layout:

$$
1\ \text{in} = 72\ \text{pt} = 96\ \text{px},\qquad x_{\text{px}} = \tfrac{96}{72}\, x_{\text{pt}} = \tfrac{4}{3}\, x_{\text{pt}}.
\tag{7}
$$

A print-on-demand interior is often supplied as a sheet that already contains its bleed on the three outside edges and none at the binding, which is cut. For DriveThruRPG's US Letter book, trim $w_t \times h_t = 612 \times 792$ pt and bleed $b = 9$ pt give

$$
W = w_t + b = 621\ \text{pt},\qquad H = h_t + 2b = 810\ \text{pt},
\tag{8}
$$

the $8.625 \times 11.25$ in file the vendor asks for. The sheet, not the trim, is the page the stylesheet declares, which is why the bleed is recorded separately in the manifest: it tells the overlay and the checks where the trim is without changing what prints.

### 6.2 The boxes of one page

Let $W \times H$ be the sheet, $b$ the in-sheet bleed, $s$ the text safe inset, $a$ the art safe inset (defaulting to $s$) and $g$ the binding allowance (defaulting to $s$), all in points, with the origin at the sheet's top left and $y$ down. For a page side $\sigma \in \{\text{recto}, \text{verso}\}$, the binding is the left edge of a recto and the right edge of a verso. Define the horizontal text insets $(\ell_\sigma, r_\sigma) = (g, s)$ for a recto and $(s, g)$ for a verso, and the art insets $(\ell'_\sigma, r'_\sigma)$ likewise with $a$ in place of $s$. Then the trim, text and art boxes are

$$
\begin{aligned}
\text{trim}_\sigma &= \bigl( b\,[\sigma = \text{verso}],\; b,\; W - b,\; H - 2b \bigr), \\
\text{text}_\sigma &= \bigl( x_T + \ell_\sigma,\; y_T + s,\; w_T - \ell_\sigma - r_\sigma,\; h_T - 2s \bigr), \\
\text{art}_\sigma &= \bigl( x_T + \ell'_\sigma,\; y_T + a,\; w_T - \ell'_\sigma - r'_\sigma,\; h_T - 2a \bigr),
\end{aligned}
\tag{9}
$$

where $(x_T, y_T, w_T, h_T)$ is the trim and boxes are written $(x, y, w, h)$. Figure 3 draws them for a recto of the DriveThruRPG preset. Page 1 is a recto, so odd pages are rectos; the validator chooses $\sigma$ by page parity and the overlay by the viewer's measured side. These boxes are a vendor's absolute constraints, not a design: the classical canons of page construction [[6], [50]] relate margins to the proportions of the page and remain the author's business in the stylesheet; the system only checks that the result stays inside the vendor's lines.

@section .figure

![Diagram of a recto page of the DriveThruRPG preset at reduced scale. The binding edge is marked on the left. A hatched bleed band runs along the top, bottom and right edges between the sheet and the dashed trim line. Inside the trim, a dashed text-safe box and a dotted art-safe box are inset by the labelled distances b, s, a and g. Sample ink shows text inside the safe box, an image bleeding to the sheet edge, and an image stopping inside the bleed band. A legend on the right lists the boxes, the preset's values and the four verdicts.](figures/page-boxes.svg){.gp-full}

**Figure 3.** The boxes of one recto page, equation (9), for the DriveThruRPG preset: sheet 621 × 810 pt, $b = 9$, $s = 36$, $a = 18$, $g = 36$ pt. A verso mirrors the binding and outer insets. {.caption}

@end-section

### 6.3 The verdict on a rectangle of ink

A piece of ink is a rectangle $r$ judged against the box its rule allows: text against $\text{text}_\sigma$, art against $\text{art}_\sigma$. For each edge $e$, read outward so that larger is further out, let $i_e$ be the ink's coordinate and $L_e$, $T_e$ and $E_e$ the allowed box's, the trim's and the sheet's; let $\tau$ absorb layout and PDF rounding (0.5 pt in the validator; the viewer's 1/64 px grid is below it), and write $\hat{L}_e = L_e + \tau$, $\hat{T}_e = T_e + \tau$ and $\hat{E}_e = E_e + \tau$ for the thresholds pushed out by it. The edge passes when $i_e \le \hat{L}_e$, or, for art only, when $i_e \ge E_e - \tau$, because art that reaches the sheet's edge is bleeding there as it should. Otherwise its kind is

$$
\begin{gathered}
\kappa_e = \begin{cases}
\text{off-page} & i_e > \hat{E}_e \\
\text{bleed} & \hat{T}_e < i_e \le \hat{E}_e \\
\text{unsafe} & \hat{L}_e < i_e \le \hat{T}_e,
\end{cases} \\[1ex]
\text{inside} \prec \text{unsafe} \prec \text{bleed} \prec \text{off-page},
\end{gathered}
\tag{10}
$$

and the verdict on $r$ is the worst edge's kind, with the furthest-past edge breaking ties, together with the gap $T_e - i_e$ to the trim and the distance $T_e - L_e$ the rule demands, from which the validator phrases its message ("0.18 in too close to the outside edge"). Art classified as bleed is the case vendors warn about most: an image that crosses the trim but stops short of the sheet can leave a white sliver when the page is cut.

### 6.4 Text boxes from the PDF's own operators

The post-build check cannot ask the engine where text is; it must read the PDF. PDF.js reports each text item as a string, an advance width $\omega$ along the baseline, and the current transformation matrix $[a\ b\ c\ d\ e\ f]$ of the text-showing operator, in points with $y$ up from the sheet's bottom [[43]]. The vector $(a, b)$ runs along the baseline, $(c, d)$ is one em up, and $(e, f)$ is the baseline's start. Because an embedded font's ascent is unreliable, the glyph box is taken as the em split the way PDF.js's own text layer falls back to, 0.8 above the baseline and 0.2 below. The four corners of the item are therefore

$$
\begin{gathered}
\begin{pmatrix} x \\ y \end{pmatrix}
=
\begin{pmatrix} e \\ f \end{pmatrix}
+
\begin{pmatrix} a & c \\ b & d \end{pmatrix}
\begin{pmatrix} \mathfrak{s}\,\lambda \\ u \end{pmatrix}, \\[1ex]
\mathfrak{s} \in \{0, 1\},\qquad u \in \{-0.2,\ 0.8\},\qquad
\lambda = \frac{\omega}{\sqrt{a^2 + b^2}},
\end{gathered}
\tag{11}
$$

which also covers rotated and slanted text, and the item's rectangle is the axis-aligned hull of the four points. The hull $(x_0, y_0, w, h)$ in PDF coordinates becomes $(x_0,\ H - y_0 - h,\ w,\ h)$ in the $y$-down coordinates of (9), and is judged by (10) with the text rule. Images are read from the content stream's `Do` operators and judged with the art rule.

### 6.5 Bleed and marks as a geometry transform

When a stylesheet declares `bleed` and `marks` (descriptors Chromium's parser drops), Tier 2 rewrites the page size and margins so that content stays where the author put it relative to the trim. The transform is arithmetic on the resolved page geometry and costs no measurement, so a book with bleed still prints in a single pass. With trim $w_t \times h_t$, bleed $b$ and slug $\varsigma$ (18 pt when marks are requested, else 0),

$$
\begin{gathered}
W_m = w_t + 2(b + \varsigma),\qquad H_m = h_t + 2(b + \varsigma), \\[0.6ex]
m' = \begin{cases} \varsigma & m = 0 \\ m + b + \varsigma & m > 0, \end{cases}
\end{gathered}
\tag{12}
$$

where $m$ is an authored margin and $m'$ the emitted one. The case split is forced by the clipping fact of Section 4.1: inflating an authored zero would put a white border exactly where the author asked for full-bleed art, so a zero-margin page keeps a slug-only margin and its content box is exactly the bleed box. Margin-box insets are compensated by $b + \varsigma$ so running heads do not drift into the bleed. Post-processing then writes

$$
\begin{aligned}
\text{MediaBox} &= [0,\ 0,\ W_m,\ H_m], \\
\text{BleedBox} &= [\varsigma,\ \varsigma,\ W_m - \varsigma,\ H_m - \varsigma], \\
\text{TrimBox} &= [b + \varsigma,\ b + \varsigma,\ W_m - b - \varsigma,\ H_m - b - \varsigma].
\end{aligned}
\tag{13}
$$

For the in-sheet bleed of Section 6.1 the trim box equals the media box, and the bleed check that compares them is switched off by the preset, because it would warn on every correct file.

### 6.6 Signature padding

Vendors print in signatures and reserve the last page for their own information. For a content page count $n$, a signature size $\varsigma_s \ge 1$ and a last-page mode $\mu$, the number of blank pages the build appends is

$$
\begin{gathered}
p_0 = \bigl( \varsigma_s - (n \bmod \varsigma_s) \bigr) \bmod \varsigma_s, \\[0.8ex]
P(n, \varsigma_s, \mu) = \begin{cases}
\bigl( \varsigma_s - ((n + 1) \bmod \varsigma_s) \bigr) \bmod \varsigma_s & \mu = \text{short-by-one} \\
\varsigma_s & \mu = \text{blank} \ \wedge\ p_0 = 0 \\
p_0 & \text{otherwise}.
\end{cases}
\end{gathered}
\tag{14}
$$

The `blank` mode pads to a multiple of the signature and, when that would add nothing, adds a whole signature so that the last page is always a blank one the build added; `short-by-one` stops at $k\varsigma_s - 1$ pages and lets the printer supply the last. The validation example in the corpus has $n = 3$ content pages under the DriveThruRPG preset ($\varsigma_s = 4$, $\mu = \text{blank}$), so $P = 1$ and the shipped file has 4 pages, which is what Section 8 records;[^pad] a 61-page book would receive 3. The viewer shows the same appended sheets, so the page count an author sees on screen is the page count the vendor receives, and a post-build check asserts the rule against the finished PDF independently.

### 6.7 Ink coverage

Total area coverage is measured per page with Ghostscript's `inkcov` device, which reports the mean coverage of each process ink as a fraction. With $C_p, M_p, Y_p, K_p$ in percent,

$$
\begin{gathered}
\mathrm{TAC}_p = C_p + M_p + Y_p + K_p, \\[0.4ex]
\text{flag page } p \iff \mathrm{TAC}_p > \mathrm{TAC}_{\max} + \tau_{\text{ink}},
\end{gathered}
\tag{15}
$$

with $\mathrm{TAC}_{\max} = 240$ and $\tau_{\text{ink}} = 0.5$ for DriveThruRPG and $\mathrm{TAC}_{\max} = 400$, the physical ceiling of four inks, for the neutral book preset so that the check never fires without a real vendor limit. A Ghostscript failure is reported as "not measured", never as a pass: the record notes a release of Ghostscript that printed nothing without an output target, which an earlier version of the check had read as zero pages and therefore no problems.

### 6.8 Effective image resolution

An image's effective resolution is its pixel dimensions over its placed size in inches,

$$
\begin{gathered}
\rho_x = \frac{72\, N_x}{w_{\text{pt}}},\qquad \rho_y = \frac{72\, N_y}{h_{\text{pt}}}, \\[0.6ex]
\text{flag} \iff \min(\operatorname{round}\rho_x,\ \operatorname{round}\rho_y) < \rho_{\min},
\end{gathered}
\tag{16}
$$

with $\rho_{\min} = 300$ dpi for print presets and $0$ (disabled) for the digital target; rounding tolerates sub-pixel placement noise at the threshold. The record's raster-fidelity measurement through a pdf-lib re-save found images embedded at their exact source resolution (300, 600 and 72 dpi within 2) with every image row byte-identical, so the check measures the author's asset, not an artefact of the pipeline.

### 6.9 Width overflow and shrink-to-fit

Content wider than the printable width makes Chromium scale the whole document down uniformly and silently: the record measured a 1020 px box on an 8.5 × 11 in page scaling every sheet to $0.6666\times$, a 96 px probe printing at 53.15 pt against a 79.73 pt control, with the page count unchanged, so the failure is invisible in the PDF. Because every measurement in Sections 6.2 to 6.8 assumes unscaled points, the compiler audits the laid-out document for boxes wider than the content box $W_c$, estimates the scale the engine would apply,

$$
\kappa = \min\Bigl(1,\ \frac{W_c}{\max_i w_i}\Bigr),
\tag{17}
$$

and fails the build naming the offenders when $\kappa < 1$ unless the author opts in with `--allow-shrink`, in which case each offender is a warning and the book is built eyes open.

### 6.10 The checks

Table 4 groups the 35 registered checks. The print-safety check on CSS runs on a PostCSS tree inside the build (stylelint cannot be compiled into the standalone binary) and rejects remote `url()` values outright, since a font fetched at print time is a dependency no later build can guarantee, warns on properties that force rasterization (`filter`, blend modes, animation), on art a positioned ancestor would clip, on forced breaks written in a form the preview's CSS reader cannot follow, and on a `size` in a stylesheet that the manifest will override. A check's level is one word in the manifest, and a target may require a check to run.

@section .figure

**Table 4.** The validation checks by category and phase. Counts are of registered check modules in the version measured. {.caption}

| Category | Phase | Count | Examples |
|:--|:--|--:|:--|
| Source | pre-build | 11 | markdownlint and HTMLHint wrappers; CSS print safety; CSS ownership contract; dangling links and references; layout-marker diagnostics; alt text and heading order; unusual characters; leftover merge markers |
| Asset | pre-build | 3 | image size and alpha channel; font approval and licence |
| PDF | post-build | 17 | structure; page size (14); safe margins (9)--(11); bleed boxes (13); signature (14); ink coverage (15); image resolution (16); embedded fonts; colour spaces; transparency; PDF/X markers and metadata; black text; bookmarks; TOC links; cross-references; page labels |
| Heuristic | post-build | 4 | text density; section density; decorative layer count; placement variance |

@end-section

## 7 Mathematics in the authoring surface

### 7.1 Why SVG

A scholarly author writes mathematics in TeX, and every Markdown system that handles it uses MathJax or KaTeX. The question for a print pipeline with a parity contract is not whether to typeset TeX but into what. MathJax's HTML-and-CSS output and KaTeX's need math fonts installed or shipped: KaTeX's HTML output needs some twenty font files copied into every project, and a formula's layout depends on whether the building machine has them. MathML output hands layout to the browser's MathML Core implementation [[55]], which Chromium has shipped natively, but its quality depends on a system font with an OpenType MATH table; the project's record notes that on a machine without one, KaTeX's MathML printed broken fractions. Both outputs also lay the formula out at render time in the browser, so an author's preview and a CI server's PDF can differ.

Gutterpress therefore typesets with MathJax [[7], [40]] to SVG at Markdown-render time, with glyphs written as paths and no font cache, so each formula is a drawing that needs no font in the project, no font on the building machine and no stylesheet beyond MathJax's own rules for its containers; it is laid out once, so the preview paginates it exactly as the PDF does; and it is resolution-independent, as a printed formula must be. MathJax's assistive MathML is emitted alongside for screen readers in the preview. Errors are never silent: the `noerrors` and `noundefined` packages are left out, so a formula MathJax cannot typeset renders in red and is reported, with its line and the reason, on the same channel the layout markers use, which the desktop's problems panel and the validator read. A `\newcommand` persists for the rest of the book's render and no further.

### 7.2 Grammar

The dollar grammar is Pandoc's [[38]], as in every markdown-it math plugin: an opening `$` is not followed by a space, a closing `$` is not preceded by a space and not followed by a digit, so "\$5 and \$10" stays prose; `$$` on lines of its own opens a display. The scanner lives in Gutterpress rather than a dependency for one structural reason: the table rule must know where a formula ends, so that a `|` inside `$...$` does not split a table cell, as a `|` inside a code span does not. One scanner serves both; to the table rule a formula is otherwise ordinary text.

### 7.3 A demonstration

The expressions below exercise the constructs an academic or educational author needs: piecewise definitions, nested fractions, sums and products, absolute values, matrices, aligned derivations, operators and blackboard letters. They are also content: equation (18) is the objective TeX minimizes when it breaks a paragraph, which no browser engine implements, and equation (20) is the system this paper's validator solves.

Knuth and Plass [[31]] define, for a candidate line $j$ of natural width $l_j$, stretchability $Y_j$ and shrinkability $Z_j$ set in a measure $L_j$, the adjustment ratio and badness

$$
r_j = \begin{cases}
\dfrac{L_j - l_j}{Y_j} & l_j < L_j \\[1.2ex]
0 & l_j = L_j \\[0.6ex]
\dfrac{L_j - l_j}{Z_j} & l_j > L_j,
\end{cases}
\qquad\quad
\beta_j = \begin{cases} 100\,\lvert r_j \rvert^{3} & r_j \ge -1 \\[0.6ex] \infty & r_j < -1, \end{cases}
\tag{18}
$$

and, with a line penalty $\ell$ and a breakpoint penalty $\pi_j$, the demerits of the line and the objective over a sequence of $k$ breakpoints,

$$
\delta_j = \begin{cases}
(\ell + \beta_j)^2 + \pi_j^2 & 0 \le \pi_j < \infty \\
(\ell + \beta_j)^2 - \pi_j^2 & -\infty < \pi_j < 0 \\
(\ell + \beta_j)^2 & \pi_j = -\infty,
\end{cases}
\qquad\quad
\min_{b_1 < \dots < b_k} \ \sum_{j=1}^{k} \delta_j ,
\tag{19}
$$

omitting their additional terms for flagged breaks and fitness-class changes. The minimum is found by dynamic programming over feasible breakpoints, which is why a TeX paragraph can move a word from its first line to improve its last; Blink's line breaker decides one line at a time and cannot.

Equation (11), written out for a run of text, becomes the linear system the validator solves for every text item on every page of a built PDF:

$$
\begin{aligned}
\begin{pmatrix} x_{\mathfrak{s}u} \\ y_{\mathfrak{s}u} \end{pmatrix}
&= \begin{pmatrix} e \\ f \end{pmatrix}
 + \begin{pmatrix} a & c \\ b & d \end{pmatrix}
   \begin{pmatrix} \mathfrak{s}\lambda \\ u \end{pmatrix},
 \qquad (\mathfrak{s}, u) \in \{0,1\} \times \{-0.2,\ 0.8\}, \\[1ex]
\mathcal{B} &= \Bigl[\min_{\mathfrak{s},u} x_{\mathfrak{s}u},\ \max_{\mathfrak{s},u} x_{\mathfrak{s}u}\Bigr] \times \Bigl[\min_{\mathfrak{s},u} y_{\mathfrak{s}u},\ \max_{\mathfrak{s},u} y_{\mathfrak{s}u}\Bigr] \subset \mathbb{R}^2, \\[1ex]
\mathcal{B}' &= \bigl\{ (x,\ H - y) : (x, y) \in \mathcal{B} \bigr\}, \\[1ex]
\operatorname{verdict}(\mathcal{B}') &= \max_{e \in \{\mathrm{L},\mathrm{R},\mathrm{T},\mathrm{B}\}} \kappa_e(\mathcal{B}'),
\end{aligned}
\tag{20}
$$

with $\kappa_e$ from (10) and the maximum taken in the severity order $\text{inside} \prec \text{unsafe} \prec \text{bleed} \prec \text{off-page}$. For an unrotated item $b = c = 0$ and $a = d$ equals the font size, so (20) reduces to a box of width $\omega$ and height $a$ sitting $0.2a$ below the baseline, the ordinary case; the general form costs nothing extra and makes rotated folios and slanted captions come out right.

Inline mathematics sets in the running text, as in the trapezoidal-rule error bound $\lvert T(1/n) - I \rvert \le 2M / (e^{2\pi\sigma n} - 1)$ for a function analytic in a strip of half-width $\sigma$, or the Euler--Maclaurin coefficient $\tau_k = \frac{B_{2k}}{(2k)!}\bigl[f^{(2k-1)}(b) - f^{(2k-1)}(a)\bigr]$, and in table cells, as Table 5 shows.

@section .figure

**Table 5.** Formulas in table cells. The cell delimiter `|` inside the first row's formula does not split the cell, because the table rule recognizes math spans (Section 7.2). {.caption}

| Expression | Rendered | Note |
|:--|:--|:--|
| `$\lvert x \rvert = \{\, y \mid y \ge 0 \,\}$` | $\lvert x \rvert = \{\, y \mid y \ge 0 \,\}$ | a `\mid` inside a cell |
| `$\sum_{k=0}^{\infty} \frac{x^k}{k!} = e^x$` | $\sum_{k=0}^{\infty} \frac{x^k}{k!} = e^x$ | inline sum and fraction |
| `$\mathbf{A}^{-1} = \frac{1}{\det \mathbf{A}}\operatorname{adj}\mathbf{A}$` | $\mathbf{A}^{-1} = \frac{1}{\det \mathbf{A}}\operatorname{adj}\mathbf{A}$ | bold and `\operatorname` |

@end-section

## 8 Evaluation

### 8.1 Setup and sources of evidence

Two kinds of numbers appear below, and we keep them apart. **Recorded** measurements are those the project's engineering record [[19]] documents, each with the Chromium build it was taken on (151.0.7922.75 unless stated) and the probe that produced it; the spike harness that produced them was deleted with the pre-native-engine scaffolding, so they are one-time measurements, reported here as the record states them. **Fresh** measurements were taken for this article on 30 October 2026 by building the repository's corpus with Gutterpress 0.11.23-alpha.7 (commit `41ab886`) from source under Bun 1.4.4, against Google Chrome for Testing 153.0.8010.12 on a Linux container with the Liberation and DejaVu font families and no others; MathJax 3.2.2 (`mathjax-full`), pdf-lib 1.17.1 and PDF.js through `unpdf` 1.6.2. Ghostscript and qpdf were not available in the container, so the PDF/X hand-off was not exercised fresh. Because the fonts the looks ask for first (Georgia, Latin Modern) are absent, the Liberation fallbacks set every book, and page counts differ from those the record cites for the same books on the authors' machines; parity is a property of one document on one machine, so the comparison is valid as long as both renderers see the same fonts, which they do.

### 8.2 Parity across the corpus

The native parity gate (Section 5.3) was run once over its fourteen registered fixtures: the two example books and the three design-guide manifests that are real, author-written documents, the sample paper, and the minimal repro books that each pin a divergence the gate once caught. Table 6 gives the result. Every fixture came back CLEAN: page counts equal, every instrumented cross-reference target and its folio on the same page, every heading (335 heading ids in all) on the same page on screen and in print. The committed exact-fit fixture, which on the CI font stack reproduces the $+0.02$ / $-0.36$ px boundary of Section 5.4, is CLEAN on this font stack, which the gate's documentation anticipates: the knife edge moves with the fonts, and a clean reading is a pass, never a failure. The whole run, including the browser launch, took 20.1 s.

@section .figure

**Table 6.** Fresh native parity gate over the registered corpus (Chromium 153.0.8010.12, Liberation fonts). Tier is the compiler's classification; pages are print / viewer; ids are instrumented cross-reference targets and headings. {.caption}

| Fixture | Tier | Pages (print / viewer) | Xref ids | Heading ids | Outcome |
|:--|:--:|:--:|--:|--:|:--|
| gutterpress-user-guide (example) | 3 | 97 / 97 | 10 | 183 | CLEAN |
| design-guide (example) | 3 | 55 / 55 | 9 | 102 | CLEAN |
| book-01, book-02 (examples) | 3 | 2 / 2 each | 1 | 1 | CLEAN |
| with-validation (example) | 1 | 3 / 3 | 0 | 10 | CLEAN |
| academic-paper (this article) | 1 | 29 / 29 | 0 | 53 | CLEAN |
| recto-chapters | 3 | 16 / 16 | 8 | 8 | CLEAN |
| section-break | 1 | 15 / 15 | 0 | 24 | CLEAN |
| css-authoring-spike | 3 | 7 / 7 | 6 | 7 | CLEAN |
| gp-image-positioning | 3 | 6 / 6 | 2 | 5 | CLEAN |
| atomic-blocks | 1 | 6 / 6 | 0 | 4 | CLEAN |
| mirrored-margins | 1 | 5 / 5 | 0 | 7 | CLEAN |
| percentage-height-root | 1 | 4 / 4 | 0 | 4 | CLEAN |
| exact-fit-boundary | 3 | 3 / 3 | 1 | 4 | CLEAN (exact fit on the CI fonts) |

@end-section

### 8.3 Cost

Table 7 reports the compiler's own accounting for the Tier 3 books in the corpus: how many times `Page.printToPDF` ran, whether the predicted page map held, and the wall time of the `build()` call on a warm browser, as the median of three runs. Every Tier 3 book converged in one pass with the predicted map holding, so the verification print was the shipped print. The recto-chapters fixture alone printed three times, by construction rather than by a miss: blank planning (Section 4.5) needs one spacer-free measurement before the plan is computed and one print to verify that every forced break landed on its side, and the fixpoint print follows. A book with recto chapters and cross-references therefore costs three prints today, two of which the record's analytic-planning rule requires; folding the planning measurement into the prediction is the obvious next saving. The command-line builds of the same books, cold, including the browser launch, validation, Markdown rendering and asset staging, took 9.0 to 9.4 s for the 97-page user guide, 7.9 to 8.0 s for the 55-page design guide and 6.4 to 6.8 s for the books of two to eight pages, over two runs each; about six seconds of every build is fixed cost, and a 97-page book adds three.

@section .figure

**Table 7.** Fresh compiler accounting on a warm browser (median of three `build()` calls). Prints is the number of `Page.printToPDF` calls; a predicted hit means the first print was the shipped one. {.caption}

| Book | Tier | Content pages | Xref ids | Prints | Predicted map held | Warm build (ms) |
|:--|:--:|--:|--:|--:|:--:|--:|
| gutterpress-user-guide | 3 | 97 | 10 | 1 | yes | 3294 |
| design-guide | 3 | 55 | 9 | 1 | yes | 1921 |
| recto-chapters | 3 | 16 | 8 | 3 | yes | 571 |
| with-print-effects | 3 | 5 | 1 | 1 | yes | 440 |
| exact-fit-boundary | 3 | 3 | 1 | 1 | yes | 463 |
| book-01 | 3 | 2 | 1 | 1 | yes | 402 |
| with-validation | 1 | 3 | 0 | 1 | not predicted | 206 |
| academic-paper (this article) | 1 | 29 | 0 | 1 | not predicted | 1647 |

@end-section

### 8.4 Recorded engine measurements

The record's numbers that bear most directly on the claims of this paper are, in brief: the native engine reproduces plain Chromium's pagination of a 61-page real book page for page (61 of 61), adding only the running heads it synthesizes; the generated corpus paginates 330 of 331 blocks identically on screen and in print, the one difference being an adjacent-page move; the counter-style running-head mechanism replaced page renaming at 4.7 KB against 64.5 KB of generated CSS and deleted 342 lines; neutral measurement cut Tier 3 from four prints to two and from 3.1 s to 1.8 s warm on the 61-page book; margin boxes drop `box-shadow`, `transform`, `opacity`, `outline`, `filter`, `mix-blend-mode`, `clip-path` and `perspective` with a mean absolute pixel difference of 0.0000 against the same box without the declaration, while honouring `text-shadow`, `border-radius`, gradients, `writing-mode`, padding and type properties; a CSS `filter` rasterizes its subtree at 300 dpi, taking a 60-page book from 6.2 s to 57.0 s to print (9.2×), removing its text from the PDF as text, and growing an eight-kilobyte probe to 37 KB with four embedded images, while `box-shadow` and `background-image` cost nothing measurable; and the Ghostscript PDF/X-1a round trip preserves page boxes exactly and text byte for byte.

### 8.5 This article as a specimen

This article is built from two Markdown files, three SVG figures and a one-rule stylesheet by the pipeline it describes, with the bundled `academic` look and `gutterpress-math` feature. In the fresh run it set 29 US Letter pages with 153 formulas typeset to SVG (22 of them numbered displays), 7 tables, 3 footnotes collected before the references and 60 linked references; it is a Tier 1 document (no running strings or cross-reference counters), built in one print in 1.6 s warm and 9.0 s cold from the command line, and its parity gate outcome is in Table 6. The build emitted no warning. Its one build failure during writing is worth recording as a specimen of Section 6.9 at work: three display equations as first written were wider than the 6.5 in content box, by as little as 2 px for a subscript at the right edge of equation (10), and the width guard refused to print rather than let Chromium scale the whole article to fit; stacking them onto two lines was the fix. Building on other machines' fonts found two more. The hidden assistive MathML of a formula ending a justified line, which the browser sets in whatever math font it has, overhung the column by 2 px on the CI machine's fonts; the math feature now holds that copy to its formula's box. One reference URL that fits the column in Liberation Serif does not in Latin Modern; the stylesheet's one rule lets it break. The source, including the SVG figures, is the `examples/academic-paper` directory of the repository, and `gutterpress build examples/academic-paper` reproduces the PDF.

### 8.6 Threats to validity

The fresh measurements are from one machine, one Chromium build and one font stack; parity has been shown to be sensitive to the last two at the sub-pixel level, and the corpus is dominated by US Letter books (the record's A4 counter-example is not a registered fixture). The recorded measurements are one-time and their harness no longer exists; a future milestone bump would require rebuilding it before any of them could be re-checked, which is the main reason the engine is pinned. The corpus is the project's own: real books written by the project's authors and fixtures constructed to pin known divergences, not an independent sample of what authors write. The cost figures are small absolute numbers dominated by Chromium's launch and print, and were not compared against other formatters, because the gates measure parity and regression, not competitive performance. Finally, the system has a single layout engine by design, so every claim here is a claim about Chromium's print path and holds only where that path is available.

## 9 Limitations and open problems

**Knife-edge boundaries are inherent.** A line whose box ends within a fraction of a pixel of the page bottom can paginate differently on screen than in the PDF, for the reason given in Section 5.4; the PDF is always correct, the preview can be a page off after such a boundary, and no constant repairs it. The removal trigger is a Chromium change that gives multi-column fragmentainers the page fragmenter's line rounding.

**Footnotes are endnotes.** `float: footnote` is not implemented by the engine and is not synthesized, so footnotes, this article's included, are collected at the end of the file that contains them by the Markdown footnote extension, which a journal's style would place at the foot of the page. Page-bottom footnotes would need measurement of the note's height and a reservation in the fragmentainer, which is the one Tier 3 problem whose fix moves the content it measures; it is open.

**A per-chapter opener template is not expressible** in standard Paged Media, because `@page name:first` matches the first page of the document, not of a named run. Authors use content padding on the opener instead.

**Filters cost what they cost.** `filter` rasterizes its subtree in Chromium's PDF output; the mitigation is authorial (`box-shadow` where a shadow need not follow a clip path), and the print-safety check names each occurrence.

**Line breaking is the browser's.** No paragraph-level optimization of the Knuth--Plass kind is available, and hyphenation is Chromium's, per the manifest's language tag. Typographic quality at the line is therefore that of the browser, which the project accepts as the price of a single engine; the gap to TeX is real and is not claimed to be closed.

**Formulas are drawings.** A formula typeset to SVG is not extractable as text from the PDF, and whether the assistive MathML survives into the tagged structure has not been measured. For accessibility, the HTML export carries the MathML; the print PDF does not yet.

**Bibliographies are manual.** References in this system are a numbered Markdown list and standard reference links, as this article's are; there is no citation processor, and an author with a reference manager must export the list. Integrating a CSL processor at the Markdown layer is a natural extension that would not touch the engine.

**One engine, pinned.** Everything depends on Chromium 148 or later being present, on the system for the command line or bundled with Electron for the desktop. The pin is deliberate (Section 3.1) and must be raised by hand, with the record's facts re-measured.

## 10 Conclusion

Gutterpress is an argument that a browser's print path can be a book's typesetting engine without being extended, if the tool around it confines itself to three things: an authoring surface in which content stays semantic and design is a cascade of tokens with precedence fixed by layers; synthesis of the few missing Paged Media constructs as standard CSS the engine does execute, measured through the PDF's own destinations and computed analytically rather than iterated; and a parity contract that paginates the preview with the engine's own fragmentation code, keeps every policy in one shared module, gates every change, and classifies rather than patches the one divergence that the engine's two fragmenters inherently produce. Around that core, the arithmetic of print production, trim and bleed and safe areas and signatures and ink, is small enough to be written down in a dozen equations and shared verbatim between the overlay an author watches and the validator a vendor's file passes; and mathematics, typeset once into resolution-independent drawings, paginates the same everywhere. The measurements reported here, recorded and fresh, support the design within the limits stated: on the engine tested, fourteen books and fixtures paginate identically on screen and in print, and the costs are a second or two per book. What the approach does not do, paragraph optimization, page-bottom footnotes, a per-chapter opener template, is stated so that an author can decide whether the trade is theirs to make.

**Acknowledgments.** This article is the sample paper distributed with Gutterpress. It was written in Markdown with LaTeX mathematics and typeset by Gutterpress; its measurements are genuine and its method is stated in Section 8.1.

**Availability.** Gutterpress is free software under the Mozilla Public License 2.0 at github.com/dimm-city/gutterpress. The engineering record cited throughout is the repository's `docs/engine/ENGINE.md` and `docs/engine/DESIGN-RULES.md`; the architectural decisions are `docs/adr/`; the gates are `packages/cli/scripts/native-parity-gate.ts` and `packages/cli/scripts/render-parity.ts`; the shared policy module is `packages/cli/src/engine/shared/`. This article is `examples/academic-paper`.

**Competing interests.** The authors are the developers of the system described.

[^pin]: The floor is the constant `REQUIRED_MILESTONE` in the engine's DevTools client; launching an older browser throws. The record's measurements were taken on 151.0.7922.75, and the fresh measurements of Section 8 on 153.0.8010.12, both above the floor.

[^hit]: In the fresh run of Section 8.3 the user guide converged in one print with the predicted map holding, so the miss the record describes for that book did not recur on the version and font stack measured; every Tier 3 book's prediction held, and the recto-chapters fixture's three prints are the blank-planning measurement and its verification (Section 4.5), not a missed prediction.

[^pad]: The engine reports 3 content pages for the validation example; the command-line build, which passes the preset's signature to post-processing, ships 4. The print-effects example likewise has 5 content pages and ships 8 under the same preset, $P(5, 4, \text{blank}) = 3$.

[1]: #ref-1
[2]: #ref-2
[3]: #ref-3
[4]: #ref-4
[5]: #ref-5
[6]: #ref-6
[7]: #ref-7
[8]: #ref-8
[9]: #ref-9
[10]: #ref-10
[11]: #ref-11
[12]: #ref-12
[13]: #ref-13
[14]: #ref-14
[15]: #ref-15
[16]: #ref-16
[17]: #ref-17
[18]: #ref-18
[19]: #ref-19
[20]: #ref-20
[21]: #ref-21
[22]: #ref-22
[23]: #ref-23
[24]: #ref-24
[25]: #ref-25
[26]: #ref-26
[27]: #ref-27
[28]: #ref-28
[29]: #ref-29
[30]: #ref-30
[31]: #ref-31
[32]: #ref-32
[33]: #ref-33
[34]: #ref-34
[35]: #ref-35
[36]: #ref-36
[37]: #ref-37
[38]: #ref-38
[39]: #ref-39
[40]: #ref-40
[41]: #ref-41
[42]: #ref-42
[43]: #ref-43
[44]: #ref-44
[45]: #ref-45
[46]: #ref-46
[47]: #ref-47
[48]: #ref-48
[49]: #ref-49
[50]: #ref-50
[51]: #ref-51
[52]: #ref-52
[53]: #ref-53
[54]: #ref-54
[55]: #ref-55
[56]: #ref-56
[57]: #ref-57
[58]: #ref-58
[59]: #ref-59
[60]: #ref-60
