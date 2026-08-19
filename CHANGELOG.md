# Changelog

All notable changes to Gutterpress are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **`gutterpress build --allow-shrink`** exposes the engine's existing
  `allowShrink` escape hatch on the CLI. The pre-print width check still
  fails the build by default when a box extends past the page content box
  (Chromium would silently print the whole book scaled down); with the flag,
  the build proceeds eyes-open and every offender is reported as an
  `engine.width.overflow` warning instead. Previously the error message told
  authors to "pass allowShrink", but no CLI spelling of it existed.

- **The editor is a writing surface now: your words, in your book's own type,
  on pages the size they will print at.** Rich mode lays your text out with
  the book's own stylesheet at its own `@page` geometry — real page boxes,
  real margins, real fonts, the chapter-opener badge where print puts it —
  and you type directly into it. Markdown is still the only thing on disk;
  nothing about your project's format changes. The surface is built from the
  same four stylesheet layers the PDF is built from — Gutterpress's marker
  CSS, the `gp-*` utilities, your plugins' CSS, then your own stylesheets, in
  that order — so `.page`, `.gp-columns-2`, `.gp-bleed`, `.gp-pin` and every
  class you wrote look the way they will look printed.
  - It is **not** the print preview and does not claim the preview's
    accuracy: it lays each page out once and leaves it, where the preview
    goes back over its own work and corrects it against what print does.
    That is why the preview — and only the preview — is the surface the
    parity gate holds to the PDF page for page. Expect a break here and
    there to land a page early or a page late. Three causes are recorded in
    `editor/paginate.ts`: an element sized to the whole sheet
    (`@page cover { margin: 0 }`, `.gp-bleed`) cannot fit inside a
    content-box column; a named page that changes the size of the page box
    is skipped rather than approximated; and columns and pages avoid breaks
    differently. Check a layout against the preview, not against the editor.
  - Raw HTML you wrote renders as HTML — 49 blocks of it across the
    first-party books, far too common to show you as escaped source — and a
    `<script>` in a chapter does not run.
  - Generated content is shown but never written back. The `.chapter-opener`
    badge the pipeline injects appears because print shows it, but it lives
    in the view rather than in your document, so it cannot end up saved into
    your markdown.
- **Rich and Markdown are two first-class modes, switchable on any file and
  remembered.** A Rich/Markdown switch sits under the formatting toolbar and
  the choice is saved as the new `editor.mode` setting — **default `rich`**,
  so an existing project opens in the new surface. Switching flushes any
  pending save first, so whichever surface you land in starts from the bytes
  that are on disk. Markdown is the only thing on disk and hand-editing it
  stays a first-class story: source mode is not a degraded second seat, and
  every toolbar action, snippet and lint marker you already use is unchanged
  there.
- **A file the rich surface cannot represent exactly opens as markdown, and
  tells you why.** Footnotes, definition lists, the sub/sup/mark/abbr set and
  any plugin syntax Gutterpress does not model have nothing to become in a
  rich document, so rather than open richly and mis-save your book, that file
  opens in source mode with the reason printed above the editor ("Editing
  this file as markdown — …"). That is the design, not a bug to report:
  measured across all 32 markdown files in the eight first-party example
  books, 31 are rich-editable and the single refusal is a footnote reference.
  It holds for a file that becomes unrepresentable while it is open, too — an
  outside edit that adds a footnote to the file you are in switches it to
  source mode with the reason instead of failing.
- **"Tidy this book's markdown?" — the reformat lands once, deliberately,
  instead of ambushing you chapter by chapter.** Rich mode writes markdown in
  one consistent style, so the first save of any chapter reformats that
  chapter. The first time you open the editor on a book, Gutterpress offers
  to tidy the whole book as one reviewable change and shows exactly what
  would happen: every file it would rewrite, every file it is already happy
  with, and a before/after for each one behind "Show changes". "Decide later"
  is a real answer: it writes nothing, and you are asked again the next time
  you open that book — the offer stops for good once you have accepted it, or
  once there is nothing left to change, and a book already in that style is
  never interrupted at all.
  - Worth knowing before you agree, because it is bigger than bullet
    characters: measured on the first-party books, **27 of 32 files change,
    and the dominant edit is unwrapping** — a hand-wrapped paragraph comes
    back as one long line, because a soft line break inside a paragraph is
    just a space in markdown. Your words are untouched and the printed book is
    identical, but if you hand-wrap your paragraphs you will not get that
    wrapping back, and line-level diffs in your version history get coarser.
  - Re-wrapping instead was measured and rejected rather than dismissed.
    Across 139 real paragraphs and 417 simulated one-word edits, re-wrapping
    at 80 columns nearly doubles the one-time churn (1826 changed lines
    against 1045) and makes an ordinary edit dirty up to 14 lines, where
    leaving paragraphs alone always dirties exactly 2.
  - Nothing is written until you press "Tidy the markdown", and then only the
    files you were shown: a file that changed on disk while the dialog was
    open is skipped and named. Files Gutterpress cannot represent are listed
    as left untouched rather than quietly passed over.
- **Type `/` for a command menu; select text for a formatting bubble.**
  Fourteen slash commands cover headings, lists, quote, code, divider and
  table — and, the reason the menu exists, the layout markers that were
  otherwise buried in a toolbar dropdown: `@section`, a two-column section,
  `@chapter` and `@spread`. Every item runs the same command as the matching
  toolbar button and keyboard shortcut, so the three cannot drift on what
  they insert. `/` opens a menu only at the start of a line or after a space,
  so `and/or`, `http://` and `1/2` are just you typing a slash.
- **What the toolbar inserts is identical in both modes.** Bold, italic,
  strikethrough, inline code, headings, lists, quotes, links, tables, images
  with their `gp-*` position and size classes, and the layout blocks — which
  emit exactly the marker lines you would have typed by hand
  (`@chapter "Chapter Title"`, `@section .gp-columns-2` + `@column-break`).
  A file ends up the same bytes whichever surface built it.
- **Rich mode keeps its place with the preview.** Scrolling the editor moves
  the preview to match, "Go to source" from the preview lands on the right
  block, and clicking an entry in the Problems panel jumps to it — all of
  which speak in source line numbers that a rich document does not have. Each
  block's line is derived from what saving the file would actually write, so
  the numbers stay right as you edit above them instead of drifting.
- **Two-page view drives the editor too.** The toolbar's Single / Two-page
  switch is now one control for the whole workspace: choose Two-page and the
  editing surface shows two pages side by side instead of one. There is no
  second setting to find, and the switch stays usable while the preview is
  still starting, since it now drives an editing surface that does not need
  one. Two things it does not claim: which side of the gutter a page falls on
  — the editor lays out the file you have open and cannot know where that file
  begins in the finished book, so use the preview when you need to see true
  facing pages — and room, because the editor draws pages at their true print
  size and never zooms, so a US-Letter spread is a fixed 1656 px wide, and an
  editing pane narrower than that keeps the single-page stack instead of
  putting half a spread behind a horizontal scrollbar. Drag the splitter wider
  or hide the preview and the spread appears on its own.
- **Blocks can be reordered — with the mouse or without it.** Point at any
  block in rich mode and a grip appears in the page margin beside it; drag it
  and the block moves, with a line showing where it will land. **Alt+Up** and
  **Alt+Down** do the same with no grip involved — the same keys that move a
  line in Markdown mode, so one habit covers both surfaces — and they are the
  reason the grip is allowed to exist at all: a reorder you can only reach by
  dragging is a reorder some authors cannot reach. The nearest movable thing
  moves: a paragraph inside a `@section` moves within the section, a list item
  moves among its siblings, and anywhere inside a table the whole table moves,
  because a table's rows and columns are its structure rather than an order
  you chose. Holding **Ctrl** (**Option** on macOS) while you drop copies
  instead of moving, and either way it is one undo. A block moves among the
  blocks it sits with and no further: drop it over a neighbouring `@section`
  and it lands beside that section, not inside it, so the pointer does exactly
  what the keyboard does and no drop can quietly move your text out of the
  group whose styling it was written for.
  - The grip is chrome, not content. It lives beside the page rather than in
    your document, so it cannot be saved into your markdown, and it is not
    injected between your blocks — a handle rendered inline would break the
    `h2 + p` and `:last-child` rules real book stylesheets are full of (17
    `:last-child` and 14 `h? + p` across the example books), making your text
    jump as the pointer passed over it.

### Removed

- **Breaking, narrowly: `.col-split` no longer selects any behaviour.** It
  existed because Paged.js stripped `break-after: column`, and Paged.js is
  gone; measured on Chromium 153, the native property reproduces the fixed
  split exactly (5 paragraphs left / 0 right with a forced break, against
  3 / 2 when the columns are left to balance). The class survives as an inert
  word you can still style, and `@section .two-column .col-split` still
  splits where you put `@column-break`, so authored books are unaffected —
  what changes is that the renderer no longer wraps each column in a
  `<div class="col">`, so CSS written against that generated wrapper has
  nothing left to select. The editor's "Two columns" snippet now inserts the
  core `@section .gp-columns-2` utility, which is what it should always have
  inserted: `.col-split` never set `column-count` at all, and only appeared
  to work because the wrappers faked the columns.

### Fixed

- **A sync interrupted between merge and checkout can no longer turn into a
  silently pushed revert of other people's work.** A pull lands in two steps
  — `git.merge` moves the branch ref, then a forced checkout materializes the
  merged files — and dying between them (crash, power loss, a file locked
  during checkout) left a repo that looked healthy but whose folder still
  held the pre-merge tree. Snapshot-first then read that stale folder as
  unsaved writing, committed it on top of the merged tip, and the next push
  published a wholesale revert of files the author never touched as a clean
  fast-forward — this is exactly how dc-op-manual's `main` lost the merged
  refactor/native migration (161 files) on 2026-08-16. Sync now journals the
  merge→checkout window (`gutterpress-checkout-pending` beside the existing
  snapshot staging marker) and, before ANY snapshot can read the working
  folder as author intent — sync, manual save, or auto-snapshot — reconciles
  an interrupted window precisely: paths still matching the pre-merge tree
  are re-materialized from the branch tip, while paths the author touched
  after the crash are kept and saved as the real work they are.

- **`@spread` written while a page is still open no longer prints a blank
  sheet.** A spread groups pages, so it can never live inside one — but with
  a `@page` (or its `@section`) still open, the spread wrapper opened inside
  that page, and the very next `@page` sealed it empty; the empty wrapper's
  own forced break then claimed a whole blank page in the PDF (and the pages
  meant to be a spread were not grouped at all). The open page now closes
  first, exactly as `@page` closes its predecessor.
- **The preview honors a page-name change nested inside a named page, and
  resolves `page:` by the CSS cascade.** `![…](…){.gp-bleed}` inside a
  `page: plate` chapter prints on its own zero-side-margin sheet; the preview
  kept it inline, putting every heading after it one page early. And where
  two rules assign different named pages (`h1 { page: chapter }` overridden
  by `.cover-page h1 { page: cover }`), the preview took the first match
  rather than the specific one. It now asks the browser for the computed
  `page` value — the cascade the print engine itself uses. Both were found
  by the new plugin-and-advanced-features fixture the parity gate now runs
  (`docs/fixtures/advanced-book`).
- **A chapter that opens with `@chapter` and then `@page` no longer loses a
  page in the preview.** Print starts a new page there; the preview did not —
  so every page number, running head and `target-counter()` cross-reference
  after that point was one page ahead of the PDF, and the error repeated at
  every chapter in the book. This is the most common structure in a
  Gutterpress book. Measured against Chromium's print engine rather than
  argued about: a forced break propagates outward from a box with no sibling
  before it until it reaches one (CSS Fragmentation 3 §3.3). The preview now
  does the same.
- **Code blocks no longer break a page later in the preview than in the
  PDF.** A book that writes `pre { overflow: hidden }` — an ordinary thing to
  write, and what the user guide writes so that wide code does not leave
  half-empty pages — had every code block that straddled a page boundary
  pushed onto the following page on screen only. Chromium treats such a box
  as unbreakable in the on-screen layout and splits it in print; the preview
  now matches print, at the cost of a shim on the preview alone. With this
  the preview↔PDF parity gate is green on all six books at zero divergences
  with an empty allowlist — the user guide, the largest of them, on the same
  page count, with every heading and cross-reference landing on the same page
  in both.
- **`@media print` rules apply in the preview again.** Rules you wrote inside
  `@media print` were silently dropped from the preview while the PDF honored
  them — all of them, because the code that re-injects those rules for the
  screen had never matched a single one. Rules nested inside `@supports` or
  `@layer` were a second, separate case of the same thing; they now keep
  their wrapper instead of being lifted out of it, so a rule that loses the
  cascade in print loses it on screen as well.

## [0.10.0] - 2026-08-12

### Added

- **Multi-column runs are core vocabulary: `.gp-columns-2` and
  `.gp-columns-3`.** Put a stretch of prose in columns with
  `@section .gp-columns-2` (or the equivalent `{.gp-columns-2}` spelling) and
  set the gutter with `--gp-column-gap`. Previously "put this in two columns"
  meant borrowing a styled container from your book's own component layer —
  which, if that layer decorates `.section` by default, handed you a panel you
  never asked for and a reset rule to take it back. `column-fill` is
  deliberately left unset: only you know whether a given run should fragment
  across pages.
- **Marker arguments accept the `{...}` spelling.** `@section {.gp-columns-2}`
  and `@section .gp-columns-2` are now equivalent on core markers. Plugin
  markers already accepted the braces form, so authors reasonably typed it
  everywhere — and core silently swallowed the whole `{...}` token as the
  marker's *name*, dropping the class with no warning. That is how a
  field-guide chapter rendered wrong for two days.
- **Markers tell you when they don't understand you.** Three new
  author-readable warnings, surfaced in the CLI and the desktop Problems panel
  (click to jump to the line):
  - `unrecognized_marker_token` — an argument that is not `key=value`,
    `.class`, `#id`, or a CSS-usable word.
  - `extra_bare_marker_token` — a second plain word. A marker has one name
    slot, so `@page My Cover Page` used to produce no name at all and three
    classes.
  - `unknown_marker` — an `@word` line nothing consumed, within one edit of a
    marker that exists (typo detection is edit distance ≤ 1).
- **A missing image no longer kills the build.** A referenced file that isn't
  there now renders as a generated magenta/black checkerboard and the build
  warns by name; the rest of the book builds. It used to abort everything with
  `Could not copy asset … ENOENT` — one stale path in a 273-page book and
  nothing rendered, with a filesystem error as the only explanation. The
  placeholder is deliberately loud rather than blank, because a silently
  invisible image is how missing art ships to print. Other copy failures
  (permissions, disk) still fail the build: those are environment faults you
  can't fix by editing markdown.
- **`engine.layer.trapped` build diagnostic** — reports a `.gp-behind` element
  trapped by an ancestor that creates a stacking context, so it can never paint
  behind the page as intended. It inspects the live rendered document's
  computed styles, so it sees wrapper elements regardless of what they're
  called. The faster CSS-source lint (`printsafe/page-containment`) stays for
  the editor's live lint gutter, now with a message that states its own limited
  scope.

- **`gp-*` image positioning vocabulary** in core `GUTTERPRESS_CSS` — composable
  classes authors attach with markdown attrs (`![Art](x.png){.gp-right .gp-small}`):
  - **Positions**: `.gp-left`/`.gp-right` (floats, text wraps), `.gp-center`,
    `.gp-full`, `.gp-bleed`.
  - **Sizes**: `.gp-small`/`.gp-medium`/`.gp-large` (25/50/75% of the column;
    compose with any position and override the floats' 50% cap).
  - **Spacing**: `.gp-tight`/`.gp-loose` clearance presets via the new
    author-settable `--gp-gap` custom property (default 1em — existing float
    layouts are unchanged).
  - **Shape wrap**: `.gp-shape` wraps text to a floated image's alpha
    silhouette (`shape-outside`). The pipeline mirrors the image's src into
    an inline `--gp-shape` custom property at render time, and the build
    inlines it as a data: URI at staging so the printed PDF wraps exactly
    like the preview (shape-outside reads pixels, which `file://` origins
    block — measured and worked around, not guessed). Measured on the
    native engine: shaped pages print as small vector PDFs with extractable
    text — the Paged.js-era "rasterizes entire pages" warning no longer
    applies (guarded by `paged-css-image-shape.test.ts`).
  - **Pin mode**: `.gp-pin` pins an image within its `@page`/`@spread`
    container (centered by default; `.gp-top`/`.gp-bottom`/`.gp-left`/
    `.gp-right` select edges). A new `pin_outside_page` authoring warning
    fires when `.gp-pin` is used outside any `@page`/`@spread` — there the
    image would resolve against the whole document and can print on the
    wrong sheet (the build's `engine.abspos.leak` diagnostic now also covers
    author `gp-*` elements instead of skipping them as engine-internal).
  - Desktop: the image dialog's Position options use the `gp-*` names, with
    a new Size dropdown and a "Wrap text to the image's shape" toggle; the
    preview context menu gained "Set size…" and "Wrap text to image shape",
    and its "Set width…"/"Set position…" now preserve every attribute they
    don't manage (the old rewrite dropped unrecognized classes/ids). The
    class list lives in one shared table (`$lib/editor/image-classes`).

- **Inline editing in the preview** (ADR 0009): the paginated preview is now an
  editing surface, not just a viewer.
  - **Right-click context menu** over the preview, with actions matched to what
    was clicked — image (alt text, width, position, replace), link (edit, copy
    target), selected text (bold, italic, strikethrough, inline code, make
    link), block (insert page break, go to source) and `@marker`. Reachable by
    keyboard via `Shift+F10` / the menu key. Right-clicks on page furniture
    (running headers, page numbers) keep native behavior. Toggled by the new
    `preview.contextMenu` setting.
  - **Click-to-edit block overlay** — "Edit this block" opens the block's
    markdown source in place over the preview.
  - **Click-to-source** — clicking a block in the preview reveals it in the
    editor, opening the editor pane if it is closed.
  - Every edit flows through the existing editor buffer, so saves, crash
    recovery, external-edit conflict handling, and undo behave exactly as they
    do in the editor pane. Only the edited block's bytes change, keeping
    snapshot diffs minimal. When a chapter has unsaved changes or the source
    can't be located unambiguously, actions degrade to "open in editor" rather
    than guessing.
  - Rendered blocks now carry `data-source-range` (markdown-it `token.map`
    verbatim), and the preview bridge is at protocol v5.

- **Publish targets** (ADR 0008): where a book is *published* is now separate
  from how it is *designed*. `targets:` in the manifest (or
  `validate`/`preflight --target <id[,id]>`) names the destinations to
  validate against — `dtrpg` (DriveThruRPG print-on-demand) and `itch`
  (itch.io digital) — and one run checks every destination, labeling each
  finding with its target. Your own manifest settings always override a
  target's policy. `--profile` is replaced by `--target`; the preflight
  report's `profile` field became `targets` with per-target required checks
  (schema v2).
- A **`custom` preset**: for books that aren't a DriveThruRPG title or a 6×9in
  trade book, `preset: custom` takes your own trim via `page.width`/
  `page.height` (points), and tells you exactly what to add when they're
  missing.

### Changed

- **The editor holds the whole book, not one chapter at a time.** Every
  markdown file the book builds from is open at once, in `source.files` order,
  as one continuous manuscript: scrolling runs from the first line to the last
  instead of stopping dead at the end of each file, and a chapter divider names
  each file where it begins. Line numbers restart at 1 in every chapter, so the
  gutter matches what the preview and `gutterpress validate` report.
  - **The editor and the preview now stay in step everywhere.** Scrolling the
    preview across a chapter boundary follows in the editor immediately — no
    file to open, nothing to wait for — and it keeps following while you have
    unsaved changes, which it used to stop doing. Clicking a block, jumping to
    a heading, and opening a problem all land in the same place.
  - Each chapter still saves as its own file, with its own autosave, crash
    recovery, and external-change handling; the status bar now reports the
    whole book's save state rather than just the chapter you're typing in, so
    unsaved work a few chapters back can't look saved.
  - Stylesheets, and markdown files the book doesn't build from, still open on
    their own. Switching between them and the manuscript no longer discards
    anything — your place, undo history, and any pending save all survive.

- Creating a book now asks what you're designing it for — and where it will
  be published. `gutterpress new` requires `--preset <dtrpg|book|custom>`
  (custom also takes `--page-width`/`--page-height`) and records the publish
  targets explicitly (`--targets <ids|none>`, default: the preset's); the
  desktop's new-book dialog has a required preset choice that reveals a
  page-size form when Custom is picked, plus pre-checked publish-target
  checkboxes you can turn off. Both choices are written into the new
  manifest as explicit `preset:` and `targets:` lines; projects scaffolded
  from a saved custom template keep the template's own values.
- Publish targets can be changed later: **Project settings → Details** now
  has the same checkboxes, with the same explanation when a destination needs
  a tool this computer doesn't have.
- The new-book dialog asks for the template FIRST, and the template now sets
  what follows: picking one selects the design preset and publish targets it
  declares, which you can then change. A saved template's own choices show
  pre-filled instead of being hidden, so what the dialog shows is what gets
  written.
- Custom page sizes are picked from common trim sizes (US Letter, trade,
  digest, A4, A5) or typed in **inches** rather than points.
- "Who's writing it?" starts from the name in your settings.
- The settings button opens the start screen's Settings tab — one settings
  surface instead of two, and closing it returns you where you were.
- The bottom bar is regrouped: the book switcher and Problems on the left,
  everything about saving and syncing on the right beside the settings and
  help buttons.
- The left panel is at least 300px wide when open, so project names and
  chapter titles stop truncating (narrower on windows too small to spare it).
- If a chosen destination needs qpdf or Ghostscript and they aren't
  installed, creation says so up front — a print-compliant (PDF/X) file
  can't be built or verified until they are — instead of surfacing it later
  as validation errors. Unchecking the destination (or `--targets none`)
  records the opt-out in the manifest, where it's easy to revisit.

- Your name and email now lead the settings panel's **Accounts** tab (renamed
  from Connections), with your GitHub account directly beneath them — the two
  things that decide who your saved versions are credited to, together and
  first. If either is blank, a notice across the top of the window offers to
  fill them in, and disappears once they are set.
- The welcome screen is now tabbed: **Projects** (continue where you left off,
  plus your books), **Accounts**, and **Help**. It opens on Accounts the first
  time you have no name or email saved, so your history is attributed to you
  from your first save.
- Help moved out of its pop-up dialog onto that Help tab. The help button at
  the bottom right opens it, and closing it returns you exactly where you were.
- A project's own connection details — its online repository, branch, and the
  Test Remote Access check — moved to **Project settings → Connections**.
  Accounts you sign in to stay in the app settings, where they apply to every
  project.
- The two developer settings (file-watcher interval, log level) are a section
  on the Editor tab instead of a tab of their own.

### Removed

- **Breaking: `@section` no longer warns when it isn't inside a `@page`.** A
  bare `@section` is valid authoring, and the warning that said otherwise was
  wrong every time it fired: audited across both real books, all 17 occurrences
  were `@section .gp-columns-2` column runs wrapping flowing prose — exactly
  what the marker is for — and none rendered wrong. A diagnostic that is always
  wrong trains authors to ignore diagnostics. The one real hazard an unwrapped
  section could carry, a `.gp-pin` with no containing block, already has its own
  precise warning. The undocumented `implicitPage` option is gone with it; it
  was reachable from no manifest key, no CLI flag, and no product code path, and
  turning it on would have inserted a page break before every wrapped section.
- **Breaking: CSS sibling combinators work again.** The
  `printsafe/no-pagedjs-crash-selectors` rule is gone along with Paged.js. It
  was an *error*-severity rule, so books that needed `+`/`~` combined with
  `:is()`/`:where()`/`:not()`/`:nth-of-type` had to work around it. Write them
  normally now. If you suppressed that rule ID in your manifest or theme, the
  suppression is dead configuration and can be deleted.

- **The five pre-`gp-*` image utility classes** — `.center`, `.float-left`,
  `.float-right`, `.full-width`, `.full-bleed` — are gone from core
  `GUTTERPRESS_CSS`, replaced by the `gp-*` vocabulary above with no aliases:
  one vocabulary, one way to spell each layout. Migration is a find-and-replace
  in your markdown (`.float-left` → `.gp-left`, etc.); the desktop editor's
  "Set position…" recognizes the old names and rewrites them in place. See
  `docs/migrations/2026-08-gp-image-classes.md`.
- The TTRPG starter template and the TTRPG Supplement theme, along with the
  user guide's TTRPG chapter. Stat blocks, dice notation, and read-aloud boxes
  never needed a plugin or a dedicated template — tables, layout markers, and
  CSS classes cover them, as the rest of the guide shows.
- **Breaking: the native engine's `folio`-prefixed public surface is renamed
  to `gp`/`Gutterpress`, and the deprecated `window.Folio`/`window.folio`
  aliases are gone.** Native is now the only engine — Paged.js itself has
  been deleted; `engine: paged` is still accepted in the manifest but ignored
  (deprecation warning, builds natively regardless). If you hand-authored CSS
  or JS against the native engine's generated hooks, update:
  - `window.Folio` / `window.folio` → `window.Gutterpress` (the aliases have
    been removed, not just deprecated).
  - Every `.folio-*` engine-generated CSS class (`.folio-sheet`,
    `.folio-strip`, `.folio-run`, `.folio-marginbox`, …) → `.gp-*`.
  - Every `--folio-*` engine-generated custom property (`--folio-page-w`,
    `--folio-content-w`, `--folio-margin-*`, …) → `--gp-*`.
  - The `folio--blank` generated `@page` name (for authors styling
    `@page folio--blank {}`) → `gp--blank`.
  - The `folio:layout` window event → `gp:layout`.
  - The `folio:page` window event → `gp:page`, and the matching
    iframe-embed message the viewer posts to its parent changes payload key:
    `{ folio: { page, pagecount } }` → `{ gp: { page, pagecount } }`. If you
    embed a published book in an `<iframe>` and listen for page changes, read
    `event.data.gp`.
  - `folio.js`/`folio-agent.js` were already renamed to
    `gutterpress-viewer.js`/`gutterpress-agent.js` in an earlier prerelease;
    that rename is now final (no alias file).

### Fixed

- **Breaking: sync never asks — it always converges.** Field experience showed
  the interactive conflict machinery was the wrong shape for a small writing
  team: an author hit "This project changed in two places," picked a version,
  and dead-ended on "Couldn't update the online copy" no matter what they
  chose. That machinery is gone. When both sides change the same passage, sync
  completes and keeps BOTH versions in the one file, wrapped in standard
  `<<<<<<< your version` / `>>>>>>> online version` markers — visible in the
  editor and loud in the preview until you blend them (a toast names the
  files). A file deleted on one side but edited on the other keeps the edit.
  A binary file changed on both sides keeps the newer one; for images a small
  non-blocking picker shows both versions side by side afterwards so you can
  swap in the other with one click. Nothing is ever lost — the other version
  of anything remains in Previous versions. Removed with the machinery: the
  per-file conflict dialog, the `(online copy)` side files, the conflict
  status pill state, and the "resolve before exporting" PDF block.
- **Breaking: repair is one automatic pipeline.** The 16-handler recovery
  subsystem (risk policies, backup zips, confirmation dialogs, guidance
  dialogs) is replaced by a single `repairRepo()` that runs silently behind
  the "Tidying up sync…" status: sweep stale locks → clear interrupted
  operations left by other git tools → rebuild a corrupt index → reattach a
  detached HEAD (rescuing stranded work into a branch) → and, only as a last
  resort, rebuild `.git` from the online copy — keeping the old history
  folder on disk (`.git-damaged-<timestamp>`), salvaging every readable
  commit (unpushed versions included) back into the repaired history, and
  never touching your project files. `gutterpress repair` drives the same
  pipeline from the terminal with one y/N prompt.
- **Breaking: `var()` inside `@page` now resolves, or fails loudly — never
  silently wrong.** Two reproduced bugs: a custom property in `@page { size }`
  silently fell back to US Letter, and one in `@page { margin }` silently zeroed
  your margins *and* disabled the shrink-to-fit guard. Custom properties are now
  resolved for the `@page` declarations Gutterpress parses itself (`size`,
  `margin`/`margin-*`, `bleed`), from `:root` in any stylesheet in the set, plus
  `var(--x, fallback)` fallbacks. Anything still unresolvable — or resolving to
  a value that isn't valid geometry — **hard-errors and names the rule and
  declaration** instead of guessing. This is breaking in the sense that a book
  which was silently building at the wrong trim will now stop and tell you.
  Fixed en route: comments between declarations were mishandled, which had been
  silently dropping `var()`-based mirrored binding margins — every page context
  resolved to the same margins, so `:left`/`:right` never mirrored.
- **A stray directory named `.git` no longer captures every project beneath
  it.** The ancestor walk that decides whether a folder lives inside a
  repository accepted anything merely *named* `.git`, so one junk directory high
  in the tree reclassified everything under it — observed with a `/tmp/.git`
  holding a single unrelated file, which made every project under the OS temp
  directory report as versioned and refuse to initialize version history. The
  walk now checks for a real `HEAD`. Classification of the folder you actually
  opened stays lenient on purpose: a `.git` with an unreadable `HEAD` is a
  *corrupt* repository and must route to recovery as damaged, not present itself
  as a fresh folder to set up.

- **"Add to application menu" could leave you launching an old version.** The
  action copies the app you're running, so upgrading and not re-running it
  left the menu opening the previous build — while Settings still said
  "installed", with nothing anywhere explaining why the app never seemed to
  change. Settings now detects it (by recorded version, and by comparing the
  two copies for a same-version rebuild) and offers **Update menu entry**,
  naming both versions.
- Creating a project from any starter template failed in the packaged desktop
  app with a "could not create the project files" error naming a missing file
  inside `app.asar`. The app's own build was inlining a copy of the Gutterpress
  library without the template, theme, and schema files it reads at runtime.
- The welcome screen's Accounts and Help tabs could not be scrolled: anything
  past the height of the window was unreachable, and the footer overlapped the
  panel's text.

- The live preview no longer starts every source file on a new page. It was
  injecting a `.pmd-chapter{break-before:page}` rule that `gutterpress build` has
  no equivalent for, so any project that splits one chapter across several
  source files previewed with different page boundaries than the PDF it
  produced. Preview and build now break only where project CSS or a
  Gutterpress layout marker says to. Measured on a 292-page book whose chapter 2
  spans nine source files: 227 of 293 preview pages previously carried
  different content than the build; now every page carries the same content the
  build puts there.
  Source attribution now annotates existing blocks instead of inserting a
  file-level wrapper, so authored structural selectors see the same element tree
  in preview and build. Eligible edits to one Markdown source rerender and splice
  only that chapter into the live preview; CSS changes, source-list changes, and
  edits that cannot be isolated safely still trigger complete-document
  pagination. Both paths preserve the build's cross-file page flow.

## [0.8.3] - 2026-07-22

### Changed

- The viewer's main toolbar was rebuilt on a modern responsive layout (an
  in-flow three-column grid with container-query collapse stages, extracted
  into its own `AppToolbar` component) so controls can no longer overflow or
  overlap at any window size, from full-screen desktop down to phones. The
  primary actions are now ordered Publish, Export, Save — with Save as the
  right-most button.
- The toolbar's page indicator is now a page picker: clicking "3 / 24" opens
  a dropdown with an entry for every page and the current page selected,
  replacing the type-a-number box.
- Project settings (details, look & style, plugins) moved out of the cramped
  left-sidebar Config tab into a full-screen view patterned after the app
  settings, opened from the toolbar's More menu. The left panel now has four
  tabs: Projects, TOC, Files, and Media.
- On small screens the pane switcher is just Markdown and Preview — the
  defunct style/CSS tab is gone.
- Text-character icons (arrows, check marks, disclosure triangles, stars,
  emoji) across the viewer were replaced with proper SVG icons.
- The toolbar's overflow (⋮) menu is gone: Export now opens an export dialog
  (choose PDF with an optional print-safety validation pass, standalone HTML,
  or save the project as a reusable template), Project settings is a dedicated
  toolbar button beside the editor toggle, Focus mode moved onto the editor
  toolbar (next to snippets, still Ctrl+Shift+F / Esc), and Advanced setup is
  merged into Settings → Connections (all its old entry points land there).
- The page picker's dropdown options are explicitly themed so the list can
  never render unreadable (same-color text on background), and the desktop
  window title now mirrors the open book's title.
- Project settings polish: the manifest's source files are managed with a
  drag-and-drop list (reorder chapters, include/exclude files) instead of a
  textarea, and the collapsible "Advanced" disclosures were flattened into
  always-visible sections.

## [0.8.2] - 2026-07-21

### Changed

- Desktop update checks now follow an explicit **update channel** — Stable
  (default), Beta, or Alpha — chosen under Settings → App → Updates, replacing
  the "Get prerelease updates" toggle. Channels are inclusive downward: Beta
  also receives stable releases, Alpha receives everything. An existing
  prerelease opt-in migrates to the Beta channel automatically.
- The release workflow only accepts `-alpha.N` / `-beta.N` prerelease
  versions (matching the app's update channels; suffixes like `rc` are
  "custom channels" to electron-updater and would strand their users), always
  builds the viewer installers (the `skip_viewer` "RUNTIME release" mode is
  removed — a release without the updater feed files broke update checks),
  and verifies the electron-updater feed (`latest.yml` / `latest-linux.yml`
  present, version-matched, all referenced installers attached) before
  publishing. The Docker publish workflow now runs only via its explicit
  dispatch from the release workflow.

- The library now requires Node 22+ (the oldest currently supported LTS; the
  previous `>=18` floor spanned releases without `AbortSignal.any`, where a
  network deadline could be silently dropped). The release pipeline and
  Docker image now build and run on Node 22 as well. Users of the standalone
  CLI binary and the viewer app are unaffected — both ship their own runtime.

### Fixed

- Connecting or syncing to a plain `http://` remote with a stored credential
  now fails loudly with a dedicated "insecure connection" message instead of an
  endless "reconnect" loop — and "Test connection" obeys the same rule, so it
  can no longer send a token in cleartext (or report Connected while sync
  fails). Recovery no longer deletes the host's credential in that situation,
  and IPv6-loopback (`http://[::1]`) daemons receive credentials as documented.
- A sync interrupted mid-download (network stall + timeout) can no longer
  strand the remote-tracking branch pointing at data that never arrived — which
  previously forced a full re-download and a spurious repair pass on the next
  sync. The interruption guard itself is also tolerant of a damaged ref
  store, so a broken repository can never be blocked from its own repair
  fetch.
- A transient settings-file read error (e.g. a backup tool briefly holding the
  file) no longer causes a settings change to silently reset every other
  setting to defaults.
- Closing the viewer while a version-history snapshot is being committed no
  longer risks killing the commit mid-write (which left the project needing
  repair on next launch).
- Publish tools that hand output to a helper process no longer risk truncated
  output, and every publish command now gets the stalled-network timeout by
  default instead of only where a provider remembered to pass it. The itch.io
  and Shopify API calls (and theme imports from a URL) now time out on a
  stalled connection too, with the same friendly messages.
- When background auto-sync fails, the sync status now shows the actual
  explanation (for example the insecure-address guidance) instead of only a
  generic error state.

### Changed

- Internal consolidation from a follow-up code review: one shared
  spawn/timeout core, one fetch-with-timeout helper, one renderer-send guard,
  one shared HostServices test fixture, fewer redundant sync preflight scans,
  and the PDF inspection cache is now released at the end of each validation
  run. No author-facing behavior changes beyond the fixes above.

## [0.8.1] - 2026-07-17

[Full Changelog](https://github.com/dimm-city/print-md/compare/v0.8.0...v0.8.1) ·
[Release notes](https://github.com/dimm-city/print-md/releases/tag/v0.8.1)

### Fixed

- Sync, clone, push, pull, and publish now time out on a stalled network
  connection instead of hanging forever (and no longer wedge later operations
  on the same project).
- Changing two settings in quick succession no longer risks silently reverting
  one of them, and a malformed settings write can no longer corrupt a section.
- Opening an external link now only accepts `http(s)` URLs.

### Changed

- Internal robustness, dead-code removal, and CI hardening from a code-quality
  audit — see `docs/reviews/code-quality-audit-2026-07-16.md`. No changes to
  author-facing behavior beyond the fixes above.

## [0.8.0] - 2026-07-15

[Full Changelog](https://github.com/dimm-city/print-md/compare/v0.7.1...v0.8.0) ·
[Release notes](https://github.com/dimm-city/print-md/releases/tag/v0.8.0)

### Added

- **Writer-focused editing.** Create, rename, copy, and delete files and
  folders from the project tree; author `@marker` syntax with editor
  completions; resize the editor/preview split; and use focus mode for
  distraction-free writing.
- **Guided publishing.** Publish from the toolbar through a wizard with saved
  credential selection and a preflight step that identifies blocking errors
  and warnings before publishing.
- **Theme package import.** Import themes from ZIP packages, folders, or CSS
  files; preview them before applying; and revert to the previously applied
  theme.
- **More visible project controls.** Added a toolbar Save action, a collapsible
  table of contents, version-history workspace restore, and centralized
  Connections settings.
- **Prerelease update opt-in.** Desktop users can enable release-candidate and
  other prerelease update notifications under Settings → App → Updates.
- Build and preview now surface author-facing layout warnings in their logs.

### Changed

- **Sync status overhaul.** One source of truth now drives sync state and
  guidance, removing misleading status and dead-end recovery paths.
- Replaced the settings dialog with a full-window, tabbed settings view.
- Removed the separate startup splash window; startup now stays within the
  main workspace.
- Decomposed and hardened the desktop host and CLI build, preview, and release
  paths.

### Fixed

- Protected the preload bridge from remotely loaded content, preventing
  untrusted pages from reaching desktop capabilities.
- Prevented editor data loss and corrected errors in saving, configuration,
  sync-conflict, export, publishing, theme import, and table-of-contents flows.
- Enforced theme ZIP size limits before decompression.
- `print-md validate --phase` now rejects unknown phase names instead of
  reporting a successful validation.

## [0.8.0-beta.2] - 2026-07-14

### Added

- **Editor layout controls.** The editor/preview split is now a resizable
  gutter with snap points and keyboard resize (#103), plus a distraction-free
  focus mode (#104).
- **Guided publish preflight.** The publish wizard gained a preflight step that
  surfaces blocking errors and warnings before you publish, with an author
  override (#105).
- **Theme package import.** Import a theme from a packaged ZIP, a folder, or a
  single CSS file, preview it live on hover over a canned sample spread, and
  revert to the previously applied theme at any time (#106).

### Testing / infra

- Added an **advisory** preview re-render latency gate
  (`tests/perf/rerender-latency-gate.mjs`) with the `bench/novel-50p` fixture
  (#107). Its `perf-baseline.json` median is a placeholder until captured with
  `npm run rerender-baseline`.

## [0.8.0-beta.1] - 2026-07-13

[Full Changelog](https://github.com/dimm-city/print-md/compare/v0.7.1...v0.8.0-beta.1) ·
[Release notes](https://github.com/dimm-city/print-md/releases/tag/v0.8.0-beta.1)

### Added

- **Writer-focused editing.** Create, rename, copy, and delete files and
  folders from the project tree; author `@marker` syntax with editor
  completions; and manage a project's look and styles through a clearer
  settings flow.
- **Publishing workflow.** Start publishing from the toolbar, complete a
  guided wizard, and select, switch, or add saved credentials for each
  provider. The CLI can now target a specific saved credential when connecting
  or disconnecting a provider with `print-md publish --account` (keep several
  accounts per provider); publish-time credential selection is driven by the
  manifest `publish.<id>.credential` or the stored default.
- **More visible project controls.** Added a toolbar Save action, a
  collapsible table of contents, version-history workspace restore, and
  centralized Connections settings.
- Build and preview now surface author-facing layout warnings in their logs.

### Changed

- **Sync status overhaul.** One source of truth now drives sync state and
  guidance, removing misleading status and dead-end recovery paths.
- The desktop host and CLI build/preview paths were decomposed and hardened,
  with stronger build, preview, and release verification.
- Removed the separate startup splash window; startup now stays within the
  main workspace.

### Fixed

- Protected the preload bridge from remotely loaded content, preventing
  untrusted pages from reaching desktop capabilities.
- Prevented editor data loss and corrected errors in saving, configuration,
  sync-conflict, export, publishing, and table-of-contents flows.
- `print-md validate --phase` now rejects unknown phase names instead of
  reporting a successful validation.

## [0.7.1] - 2026-07-07

[Full Changelog](https://github.com/dimm-city/print-md/compare/v0.7.0...v0.7.1) ·
[Release notes](https://github.com/dimm-city/print-md/releases/tag/v0.7.1)

### Added

- **Publish providers (#35).** Push a finished book to distribution platforms
  from the new `print-md publish` command (headless/CI-safe: `--dry-run`,
  `--json`, env-var credentials) and the desktop app's Project settings →
  Publish section. Five providers: **itch.io** (direct upload via butler,
  auto-downloaded on first publish), **Azure Static Web Apps** (deploys the
  HTML export via the SWA CLI), **Shopify** (creates/updates the product via
  the Admin GraphQL API), and guided flows for **DriveThruRPG** and **Amazon
  KDP** (no upload APIs exist — print-md validates, stages an upload package
  with a listing sheet, and opens the platform's upload page with a
  checklist). Non-secret settings live in the manifest's new `publish:`
  section; API keys are stored in the OS keychain (desktop) or the `0600`
  user-config credential store (CLI) — never in the project folder.

### Changed

- Code-quality remediation across five refactor phases: dedup, structured
  checks, and breaking up several "god files" into composition roots.
- Preview rendering and ZIP backup now use `fflate`.
- Layout scope management refactored to stack-based frame tracking.
- **Repo-root sessions.** A project is its whole repo: added a book switcher,
  removed dead restore-UI code, and hardened recovery.
- Added a welcome landing screen for the startup and empty states.

### Fixed

- `markdown-it-paged`: chapter labels now propagate to every page, col-split
  depth resets per render (was leaking across chapters), and ambiguous marker
  tokens now warn instead of silently misbehaving.
- `release`: version input is normalized before semver validation.

## [0.7.0] - 2026-07-02

[Full Changelog](https://github.com/dimm-city/print-md/compare/v0.6.2...v0.7.0) ·
[Release notes](https://github.com/dimm-city/print-md/releases/tag/v0.7.0)

### Changed

- **Git recovery overhaul.** Interrupted-operation repair, one shared
  classifier, uniform locking, a library preflight check, and a repair CLI
  command.
- Replaced the custom hot-swap web-UI updater with `electron-updater`.
- Release pipeline and auto-update hardening from a deep review pass.
- The release workflow now dispatches `docker.yml` explicitly — a
  `GITHUB_TOKEN`-authored release never triggers it on its own.

## [0.6.2] - 2026-07-01

[Full Changelog](https://github.com/dimm-city/print-md/compare/v0.6.1...v0.6.2) ·
[Release notes](https://github.com/dimm-city/print-md/releases/tag/v0.6.2)

### Fixed

- Recover from an interrupted rebase/cherry-pick, with a clearer
  guidance call-to-action on the fix screen.

## [0.6.1] - 2026-07-01

### Added

- **Windows installer.** Full releases now attach a Windows `.exe` installer in
  addition to the portable zip, so non-technical users can download one file and
  install print-md without manually extracting folders.

### Fixed

- **Safer sync with open editor files.** The editor now checks the live file on
  disk before saving, refuses to overwrite pulled/externally changed content, and
  surfaces the existing Reload / Keep mine choice instead. Background sync now
  tells the UI when pulled files changed locally, so open buffers and problem
  checks refresh even when the shallow folder watcher misses nested file updates.

## [0.6.0] - 2026-06-30

[Full Changelog](https://github.com/dimm-city/print-md/compare/v0.5.4...v0.6.0) ·
[Release notes](https://github.com/dimm-city/print-md/releases/tag/v0.6.0)

### Added

- **PWA scaffolding (#33).** A File System Access `WebAdapter`, a service
  worker, and offline support laid the groundwork for running the editor in a
  browser — desktop-only for now; full PWA support is tracked separately.
- **Mobile-friendly editor (#34).** A single-column, tab-switched layout
  (Markdown / CSS / Preview) usable down to phone widths.
- **Snippets, project templates, a Plugin Manager, and a Theme Manager**
  (#29, #30, #32).
- **CSS-file picker (#66).** Choose which stylesheet to edit, on any screen
  size.
- View the project's git/sync activity log from the status pill.

### Changed

- **Single standard package.** The library and CLI are now one
  `@dimm-city/print-md` package with no custom build step.
- `FolderRef`/`FileRef` replace raw path strings in the viewer's platform
  contract — groundwork the PWA work builds on (#49, #61).
- Migrated 44 IPC handlers to SvelteKit server routes.

### Fixed

- Sync/build-runner deduplication and a racy-index data-safety fix (#49, #50,
  #52).
- Issue #68 follow-ups: type consolidation, accessibility, UX polish, and
  removal of dead surface area.

## [0.5.4] - 2026-06-22

### Added

- **Definition lists.** print-md now parses the standard PHP-Markdown-Extra /
  Pandoc definition-list syntax — a `Term` line, then a `: definition` line —
  emitting plain `<dl><dt><dd>`. Implemented via the canonical `markdown-it-deflist`
  plugin in the core markdown pipeline (definition lists are not part of
  CommonMark/markdown-it core). Purely additive: content without the `: `
  definition-line syntax renders unchanged.

### Fixed

- **Recovery overlay crash.** The recovery overlay took a prop named `state`,
  which shadowed Svelte's `$state` rune and miscompiled state reads into store
  auto-subscriptions — crashing the overlay with `state.subscribe is not a
  function` in production builds. The prop is now `recoveryState`.

## [0.5.3] - 2026-06-19

[Full Changelog](https://github.com/dimm-city/print-md/compare/v0.5.2...v0.5.3) ·
[Release notes](https://github.com/dimm-city/print-md/releases/tag/v0.5.3)

Maintenance release. No pull requests were listed against this tag; see the
full diff above for the exact changes.

## [0.5.2] - 2026-06-16

### Added

- **Automatic recovery from sync problems.** If print-md ever finds your project
  in a confusing version-control state, it now quietly puts things right — saving
  a backup of your work **first** — and shows only a small "Tidying up your sync"
  message while it does. You're asked to decide **only** when a repair could be
  risky (with a plain-language confirmation that notes the backup), and if it
  can't safely continue it stops and shows simple next steps plus where the backup
  was saved. Your files are never deleted and the online copy is never forced.
- **Compare versions in a conflict.** When the same text file changed in two
  places, the "Changes happened in two places" screen now has a **Compare
  versions** view showing *your version* next to *the online version*, so you can
  choose with confidence. "Keep both" stays the recommended, lossless default.
- **A bottom status bar.** Sync status and a saving indicator ("Saving…" /
  "All changes saved") are now always visible at the bottom of the window, with a
  one-click refresh to **sync now** and a **Save now** action — so you can always
  see, and force, where your work stands.

### Changed

- The Edit toggle now sits to the left of the page-navigation buttons, which stay
  centered in the toolbar.
- Sync and save status moved out of the toolbar into the calm, always-readable
  bottom status bar; the sync indicator reads as plain status text rather than a
  button.

### Fixed

- A healthy, in-sync project opened from a **subfolder** could wrongly be treated
  as damaged and trigger a "repair" — which, in some setups, could exhaust memory
  and crash the app. Recovery now correctly recognises the project's repository
  and only runs for genuinely broken projects.
- Recovery backups are now **streamed to disk**, so backing up a large project no
  longer risks running out of memory.
- The **History** tab and the **Problems** list now refresh after saves, syncs,
  snapshots, and restores instead of going stale.
- The Help window now shows the web UI version without expanding the system
  details.

## [0.5.1] - 2026-06-15

### Added

- **Transparent background sync.** When a project is connected to an online
  repository, print-md now keeps it in sync automatically — pulling teammates'
  changes shortly after you open it and periodically while you work, and sending
  yours up — with no buttons to press. The only thing you see is a small status
  ("Saving changes…" / "Everything is in sync"). You're prompted **only** when
  the same file changed in two places, with plain-language choices: **Keep my
  version**, **Use the online version**, or **Keep both** (the safe, lossless
  default). Auto-sync defaults on for connected projects; a Settings toggle can
  pause it.

### Changed

- **A project is its git repo.** Opening a folder — the repo root or any
  subfolder — now syncs the whole repository (plain Git), removing the previous
  per-book scoping that made the two behave differently.
- The separate manual Sync dialog and the History-tab Pull/Push controls were
  removed in favour of the transparent flow above.
- Substantial internal simplification: the sync engine now decides direction
  with a single merge-base check, and ~2,700 lines of dead/over-engineered sync
  and preview code were removed (behaviour unchanged).

### Fixed

- Auto-sync now pulls promptly when you open a project (previously it could wait
  several minutes).
- The deep-history "phantom New changes online" badge is gone.
- The primary accent colour now meets WCAG AA contrast against white text.
- Windows cross-chapter follow-highlight in the preview.

## [0.5.0] - 2026-06-11

### Added

- **Remote Git, for non-technical writers.** Connect a project to GitHub with a
  one-time device-flow sign-in (OAuth App — every repo you can access is
  visible, no per-repo install). Clone a project, and a book that lives inside a
  larger repo uses that repo's history and sync (multi-book picker included).
- **Workspace UI.** A tabbed left-panel sidebar (Table of Contents, Files,
  Media, Projects, History), an editor toolbar with markdown actions + image
  insert, a Media panel to browse/import/inspect project images, and a Problems
  panel that surfaces lint results in the app.

### Changed

- Sync was rebuilt fetch-first with distinct Pull and Push; "check for updates"
  is now refs-only (no history walk), so it stays fast on large repositories.

### Fixed

- Numerous viewer UX and sync-robustness fixes (responsive toolbar, themed
  scrollbars, render-overlay scoping, full-speed initial render, and more).

> **0.3.x–0.4.x:** no release notes are available for this range, on GitHub or
> here. The [0.5.1 release notes](https://github.com/dimm-city/print-md/releases/tag/v0.5.1)
> record that the project's git and release history was reset at that release
> to remove private material that was never intended for public distribution
> — the corresponding tags and GitHub Releases no longer exist. `CLAUDE.md`'s
> discussion of "milestones 0.4.0 and 0.5.0" and the `0.4.0-beta.4`
> renderer-purity crash (see `docs/adr/0004-platform-abstraction.md`) are the
> only surviving record of what shipped in that range.

## [0.2.1] - 2026-06-04

### Added

- **Viewer: web-UI auto-update.** The desktop viewer now updates its SvelteKit
  UI bundle automatically from GitHub Releases (a separate `web-v*` release
  line, independent of the installer `v*` line). Updates are verified with an
  Ed25519-signed manifest and SHA-256 bundle integrity, downloaded and staged
  in the background, applied via an in-app **"Update ready / Apply now"** banner
  (or on next launch), and protected by a health-gate watchdog that rolls back
  a bundle that fails to boot. A manual **"Check for updates"** control is in
  the toolbar. The Electron shell and the library continue to update via a
  normal installer download.
- **Viewer: System info** now reports the Web UI bundle version alongside the
  Electron shell ("Viewer") version — they can differ after a web-UI update.

### Fixed

- **Viewer: System info** now resolves the library version (previously shown as
  `unknown`).
- **Viewer:** the "You're up to date" notification no longer appears twice on a
  manual check, and no longer fires at all on the silent background launch check
  (it only surfaces a banner when an update is actually staged).

## [0.2.0] - 2026-06-04

- Viewer workflow improvements: static-SPA (`adapter-static`) + `app://`
  architecture with IPC instead of HTTP routes, and PDF export via Electron's
  bundled Chromium. See the v0.2.0 release notes for details.

[0.2.1]: https://github.com/dimm-city/print-md/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/dimm-city/print-md/compare/v0.1.13...v0.2.0
