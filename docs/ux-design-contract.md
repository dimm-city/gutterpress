# Gutterpress UX Design Contract

> **Status: draft revision** of the contract originally proposed in issue
> [#40](https://github.com/dimm-city/gutterpress/issues/40). Baselined against
> desktop **0.10.2-alpha.3** (2026-08-26).
>
> This document is the normative home of the UX contract. Issue #40 remains
> the tracking issue and links here. **Deviations are proposed as PRs against
> this document**, cross-referenced from the relevant feature issue — not as
> issue comments.

Every feature area below is tagged with its implementation status:

- **SHIPPED** — exists today; the named components/routes are the baseline.
  This contract describes them and may specify refinements as deltas.
- **PARTIAL** — some of the described behavior exists; the delta is called out.
- **PROPOSED** — does not exist. Must be linked to a tracking issue (or
  explicitly marked *not yet scoped — file an issue before implementation*).

---

## Scope

This contract governs the **desktop application** — the Electron app. There
is no PWA/browser target inside this package: the browser host (#33/#34,
`docs/pwa-webadapter-plan.md`) shipped partially, then was deleted rather
than completed (0.11, SFE-P5a, plan D10; see CLAUDE.md §8 and the deletion
ledger's SFE-P5a entry). A future web product would be a separate package
consuming `@dimm-city/gutterpress-editor` and `gutterpress/render`, not a
mode of this application — this contract does not govern it.

**Out of scope:** the CLI (`gutterpress new/build/preview/lint/publish`). The CLI
is the power-user and CI surface (see the repo README: "a desktop application
(with a CLI for power users)") and is governed by `packages/cli/README.md` and
`docs/publishing.md`. Developer users are expected to move between the app and
the CLI; nothing in this contract should assume the app is their only path.

## Architectural constraints (normative, external)

The following documents constrain every pattern in this contract. **Where this
contract and those documents conflict, the architecture documents win.**

| Rule | Source | UX consequence |
|---|---|---|
| Renderer stays PWA-clean; host capabilities via server routes (default) or the Platform seam (push streams, BrowserWindow calls) | `CLAUDE.md` §8 | Theme import file IO, AI/publish network calls, preflight fs checks → server routes. Publish/build **progress streams** → the adapter/IPC push seam. No `node:*` or lib value-imports in the SPA. |
| Preview bridge protocol | ADR 0005 (removed in the 2026-07-29 docs cleanup) | Sync scroll, page navigation, outline, any preview overlay or overflow probe must go through the bridge. |
| Plugins are plain markdown-it plugins; no plugin API; loader never auto-installs | `CLAUDE.md` §5 | Constrains §9 (Plugin manager) below. |
| PDF rendering = Electron `printToPDF` (desktop) / puppeteer-core (CLI); pure-JS tooling posture | ADR 0002 (removed in the 2026-07-29 docs cleanup) | Preflight/export UX; "export" not "download". |
| Git/GitHub operations are Node-native pure JS | `CLAUDE.md` §7 | Project source / sync / provider-auth UX. |
| `$effect` is eslint-banned in the SPA; persisted preferences flow through the settings store's `onSettingsChange()` channel | `CLAUDE.md` §8 | Every persisted preference this contract specs (font size, pane layout, sync toggle, tooltip-seen state). |
| All changes must REDUCE complexity unless properly justified | `CLAUDE.md` Primary Goals | Every PROPOSED item needs a scoped issue before implementation. |

---

## Vision Statement

Gutterpress transforms markdown into beautifully paginated PDFs with zero layout
friction. It meets authors where they work — in prose and in code — and stays
invisible until they need it. The interface disappears into the writing; the
print engine makes the result look professional without requiring design
expertise.

**Design north star:** a non-technical author can open a folder, write in
markdown, and export a print-ready PDF with **P50 time-to-first-PDF ≤ 5
minutes** (see Quality Gates — this is the single canonical number; all other
sections reference it). A developer-level user can fully customize the output
in the app or drop to the CLI.

---

## Target User Personas

| Persona | Name | Goals | Pain Points | Technical Level |
|---|---|---|---|---|
| Self-publisher | Maya | Write novel, export KDP-ready PDF | Word formatting chaos, PDF confusion | Low |
| Indie print creator | Kai | Produce zine/supplement with custom layout | InDesign cost, asset management | Medium |
| Technical author | Sam | Produce a printed manual / handbook / rulebook with consistent styling | Toolchain fragmentation, theme drift | High |
| Indie author | Rosa | Publish across itch.io + Amazon KDP | Format juggling, proof corrections | Low–Medium |
| Power user | Dev | Automate, extend, build plugins | Black-box tooling, no escape hatches | Developer |

Notes:

- Sam was previously "Technical writer — document APIs". API-reference
  documentation is a web-docs use case outside the repo's print-materials
  goals (no example, guide chapter, or issue targets it) and is **out of
  scope**. The persona is re-grounded in what the repo demonstrates
  (`examples/gutterpress-user-guide` is itself a printed manual).
- Dev's happy path may be the CLI (see Scope); app UX for Dev means escape
  hatches and inspectability, not replicating the CLI in the GUI.

---

## Information Architecture

### Screen inventory

Statuses reflect 0.8.0-beta.1. Names in parentheses are the shipped
components/controllers.

```
gutterpress/
├── Welcome / start screen                     SHIPPED  (WelcomeLanding: Projects / Settings / Help
│                                                        tabs — continue card + recents/favorites/
│                                                        discovered via ProjectsListBody, the WHOLE
│                                                        settings surface, and in-app help)
├── New project wizard / templates             SHIPPED  (NewProjectWizard, #25; templates from the
│                                                        shared lib scaffolding — see Onboarding)
├── Open dialog (recents/favorites, URLs)      SHIPPED  (#10, #27)
├── Editor Workspace
│   ├── Left panel — 5 tabs                    SHIPPED  (LeftPanel: Projects, TOC, Files, Media, Config;
│   │                                                    Cmd/Ctrl+\ toggle; overlay at ≤820px)
│   ├── Markdown editor                        SHIPPED  (MarkdownEditor, CodeMirror 6, #38)
│   ├── CSS editing                            SHIPPED  (language mode of the same editor —
│   │                                                    css-editor.ts, #39; NOT a separate panel)
│   ├── Live paginated preview                 SHIPPED  (PreviewFrame + preview bridge)
│   ├── Editor toolbar                         SHIPPED  (EditorToolbar, #31; SnippetPicker, #29)
│   ├── Page navigation                        SHIPPED  (PageNavController toolbar pager + TOC outline, #20)
│   └── Page thumbnail navigator               NOT PLANNED (evaluated 2026-07-14 — the
│                                                        shipped pager + TOC outline cover navigation)
├── Problems panel                             SHIPPED  (ProblemsPanel, #28)
├── Publish workflow                           SHIPPED  (PublishWizard + Connections, #35; see §6 for
│                                                        proposed deltas: preflight checklist, history)
├── Plugin manager                             SHIPPED  (Config panel → PluginsSection, #30)
├── Theme selector / importer                  SHIPPED  (Config panel → "Look & style" theme grid, #32)
├── Design tokens editor                       SHIPPED  (DesignSection: guided :root custom-property editor)
├── Project source / version history / GitHub  SHIPPED  (#12–#16, the Node-native git layer; AdvancedSetupDialog,
│                                                        GitHubDialog, sync status)
├── Media panel                                SHIPPED  (MediaPanel, #47)
├── Crash recovery                             SHIPPED  (RecoveryOverlay / CrashRecoveryDialog)
├── Settings                                   SHIPPED  (SettingsView, embedded in the start
│                                                        screen's Settings tab: App / Editor /
│                                                        Saving / Accounts)
├── Visual layout editor                       PROPOSED (#37 — milestone placeholder; sub-issues first)
└── AI Assistant                               PROPOSED (#36)
```

Document theming ("Look & style", design tokens, stylesheets) lives in the
**project Config panel**, not Settings — app appearance and print theme are
deliberately separated concepts; do not merge them back.

### Navigation model

- **Desktop (SHIPPED baseline):** LeftPanel (5 tabs) + toolbar. Right-hand
  preview pane. Global shortcuts: see the Keyboard shortcut map below.
- **Command palette — evaluated, not planned (2026-07-14):** menus + the
  shortcut map cover the app's actions today; revisit only if the action count
  outgrows them. `Cmd/Ctrl+Shift+P` stays reserved should it return;
  `Cmd/Ctrl+K` remains reserved for insert-link.
- **Narrow / mobile (SHIPPED):** ONE breakpoint at **820px**
  (`NARROW_BREAKPOINT`, `mobile-layout.ts`, #34): below it the workspace is a
  single column with a **Markdown / CSS / Preview** tab bar, keyboard-aware
  via `visualViewport`. Any multi-tier breakpoint proposal is a PROPOSED
  change to this shipped behavior and needs an issue.
- **Mobile primary navigation (PWA) — REMOVED (0.11, SFE-P5a, plan D10):**
  described a Write/Preview/Files/Settings tab set for the now-deleted
  browser host. No PWA/browser target exists in this package (see Scope
  above); a future web product would define its own navigation model.

### Keyboard shortcut map

New bindings must not conflict with this table. (Shipped source:
`shortcuts.ts` / `save-shortcuts.ts`.)

| Shortcut | Action | Status |
|---|---|---|
| `Cmd/Ctrl+,` | Settings | SHIPPED |
| `Cmd/Ctrl+E` | Toggle editor pane | SHIPPED |
| `Cmd/Ctrl+\` | Toggle left panel | SHIPPED |
| `Cmd/Ctrl+S` | Save now | SHIPPED |
| `Cmd/Ctrl+Shift+S` | Snippet picker | SHIPPED |
| `Cmd/Ctrl+Shift+E` | Export PDF | SHIPPED |
| `F` (preview focused) | Fit width | SHIPPED |
| Arrows / Home / End / `+` / `-` (preview) | Page nav / zoom | SHIPPED |
| `Cmd/Ctrl+K` | Insert link | PROPOSED (reserved; the markdown-editor convention) |
| `Cmd/Ctrl+Shift+P` | Command palette | NOT PLANNED (evaluated 2026-07-14; stays reserved if it returns) |
| `Cmd/Ctrl+Shift+F` | Focus mode | PROPOSED — **#104** (**not** F11: F11 is OS/Chromium fullscreen on Win/Linux and Show Desktop on macOS) |

---

## Interaction Patterns by Feature Area

### 1. Editor + Preview split pane

**Status: SHIPPED baseline** (#38 editor, #34 responsive collapse,
`EditorPreviewSyncController` sync) with PROPOSED refinements.

Reference research: iA Writer (focus mode, zero chrome), VS Code (split
editor), Typora (source/preview toggle), Ulysses, Bear.

Shipped baseline:

- Editor + paginated preview side by side; single collapse breakpoint at
  820px → Markdown / CSS / Preview tabs (see Navigation model).
- **Synchronized scroll is SHIPPED and bidirectional**: editor→preview
  anchor-line follow and preview→editor follow via `sourceLineChanged` /
  `scrollTo({line, chapter})` over the preview-bridge protocol, with cross-chapter
  reveal and echo suppression. Remaining delta (PROPOSED): a user-facing
  toggle to disable sync, persisted via the settings store.
- **Click-to-source follows across chapters — SHIPPED, deliberate** (owner-
  ratified 2026-08-26): a single click on any source-mapped block, with the
  editor pane open, loads that block's chapter into the editor — switching
  files if needed, flushing the outgoing buffer first so nothing is lost —
  and reveals the line without stealing the caret or selection. The editor
  follows the author's attention; this is the intended contract, not a
  side-effect.
  - Mapping spec (for reference and for any rework): block-level
    `data-source-line` anchors from markdown-it token maps; after pagination
    the preview scrolls to the page containing the nearest preceding mapped
    block. Content with no direct mapping (generated content, running
    headers) falls back to the nearest mapped ancestor.
- PDF export via `Cmd/Ctrl+Shift+E` → native save dialog →
  `webContents.printToPDF`.
- **Auto-save is SHIPPED and works as follows** (do not respecify): debounced
  disk save 500ms after the last edit (`EditorBuffer`), crash-recovery
  snapshots at 1000ms, a user setting ("Save edits automatically",
  default 500ms), plus explicit `Cmd/Ctrl+S` / toolbar Save. The save
  indicator is subtle (no modal) — see Anti-Patterns.

Proposed refinements:

- Resizable gutter with snap points **25/50/60/75** (60/40 is the 900–1279px
  default, so it must be a snap point) plus double-click-gutter →
  reset-to-default. Gutter is keyboard-adjustable (Arrow keys when focused)
  — this is also the WCAG 2.2 SC 2.5.7 single-pointer alternative.
  Tracked in **#103**.
- Focus mode (`Cmd/Ctrl+Shift+F` / dedicated button): hides all chrome except
  the editor; must compose with the existing pane/panel toggles.
  Tracked in **#104**.
- Typora-style seamless WYSIWYG as an opt-in toggle — never the default;
  explicit source/preview is the default because print layout fidelity
  matters.
- Avoid: forcing permanent single-pane mode; auto-hiding scrollbars that
  cause layout shift.

### 1b. Inline editing in the preview

**Status: SHIPPED in 0.10.0, then PARTIALLY REMOVED in 0.11 (SFE-P4,
2026-09-01).** Originally tracked by **#135** Tier 0 and **#136** Tier 1;
implementation plan `docs/inline-editing-plan.md`, rationale
`docs/adr/0009-inline-editing-source-ranges.md`.
**Correction 2026-09-01:** the source-mutating half of this section —
the context menu's mutation items (image properties/unwrap, link edit,
marker/page-marker edit, block-break before/after, selection formatting,
make-link) and the "Block overlay" ("Edit this block", double-click-to-edit)
described below — was **deleted** in SFE-P4; see the deletion ledger
(`docs/plans/source-first-editor/deletion-ledger.md`, "SFE-P4" entry) for
the measured proof. The preview is now **read-only**: navigation
(click-to-source), selection/copy, open link/image, diagnostics, page
controls, and source reveal only (plan D8). Those mutation affordances'
replacements live in the source and shared rich editor commands, not the
preview. The rest of this section (click-to-source, the read-only context
menu items) remains current; do not treat the mutation items or the block
overlay below as live product behavior.

The paginated preview is an editing surface, not only a viewer. This does
**not** supersede the opt-in WYSIWYG rule above: these are explicit,
user-invoked actions on a specific target, not a seamless typing surface.
The source pane remains the default editing model.

Shipped behavior:

- **Click-to-source.** Clicking a block in the preview reveals it in the
  editor, opening the editor pane if it is closed. Always on — navigation,
  not mutation.
- **Context menu** on right-click, with items matched to the target:
  image (alt text, width, position, replace, reveal in Media panel), link
  (edit, copy target), selected text (bold, italic, strikethrough, inline
  code, make link), block (edit this block, insert page break
  before/after, go to source), and `@marker` (edit marker, go to source).
  The block and `@marker` menus carry one further item, **"Edit page
  marker…"**, placed last before "Go to source": it edits the marker line
  of the `.page`/`.spread`/`.chapter` enclosing the point, and is offered
  only when that line is not already the primary target — the same chapter
  plus an identical source range suppresses it, because the primary items
  edit that line already. Without it the enclosing `@page` marker is
  unreachable from inside a `@section`, whose innermost annotated block
  always wins the primary slot. A preview that does not report the
  enclosing marker (older than bridge protocol v7) offers no such item.
  Gated by the `preview.contextMenu` setting, default on.
- **Block overlay.** "Edit this block" opens that block's **markdown
  source** in place over the preview; commit on `Ctrl/Cmd+Enter` or blur,
  cancel on `Escape`.

Rules (normative):

- **Keyboard parity is required, not optional.** `Shift+F10` / the menu key
  opens the menu, satisfying the Accessibility checklist's "context menus
  reachable via keyboard menu key / `Shift+F10`". The listener necessarily
  lives inside the preview iframe — keystrokes focused in a cross-origin
  iframe never reach the SPA, so an app-side listener cannot satisfy this.
- **Page furniture keeps native behavior; the empty margin band does not.**
  A right-click whose top-most hit element is inside a margin box (running
  header, page number — any `.gp-marginbox`) resolves to no target: the
  menu does not open and the native one is not suppressed, so that text
  stays copyable. That check runs before both probes below, so furniture
  wins over anything layered beneath it. A right-click that lands inside a
  sheet's box but resolves to no annotated block — the empty margin band
  around the content box — MUST instead resolve to the annotated
  `.page`/`.spread` that owns that sheet (the wrapper with the greatest
  rect overlap with it), and open that marker's menu: the `@page` marker is
  reachable from anywhere on its paper, not only from the content box. A
  sheet whose page has no author `@page`/`@spread` wrapper keeps native
  behavior. Note that the viewer draws its own margin boxes
  into the hit-transparent sheet layer (next rule), so they are not
  normally in the hit stack at all and a right-click over one falls through
  to the margin-band rule; the furniture check governs the case where
  furniture is hit-testable.
- **Only author content captures pointer hits.** The viewer's own chrome —
  runs, strips, sheet layers, and the sheets and margin boxes they hold —
  is pointer-transparent, and author content re-enables hits. Chrome must
  never win a hit for pixels it does not paint: a run pulled up over the
  previous row in a wrapped/spread composition blankets the page beneath
  it, and while that box captured hits, right-click, click-to-source, link
  clicks, and text selection were all dead on every covered page.
- **Content layered behind the page stays reachable.** Target resolution
  probes the whole hit stack, not only the top-most element, and prefers
  the top-most image under the point whose **computed** z-index is negative
  — the `.gp-behind` depth ladder, or any book CSS that layers an image
  behind, since the test is the computed value and never the class.
  Otherwise such an image has no reachable right-click point anywhere. Only
  negative-z images qualify — stealing a covering block's
  right-clicks for a normally layered image would invert the bug — and a
  directly hit image, link text, or margin box is never probed beneath. The
  keyboard path targets top-most-only: its anchor is a synthetic
  block-center point, not a place the author aimed at.
- **Never guess an edit.** When a chapter has unsaved changes, or the
  rendered selection cannot be mapped back to source unambiguously, the
  affected item is **disabled with a stated reason** and the author is
  directed to the editor. A wrong edit in an author's book is the worst
  outcome this surface can produce; a refused action is always preferable.
- **No destructive items** while an unmounted editor means no undo. Marker
  removal is deliberately absent from v1.
- Edits flow through the same buffer as the editor pane, so save,
  crash-recovery, external-edit conflict handling, and undo (when the
  editor is mounted) are identical.

Deferred, with tracking issues: **touch long-press invocation** (the
Accessibility checklist's "long-press on touch" applies once the menu
reaches touch layouts — it is not registered there in 0.10.0); Tier 2
editor-pane live preview, which remains governed by the opt-in WYSIWYG
rule in §1.

Anti-patterns: opening a menu with no keyboard path; suppressing the
native menu without offering a replacement; silently applying an edit
whose source location was inferred rather than verified.

### 2. Toolbar

**Status: SHIPPED baseline** (`EditorToolbar`, #31 — fixed compact bar above
the editor with a container-query "More" overflow popover; `SnippetPicker`,
#29 — dialog via toolbar or `Cmd/Ctrl+Shift+S`, project `snippets/` folder,
`{{variable}}` prompting, save-selection-as-snippet).

Rules (shipped + refinements):

- Grouping: Format / Insert / View. Visible icon count is **per-breakpoint**:
  `floor(available width / 44px) − 1` (overflow affordance), capped at 9 on
  desktop. Overflow strategy is one mechanism per input class: overflow menu
  on pointer layouts; horizontal scroll with edge-fade on touch (no nested
  menu above a keyboard). These are mutually exclusive — never both.
- Keyboard model (**ARIA toolbar pattern**, and the Accessibility checklist
  uses the same words): the toolbar is a single Tab stop; Arrow keys move
  between buttons; Tab exits; `Enter` **or `Space`** activates.
- Icon-only buttons: `aria-label` always; tooltip on pointer devices; on
  touch (where hover doesn't exist) long-press reveals the label, or labels
  render under icons where space allows.
- PROPOSED (not yet scoped): selection-state inline formatting popover;
  slash-command menu (`/` at line start or after whitespace only — see §7 for
  the trigger rules). Both are alternatives to shipped interactions and need
  issues.

Anti-patterns: toolbars that obscure content on scroll; unlabeled icon-only
buttons.

### 3. Mobile / PWA editor UX

**Status: REMOVED (0.11, SFE-P5a, plan D10).** Previously tracked in #33
(closed, PR #63) and #34 (closed), with normative implementation detail in
`docs/pwa-webadapter-plan.md`. That implementation — the `WebAdapter` browser
host this section specified against (write-first tab layout, keyboard
toolbar, offline app-shell precache via `service-worker.ts`) — shipped
partially, then was **deleted rather than completed**: `packages/desktop` is
an Electron-only product now, with no dormant browser host inside it. A
future web product is not a mode of this package — it is a **separate
package** consuming `@dimm-city/gutterpress-editor` and `gutterpress/render`,
built new against those public surfaces rather than by finishing this
deleted adapter. `docs/pwa-webadapter-plan.md` is closed and kept as
history, not as a normative spec to reconcile against; the deletion itself
is recorded in the deletion ledger's SFE-P5a entry
(`docs/plans/source-first-editor/deletion-ledger.md`). The narrow/mobile
**desktop** window layout (820px breakpoint, §1 above) is unaffected — it is
shipped Electron behavior, not PWA-specific.

### 4. Onboarding — progressive disclosure

**Status: PARTIAL** (#25 wizard + templates, #27 project finder,
`WelcomeLanding` shipped 2026-07-06; contextual tooltips PROPOSED).

**Layer 1 — first run (SHIPPED baseline):**

- `WelcomeLanding`: three tabs — **Projects** (continue card with live
  pre-render status + recents / favorites / discovered projects),
  **Settings** (the entire settings surface, sub-tabs and all — there is no
  separate settings window), and **Help**. It always opens on **Projects** —
  picking or continuing a book is the screen's job. A missing name/email is
  raised by the workspace's standing identity banner, never by sending the
  start screen to Settings → Accounts.
  `NewProjectWizard`: template first (**3 built-in templates** — Book, Zine,
  Technical document — plus custom templates, save-as-template,
  import-from-folder), and the chosen template seeds the book's design
  preset and publish targets (ADR 0008), both of which stay editable.
- Templates come from the **shared lib scaffolding** in
  `gutterpress` (same set behind `gutterpress new`; CLAUDE.md §7 "one
  implementation, two thin front-ends") — the picker is a front-end over the
  lib, never a desktop-only template store.
- PROPOSED: additional curated templates (Novel, Resume, Chapbook,
  Rulebook…). Whatever the final count, **each shipped template carries
  annotated comments in both markdown and CSS**; at minimum the templates
  matching Maya, Kai, and Sam are fully annotated at launch. (This replaces
  the earlier conflicting counts: "3 personas" / "6–8 templates".)
- No feature-tour modals; the user lands in the editor with the template
  loaded.

**Layer 2 — contextual help (PARTIAL):**

- In-app help (shortcuts + workflow docs) is SHIPPED, as the start screen's
  **Help** tab (`HelpContent`, reached from the status-bar help button; the
  former `HelpDialog` modal was retired 2026-07-30). PROPOSED:
  per-panel "?" entry points opening the in-app help drawer (never an
  external browser tab), and hover/focus tooltips shown max once per session
  per control (tooltip-seen state persists via the settings store).
- Empty states: Problems panel and Publish panel have specified empty states
  (see §6/§10); every new panel must define one.

**Layer 3 — soft emphasis (NOT hiding):**

- Advanced features are **de-emphasized, never hidden or disabled**: a
  collapsed/badged "Advanced" menu grouping until the first successful PDF
  export, tracked per app installation in desktop prefs (userData), after
  which the badge (not the item) disappears. Everything stays reachable via
  menus at all times — hiding would contradict
  the Dev persona's "no escape hatches" pain point and would **regress
  shipped, ungated features** (#30 plugins, #32 themes).
- The **Theme selector is core to a good first PDF and is never gated**; only
  power-user surfaces (theme importer, visual layout editor #37, AI #36) get
  the Advanced badge.
- Settings tabs are the shipped **App / Editor / Saving / Accounts**; the
  former "Advanced" ("for developers") tab is a section on Editor, and the
  whole surface lives on the start screen's Settings tab rather than in a
  window of its own (one settings surface, reached from the status bar's
  settings button or `Cmd/Ctrl+,`). Any further regrouping is a PROPOSED
  delta.

Anti-patterns: full-screen onboarding carousels; auto-advancing tours; empty
workspaces with no guidance; requiring account creation (there are no
accounts — see Anti-Patterns table).

### 5. Print / layout tool UX

**Status: PARTIAL** — page navigation #20 and pre-export readiness #24 are
shipped; the visual layout editor is **#37 (open)**.

Reference research: InDesign/Affinity (preflight, master pages), Scribus
(what to avoid).

From print tools, keep: page navigation for long documents; non-destructive,
always-revertible CSS overrides; preflight before export. Avoid: tool-mode
switching (markdown-first, not canvas-first); floating panels that lose
position; modal dialogs for live-editable properties (page size/margins);
exposing low-level engine concepts to non-technical users.

**Preflight (PROPOSED — tracked in #105; engine is SHIPPED):** the panel is a desktop
UI over the **existing check registry** (`packages/cli/src/checks/`: font
refs/licensing, broken local refs, heuristics, alt text, heading order,
print-safety CSS; post-build PDF checks — embedded fonts, page size, ink
coverage — per the printToPDF/pure-JS posture), exposed via a server route. It extends the shipped
#24 readiness check; it is not a parallel subsystem. Check tiers:

1. live (debounced ≥1s): metadata fields, link syntax;
2. on file save / asset add: file existence, image dimensions;
3. on opening the Publish panel or on demand: render-dependent checks (ToC,
   overflow) and post-build PDF checks (these require a built PDF and, for
   PDF/X, external qpdf/gs — they can never run per keystroke).

**Master pages / page templates (PROPOSED):** a UI over the **existing
`@page` / `@section` / `@chapter` markers** (`markers.js`, CLAUDE.md
§5/§6). "Section" = a marker block; "picking a template" = the inspector
writes/updates the marker's class argument (e.g. `@section chapter-opener`)
in the markdown source. Templates are plain CSS classes; the markdown file
remains the single source of truth. **No second sectioning model.**

**Visual layout editor (PROPOSED — #37):** #37 is the tracked spec
(sub-issues required before implementation; "the CSS file remains the
source of truth"). The interaction-model question — #37's original
page-spread drag-and-drop canvas vs the click-region property inspector
sketched in issue #40 — is **resolved (2026-07-20, recorded in #37): v1 is
the property-inspector model.** Click a region in the live preview → a
property panel edits token-backed properties and `@page`-mapped geometry
(page size, margins, running headers, column count). This follows the
recommendation in #37's own research comment — a drag-and-drop canvas for
paginated content inherits the full InDesign/TeX reflow problem domain,
while a property panel covers ~80% of the need at a fraction of the
complexity (REDUCE-complexity mandate) — and Webflow/Pinegrow precedent:
every control maps 1:1 to a CSS rule written back to the stylesheet. The
canvas is **deferred indefinitely**; if ever revisited, it is a later
evolution of the inspector proposed as a PR against this document.
Non-negotiables (unchanged): writes target a defined layer (e.g. a
tool-managed overrides block appended last in the cascade); v1 edits
only token-backed properties (others shown read-only), so the tool never
writes raw values; the shipped **DesignSection token editor is the
baseline** it extends (do not build a second token panel).

**Overflow indicator (PROPOSED):** the engine does not report overflow.
Detection = post-pagination geometry probe in the preview process
(content-area `scrollHeight/Width` vs client box; opt-out class for
intentional bleeds), surfaced through the preview-bridge protocol to both the page
navigation UI and a Problems-panel entry with the page number.

### 6. Publishing workflow

**Status: SHIPPED baseline (#35, closed 2026-07-06)** — normative provider
detail lives in `docs/publishing.md`. Shipped: toolbar **Publish** button →
`PublishWizard` (choose destinations → one setup step per destination →
publish), five built-in providers, saved named credentials (`safeStorage`) with
an account picker, Settings → **Accounts** tab.

**Provider model (binding):** providers are **built into the lib's publish
registry** (`packages/cli/src/lib/publish/`) — they are *not plugins* and there
is no "publish plugin" category (CLAUDE.md §5). New providers are code
contributions to the registry. Two provider classes (from the shipped matrix):

| Class | Providers | Publish flow | Success state |
|---|---|---|---|
| **API** | itch.io (via auto-downloaded butler), Azure SWA, Shopify | one-click with live progress | direct link + copy button + "Publish again" |
| **Guided** | Amazon KDP, DriveThruRPG (no public APIs; KDP automation violates Amazon ToS) | validate → stage a ready-to-upload package (`publish/<provider>/` + `LISTING.md`) → open the provider hub with a checklist | "Package staged — opened KDP with your checklist" + link to the staged folder |

The one-size "direct link to published work" success state is wrong for
Guided providers (KDP review takes up to ~72h); the success state is
**provider-aware** per the table.

**Placement & gate (decisions on #105, 2026-07-14):** preflight is a **step
inside the PublishWizard**, shown after destination selection so checks are
provider-aware. A blocking ❌ **disables Publish by default**; the user may
explicitly override (**Publish anyway**, with confirmation). Warnings/info
never block.

**Flow order:** provider selection → provider-aware preflight → publish.
Provider-specific checks appear only after that provider is selected,
appended below the shared checks. (The original mock showed a KDP row before
selection *and* a green header above an ❌ row — both corrected: any ❌ makes
the header red.)

```
┌─────────────────────────────────────────┐
│ 🔴 2 issues blocking publish            │   Preflight — KDP selected
│                                         │
│ ✅ Title set                            │
│ ✅ Cover meets KDP print spec           │   (trim + bleed at ≥300dpi — computed
│ ✅ All referenced images resolve        │    per provider; 1600×2560 is KDP's
│ ⚠️ Table of contents — not generated    │    EBOOK spec and is not used here)
│ ❌ KDP: ISBN field empty                │   ← [Set…] navigates to the field
│                                         │
│ [Set ISBN…]            [Publish anyway]  │
└─────────────────────────────────────────┘
```

- Every preflight rule declares `fixable: none | navigate`. A `navigate` rule
  (like ISBN) gets a Set…/Go-to button that jumps to the field; a `none` rule
  explains itself. **There is no auto-fix** — preflight never mutates document
  content (decision on #105, 2026-07-14; the earlier `auto` class and "Fix
  all" button were dropped).
- Severity: error / warning / info; header is red/amber/green accordingly —
  no guessing.
- Progress: side drawer (not modal) with step indicators and a collapsible
  live log. The progress stream is a **push stream → adapter/IPC seam** (see
  Architectural constraints). Error state shows the exact error, suggests a
  fix, and always preserves the PDF locally.
- **Publish history — evaluated, not planned (2026-07-14):** a last-N publish
  log was considered and dropped; provider dashboards and the project's git
  snapshot history cover the need. If revisited, storage must be per project
  and gitignored (CLAUDE.md §7 snapshot commits capture anything un-ignored).

### 7. AI writing assistant

**Status: PROPOSED — tracked in #36 (open).** #36 already defines the chat
sidebar, selection actions (rewrite / expand / shrink / fix), genre helpers,
and provider-agnostic configuration (OpenAI / Anthropic / local Ollama, keys
in the OS keychain, per-user). This section defers to #36 for all of that;
divergences below are labeled.

**Product shape (decided 2026-07-20):** the AI feature is a **chat window**.
Authors converse with an LLM/agent that can **read the project's files** to
gather context on what they're working on — reads happen host-side; context
is the current file by default with opt-in full-project context (#36). It is
*not* an ambient completion surface: **inline ghost-text autocomplete was
evaluated and removed from the plan entirely** (2026-07-20); any revival
would be a new proposal against this document. A possible **future
direction** — explicitly out of scope until it gets its own issue — is
letting the agent edit files directly, in the style of Claude Code / VS Code
Copilot (proposed edits surfaced as reviewable diffs); until then the
no-unaccepted-mutations constraint below stands.

Binding constraints (regardless of final design):

- **Off by default.** AI activates only after the user enables it and
  configures a provider (Settings → Accounts). With AI off, all AI entry
  points (toolbar button, `/ai`, chat panel) are **hidden**, not greyed out;
  the drawer, if reached, shows a one-card empty state ("Connect a provider
  to enable AI").
- Provider calls run **host-side** via an `api/ai/*` server route, and the
  file reads that build the agent's context are host-side too — the renderer
  never assembles provider payloads. Keys live in host credential storage
  (reuse the Node-native git layer's token layering). The UI discloses plainly that
  document text is sent to the configured provider. Local Ollama is the
  offline/no-cloud path (#36).
- **Context is allow-listed, never "the whole folder."** A local-first
  project root routinely holds secrets and noise (`.env`, credential/token
  files, `.git/`, generated build output under the project's out dir, binary
  assets). The host context builder MUST therefore, as a binding part of the
  #36 implementation:
  - include **only text source the author authored** — markdown/CSS and the
    manifest — and **exclude** dotfiles/dot-dirs, anything matched by the
    project's `.gitignore`, the configured build/output directory, files over
    a size cap, and non-text/binary files;
  - never read outside the project root (no `../` escape, no absolute paths);
  - treat "opt-in full-project context" as *all allow-listed files in the
    project*, not *all files* — the toggle widens scope within the allow-list,
    it does not disable it.
- **Consent is per-scope and previewable.** Enabling full-project context is
  an explicit action separate from enabling AI, and before the first
  full-project submission the UI shows exactly which files will be sent (a
  reviewable manifest the author can exclude entries from). Sending document
  text is disclosed (above); sending *additional* project files requires this
  distinct, informed opt-in.
- AI never modifies text without an explicit accept step.

Interaction sketch:

- Chat panel (right drawer / bottom sheet on mobile), per-document history,
  "Apply" inserts at cursor or replaces selection. Slash actions align with
  #36's list (`/rewrite`, `/expand`, `/shrink`, `/fix`, …).
- Key precedence (binding): the slash menu opens only when `/` is typed at
  line start or after whitespace; `Esc` or a non-matching character
  dismisses; `/ai` is an entry in that menu, not a separate parser.

### 8. CSS editor

**Status: SHIPPED baseline** (#39, #68 follow-ups) with PROPOSED refinements.

Shipped: CSS editing is a **language mode of the single CodeMirror 6 editor**
(`css-editor.ts` — language compartment per file type), not a separate
tabbed/split panel. The lint gutter runs the **postcss-based print-safety
checker** (`checkCss`, the four `printsafe/*` rules) via the
`api/lint/check-css` route + `getPlatform().checkCss` — the same engine as
`gutterpress validate`. Completions are a curated paged-media table.

> **stylelint is not used and must not be reintroduced** — it was removed
> because it cannot survive `bun build --compile` (CLAUDE.md §3). New lint
> rules go through `printsafe.ts`.

Proposed refinements (file issues):

- Theme-token autocomplete + highlighting sourced from the active theme's
  token list (extends the shipped completions).
- Token inspection: the shipped **DesignSection** (guided `:root` token editor
  with swatches and debounced write-back) is the "computed variables" surface
  — extend it; do not build a second token panel.
- Token-hover element highlighting, defined precisely: highlight elements
  matched by selectors of rules containing `var(--token)` in a declaration
  (static stylesheet analysis + `querySelectorAll` in the preview via the
  preview-bridge protocol); inheritance-only consumers are **not** highlighted; cap
  and badge the count above N matches.
- "Visual Mode" toggle → belongs to #37 (see §5).

### 9. Plugin manager

**Status: SHIPPED** (Config panel → `PluginsSection`, #30). This section is
rewritten around the actual plugin model; the original "app store" concept is
**rejected** as incompatible with CLAUDE.md §5 unless a future ADR changes
that rule.

The model (binding, from CLAUDE.md §5):

- Plugins are **plain markdown-it npm packages** declared in the project
  manifest. There is no custom plugin API, hosted Gutterpress registry, or sandbox.
  Explicit install resolves the public npm registry and vendors an exact
  version plus its runtime dependency tree; the build/preview loader itself
  never installs or accesses the network. The desktop host confines the target
  to the open project and requires a native confirmation that says third-party
  code receives full filesystem and network privileges.
- Build/export/validate **fail fast** on any plugin load error, identifying
  the offending manifest entry — a final artifact never silently omits
  author-configured formatting. Live preview **degrades and reports loudly**
  ("Not installed" badge + fix instructions); every skip is surfaced.

Shipped UI (the baseline to refine, not replace): configured-plugin list with
enable/disable toggle, "Re-check" validation, curated bundled markdown-it
recommendations, verified/pinned npm install, local import, and an actionable
missing-vendor state.

Refinements (PROPOSED): link each plugin to its npm page for
author/version/last-published metadata; surface load errors inline.

Explicitly **removed** from the earlier draft (each would require its own
ADR-level proposal and a CLAUDE.md §5 amendment):

- install counts / reviews (presumes a hosted registry that doesn't exist);
- "permissions requested" (plugins run in-process with full privileges — a
  permission display with no sandbox is a false security affordance; instead
  the UI states plainly: *plugins are ordinary npm packages that run with
  full application access* and links to the package source);
- the category filter "themes / publish providers / lint rules / AI providers
  / snippets" — none of those are plugin types (themes = CSS #32, publish
  providers = built-in lib modules #35, lint = built-in printsafe, AI =
  settings-configured #36, snippets = project folder #29);

### 10. Problems panel

**Status: SHIPPED** (#28, `ProblemsPanel` + `problems.ts`) with a deliberately
**writer-first** design this contract preserves: entries grouped by file (not
a flat columned table), check ids translated to plain-language labels
("Broken link", "Print-safety (CSS)"), rule codes demoted to secondary text.
Raw rule-ID columns and rule-ID-first presentation are anti-patterns here.

- Bottom drawer, collapsible, badge with error/warning count
  (`aria-label="3 errors, 2 warnings"`).
- Click row → jump to location in the editor. PROPOSED: severity filters;
  Arrow-key row navigation with Enter-to-jump; inline "Go to" navigation on
  rows (matching §6's navigate-only remediation — no auto-fix — and required
  before any "navigate-and-resolve" quality gate can be measured).
- **Existing checks** (source-time): broken local links, print-safety CSS,
  markdownlint, htmlhint, missing image alt text, heading order, missing
  shared assets.
- **Proposed print-specific checks** (layout-time — these need a
  post-pagination audit pass, are located by page number + nearest mapped
  source block, and refresh only after a pagination pass, never per
  keystroke): widows/orphans, image aspect-ratio mismatch, page overflow
  (see §5).
- Rule explanations open the in-app help drawer, not an external browser.
- Empty state: "No problems found — document looks great."

### 11. Theme selector / importer

**Status: SHIPPED baseline** (#32; Config panel → "Look & style") with
PROPOSED refinements tracked in **#106**.

Shipped: theme grid of built-in + project themes with per-card **rendered
thumbnail previews**, Apply / Remove, and import **from folder or URL**
(`api/theme/import-from-folder`, `import-from-url`). **Apply copies a
built-in theme into the project (`themes/<id>`) as a user-owned, editable
copy**, and the grid dedupes the built-in card once a project copy exists —
this *is* the "duplicate & edit" model; do not add a second one. Theme tokens
are surfaced through the DesignSection editor.

Shipped refinements (#106, 0.8.0-beta.1):

- **Hover live preview** — renders the theme onto a **canned sample spread
  (2 pages) off-screen**; it never re-paginates the user's document (full
  re-pagination cannot meet the ≤500ms gate and would storm on hover).
  Full-document re-pagination happens only on Apply, with a progress state.
  Shipped: `AppearanceSection` renders the sample into a hover-preview iframe
  via `hoverPreviewSrcdoc`.
- **Revert instead of timed undo:** applying a theme records the previous
  theme reference; "Revert to previous theme" remains available indefinitely
  (theme application is a config/CSS-reference change, and snapshot commits
  already version project files — a volatile 30-second window is strictly
  weaker). A toast with an inline Undo button may sugar this, but the
  persistent revert is the mechanism. Shipped: `revertTheme` /
  `getPreviousTheme` backed by the `themePrevious` manifest key, exposed as
  `api/theme/revert` and `api/theme/previous`.
- **ZIP drag-and-drop import**, validated against a defined **theme package
  format**: `theme.css` at root + optional `assets/` + optional `theme.json`
  (name/version); validation order = structure → CSS parses → print-safety
  check passes (note `printsafe/no-remote-urls` fails CDN-referencing themes
  — surface that clearly) → declares at least one `--print-*` token.
  Failures are errors; extra files are warnings. Shipped:
  `importThemeFromFile` / `importThemeFromZip`, exposed as
  `api/theme/import-from-file`.

---

## Responsive / adaptive design requirements

**Shipped baseline:** one breakpoint — **820px** (`NARROW_BREAKPOINT`; CSS
`max-width: 820px` agrees with JS) → single column + Markdown / CSS / Preview
tabs. Desktop-side layout tiers below are PROPOSED refinements and must keep
that constant (or change it in one place, with an issue):

| Name | Range | Layout strategy | Status |
|---|---|---|---|
| Narrow | <820px | Single column; Markdown/CSS/Preview tabs; keyboard-aware | SHIPPED |
| Desktop | 820–1279px | Two-pane split (editor + preview), collapsible left panel | SHIPPED |
| Desktop L | ≥1280px | Three-pane capable (left panel + editor + preview) | PARTIAL |
| Ultra-wide | ≥1920px | Optional fourth pane (inspector/AI drawer) | PROPOSED |

Pane-counting note: split percentages (e.g. 50/50, 60/40) describe the
**editor/preview content area only**, exclusive of the left panel and any
drawer.

### Touch vs. pointer

- Interactive targets: ≥44×44px on touch; ≥32×32px on pointer (WCAG 2.2
  SC 2.5.8 floor is 24px — we exceed it).
- Hover-dependent UI only via `@media (hover: hover)`; touch alternatives per
  §2 (long-press labels).
- Gutters: the visible line may be thin (1–4px) but the **hit area is ≥44px
  wide on touch** (≥16px on pointer) — an "8px padding" strip is not
  touch-friendly and violates the target rule. Keyboard adjustment (Arrow
  keys) is the SC 2.5.7 non-drag alternative.
- Context menus: long-press on touch, right-click + `Shift+F10` on desktop.

### PWA requirements

**Status: REMOVED (0.11, SFE-P5a, plan D10).** Previously shipped (Phases
1–5) via #33/PR #63, normative in `docs/pwa-webadapter-plan.md`. That
implementation — `service-worker.ts` (app-shell precache), the web app
manifest, and `WebAdapter` (FSA primitives + IndexedDB persistence) — was
**deleted rather than completed**: `packages/desktop` is an Electron-only
product now, with no dormant browser host inside it. A future web product is
not a mode of this package — it is a **separate package** consuming
`@dimm-city/gutterpress-editor` and `gutterpress/render`, built new against
those public surfaces rather than by finishing this deleted adapter.
`docs/pwa-webadapter-plan.md` is closed and kept as history; the deletion
itself is recorded in the deletion ledger's SFE-P5a entry
(`docs/plans/source-first-editor/deletion-ledger.md`). PDF export and
publishing remain desktop/CLI-only, unconditionally — there is no web/mobile
target left to gate them off for.

---

## Measurable quality gates

### Measurement approach (decided — no telemetry, #108)

Gutterpress ships **no telemetry, no analytics events, and no session recording**
(decision on **#108**, 2026-07-14) — consistent with its local-first, MPL-2.0,
no-backend posture and the privacy stance behind the no-font-CDN rule. All
quality gates below are therefore measured **without instrumentation**:

- **Usability tests** (moderated/unmoderated, recruited participants) are the
  primary instrument for completion rates, time-to-first-PDF, and satisfaction.
- **GitHub-issue rates** stand in for "support ticket rate".
- **CI / e2e / unit tests** back the error-rate and performance gates.
- **No session recording, ever** — recording a writing app would capture
  manuscripts; recordings occur only inside consented usability studies.

Targets that would require fleet-scale data (sub-0.1% crash rates, NPS cohorts)
are **aspirational direction, not release-blocking gates**, since there is no
instrument to evaluate them.

### Canonical first-PDF metric (single source of truth)

- **Target: P50 time-to-first-PDF ≤ 5 minutes** (app open → PDF written via
  the native save dialog; new user; template project).
- Completion: **≥85% of new users export within 10 minutes** (≈P85).
- Regression gate: any release where P50 exceeds 5 minutes.
- Measured via moderated/unmoderated usability tests (no telemetry — #108).

### Task completion targets

| Task | Target | Method |
|---|---|---|
| First PDF exported | per canonical metric above | usability test |
| Apply a theme | 5/5 test participants complete unassisted (n=5 formative; see below) | usability test |
| First publish (itch.io) | ≥80% unassisted | usability test + GitHub-issue rate |
| Enable a plugin from "Not installed" using the in-app instructions | ≤2 min | usability test |
| Resolve a Problems-panel finding | ≥90% navigate-and-resolve | usability test (a "click-to-fix" rate requires the §10 Fix affordance first) |

Small-n honesty: with n=5 the only observable rates are multiples of 20% —
state gates as **x/5 pass/fail**, not percentages. Quarterly summative
testing: n=8 per persona is the eventual bar; until a research owner exists,
scope to the 2 priority personas (Maya, Kai).

### Error-rate targets

| Error | Target | How measured today |
|---|---|---|
| Publish failure (user-caused, preflight-caught) | ≤5% | provider e2e tests + GitHub-issue reports |
| Publish failure (app-caused) | ≤1% | same |
| PDF export crash | 0 in the e2e suite (fleet rate is aspirational — no telemetry) | CI gate |
| Data loss | none beyond the last auto-save debounce (500ms) + recovery snapshot (1s) — crash recovery must restore to within 1s of the last edit | recovery test suite |

### Performance gates

The CI performance gates (`tests/perf/render-gate.mjs`,
`rerender-latency-gate.mjs`, the `bench/` fixtures) were **removed 2026-08-30**
on the owner's call: over their lifetime the render-speed gate's failures were
100% infrastructure (its regression signature appeared in none of them) and
the rerender gate never fired in 577 runs, while both cost a runner per PR and
a recurring flake surface. The latency targets below remain the design intent;
they are validated by usability testing, not by a wall-clock CI gate.

| Metric | Target | Fixture / condition |
|---|---|---|
| Cold launch → editor accepts first keystroke | ≤2s P90 | reference machine (M1 MacBook Air + CI runner) — replaces the undefined "TTI" |
| Preview re-render after keystroke | ≤300ms | `bench/novel-50p` (text-only) |
| PDF export | ≤8s | `bench/novel-50p`; image-heavy budget (`bench/zine-24p`) not yet created |
| Theme switch (hover sample-spread render) | ≤500ms | sample spread only — full-document re-apply is exempt above N pages and shows progress |

Mobile/PWA performance targets are historical: `docs/pwa-webadapter-plan.md`
is closed (0.11, SFE-P5a, plan D10) and its follow-ups do not apply — there
is no PWA/browser target in this package (see "PWA requirements" above). A
future web product would define its own performance targets against a named
reference device.

### Satisfaction

- SUS ≥80; task satisfaction ≥4.0/5 — measured in the quarterly usability
  study (see small-n note). **No in-app day-7 survey** unless it gets its own
  issue, a defined trigger, and a surface in the screen inventory; NPS
  cohort tracking is out of scope (no telemetry — #108).

---

## Accessibility requirements

### Standards

- **WCAG 2.2 Level AA** for all UI chrome (not user content). The 2.2 deltas
  bind concretely here: **2.5.7 Dragging Movements** — gutter drag and
  drag-and-drop import need single-pointer/keyboard alternatives (Arrow-key
  gutter; file-picker import button); **2.5.8 Target Size** — the 24px
  minimum floor under our 44/32px rules; **2.4.11 Focus Not Obscured** —
  sticky/keyboard toolbars must not cover the focused element.
- Keyboard-only operability for every mouse-accessible feature.
- Screen reader matrix (matches the real platforms — the app is Chromium on
  every desktop OS, so no non-Chromium engine is ever a test target):
  - Windows: **NVDA + the app**;
  - macOS: **VoiceOver + the app**.
  - (There is no PWA/browser target in this package — see Scope above — so
    no browser/mobile screen-reader row applies.)
- Shipped precedent to match, not reinvent: **#22** (focus trap,
  WCAG SC 2.1.2) and **#21** (export-progress announcements, cancel,
  elapsed time).

### Color and contrast

| Element | Minimum |
|---|---|
| Body text | 4.5:1 |
| Large text / headings | 3:1 |
| UI controls / focus indicators | 3:1 |
| Meaningful icons (error/warning/success) | 3:1 (non-text contrast, SC 1.4.11) |

- Light + dark mode (SHIPPED, #48); auto-detect `prefers-color-scheme`, user
  override. `prefers-contrast: more`: remove decorative shadows, increase
  border weight, focus ring → 3px solid.
- No color-only state indication: icon + label accompany color, always.

### Keyboard navigation

- Toolbar: ARIA toolbar pattern (single Tab stop, Arrow keys between buttons,
  Enter **or Space** activates) — same wording as §2.
- Split-pane gutter adjustable by Arrow keys when focused.
- Modals trap focus; `Esc` closes; focus returns to the opener (per #22).
- Problems-panel rows: Arrow keys + Enter to jump.
- Drag-and-drop always has a keyboard alternative (SC 2.5.7).
- Context menus reachable via keyboard menu key / `Shift+F10`.

### Reduced motion

- `prefers-reduced-motion: reduce` disables pane transitions, toolbar
  slide-ins, and panel fades; state changes become instant.

### Focus management

- Focus indicator as an **outcome spec**: a visible ring ≥2px with ≥3:1
  contrast against adjacent colors in both themes. Implementation may be
  dual-layer (outline + box-shadow) — a single `outline` declaration cannot
  satisfy "dual-layer" by itself. Under `prefers-contrast: more`: 3px solid.
- After publish/export completes, focus moves to the result summary for
  screen-reader announcement (per #21).

### Screen reader semantics

- Preview updates: **no announcements while the editor has focus and the user
  is typing.** After ~3s idle following a re-render, announce meaningful
  deltas only ("Preview updated — now 52 pages"), max one per idle period,
  via a status node **separate from the re-rendering preview DOM**.
- Problems badge: `aria-label="3 errors, 2 warnings"`.
- Publish/export progress: `role="status"` (shipped, #21).
- Editor: CodeMirror 6's built-in accessibility tree; do not override
  `aria-multiline`.
- Meaningful icons carry `aria-label` or visible text; decorative images
  `alt=""`.

### Font and text

- Text sizes in **rem** (px equivalents at the 16px default root, for
  reference only): UI chrome minimum **0.875rem** (14px); prose **1rem**
  (16px) recommended; editor font user-resizable **0.75–1.75rem** (12–28px),
  **persisted per user** in app preferences (not per project — a comfort
  setting follows the user's eyes and monitor, and a project-folder file
  would be captured by snapshot commits).
- Non-text sizes (icons, borders, focus rings) may remain px.
- Line height ≥1.5 for body text.

---

## Design system recommendations

### Component library

**Build on [bits-ui](https://bits-ui.com)** — headless, Svelte-5-native
(runes), WCAG-focused, MIT — or **[shadcn-svelte](https://shadcn-svelte.com)**
as a pre-styled layer (community shadcn port built on bits-ui; **note: it
implies adopting Tailwind, which the desktop app does not use** — bits-ui alone
works with the plain-CSS token system below). **[Melt UI](https://melt-ui.com)**
is the alternative headless builder. bits-ui's `Command` component (and
shadcn-svelte's pre-styled Command) is the Svelte equivalent of `cmdk` for the
proposed palette.

Rationale: headless primitives avoid re-solving dialog/dropdown/tooltip
accessibility while leaving visual design to our tokens.

Avoid: hand-rolling modal/dropdown/tooltip focus management (the shipped
dialogs already follow #22's trap pattern — new ones must too); opinionated
styled Svelte kits (Skeleton, Flowbite Svelte, Carbon Components Svelte) —
their visual systems fight a print-tool aesthetic.

> React-only libraries (Radix UI, shadcn/ui, MUI, Ant Design) are not options
> for this Svelte 5 app and appear here only so nobody re-proposes them.

### Design token system

CSS custom properties as the single source of truth. **App-shell tokens are a
separate layer from document/theme tokens; document tokens use the
`--print-*` prefix** to prevent collision (the shipped DesignSection edits the
document layer).

```css
/* Color */
--color-bg-primary  --color-bg-secondary  --color-bg-elevated
--color-text-primary  --color-text-secondary  --color-text-disabled
--color-accent  --color-accent-hover
--color-danger  --color-warning  --color-success  --color-focus-ring

/* Typography */
--font-sans  --font-mono
--font-size-xs … --font-size-xl        /* rem-based */
--line-height-tight/normal/loose
--font-weight-normal/medium/bold

/* Spacing (4px base grid) */
--space-1 (4px)  --space-2 (8px)  --space-3 (12px)  --space-4 (16px)
--space-6 (24px) --space-8 (32px) --space-12 (48px) --space-16 (64px)

/* Radius */   --radius-sm/md/lg/full
/* Shadow */   --shadow-sm/md/lg
/* Motion */   --duration-fast (100ms)  --duration-normal (200ms)
               --duration-slow (350ms — large-surface changes ONLY: theme
               cross-fade, skeleton→content; everything else ≤200ms)
               --easing-standard/decelerate/accelerate
/* Z-index */  --z-base  --z-dropdown  --z-sticky  --z-overlay  --z-modal  --z-toast
```

**Toasts** (`--z-toast`, `Toast.svelte` is SHIPPED): permitted for
non-blocking confirmations only ("Link copied", theme-revert sugar per §11);
placed bottom-center; auto-dismiss ≥4s with hover-pause; `role="status"`.
Never for save confirmation (see Anti-Patterns) or errors that need action
(those go to the Problems panel or an inline state).

### Icon system

**SHIPPED mechanism — preserve it:** `Icon.svelte` inlines a hand-picked
subset of Lucide path data (MIT) precisely to avoid a 1300-icon package
dependency. Add icons by copying path data per the component's instructions.
(If a package is ever justified, the Svelte 5 package is `@lucide/svelte`;
`lucide-svelte` is the legacy 3/4 package.) Icons at 16/20px, 1.5px stroke,
explicit width/height (never scaled by `font-size`). Icon-only buttons:
`aria-label` + tooltip/long-press label per §2.

### Typography

- UI chrome: system font stack — fast, native.
- Editor body: user-selectable. Defaults — iA Writer Mono (mono; **SIL OFL
  1.1**, IBM Plex Mono derivative, bundle from `iaolo/iA-Fonts`), Lora
  (serif; OFL), Inter (sans; OFL). **All defaults are bundled + subset in the
  app package, same as JetBrains Mono (OFL) for the CSS editor — no runtime
  font fetching of any kind** (privacy + offline; the same standard behind the
  no-telemetry decision, #108).

### Motion principles

- Transitions serve orientation, not decoration; everything ≤200ms except the
  sanctioned `--duration-slow` uses above. No looping idle animations.
- Loading: skeletons for content areas; spinner only for <3s operations with
  no placeholder.

---

## Anti-patterns — explicitly prohibited

| Anti-pattern | Why | Alternative |
|---|---|---|
| Full-screen onboarding carousel | Hides the actual app | Annotated starter template (shipped wizard) |
| Save-confirmation modal/toast ("Saved!") | Interrupts writing | Subtle indicator; auto-save is shipped (§1) |
| Blocking publish modal with progress | Forces spinner-watching | Side-drawer progress log (§6) |
| Floating panels that reset position | Lost state | Docked panels, persisted layout |
| Color-only state indication | WCAG / color-blind users | Icon + color + label |
| Unlabeled icon-only buttons | New users, screen readers, touch | `aria-label` + tooltip (pointer) / long-press label (touch) |
| Requiring an account or purchase before first export | Abandonment, trust; **there are no accounts or tiers** — MPL-2.0 local-first app | All core features work with no account; provider sign-in only at the moment publish/sync needs it |
| AI modifying content without accept | Trust violation | Explicit apply/accept only; AI off by default (§7) |
| Tooltips that vanish on mouse move | Motor-impaired users | ≥300ms hide delay; persists while hovered |
| Auto-advancing feature tours | Patronizing | On-demand contextual help |
| Hiding features behind unlock gates | Contradicts escape-hatch principle; regresses shipped UI | Soft emphasis: Advanced badge, never hidden (§4) |
| Opening help in an external browser tab | Breaks flow; offline failure | In-app help: the start screen's Help tab (`HelpContent`) |
| Print-tool "modes" (pointer/text/frame tools) | Wrong mental model | Markdown-first; properties in inspector |
| Requiring save before preview | Breaks the live loop | Shipped: 500ms debounced save + live preview |
| Raw engine / `@page` errors shown to authors | Opaque, frightening | Plain-language Problems entries (shipped, §10) |
| Raw rule IDs / linter jargon as primary text | Writer-first product | Plain-language labels, codes demoted (shipped, §10) |
| Reintroducing stylelint or any bundler-hostile dep for editor lint | Breaks `bun build --compile` (CLAUDE.md §3) | Extend `printsafe.ts` |
| A Gutterpress-specific plugin API, hosted plugin marketplace, or fake granular permissions UI | Contradicts CLAUDE.md §5 and the unsandboxed runtime | §9's plain-package model and one honest full-privilege confirmation |
| Settings with >30 items in a flat list | Overwhelming | Shipped tab structure (§4) |

---

## References and inspiration

**Editor UX:** iA Writer (focus, typography-first) · Typora (seamless toggle)
· VS Code (problems panel, split editor; its palette is `Ctrl/Cmd+Shift+P`) ·
Obsidian (panel flexibility, community themes) · Bear · Ulysses.

**Print/layout:** Affinity Publisher 2 (preflight, masters) · Canva
(non-designer layout) · Visme (template-first onboarding).

**Publish:** Netlify (preflight + deploy log drawer) · Shopify (provider
cards) · Leanpub (author-centric flow).

**Mobile editors:** iA Writer iOS · 1Writer · Drafts.

**Accessibility:** [WCAG 2.2 quick reference](https://www.w3.org/WAI/WCAG22/quickref/)
· [Inclusive Components](https://inclusive-components.design/) (Heydon
Pickering) · bits-ui accessibility docs.

**Design systems:** [bits-ui](https://bits-ui.com) ·
[shadcn-svelte](https://shadcn-svelte.com) · [Melt UI](https://melt-ui.com) ·
[Open Props](https://open-props.style/) (framework-agnostic token reference).

---

## Implementation checklist (re-baselined at 0.8.0-beta.1)

Legend: ✅ shipped · 🔶 partial · ⏳ open issue · 🆕 proposed, **file an issue
before implementation** (Primary Goals: unscoped mandated work is prohibited)
· ❌ evaluated, not planned (triaged 2026-07-14).

### Foundation
- 🔶 Design token system — DesignSection ships the document layer; 🆕 formalize the app-shell token layer (light + dark, #48)
- 🆕 Component library decision (bits-ui vs shadcn-svelte+Tailwind vs continue hand-rolled + #22 patterns) — decision record required
- ✅ Responsive collapse (#34, 820px) · 🆕 Desktop-L/ultra-wide tiers
- ✅ Icon mechanism (Icon.svelte inline subset — preserve)
- 🆕 Keyboard-navigation audit of all existing components (WCAG 2.2 AA)

### Core editor
- ✅ Editor (#38) · ✅ CSS language mode (#39) · ✅ Toolbar (#31) · ✅ Snippets (#29)
- ✅ Synchronized scroll (EditorPreviewSyncController) · 🆕 user toggle to disable
- ⏳ Resizable gutter with snap points + keyboard adjustment — **#103**
- ⏳ Focus mode (`Cmd/Ctrl+Shift+F`) — **#104**
- ❌ Command palette — evaluated, not planned (shortcut stays reserved)

### Onboarding
- ✅ Welcome + wizard + templates (#25, #27, WelcomeLanding)
- 🆕 Additional annotated templates (per §4 Layer 1)
- 🆕 Contextual tooltip system (once per session, settings-store state)
- 🆕 Empty-state designs for every panel (Problems/Publish specs exist)

### Print / publish
- ✅ Publish wizard + 5 providers + Connections (#35) · ✅ readiness check (#24) · ✅ page navigation (#20) · ✅ export progress a11y (#21)
- ✅ Preflight panel (PublishWizard step; block-with-override; fixable none/navigate, no auto-fix) — **#105** (0.8.0-beta.1)
- ✅ Theme package format + ZIP/CSS import + hover sample preview + revert — **#106** (0.8.0-beta.1)
- 🆕 Publish progress drawer (push-stream seam) · ❌ publish history — evaluated, not planned
- ❌ Page thumbnail navigator — evaluated, not planned (pager + TOC cover it)
- ⏳ Visual layout editor — **#37**; interaction model resolved (property inspector, §5); blocked on #37 sub-issue scoping (do not schedule as near-term)
- ⏳ AI assistant — **#36** (chat window with host-side file-read context; off by default, §7 constraints; no ambient completions — ghost text removed from the plan)

### Quality-gate measurement
- ✅ Telemetry decision — **#108**: no telemetry; gates measured via usability tests + CI (this section updated to match)
- ❌ Benchmark fixtures / CI perf gates — shipped in 0.8.0-beta.1, **removed 2026-08-30** (see "Performance gates" above); #107 closed by removal
- 🆕 Quarterly usability-study protocol (owner, recruitment, 2 priority personas)
- 🆕 Accessibility audit: axe-core automated + manual NVDA/VoiceOver passes per the matrix

---

*This contract is a living document, revised via PRs. It was rebuilt from
issue #40 after a full review against 0.8.0-beta.1 — see the review comment on
#40 for the complete list of corrections and their rationale.*
