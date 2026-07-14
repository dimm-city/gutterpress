# print-md UX Design Contract

> **Status: draft revision** of the contract originally proposed in issue
> [#40](https://github.com/dimm-city/print-md/issues/40). Baselined against
> viewer **0.8.0-beta.1** (2026-07-14).
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

This contract governs the **viewer application** — the desktop Electron app
and its PWA/browser target (#33/#34, `docs/pwa-webadapter-plan.md`).

**Out of scope:** the CLI (`print-md new/build/preview/lint/publish`). The CLI
is the power-user and CI surface (see the repo README: "a desktop application
(with a CLI for power users)") and is governed by `packages/cli/README.md` and
`docs/publishing.md`. Developer users are expected to move between the app and
the CLI; nothing in this contract should assume the app is their only path.

## Architectural constraints (normative, external)

The following documents constrain every pattern in this contract. **Where this
contract and those documents conflict, the architecture documents win.**

| Rule | Source | UX consequence |
|---|---|---|
| Renderer stays PWA-clean; host capabilities via server routes (default) or the Platform seam (push streams, BrowserWindow calls, FSA-divergent fs) | `CLAUDE.md` §8, `docs/adr/0004-platform-abstraction.md` | Theme import file IO, AI/publish network calls, preflight fs checks → server routes. Publish/build **progress streams** → the adapter/IPC push seam. No `node:*` or lib value-imports in the SPA. |
| Preview bridge protocol | `docs/adr/0005-preview-bridge-protocol.md` | Sync scroll, page navigation, outline, any preview overlay or overflow probe must go through the bridge. |
| Plugins are plain markdown-it plugins; no plugin API; loader never auto-installs | `CLAUDE.md` §5 | Constrains §9 (Plugin manager) below. |
| PDF rendering = Electron `printToPDF` (viewer) / puppeteer-core (CLI); pure-JS tooling posture | `docs/adr/0002-pdf-rendering-and-pure-js-tooling.md` | Preflight/export UX; "export" not "download". |
| Git/GitHub operations are Node-native pure JS | `CLAUDE.md` §7, `docs/adr/0006-remote-git-github-integration.md` | Project source / sync / provider-auth UX. |
| `$effect` is eslint-banned in the SPA; persisted preferences flow through the settings store's `onSettingsChange()` channel | `CLAUDE.md` §8 | Every persisted preference this contract specs (font size, pane layout, sync toggle, tooltip-seen state). |
| All changes must REDUCE complexity unless properly justified | `CLAUDE.md` Primary Goals | Every PROPOSED item needs a scoped issue before implementation. |

---

## Vision Statement

print-md transforms markdown into beautifully paginated PDFs with zero layout
friction. It meets authors where they work — in prose, in code, and (via the
PWA) on mobile for writing and previewing — and stays invisible until they
need it. The interface disappears into the writing; the print engine makes the
result look professional without requiring design expertise.

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
| TTRPG creator | Kai | Produce zine/supplement with custom layout | InDesign cost, asset management | Medium |
| Technical author | Sam | Produce a printed manual / handbook / rulebook with consistent styling | Toolchain fragmentation, theme drift | High |
| Indie author | Rosa | Publish across itch.io + Amazon KDP | Format juggling, proof corrections | Low–Medium |
| Power user | Dev | Automate, extend, build plugins | Black-box tooling, no escape hatches | Developer |

Notes:

- Sam was previously "Technical writer — document APIs". API-reference
  documentation is a web-docs use case outside the repo's print-materials
  goals (no example, guide chapter, or issue targets it) and is **out of
  scope**. The persona is re-grounded in what the repo demonstrates
  (`examples/print-md-user-guide` is itself a printed manual).
- Dev's happy path may be the CLI (see Scope); app UX for Dev means escape
  hatches and inspectability, not replicating the CLI in the GUI.

---

## Information Architecture

### Screen inventory

Statuses reflect 0.8.0-beta.1. Names in parentheses are the shipped
components/controllers.

```
print-md/
├── Welcome / start screen                     SHIPPED  (WelcomeLanding: continue card,
│                                                        recents/favorites/discovered via ProjectsListBody)
├── New project wizard / templates             SHIPPED  (NewProjectWizard, #25; templates from the
│                                                        shared lib scaffolding — see Onboarding)
├── Open dialog (recents/favorites, URLs)      SHIPPED  (#10, #27)
├── Editor Workspace
│   ├── Left panel — 5 tabs                    SHIPPED  (LeftPanel: Projects, TOC, Files, Media, Config;
│   │                                                    Cmd/Ctrl+\ toggle; overlay at ≤820px)
│   ├── Markdown editor                        SHIPPED  (MarkdownEditor, CodeMirror 6, #38)
│   ├── CSS editing                            SHIPPED  (language mode of the same editor —
│   │                                                    css-editor.ts, #39; NOT a separate panel)
│   ├── Live paginated preview                 SHIPPED  (PreviewFrame + paged.js bridge, ADR 0005)
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
├── Project source / version history / GitHub  SHIPPED  (#12–#16, ADR 0006; AdvancedSetupDialog,
│                                                        GitHubDialog, sync status)
├── Media panel                                SHIPPED  (MediaPanel, #47)
├── Crash recovery                             SHIPPED  (RecoveryOverlay / CrashRecoveryDialog)
├── Settings                                   SHIPPED  (SettingsDialog: App / Editor / Saving /
│                                                        Connections / Advanced)
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
- **Mobile primary navigation (PWA):** Write, Preview, Files, Settings.
  **Publish is not a mobile tab** — PDF export/publish is capability-gated
  off on web/mobile per #33's constraints ("PDF export stays desktop/CLI
  only") and `docs/pwa-webadapter-plan.md`; where referenced on mobile it
  shows "requires desktop".

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
  `scrollTo({line, chapter})` over the ADR 0005 bridge, with cross-chapter
  reveal and echo suppression. Remaining delta (PROPOSED): a user-facing
  toggle to disable sync, persisted via the settings store.
  - Mapping spec (for reference and for any rework): block-level
    `data-source-line` anchors from markdown-it token maps; after pagination
    the preview scrolls to the page containing the nearest preceding mapped
    block. Content with no direct mapping (generated content, running
    headers) falls back to the nearest mapped ancestor.
- PDF export via `Cmd/Ctrl+Shift+E` → native save dialog →
  `webContents.printToPDF` (ADR 0002).

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

**Status: PARTIAL** — tracked in **#33 (closed, PR #63; Safari/OPFS Phase 6
deferred)** and **#34 (closed)**. Normative implementation detail lives in
`docs/pwa-webadapter-plan.md`; **where this section and that plan disagree,
the plan wins.**

- Write-first: single column, Markdown / CSS / Preview tabs (shipped 820px
  behavior), bottom-reachable tab bar.
- Keyboard toolbar (PROPOSED refinement — spec corrected):
  - **Chromium/Android:** opt in with
    `navigator.virtualKeyboard.overlaysContent = true`, then pin with
    `position: fixed; bottom: env(keyboard-inset-height, 0px)`.
  - **iOS Safari:** the VirtualKeyboard API does **not** exist there — use
    `visualViewport` resize/scroll events (or
    `interactive-widget=resizes-content`) to compute the inset.
  - `position: sticky` cannot pin above a keyboard; do not spec it.
- **Auto-save is SHIPPED and works as follows** (do not respecify): debounced
  disk save 500ms after the last edit (`EditorBuffer`), crash-recovery
  snapshots at 1000ms, a user setting ("Save edits automatically",
  default 2500ms), plus explicit `Cmd/Ctrl+S` / toolbar Save. The save
  indicator is subtle (no modal) — see Anti-Patterns.
- Image insertion on mobile: system photo picker + camera (PROPOSED — gate on
  the PWA file-write path).
- Offline: service worker app-shell precache is SHIPPED
  (`service-worker.ts`, registered only when `!isDesktop()`). Offline cache
  scope (one statement, used everywhere): **app shell + the last-opened
  project (markdown, CSS, and referenced assets)** — "last 5 files" is not
  enough to preview a project. Offline indicator copy: **"Working offline —
  your files are saved locally."** There is no cloud sync; if the project
  has a git remote, a separate conditional indicator reads "remote sync
  paused — will resume when online."

### 4. Onboarding — progressive disclosure

**Status: PARTIAL** (#25 wizard + templates, #27 project finder,
`WelcomeLanding` shipped 2026-07-06; contextual tooltips PROPOSED).

**Layer 1 — first run (SHIPPED baseline):**

- `WelcomeLanding`: continue card (live pre-render status) + recents /
  favorites / discovered projects. `NewProjectWizard`: **4 built-in
  templates** (Book, TTRPG supplement, Zine, Technical document), custom
  templates, save-as-template, import-from-folder.
- Templates come from the **shared lib scaffolding** in
  `@dimm-city/print-md` (same set behind `print-md new`; CLAUDE.md §7 "one
  implementation, two thin front-ends") — the picker is a front-end over the
  lib, never a viewer-only template store.
- PROPOSED: additional curated templates (Novel, Resume, Chapbook,
  Rulebook…). Whatever the final count, **each shipped template carries
  annotated comments in both markdown and CSS**; at minimum the templates
  matching Maya, Kai, and Sam are fully annotated at launch. (This replaces
  the earlier conflicting counts: "3 personas" / "6–8 templates".)
- No feature-tour modals; the user lands in the editor with the template
  loaded.

**Layer 2 — contextual help (PARTIAL):**

- `HelpDialog` (toolbar, shortcuts + workflow docs) is SHIPPED. PROPOSED:
  per-panel "?" entry points opening the in-app help drawer (never an
  external browser tab), and hover/focus tooltips shown max once per session
  per control (tooltip-seen state persists via the settings store).
- Empty states: Problems panel and Publish panel have specified empty states
  (see §6/§10); every new panel must define one.

**Layer 3 — soft emphasis (NOT hiding):**

- Advanced features are **de-emphasized, never hidden or disabled**: a
  collapsed/badged "Advanced" menu grouping until the first successful PDF
  export, tracked per app installation in viewer prefs (userData), after
  which the badge (not the item) disappears. Everything stays reachable via
  menus at all times — hiding would contradict
  the Dev persona's "no escape hatches" pain point and would **regress
  shipped, ungated features** (#30 plugins, #32 themes).
- The **Theme selector is core to a good first PDF and is never gated**; only
  power-user surfaces (theme importer, visual layout editor #37, AI #36) get
  the Advanced badge.
- Settings tabs are the shipped **App / Editor / Saving / Connections /
  Advanced** ("for developers"); any regrouping is a PROPOSED delta.

Anti-patterns: full-screen onboarding carousels; auto-advancing tours; empty
workspaces with no guidance; requiring account creation (there are no
accounts — see Anti-Patterns table).

### 5. Print / layout tool UX

**Status: PARTIAL** — page navigation #20 and pre-export readiness #24 are
shipped; the visual layout editor is **#37 (open)**.

Reference research: InDesign/Affinity (preflight, master pages), Scribus
(what to avoid), Paged.js (engine).

From print tools, keep: page navigation for long documents; non-destructive,
always-revertible CSS overrides; preflight before export. Avoid: tool-mode
switching (markdown-first, not canvas-first); floating panels that lose
position; modal dialogs for live-editable properties (page size/margins);
exposing low-level engine concepts to non-technical users.

**Preflight (PROPOSED — tracked in #105; engine is SHIPPED):** the panel is a viewer
UI over the **existing check registry** (`packages/cli/src/checks/`: font
refs/licensing, broken local refs, heuristics, alt text, heading order,
print-safety CSS; post-build PDF checks — embedded fonts, page size, ink
coverage — per ADR 0002), exposed via a server route. It extends the shipped
#24 readiness check; it is not a parallel subsystem. Check tiers:

1. live (debounced ≥1s): metadata fields, link syntax;
2. on file save / asset add: file existence, image dimensions;
3. on opening the Publish panel or on demand: render-dependent checks (ToC,
   overflow) and post-build PDF checks (these require a built PDF and, for
   PDF/X, external qpdf/gs — they can never run per keystroke).

**Master pages / page templates (PROPOSED):** a UI over the **existing
`@page` / `@section` / `@chapter` markers** (markdown-it-paged, CLAUDE.md
§5/§6). "Section" = a marker block; "picking a template" = the inspector
writes/updates the marker's class argument (e.g. `@section chapter-opener`)
in the markdown source. Templates are plain CSS classes; the markdown file
remains the single source of truth. **No second sectioning model.**

**Visual layout editor (PROPOSED — #37):** #37 is the tracked spec
(page-spread canvas; regions map to named `@page` rules/classes; "the CSS
file remains the source of truth"; sub-issues required before
implementation). The interaction-model decision — #37's canvas vs the
click-region property inspector sketched in issue #40 — is reconciled **in
#37**, not here. Non-negotiables either way: writes target a defined layer
(e.g. a tool-managed overrides block appended last in the cascade); v1 edits
only token-backed properties (others shown read-only), so the tool never
writes raw values; the shipped **DesignSection token editor is the
baseline** it extends (do not build a second token panel).

**Overflow indicator (PROPOSED):** paged.js does not report overflow.
Detection = post-pagination geometry probe in the preview process
(content-area `scrollHeight/Width` vs client box; opt-out class for
intentional bleeds), surfaced through the ADR 0005 bridge to both the page
navigation UI and a Problems-panel entry with the page number.

### 6. Publishing workflow

**Status: SHIPPED baseline (#35, closed 2026-07-06)** — normative provider
detail lives in `docs/publishing.md`. Shipped: toolbar **Publish** button →
`PublishWizard` (choose destinations → one setup step per destination →
publish), five built-in providers, saved named credentials (`safeStorage`) with
an account picker, Settings → **Connections** tab.

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
│ [Fix all auto-fixable]  [Export PDF]    │
└─────────────────────────────────────────┘
```

- Every preflight rule declares `fixable: none | navigate | auto`. `auto`
  rules state their exact mutation (e.g. ToC → insert the ToC marker after
  frontmatter); auto-fixes that touch document content apply as a **single
  undoable edit**. "Fix all" runs `auto` rules only and reports what changed;
  `navigate` rules (like ISBN) get a Set… button; `none` rules explain
  themselves.
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
sidebar, selection actions (rewrite / expand / shrink / fix), TTRPG helpers,
and provider-agnostic configuration (OpenAI / Anthropic / local Ollama, keys
in the OS keychain, per-user). This section defers to #36 for all of that;
divergences below are labeled.

Binding constraints (regardless of final design):

- **Off by default.** AI activates only after the user enables it and
  configures a provider (Settings → Connections). With AI off, all AI entry
  points (toolbar button, `/ai`, chat panel) are **hidden**, not greyed out;
  the drawer, if reached, shows a one-card empty state ("Connect a provider
  to enable AI").
- Provider calls run **host-side** via an `api/ai/*` server route; keys live
  in host credential storage (reuse the ADR 0006 token layering). The UI
  discloses plainly that document text is sent to the configured provider.
  Local Ollama is the offline/no-cloud path (#36).
- AI never modifies text without an explicit accept step.

Interaction sketch (to be reconciled in #36):

- Chat panel (right drawer / bottom sheet on mobile), per-document history,
  "Apply" inserts at cursor or replaces selection. Slash actions align with
  #36's list (`/rewrite`, `/expand`, `/shrink`, `/fix`, …).
- **Inline ghost text is a proposed extension that appears nowhere in #36**
  — it requires scoping there (or a sub-issue) before any implementation.
  If built: triggers only while enabled, on pause ≥1.5s, never mid-word,
  never during rapid typing; 50% opacity; subtle gutter indicator while
  generating.
- Key precedence (binding): **Tab accepts ghost text only while ghost text is
  visible; otherwise Tab indents.** The slash menu opens only when `/` is
  typed at line start or after whitespace; `Esc` or a non-matching character
  dismisses; `/ai` is an entry in that menu, not a separate parser.

### 8. CSS editor

**Status: SHIPPED baseline** (#39, #68 follow-ups) with PROPOSED refinements.

Shipped: CSS editing is a **language mode of the single CodeMirror 6 editor**
(`css-editor.ts` — language compartment per file type), not a separate
tabbed/split panel. The lint gutter runs the **postcss-based print-safety
checker** (`checkCss`, the four `printsafe/*` rules) via the
`api/lint/check-css` route + `getPlatform().checkCss` — the same engine as
`print-md validate`. Completions are a curated paged-media table.

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
  ADR 0005 bridge); inheritance-only consumers are **not** highlighted; cap
  and badge the count above N matches.
- "Visual Mode" toggle → belongs to #37 (see §5).

### 9. Plugin manager

**Status: SHIPPED** (Config panel → `PluginsSection`, #30). This section is
rewritten around the actual plugin model; the original "app store" concept is
**rejected** as incompatible with CLAUDE.md §5 unless a future ADR changes
that rule.

The model (binding, from CLAUDE.md §5):

- Plugins are **plain markdown-it npm packages** declared in the project
  manifest. There is no plugin API, no registry, no auto-install, no sandbox.
- Build/export/validate **fail fast** on any plugin load error, identifying
  the offending manifest entry — a final artifact never silently omits
  author-configured formatting. Live preview **degrades and reports loudly**
  ("Not installed" badge + fix instructions); every skip is surfaced.

Shipped UI (the baseline to refine, not replace): configured-plugin list with
enable/disable toggle, "Re-check" validation, curated markdown-it
recommendations, add by npm name or local path, and the "Not installed" state
with a copyable install command.

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
- in-app install (the loader deliberately does not install; the "plugin
  install time" quality gate is deleted with it — see Quality Gates).

### 10. Problems panel

**Status: SHIPPED** (#28, `ProblemsPanel` + `problems.ts`) with a deliberately
**writer-first** design this contract preserves: entries grouped by file (not
a flat columned table), check ids translated to plain-language labels
("Broken link", "Print-safety (CSS)"), rule codes demoted to secondary text.
Raw rule-ID columns and rule-ID-first presentation are anti-patterns here.

- Bottom drawer, collapsible, badge with error/warning count
  (`aria-label="3 errors, 2 warnings"`).
- Click row → jump to location in the editor. PROPOSED: severity filters;
  Arrow-key row navigation with Enter-to-jump; inline "Fix" on auto-fixable
  rules (mirroring the preflight taxonomy in §6 — required before any
  "click-to-fix" quality gate can be measured).
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

Proposed refinements (#106):

- **Hover live preview** — renders the theme onto a **canned sample spread
  (2 pages) off-screen**; it never re-paginates the user's document (full
  re-pagination cannot meet the ≤500ms gate and would storm on hover).
  Full-document re-pagination happens only on Apply, with a progress state.
- **Revert instead of timed undo:** applying a theme records the previous
  theme reference; "Revert to previous theme" remains available indefinitely
  (theme application is a config/CSS-reference change, and snapshot commits
  already version project files — a volatile 30-second window is strictly
  weaker). A toast with an inline Undo button may sugar this, but the
  persistent revert is the mechanism.
- **ZIP drag-and-drop import**, validated against a defined **theme package
  format**: `theme.css` at root + optional `assets/` + optional `theme.json`
  (name/version); validation order = structure → CSS parses → print-safety
  check passes (note `printsafe/no-remote-urls` fails CDN-referencing themes
  — surface that clearly) → declares at least one `--print-*` token.
  Failures are errors; extra files are warnings.

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

**Status: SHIPPED (Phases 1–5) via #33/PR #63; Safari/OPFS Phase 6 deferred.
Normative: `docs/pwa-webadapter-plan.md` — reconcile against it, don't
respecify.** Existing pieces: `service-worker.ts` (app-shell precache,
registered only when `!isDesktop()` — the desktop build must never register
it), manifest, `WebAdapter` (FSA primitives + IndexedDB persistence),
capability gating via the platform seam.

- Installable per the plan; `display: standalone`; theme-color follows the
  app theme.
- Offline cache scope and indicator copy: see §3 (one definition, used
  everywhere).
- File access: File System Access API where available; IndexedDB-backed
  fallback (both exist in `WebAdapter`); Safari/OPFS is the deferred Phase 6.
- **PDF export and publishing are desktop/CLI-only** (#33 constraint): the
  affordances are hidden or show "requires desktop" on web/mobile.

---

## Measurable quality gates

### Measurement prerequisites (blocking)

The app has **no telemetry, no analytics events, no consent flow, no support
system** — and this contract's own privacy stance (see Typography: no font
CDNs) applies with more force to behavioral data. Therefore:

- **No session recording in production, ever** — recording a writing app
  captures manuscripts. Recordings happen only in consented usability
  studies.
- Any in-app metrics require the telemetry/consent decision (**#108**) first
  (first-run consent, kill switch, published event schema, no content
  capture, offline queueing, user-inspectable data — or a formal "no
  telemetry" decision). Until #108 is resolved, every gate below marked
  *(telemetry)* is **aspirational, not enforceable**.
- "Support ticket rate" → replaced by GitHub-issue rate / usability-test
  observation.

### Canonical first-PDF metric (single source of truth)

- **Target: P50 time-to-first-PDF ≤ 5 minutes** (app open → PDF written via
  the native save dialog; new user; template project).
- Completion: **≥85% of new users export within 10 minutes** (≈P85).
- Regression gate: any release where P50 exceeds 5 minutes.
- Measured via moderated/unmoderated usability tests until telemetry exists
  *(telemetry)*.

### Task completion targets

| Task | Target | Method |
|---|---|---|
| First PDF exported | per canonical metric above | usability test *(telemetry later)* |
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
| Publish failure (user-caused, preflight-caught) | ≤5% | provider e2e tests + issue reports *(telemetry)* |
| Publish failure (app-caused) | ≤1% | same |
| PDF export crash | 0 in the e2e suite; fleet rate *(telemetry)* | CI gate |
| Data loss | none beyond the last auto-save debounce (500ms) + recovery snapshot (1s) — crash recovery must restore to within 1s of the last edit | recovery test suite |

### Performance gates

Measured against **named, checked-in fixtures** on a named reference machine,
wired into the existing perf harness (`tests/perf/render-gate.mjs`) — tracked
in **#107**:

| Metric | Target | Fixture / condition |
|---|---|---|
| Cold launch → editor accepts first keystroke | ≤2s P90 | reference machine (M1 MacBook Air + CI runner) — replaces the undefined "TTI" |
| Preview re-render after keystroke | ≤300ms | `bench/novel-50p` (text-only) |
| PDF export | ≤8s | `bench/novel-50p`; image-heavy budget set separately by `bench/zine-24p` |
| Theme switch (hover sample-spread render) | ≤500ms | sample spread only — full-document re-apply is exempt above N pages and shows progress |

Mobile/PWA performance targets are set in `docs/pwa-webadapter-plan.md`
follow-ups with a named reference device — "mid-range Android" is not a
device class.

### Satisfaction

- SUS ≥80; task satisfaction ≥4.0/5 — measured in the quarterly usability
  study (see small-n note). **No in-app day-7 survey** unless it gets its own
  issue, a defined trigger, and a surface in the screen inventory; NPS
  cohort tracking requires the telemetry prerequisites.

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
  every desktop OS, so Safari never tests the desktop app):
  - Windows: **NVDA + the app**;
  - macOS: **VoiceOver + the app**;
  - PWA: NVDA + Firefox/Chrome (Windows), VoiceOver + Safari (iOS — note
    Safari support is the deferred #33 Phase 6), TalkBack + Chrome (Android).
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
  slide-ins, ghost-text fades; state changes become instant.

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
implies adopting Tailwind, which the viewer does not use** — bits-ui alone
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
  font fetching of any kind** (privacy + offline; this is the same standard
  the telemetry rules follow).

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
| Save-confirmation modal/toast ("Saved!") | Interrupts writing | Subtle indicator; auto-save is shipped (§3) |
| Blocking publish modal with progress | Forces spinner-watching | Side-drawer progress log (§6) |
| Floating panels that reset position | Lost state | Docked panels, persisted layout |
| Color-only state indication | WCAG / color-blind users | Icon + color + label |
| Unlabeled icon-only buttons | New users, screen readers, touch | `aria-label` + tooltip (pointer) / long-press label (touch) |
| Requiring an account or purchase before first export | Abandonment, trust; **there are no accounts or tiers** — MPL-2.0 local-first app | All core features work with no account; provider sign-in only at the moment publish/sync needs it |
| AI modifying content without accept | Trust violation | Ghost text / explicit apply only; AI off by default (§7) |
| Tooltips that vanish on mouse move | Motor-impaired users | ≥300ms hide delay; persists while hovered |
| Auto-advancing feature tours | Patronizing | On-demand contextual help |
| Hiding features behind unlock gates | Contradicts escape-hatch principle; regresses shipped UI | Soft emphasis: Advanced badge, never hidden (§4) |
| Opening help in an external browser tab | Breaks flow; offline failure | In-app help drawer (HelpDialog) |
| Print-tool "modes" (pointer/text/frame tools) | Wrong mental model | Markdown-first; properties in inspector |
| Requiring save before preview | Breaks the live loop | Shipped: 500ms debounced save + live preview |
| Raw Paged.js / `@page` errors shown to authors | Opaque, frightening | Plain-language Problems entries (shipped, §10) |
| Raw rule IDs / linter jargon as primary text | Writer-first product | Plain-language labels, codes demoted (shipped, §10) |
| Reintroducing stylelint or any bundler-hostile dep for editor lint | Breaks `bun build --compile` (CLAUDE.md §3) | Extend `printsafe.ts` |
| A print-md-specific plugin API, plugin sandbox/permissions UI, or in-app plugin installer | Contradicts CLAUDE.md §5 | §9's manifest model; ADR first if this ever changes |
| Settings with >30 items in a flat list | Overwhelming | Shipped tab structure (§4) |

---

## References and inspiration

**Editor UX:** iA Writer (focus, typography-first) · Typora (seamless toggle)
· VS Code (problems panel, split editor; its palette is `Ctrl/Cmd+Shift+P`) ·
Obsidian (panel flexibility, community themes) · Bear · Ulysses.

**Print/layout:** Affinity Publisher 2 (preflight, masters) · Canva
(non-designer layout) · Visme (template-first onboarding) ·
[Paged.js](https://pagedjs.org/) (the actual engine).

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
- ⏳ Preflight panel over the existing check registry (§6 taxonomy: fixable none/navigate/auto) — **#105**
- ⏳ Theme package format + ZIP import + hover sample preview — **#106**
- 🆕 Publish progress drawer (push-stream seam) · ❌ publish history — evaluated, not planned
- ❌ Page thumbnail navigator — evaluated, not planned (pager + TOC cover it)
- ⏳ Visual layout editor — **#37**; blocked on #37 sub-issue scoping (do not schedule as near-term)
- ⏳ AI assistant — **#36** (off by default, host-side, §7 constraints)

### Quality-gate measurement
- ⏳ Telemetry/consent decision — **#108**; **blocks** every *(telemetry)* gate
- ⏳ Benchmark fixtures (`bench/novel-50p`, `bench/zine-24p`) wired into `tests/perf/render-gate.mjs` — **#107**
- 🆕 Quarterly usability-study protocol (owner, recruitment, 2 priority personas)
- 🆕 Accessibility audit: axe-core automated + manual NVDA/VoiceOver passes per the matrix

---

*This contract is a living document, revised via PRs. It was rebuilt from
issue #40 after a full review against 0.8.0-beta.1 — see the review comment on
#40 for the complete list of corrections and their rationale.*
