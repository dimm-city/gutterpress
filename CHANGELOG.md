# Changelog

All notable changes to Gutterpress are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **A failed export now offers its own way forward: "Build anyway"** (#163).
  When the desktop export stops on over-wide content, the message used to end
  with the engine's advice to "pass allowShrink" — a flag that exists on
  `gutterpress build`, and nowhere a desktop author could reach. The failure
  itself now carries the escape hatch: it names the offending elements and
  offers a "Build anyway" button that re-runs the export with the shrink
  allowed. The offer states what it costs — the whole book scales down (a real
  book measured 0.693×, 12pt type printing at 8.3pt) with the page size and
  page count unchanged, so the shrink is invisible in the finished PDF. It is
  deliberately not a standing checkbox in the export dialog: a permanent
  opt-out invites shipping a silently scaled-down book, while an offer only
  exists when a real over-wide element does.

### Changed

- **Your work now uploads in quieter batches** — about every 15 minutes, and
  once more when you close the project or the app — instead of every couple
  of minutes. Changes from your other computer (or a co-writer) still arrive
  promptly: the app keeps checking online every two minutes and merges what
  it finds; only the sending calmed down. This also thins the "Previous
  versions" list: while you type, the in-between checks no longer record a
  version every two minutes — versions are saved when an upload happens, when
  online changes need combining with yours, and by the usual
  after-you-pause-writing automatic backup. Uploading always brings the
  online copy down and combines it first, so it never overwrites work from
  elsewhere — and if the closing upload can't finish within a few seconds
  (say the Wi-Fi dropped), the app still closes; that work is safe on your
  computer and goes online the next time the project opens.

### Removed

- **`gutterpress repair --force` is gone**, along with the app-open check it
  overrode. The desktop used to leave a liveness marker in the project while
  it had it open, and `repair` refused to run when that marker looked fresh
  unless you passed `--force`. The marker carried no actual locking — it
  could only guess, and it failed open — so it stopped a real repair more
  readily than it prevented a real clash. `repair` now simply runs. The
  writes it makes were already serialized per project. Scripts passing
  `--force` should drop the flag.

### Fixed

- **Automatic syncing no longer rolls back the sentence you just typed.**
  A 0.10.0 report — "this latest update erases my most recent edit and states
  'RELOADED FROM DISC' every minute or so" — was real data loss, not a display
  glitch. Sync commits your work before it goes to the network, but the
  network round-trip that follows takes longer than the editor's half-second
  autosave delay, so an edit made *during* a sync reached disk after that
  commit and before the step that syncs your files to the merge result. That
  step overwrote it, and because the edit had never been committed, no
  "Previous versions" entry held it — it was simply gone. It could happen on
  every two-minute automatic sync, to an author working entirely alone:
  0.10.0's always-converging sync made that final step run on every cycle,
  where earlier versions skipped it when there was nothing to merge. Sync now
  commits a mid-sync edit before merging, so it is combined like any other
  change (in conflict markers if it overlaps an online edit), and the step
  that updates your files refuses to overwrite anything it did not just
  commit rather than replacing it. An edit made while syncing can no longer
  disappear.

- **Code blocks and other scrollable boxes now break across pages on screen
  the way they do in print** (#160). The preview paginates with Chromium's
  multi-column fragmenter and the PDF with its paged one, and a scroll
  container (`overflow: auto`, `scroll`, or `hidden`) is monolithic to the
  first and fragmentable to the second — measured, a 192px code block on a
  page with 108px free split across two pages in the PDF and jumped whole to
  the next page on screen. Two shipped example books drifted this way,
  including the user guide, whose own stylesheet asks for code blocks to
  "flow across pages" — which print honoured and the preview did not. Both
  books are now measured by the parity gate so they cannot drift again.

- **A forced page break keeps the following block's top margin** (#160). The
  preview forced its breaks with a spacer that filled the rest of the page,
  which Chromium treats as an ordinary overflow break — and it truncates
  adjoining margins at those. Every chapter opener with a top margin sat
  flush against the preview's page top while the PDF indented it (measured
  48px per opener), and the accumulated difference was enough to shift a page
  boundary.

- **A `break-before: recto` inserts its blank page again** (#161). The blank
  was requested with a break value that landed at the same point as the
  author's own `recto`, where the two combine, the author's value wins, and
  the fragmenter discards the pair — so no blank appeared and every chapter
  after it fell on the wrong side of the spread. The preview was a page short
  of the PDF across the whole book.

- **The over-wide-content error no longer fires on content a clipping
  ancestor already contains** (#162). Chromium's print shrink-to-fit only
  reacts to overflow that ESCAPES, so a wide box sealed inside an
  `overflow: hidden|clip|auto|scroll` ancestor never scaled the book — but
  the build hard-errored on it anyway, and the advice it gave ("give it an
  explicit width") would have changed a layout that was already correct. A
  208-page real book failed this way on two elements while printing
  coordinate-identically with them in place. The check now measures whether
  the overflow reaches past the page content box after its clipping
  ancestors, and content that genuinely escapes still errors exactly as
  before — including the three shapes that only look contained: an abspos
  box under a STATIC clipping wrapper, `overflow-y: clip` beside an untouched
  `overflow-x: visible`, and an `overflow-clip-margin` wide enough to let the
  box back out.

## [0.10.0] - 2026-08-23

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
- **Grid runs are core vocabulary too: `.gp-grid-2` and `.gp-grid-3`.** Where
  `.gp-columns-*` *flows* one run of text down and then across, `.gp-grid-*`
  *slots* each block into the next cell, across then down — so card layouts,
  stat blocks, and image-plus-caption pairs land in fixed positions instead of
  wherever the prose happens to reach. Attach it the same two ways
  (`@section .gp-grid-2` or `@section {.gp-grid-2}`) and set the gutter with
  `--gp-grid-gap` (default `1.5em`). A grid taller than the page is fine: rows
  fragment across sheets and the preview shows exactly what prints — measured
  in Chromium 151 across 2- and 3-column grids, unequal item heights, mid-row
  cuts, and multi-sheet overflow. Two things worth knowing rather than fixing:
  on a page root that fills the sheet, the default `align-content` spreads the
  rows apart to fill it, so add `align-content: start` when you want them
  packed at the top; and a `@page-break` or `@column-break` written *directly*
  inside a grid becomes a cell of its own, so keep it outside (the new
  `break_inside_grid` warning below tells you when you haven't).
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
- **Two more marker warnings, for layout mistakes that used to fail silently.**
  Both are **advisory, never fatal.** Like every other marker warning they are
  reported at *warning* severity — in the build log, in the desktop Problems
  panel (click to jump to the line), and in `gutterpress validate` /
  `preflight`, which exit non-zero only on *errors*. Nothing that built,
  exported, or validated cleanly before will start failing because of them.
  They are new, though, so expect them to speak up about books that have been
  building quietly:
  - `break_inside_grid` — a `@page-break` or `@column-break` directly inside a
    `.gp-grid-*` container. The break becomes a grid cell there: it consumes a
    slot, shifts everything after it, and in the preview puts content on the
    wrong page. Only the innermost enclosing marker counts, so a break inside a
    plain `@section` that merely sits on a grid `@page` is ordinary block flow
    and stays silent.
  - `empty_section` — a `@section` carrying classes or attributes, closed by
    the next `@section` or `@end-section` with no content at all between them.
    Whatever that decoration was meant to style applies to nothing, which is
    exactly the silent failure that once shipped a broken page. Scanned across
    the example corpus with no false positives; all six example books still
    build warning-free.
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

- **`gutterpress build --allow-shrink`** — build anyway when something is wider
  than the page's content area, instead of stopping. That check hard-errors
  because Chromium's answer to over-wide content is to scale the *whole book*
  down to fit the one offending box — rarely what you want, and easy to miss in
  a finished PDF. The flag makes it an eyes-open choice for a single build and
  still reports every offender as a warning. It is per-build on purpose and is
  not a manifest setting: the engine's error has always told authors to build
  anyway if they meant it, and until now there was no way to do so.

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

- **`.gp-flush` — pinned art can sit on the paper's edge**, set from the
  image's own properties (a checkbox in the desktop app's image dialog, or the
  class in markdown: `{.gp-pin .gp-bottom .gp-flush}`). Any edge or corner
  works; a centred pin touches no edge, so the class is inert there.

  A page's margins are not printable area, so nothing can *reach* the paper
  from inside the page — measured in Chromium 148, a pinned box pulled into
  the margin with negative insets fragments onto the NEXT sheet, one moved
  there with a transform is clipped away entirely, and a margin box in a
  near-zero margin does not render under any compensation. The engines
  therefore implement flush as per-page geometry: the compiler aliases that
  page's own context under a generated name (verbatim rule copies — the
  author's named page keeps its margins, background, and furniture) with the
  flushed margins freed, and the viewer applies the same policy in JS. The
  flushed edge's folio and running head are re-drawn inside the page at their
  original coordinates with engine-resolved values, so nothing the author
  declared stops printing. Preview and print are held together by shared
  policy (`engine/shared/flush.ts`) and measured by twin tests on both
  renderers.

- **Inline editing in the preview** (ADR 0009): the paginated preview is now an
  editing surface, not just a viewer.
  - **Right-click context menu** over the preview, with actions matched to what
    was clicked — image (alt text, width, position, replace), link (edit, copy
    target), selected text (bold, italic, strikethrough, inline code, make
    link), block (insert page break, go to source) and `@marker`. Right-click
    anywhere on the paper — including the empty margin band outside the text —
    and the menu opens on the `@page`/`@spread` that owns that sheet, so a
    page's own marker is reachable without hunting for a block to aim at; when
    you right-click inside a `@section`, the enclosing page marker is offered
    alongside it as **Edit page marker…**. Only sheets with no author
    `@page`/`@spread` wrapper keep the browser's native menu. Note that
    margin-box furniture (running headers, page numbers) is painted into a
    hit-transparent layer, so a right-click over it resolves to the sheet
    beneath rather than to the furniture, and furniture text is not
    mouse-selectable in the viewer.
    Reachable by keyboard via `Shift+F10` / the menu key. Toggled by the new
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
    verbatim), and the preview bridge is at protocol v7.

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

- **The preview↔print parity gate stages a book the way a build does.** It
  hand-rolled its own asset copy, so a single stale image reference killed the
  run with a raw `ENOENT` — the one tool that enforces preview↔print agreement
  could not be pointed at a real book — and it skipped the build's `.gp-shape`
  inlining, so it measured a document no build produces. Staging is now shared
  with the renderer: the gate substitutes the same magenta placeholder the
  build does, reports every placeholder and unresolved reference, and measures
  anyway.

- **Marker warnings now name the escape.** A marker is any line whose first
  character is `@` followed by a marker word — including a line your paragraph
  merely *wrapped* onto, which is how a sentence about `@page` splits your page
  in two. There is no new syntax for this (markdown's own `\@page` already
  renders as text, as does `` `@page` ``); what was missing was anywhere that
  said so. The "not something a marker understands" and "several plain words"
  warnings now end with the escape for that marker's own kind, and the user
  guide has a short section on writing about markers without triggering them.

- The desktop start screen shows the logo on its own; the "Gutterpress"
  wordmark beside it is gone. The first-run welcome heading is unchanged.

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
- **Breaking: the classes the layout markers emit are renamed to `gp-*`.**
  If your CSS styles them, rename the selectors — a stale selector silently
  stops matching, it does not error:
  - `.md-page-break` → `.gp-page-break` (`@page-break`)
  - `.md-column-break` → `.gp-column-break` (`@column-break`)
  - `.pmd-continued` → `.gp-continued` (`@continue`). **`.pmd-continued` is
    the name shipped in v0.8.3**, so this is the one most upgrading books
    actually have; `md-continued` and `gutterpress-continued` only existed
    between releases.

  Markers, DOM shape, `data-*` attributes and behaviour are unchanged. See
  `docs/migrations/2026-08-gp-marker-classes.md`.
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

- **Mirrored binding margins now paginate the same on screen as in print.**
  The bound-book idiom — an outer and a binding margin swapped by `@page :left`
  / `@page :right` — was honoured by Chromium when printing but ignored by the
  viewer, which sized its columns from the unqualified page context. Measured
  on a 288-page book with a 0.625in outer and 0.75in binding margin: print
  wrapped text at 7.25in, the preview at 7.375in. An eighth of an inch of extra
  measure per line shortens every paragraph, so the error accumulated — the
  preview drifted one page behind by page 8 and eight pages behind by the end.
  The viewer now resolves both pseudo-page sides and uses the recto box when
  they agree on size, warning instead of guessing when they genuinely differ.
  The compiler half of this bug was fixed earlier in this cycle; the viewer
  half was not, which is why books still diverged.

- **The viewer no longer overrides an author's `break-inside`.** A leftover
  `.gp-strip > * { break-inside: auto }` rule shipped in the viewer's own
  stylesheet, injected after the author's CSS, so it outranked every
  single-class author rule at equal specificity. A block declared atomic split
  across pages on screen while the PDF moved it whole. Removed; a fixture now
  pins the behaviour.

- **`pageOf()` is correct at any zoom.** The viewer measures element positions
  with `getBoundingClientRect()`, which CSS `zoom` scales, and compared them
  against page strides derived from `--gp-content-w`/`--gp-content-h`, which it
  does not — so every lookup was wrong by the zoom factor. Measured at zoom
  0.75: 282 of 316 headings in a real book resolved to the wrong page; at zoom
  1, none did. Because a hot reload re-measures while zoom is applied, any
  author not at exactly 100% saw a corrupted Contents page column after their
  first edit. This fix covers the outline lookup; the same coordinate mixing
  still affects three pagination sites (issue #164).

- **A Contents row with no measurable page now says so.** The page lookup's
  "not found" answer collapsed to `0`, which rendered as an empty cell —
  indistinguishable from a row that simply had no page column. Unresolvable
  rows now show `—`, so a number always means a measured page.

- **The welcome screen opens on Projects again.** A launch-time nudge switched
  the screen to Settings → Accounts whenever the git identity was blank — which
  is precisely the first-run condition, so every new author landed on account
  settings instead of their books. The nudge had been superseded by the
  workspace identity banner and should have been removed with it; the banner
  still carries the prompt.

- **`.gp-pin` reaches the page edges again.** A pinned image (`{.gp-pin
  .gp-bottom}`, a corner colophon, a full-page watermark) was landing against
  the end of the page's *prose* instead of the page itself — a bottom-pinned
  image on a short page sat directly under the last paragraph. The pin
  resolves against its `@page`/`@spread` container, and nothing had sized that
  container to the page since Paged.js was removed: the polyfill used to
  stretch each page root to the page area for free, and the native engine
  replaced it with nothing, so the container shrink-wrapped its text. Both
  renderers now publish the page's content height for the page context an
  element is in (per named page, from the author's own `@page` rules — the
  compiler on `:root` plus every `page:` selector, the viewer on each strip),
  and core CSS sizes page roots to it. Preview and print agree on this by
  construction: the parity gate's divergences on the CSS-authoring fixture
  dropped from 14 to 2, and the forced-break fix below closed the last two —
  the gate now passes every committed fixture with nothing excused, viewer and
  print page counts identical throughout.

- **Right-click reaches an image layered behind the page.** A `.gp-behind`
  image — a full-page plate, a watermark, a background texture — always lost
  the right-click to the text sitting on top of it, so its context menu (alt
  text, size, position, replace) was unreachable at every point on the page.
  The preview now looks through the whole stack under the pointer and picks the
  image behind it, without ever stealing a click aimed at a visible image, a
  link, or margin-box furniture. Keyboard-invoked menus are unaffected.

- **Two-column and spread view no longer go dead on covered pages.** Where one
  run of pages is pulled up over the tail of the previous run, the upper run's
  invisible box blanketed the page underneath: right-click, click-to-source,
  link clicks, and even plain text selection did nothing there — 60 of 60 probe
  points dead in two-column view, all of them healthy in single-page view. The
  viewer's own run and strip boxes are now transparent to the pointer, and your
  content takes the clicks again.

- **A chapter that starts a new page now starts it in the preview too.** When a
  forced break sat on the first thing inside a wrapper — the ordinary shape of a
  chapter opener — the PDF moved the whole wrapper to the new page while the
  preview left its first fragment at the foot of the previous one. The opener
  painted on the wrong preview page, and every cross-reference to that chapter
  showed a page number one too low. The viewer now carries a first-child forced
  break up to the box that actually begins the page, which is what Chromium
  prints. The preview↔print parity gate passes every committed fixture with
  nothing excused.

- **The `engine.layer.trapped` diagnostic stopped crying wolf about clipping.**
  It treated *any* ancestor with `overflow` other than `visible` as defeating a
  `.gp-behind` element, so a sound pinned plate under a page that merely sets
  `overflow-x: clip` was reported as broken — on a real book whose printed page
  was measured pixel-identical to an unclipped one. Clipping cuts; it never
  reorders layers. The audit now warns only when the element's box actually
  crosses a clipping edge, and says how far over it goes. The stacking-context
  half of the check is unchanged.

- The version shown on the start screen, on the Help tab, and in copied problem
  reports was Electron's version rather than Gutterpress's when running an
  unpackaged development build. Installed builds always reported correctly.

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
