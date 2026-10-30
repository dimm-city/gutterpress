# Gutterpress UX Design Contract

> **Status: draft revision** of the contract originally proposed in issue
> [#40](https://github.com/dimm-city/gutterpress/issues/40). Baselined against
> desktop **0.10.10** (2026-08-26).
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

This contract governs the **desktop application** (the Electron app). There
is no browser/PWA target (docs/architecture-rules.md §8).

**Out of scope:** the CLI (`gutterpress new/build/preview/validate/publish`). The CLI
is the power-user and CI surface (see the repo README: "a desktop application
(with a CLI for power users)") and is governed by `packages/cli/README.md` and
`docs/publishing.md`. Developer users are expected to move between the app and
the CLI; nothing in this contract should assume the app is their only path.

## Architectural constraints (normative, external)

The following documents constrain every pattern in this contract. **Where this
contract and those documents conflict, the architecture documents win.**

| Rule | Source | UX consequence |
|---|---|---|
| Renderer stays PWA-clean; host capabilities via server routes (default) or the Platform seam (push streams, BrowserWindow calls, host fs primitives) | `docs/architecture-rules.md` §8 | Theme import file IO, AI/publish network calls, preflight fs checks → server routes. Publish/build **progress streams** → the adapter/IPC push seam. No `node:*` or lib value-imports in the SPA. |
| Preview bridge protocol | `docs/inline-editing-plan.md` | Sync scroll, page navigation, outline, any preview overlay or overflow probe must go through the bridge. |
| Plugins are plain markdown-it plugins; no plugin API; loader never auto-installs | `docs/architecture-rules.md` §5 | Constrains §9 (Extensions) below. |
| PDF rendering = Electron `printToPDF` (desktop) / a system Chromium driven over raw CDP (CLI); pure-JS tooling posture | `docs/architecture-rules.md` §1/§3 | Preflight/export UX; "export" not "download". |
| Git/GitHub operations are Node-native pure JS | `docs/architecture-rules.md` §7 | Project source / sync / provider-auth UX. |
| `$effect` is eslint-banned in the SPA; persisted preferences flow through the settings store's `onSettingsChange()` channel | `docs/architecture-rules.md` §8 | Every persisted preference this contract specs (font size, pane layout, sync toggle, tooltip-seen state). |
| All changes must REDUCE complexity unless properly justified | [AGENTS.md Primary Goals](../AGENTS.md#gutterpress-primary-goals) | Every PROPOSED item needs a scoped issue before implementation. |

---

## Vocabulary (what an Author reads)

Gutterpress keeps an author's work safe without the author learning how. They meet
four ideas, each one they already know from other apps, and one place to look. Git's
words never reach an Author (UI, toasts, Help, the desktop guide): *commit, branch,
push, pull, merge, remote, repository, snapshot, sync, HEAD, clone*. Three exceptions:
"(GitHub calls it a repository)", once, where the author must act on github.com; the
commands an author pastes into their own Git tool (the SSH hint); and the Sync
button's own words (the **Sync** row below). Where this
section and the vocabulary review in #448 differ, this section wins.

| Idea | What the author sees | Familiar from | Underneath |
|---|---|---|---|
| **Saved** | "Saved" | Google Docs, Word AutoSave | file write |
| **Version history** | a list of earlier versions of the book; go back to any one | Version history in Google Docs and Word | commits |
| **Online copy** | the book kept online, up to date on its own; collaborators' changes arrive on their own | Dropbox, Google Drive | a remote (GitHub or a Git server) |
| **Revisions** | separate lines of work in the same book ("Second edition", "Editor's pass") that you can start, switch, rename and delete; each says whether it is also online | a revised edition of a book | branches |

| Use | Never | Notes |
|---|---|---|
| **Saved**, Saving…, Couldn't save | — | typing written to this computer |
| **version**, **Save a version**, **Version history** | snapshot, commit, restore point, history (alone), previous versions | **Version history** is the one name: status link, view title, Book setup, Help. The Settings switch is **Keep version history**; turning it on for a plain folder is **Turn on version history**. |
| **Restore this version** | revert, checkout | going back to a version |
| **online copy** | online backup (noun), remote, repository, online repository/address/location | the book kept online |
| **Back up** / **Backed up** / **Backing up…** / **Not backed up yet** | sync, push, upload | "Backed up" is shown only when a pass sent your work or there was nothing to send. |
| **Sync** / **Sync now** / **Syncing…** | Get latest, Back up now, pull, fetch, push | the one manual button, shown only with automatic backing up off: status bar **Sync**, Online copy **Sync now**, and the action on the "New changes are online for this book." toast. It gets the latest changes from the online copy, then backs up yours. Tooltip: "Sync: get the latest changes from the online copy, then back up yours" ("Sync — new changes are online: get them, then back up yours" when some are waiting). Nowhere else says "sync" to an Author; status texts stay Backed up / Backing up…. |
| **revision**, **New revision…**, **Revision you're working on** | branch, copy (for a branch), version (for a branch) | "copy" means only the online copy |
| **take**: "Two takes of a passage were kept in chapter-02.md — yours and the online copy's" | two versions, your version, online version | one side of a passage changed in two places. Buttons stay "Keep yours / Keep online / Keep both". The on-disk markers `<<<<<<< your version` / `>>>>>>> online version` and `name.online.ext` stay (a file format in existing books). |
| **sign-in**, **Sign in again** | connection, reconnect, token (except "access token" where a writer pastes one) | |
| **safety folder** | full copy of the folder, backup (for it) | Start over's kept folder |
| **Recover** (crash recovery) | Restore (now means a version) | |

The messages Gutterpress writes into a book's history show on github.com. The Version
history timeline recognises every spelling ever written, forever, and labels the
history-start versions "First version":

| Moment | Message |
|---|---|
| automatic | "Automatic version" |
| first version | "First version" |
| Save a version | "Saved a version" |
| before backing up | "Automatic version before backing up" |
| before restoring | "Automatic version before restoring" |
| before switching revision | "Saved before switching revision" |
| repair | "Repaired the online copy" |
| before deleting | "Before deleting X" |
| an edit saved during a backup | "Saved the edit you made while backing up" |
| before combining with the online copy | "Getting your changes ready to combine with the online copy's changes" |
| combining with the online copy | "Combined your changes with the online copy's" |
| keeping both takes of a file that can't be combined | "Kept both takes of the files that can't be combined" |

---

## Vision Statement

Gutterpress transforms markdown into beautifully paginated PDFs with zero layout
friction. It meets authors where they work — in prose and in code — and
stays invisible until they
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
├── Welcome / start screen                     SHIPPED  (WelcomeLanding: Books / Help /
│                                                        Troubleshooting tabs — continue card +
│                                                        recents/favorites/discovered via
│                                                        ProjectsListBody, and in-app help;
│                                                        Accounts and Settings buttons in the
│                                                        header)
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
├── Book setup                                 SHIPPED  (ProjectSettingsView, the toolbar's Setup
│   │                                                    button, hidden for a Reader; title
│   │                                                    "Book setup"; tabs Book / Look /
│   │                                                    Extensions / Online copy, Advanced set apart
│   │                                                    at the right; one Saving…/Saved in the
│   │                                                    header; every tab saves as you go; #442)
│   ├── Book (id `book`)                       SHIPPED  (DetailsSection: title, authors, page size,
│   │                                                    margins, print checks, then chapters by
│   │                                                    title with "Not in the book" below, then
│   │                                                    Save as template)
│   ├── Look (id `look`)                       SHIPPED  (LookSection: Choose a look (a one-choice
│   │                                                    gallery), Adjust the look (six brand
│   │                                                    settings beside a live sample))
│   ├── Extensions (id `extensions`)           SHIPPED  (ExtensionsSection: Your extensions (the
│   │                                                    manifest's ordered list: checkbox, move,
│   │                                                    Remove), then Add an extension: the
│   │                                                    built-in extras the book does not list,
│   │                                                    each with what to type, an npm search,
│   │                                                    then exact-name, folder, .zip/.css and
│   │                                                    web-address adds)
│   ├── Online copy (id `online-copy`)         SHIPPED  (ProjectConnectionsSection: one sentence for
│   │                                                    the book's situation and at most one
│   │                                                    primary action; GitHub or the book's own
│   │                                                    server sign-in in place; "Saved · last
│   │                                                    version …" with Save a version and Version
│   │                                                    history…; Revisions (RevisionsList: switch,
│   │                                                    new, rename, delete, each saying where it
│   │                                                    is kept); and, collapsed, "If backing up
│   │                                                    keeps failing": Test connection (this
│   │                                                    book's online copy), Repair the online
│   │                                                    copy, Start over from the online copy and
│   │                                                    Sign in again; #448)
│   └── Advanced (id `advanced`)               SHIPPED  (the ONE advanced path: Open manifest.yaml,
│                                                        the Stylesheets list (StylesSection: the
│                                                        manifest's `styles:` in order, each with
│                                                        move, Open and Remove, and the book's other
│                                                        .css files to add), and every design
│                                                        setting (DesignSection))
├── Project source / version history / GitHub  SHIPPED  (#12–#16, the Node-native git layer; AdvancedSetupDialog,
│                                                        GitHubDialog; the status bar's one status
│                                                        control, Authors only; Version history inside
│                                                        Book setup → Online copy; #448)
├── Media panel                                SHIPPED  (MediaPanel, #47)
├── Crash recovery                             SHIPPED  (RecoveryOverlay / CrashRecoveryDialog)
├── Settings                                   SHIPPED  (SettingsView: one page in its own sheet,
│                                                        no tabs — How you use Gutterpress
│                                                        (Reader or Author), Appearance, Saving,
│                                                        and Accounts… (opens Accounts);
│                                                        opened by the status-bar gear, Ctrl+, and
│                                                        the start screen's Settings button; it
│                                                        never reads the open book, so it is the
│                                                        same everywhere; #442)
├── Accounts                                   SHIPPED  (AccountsView: one page in its own sheet, like
│                                                        Settings — the one place to manage every
│                                                        connection, saved on this computer and
│                                                        used by every book. Groups, each listing
│                                                        what is saved with one Add button that
│                                                        opens a compact inline form: Your name
│                                                        and email (moved from Settings; same
│                                                        keys, saved on change); GitHub (Connect,
│                                                        or Test sign-in / Sign in again… /
│                                                        Disconnect); Other Git servers (Add,
│                                                        Edit, Remove — host, optional username,
│                                                        token, checked with the server first);
│                                                        Publishing (a key for each provider that
│                                                        takes one, with an optional account
│                                                        name, and Google Drive's sign-in: Add,
│                                                        Edit, Remove). Edit replaces the stored
│                                                        secret; it is never shown. Opened by the
│                                                        start screen's Accounts button, Settings
│                                                        and Book setup → Online copy, and by the
│                                                        missing name & email notice with the
│                                                        cursor in Name, over whichever opened it)
├── Visual layout editor                       PROPOSED (#37 — milestone placeholder; sub-issues first)
└── AI Assistant                               PROPOSED (#36)
```

Document theming (looks, design tokens, stylesheets) and features (plugins)
live in **Book setup** — the Look tab chooses a look and adjusts its brand
settings, the Extensions tab holds the extension list and turns the extras on,
and Advanced holds the stylesheets and every design setting — not app
Settings: app appearance and print theme are deliberately separated
concepts; do not merge them back. The Accounts page is the one place to manage every
connection — connect, edit and disconnect GitHub, other Git servers, publishing keys and
Google Drive — and the author's name and email. The task that needs a connection still
offers it in place, saving to the same store: a book's GitHub or Git server in its Online
copy tab, a publishing key in Publish. Where those forms match the Accounts ones they are one
component (GitHubConnect, GitServerForm). Backing up that keeps failing is fixed in the
book's Online copy tab; Troubleshooting holds Logs, Diagnostics and Report a problem only.
Diagnostics puts the update check and the update channel menu on the Desktop version line
(no separate Updates section). One name
per surface: the toolbar button, the page title and the docs all say "Book
setup"; the status-bar gear, the shortcut and the page all say "Settings".

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

**Status: SHIPPED** (0.10.0 — tracked by **#135** Tier 0 and **#136** Tier 1;
implementation plan `docs/inline-editing-plan.md`, rationale
`docs/adr/0009-inline-editing-source-ranges.md`).

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

### 3. Saving, versions and revisions

- **Auto-save is SHIPPED and works as follows** (do not respecify): a FIXED
  debounced disk save 500ms after the last edit (`EditorBuffer`) and an
  ALWAYS-ON crash-recovery draft 1000ms after the last edit, plus explicit
  `Cmd/Ctrl+S` / toolbar Save. Neither delay is a user setting (#274), but
  auto-save itself is an on/off switch, default on: Settings → Saving, "Save
  changes automatically" (owner request 2026-09-25 — with no way to turn it
  off, the Save button had nothing to do). Off, edits wait for Save /
  `Cmd/Ctrl+S`, the toolbar Save stays lit while anything is unsaved, the
  status bar reads "Unsaved changes", and the preview updates on save.
  Leaving a file with unsaved edits (switching files, books or projects,
  closing the project or the window) asks a native Save / Don't Save /
  Cancel — the one modal in the saving flow, and only when auto-save is
  off. The status control itself stays subtle (no modal) — see
  Anti-Patterns.
- **One status control, Authors only, is SHIPPED** (#448): the status bar's one
  line combines saving and the online copy — "Saving…", "Saved on this
  computer", "Saved · Backed up", "Saved · Backing up…", "Saved · Offline —
  backs up when you're back", "Saved · Sign in to back up", "Saved · Backing up
  paused", "Saved · Not backed up yet", "Couldn't save", "Versions need
  attention" — with a shape (check, cloud, warning, error) carrying the tone, not
  colour alone. Clicking it opens Book setup → Online copy, the one place for
  versions, version history, revisions and the online copy. It sits on the
  left, after the book switcher. With automatic backing up off, one **Sync**
  button sits beside it and "New changes are online for this book." stays a
  toast with Sync. A Reader sees none of it: no control, no
  buttons, no online toasts (a Reader gets the latest changes automatically).
- **Revisions are SHIPPED in Book setup → Online copy** (#448, which replaced
  #273's switcher in Settings → Saving): the list names each revision, marks
  the one the author is working on, and says where each is kept (Online; Online
  · not backed up yet; Only on this computer; Only online). The open revision
  comes first, then the rest by name; past five revisions a **Find a
  revision** field filters them, and the list scrolls in its own box after
  about six rows. **New revision…** sits above the list: it starts from what
  is open now, switches to it, and goes online with the next backup. Switch
  (saves a version of in-progress edits first; an online-only revision is
  made on this computer first), Rename… and Delete… (never the open one) act
  at once, and say what they do before they do it: an online revision is
  renamed or deleted in the online copy too, when the author asks; an
  online-only revision can be deleted from the online copy (refused, changing
  nothing, when it changed online since the list was checked); and a revision
  holding versions found nowhere else asks a second time.
- **Version history is SHIPPED as a screen of its own** (#448): Online copy's
  Version history card lists the newest versions with **Save a version** and
  **Browse versions**, which (or a listed version) opens the screen over Book
  setup — the versions on the left grouped by day, the selected one on the
  right with its **Pages** rendered as they were or its **Changed files** line
  by line, and **Restore this version** at the top. × or Esc returns to Book
  setup. It never takes over the editor pane.
  Author-facing vocabulary says "revision", never "branch"; "copy" means only
  the online copy. The editor/file tree/preview show the new revision the same
  way they pick up any other external change.
### 4. Onboarding — progressive disclosure

**Status: PARTIAL** (#25 wizard + templates, #27 project finder,
`WelcomeLanding` shipped 2026-07-06; contextual tooltips PROPOSED).

**Layer 1 — first run (SHIPPED baseline):**

- `WelcomeLanding`: three tabs — **Books** (continue card with live
  pre-render status + recents / favorites / discovered projects), **Help**
  and **Troubleshooting** — and **Accounts** and **Settings** buttons in the
  header, each opening its own page. It always opens on **Books** — picking or
  continuing a book is the screen's job. A missing name/email is raised by
  the workspace's standing identity banner, whose button opens Accounts with
  the cursor in Name. The **Create a new book** card is shown in both roles;
  creating a book sets the role to Author, so the new book opens with Edit,
  Setup and Publish in the toolbar (no toast: the toolbar is the
  confirmation). The role is the first group in Settings, **How you use
  Gutterpress**: **Reader** (the default for a fresh profile) shows just the
  pages — the workspace stays in Read, the toolbar has no Edit/Read, Setup or
  Publish (removed, not disabled), Focus has no Edit/Read switch, and the left
  panel has the table of contents only, without Files or Media; **Author**
  shows everything. Settings and Accounts are the same in both.
  `NewProjectWizard`: template first (**4 built-in templates** — Book, Zine,
  Technical document, Academic paper — plus custom templates, save-as-template,
  import-from-folder); each template lists its look (Clean book, Zine,
  Technical doc, Academic) and its description says so. The chosen template
  seeds the book's page size (a `custom` template's own size shows pre-filled)
  and publish targets (ADR 0008), all of which stay editable. Step 3 asks
  "What size should the pages be?" (DriveThruRPG print / Trade paperback /
  Another size) and "Check the finished PDF against a print service's rules?";
  Create is never disabled for a missing folder — pressing it asks for one.
- Templates come from the **shared lib scaffolding** in
  `gutterpress` (same set behind `gutterpress new`; docs/architecture-rules.md §7 "one
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
- Book setup's **Book and Look tabs are core to a good first PDF and are
  never gated**. Its **Extensions** tab is the one place for the extension
  list — the built-in extras, npm, folder and web extensions, and their order
  — and its **Advanced** tab is the one place for the stylesheets, every
  design setting and the manifest; the other tabs link to them and never
  repeat their controls.
- **Every Book setup tab saves as you go; there is no Save button.** Text
  fields commit when you leave them or press Enter; pending edits are saved
  when you switch tabs or close the panel. A commit writes only what changed
  (a title edit never rewrites the page size or `targets:`).
- Settings is one page with no tabs (How you use Gutterpress, Appearance, Saving, Accounts…), reached
  from the status bar's settings button, `Cmd/Ctrl+,` and the start screen;
  your name and email and every account are a page of their own (Accounts).
  Any further regrouping is a PROPOSED delta.

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
exposing low-level engine concepts to non-technical users. The page size and
margins are the manifest's (`preset:`, `page:` with `width`, `height` and
`margin`), edited on Book setup > Details in inches with no stylesheet
involved; a look never sets either, so margins never need a hand-written
rule.

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
`@page` / `@section` / `@chapter` markers** (`markers.js`, docs/architecture-rules.md
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
an account picker, the **Accounts** page.

**Shared vs private (binding):** the team decides where a book is published,
so that is saved in the **manifest** (`publish:`) and travels with the book:
the destinations ticked in the wizard (`publish.<id>.enabled`), each one's
settings (itch.io target and channel, Shopify store and product, Azure
environment, DriveThruRPG product URL, the **Google Drive folder**, the format)
and the output folder when it is **inside the book** (saved relative to it,
`dist` by default). A teammate who opens the book finds the same destinations
ticked and the settings filled in; the only thing they do is connect their own
account. What is one person's own stays on their computer, in private settings
keyed to the book (`publish-selections.json` in the app's user-data folder,
never in the manifest): **which of their saved accounts the book publishes
with**, and an **output folder outside the book** (a personal override; an
absolute path is never written to the manifest). Precedence when publishing:
the private value, then the manifest, then the default. The host files each
value where it belongs when it is saved (the renderer never decides), and an
older book's account or absolute in-book folder is moved on the next save of
it; opening the wizard rewrites nothing. Detail and the full table:
`docs/publishing.md`.

**One place for accounts (binding):** the **Accounts** page is where accounts
are managed. The wizard lists the provider's saved accounts, lets the author
pick one for this book, and adds or replaces one in place with the Accounts
page's own `PublishKeyForm` (a key, or the Google sign-in) through the same
`api.publish.connect` route; it keeps no key-entry markup or drafts of its own.
A **Manage accounts** link opens the Accounts page over the wizard (removal
lives there only, with its confirm), and the wizard reloads when it closes.
A teammate whose account is not connected sees, for each destination the book
uses, one step: connect (the form is right in the step) or pick one of their
saved accounts (**Choose an account…**); they never re-enter the team's
settings.

**Provider model (binding):** providers are **built into the lib's publish
registry** (`packages/cli/src/lib/publish/`) — they are *not plugins* and there
is no "publish plugin" category (docs/architecture-rules.md §5). New providers are code
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
  and gitignored (docs/architecture-rules.md §7 snapshot commits capture anything un-ignored).

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
  configures a provider (Accounts). With AI off, all AI entry
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
> because it cannot survive `bun build --compile` (docs/architecture-rules.md §3). New lint
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

### 9. Extensions (one list: looks, features, component libraries) — on screen: Look and Extensions

**Status: SHIPPED** (one manifest list, `extensions:`, since #265; shown
since #442 as Book setup → **Look** for the main path — a look chosen from a
gallery — and, as its own **Extensions** tab, the list itself and everything
that adds to it, `ExtensionsSection`). This section is rewritten around
the actual plugin model; the original "app store" concept is **rejected** as
incompatible with docs/architecture-rules.md §5 unless a future ADR changes
that rule.

The model (binding, from docs/architecture-rules.md §5 and #265):

- Plugins are **plain markdown-it packages**, each one entry in the project
  manifest's `extensions:` list — the same list that holds looks and component
  libraries. An entry is a bare specifier whose form says what it is: a
  bundled name (a feature or a look — nothing to install, works offline), a
  `./` path referenced in place, or an npm package pinned as `name@version`.
  There is no custom plugin API, hosted Gutterpress registry, or sandbox.
  Explicit install (`addExtension` — the same shared-lib function `gutterpress
  ext add` calls) resolves the public npm registry and vendors an exact
  version plus its runtime dependency tree; the build/preview loader itself
  never installs or accesses the network. The desktop host confines the
  target to the open project and requires a native confirmation that says
  third-party code receives full filesystem and network privileges.
- Build/export/validate **fail fast** on any plugin load error, identifying
  the offending manifest entry — a final artifact never silently omits
  author-configured formatting. Live preview **degrades and reports loudly**
  ("Not downloaded yet." with Install on the Extensions row); every skip is
  surfaced.
- **List order is load order and cascade order.** A later entry runs after
  earlier ones and sees their output, and its CSS wins ties; the project's
  own `styles:` always load after every extension. Reordering the list is the
  only ordering control — there is no `priority`, and the UI must not invent
  one.

Shipped UI (#442). **Look** is the main path: *Choose a look* is a
one-choice gallery of thumbnails (the built-in looks and any npm or folder
look in the list), and choosing replaces the book's look in place in
`extensions:` — a built-in look is removed, an npm or folder look switched
off — with no toast; a book with two enabled looks gets a notice and the way
to the Extensions tab instead of a guess. **Extensions** is the list itself
and the only place its entries are changed: *Your extensions* shows the
manifest's `extensions:` entries in order, each row a checkbox (on/off), the
label, its kind and source in words ("Look · built in", "Extra · npm
3.0.0"), move up/down and Remove. A row says something only when it needs
attention: "Version x is available." with Update, "Not downloaded yet." with
Install, "Couldn't load." with Show details and Check again. Updates are
checked once when the tab opens, never at project load. Below the list, one
*Add an extension* area, in three parts. The **built-in extras** the book does
not list yet (Highlight, Callouts, Math…), each with what to type and an Add
button. **Find one on npm** is the way to a published extension: a search box
whose results are the lib's `searchNpmExtensions` (what `gutterpress ext
search` prints — packages tagged `gutterpress` or `markdown-it-plugin`),
asked only when the author submits it (Enter or Search; with nothing typed it
lists the most relevant), never at project load or on a keystroke. npm
filters by keyword and only ranks by the words, so a typed search keeps the
results whose name, description or keywords mention every word. Each result
is the package name, its description, its kind when npm's keywords say (a
`gutterpress-look` package is a Look, a plain markdown-it plugin an Extra) and
an Add that is the same add as typing the name — or "Added" when the book
lists it. No results, being offline and any other failure are one plain line
under the box ("No extensions found for …", "Couldn't reach the npm
registry…"), never a toast. **Other ways to add** are an exact npm name or
`name@version` (for a package search cannot find, such as a private one), a
folder or file referenced in place, a `.zip`/`.css` import and a web address
(§11). A built-in extra is never shown twice: while the book lists it, it is
a row of the list; Remove puts it back among the ones to add. (Footnotes,
tables and definition lists need no extension and are always on, which the
area says.) No status badges, no version picker and no pre-release switch
(`gutterpress ext add name@version`).

Refinements (PROPOSED): link each plugin to its npm page for
author/version/last-published metadata; surface load errors inline.

Explicitly **removed** from the earlier draft (each would require its own
ADR-level proposal and a docs/architecture-rules.md §5 amendment):

- install counts / reviews (presumes a hosted registry that doesn't exist);
- "permissions requested" (plugins run in-process with full privileges — a
  permission display with no sandbox is a false security affordance; instead
  the UI states plainly: *plugins are ordinary npm packages that run with
  full application access* and links to the package source);
- the category filter "themes / publish providers / lint rules / AI providers
  / snippets" — none of those are plugin types (looks = styles-carrying
  extensions in the same list #32/#265, publish
  providers = built-in lib modules #35, lint = built-in printsafe, AI =
  settings-configured #36, snippets = project folder #29);

### 10. Problems panel

**Status: SHIPPED** (#28, `ProblemsPanel` + `problems.ts`) with a deliberately
**writer-first** design this contract preserves: entries grouped by file (not
a flat columned table), check ids translated to plain-language labels
("Broken link", "Print-safety (CSS)"), rule codes demoted to secondary text.
Raw rule-ID columns and rule-ID-first presentation are anti-patterns here.

- Bottom drawer, collapsible, badge with error/warning count
  (`aria-label="Problems: 3 errors, 2 warnings"`). The list is a row of its own
  above the status bar, in normal flow: opening it pushes the workspace up and
  never overlays the left panel or the editor (#307). Below 820px it is a
  full-viewport sheet with its own Close button instead.
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
- Empty state: nothing to open. The status bar reads "No problems" beside a
  tick and the toggle gives way to that plain label (#307). A list already open
  when its last problem is fixed says "No problems found — your project looks
  good!" until dismissed.

### 11. Looks and the Look tab

**Status: SHIPPED baseline** (#32; since 0.11.23 a look is a styles-carrying
entry of the one `extensions:` list, §9; since #442 it is chosen and
adjusted on Book setup's **Look** tab) with PROPOSED refinements tracked in
**#106**.

Shipped: the Look tab's gallery offers the built-in looks (bundled names:
nothing is copied) and any npm or folder look already in the list; the
Extensions tab adds a look from npm, a folder referenced in place, or a **folder, ZIP, CSS
file or URL** import (`extension-import.ts`, reached through server routes).
Every gallery card shows a **rendered thumbnail** of its CSS over a fixed
sample; there is no hover preview.

A bundled look never sets the page size or margins; the manifest (Setup >
Book) does, and `assemble.ts` writes them as the `@page` rule after every
stylesheet, so a look from elsewhere that sets a size is overridden (the CSS
check reports it) and its margins hold only until the book records its own
(`page.margin`). The Book tab writes the manifest and nothing else. A book
that recorded margins takes them out again with **Use the look's margins**
(or **Use the default margins** when no stylesheet sets any), which removes
`page.margin`; the fields then show what the book prints with. A manifest
that overrides a preset's size (`preset: book` plus a `page:` width and
height) shows the preset, with a note that choosing a size here replaces the
override.

**Adjust the look.** Six brand settings — Body text font, Heading font, Body
text size, Line spacing, Text color, Accent color — the shared tokens every
built-in look defines, so a choice carries across looks. They sit beside a
live sample page that redraws as each setting changes (a typed color or
number counts once it is committed, on blur or Enter, and only a color is
saved as a color). Every edit is written to
the **book's own stylesheets** (`styles/book.css`, created with an empty
`:root {}` and added to `styles:` on the first edit when the book has none),
host-side with postcss (#454): the token's root-level `:root` declaration is
updated in place in the last of the book's sheets that has one, otherwise it
is added to the `:root` block of the first; a declaration in any other rule,
in `@media` or `@supports`, or in a comment is left alone, and every other
byte of the sheet is kept. **Reset to the look's settings** asks first ("Replace your
settings with Clean book's?" **Replace** / **Keep mine**), then removes the
book's declarations of the six, so the look's values show through; Advanced's
Undo changes restores them. A look's own files are never
written; there is no eject or copy of a look.

**All design settings** (Advanced). `DesignSection` shows the root-level
`:root` custom properties of the book's stylesheet **as the build assembles
it** (#454): every enabled extension's — bundled, npm or path, its
stylesheet files and a plugin's `css` export — and every one of the book's
own `styles:` sheets, read host-side with postcss (`style/book-css`), each
with the value the sample page computes for it (`getComputedStyle`, so the
cascade is the browser's), with each variable's name, a per-row "Use the look's
value", and Undo changes for the visit. Derived labels are plain words
(`--fs-display` → "Display size"); a look labels its own extra tokens with
`@label`. A compound value (`1pt solid …`) is edited as text, never as a
bare number. The book's stylesheets are the manifest's `styles:` list, shown
on **Advanced › Stylesheets** with the extension list's rows: the path, move
up/down, **Open** (the file opens in the editor and Book setup closes) and
**Remove**, in load order ("a later one wins where two disagree"; they load
after every extension). Remove takes a stylesheet off `styles:` and never
deletes the file, and the last one has no Remove — an empty `styles:` falls
back to `styles/book.css`, else the first `.css` the book has, so the list
would show it again. **Add a stylesheet** offers the book's other `.css`
files (its folder, `styles/` and `css/`, and a repository's shared ones) to
add at the end of the list. A book with no stylesheet says so and offers
**Create styles/book.css**, the file the first design edit creates too.
**Open manifest.yaml** sits at the top of Advanced, since the manifest is not
a stylesheet.

There is **no apply and no revert**: a look is an ordinary list entry
(enable/disable, reorder, remove — the same verbs `gutterpress ext`
exposes). "Switching" looks is adding the new one and disabling or removing
the old; the manifest edit is versioned by the same snapshot commits as
every other project file, so the previous state is always recoverable
without a look-specific undo. The `themePrevious` manifest key and the
`revertTheme` / `getPreviousTheme` routes of the earlier theme rail are gone;
do not reintroduce a theme-specific history.

Shipped refinements (#106, 0.8.0-beta.1; carried into the one-list model):

- **Thumbnails, not a hover preview** — every look row renders its CSS over
  a fixed sample (`sampleSrcdoc`) in a sandboxed iframe; it never
  re-paginates the user's document. The earlier enlarged hover flyout is
  gone: it only ever showed above 1620 px (the app window is 1400 px) and
  promised a preview the author could not see. Full-document re-pagination
  happens only when the list actually changes (add, enable/disable,
  reorder), with a progress state.
- **ZIP drag-and-drop import**, validated against the extension package
  format: `theme.css` at root + optional `assets/` + optional `package.json`
  declaring `name` and a `gutterpress` block's `styles`
  (#239/#241/#276 — every declared sheet is validated like `theme.css`; a
  package without one gets a package.json written into the landed copy, so
  what lands always loads);
  validation order = structure → CSS parses → print-safety
  check passes (note `printsafe/no-remote-urls` fails CDN-referencing looks
  — surface that clearly) → declares at least one `--print-*` token.
  Failures are errors; extra files are warnings. Shipped:
  `importExtensionFromFile` / `importExtensionFromZip`
  (`extension-import.ts`); the import lands in `extensions/<id>/` and adds
  the entry through the one rail (`addExtension`).

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
| Switch the book's look (add one, disable the old) | 5/5 test participants complete unassisted (n=5 formative; see below) | usability test |
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
| Preview re-render after keystroke | ≤300ms | `examples/gutterpress-user-guide` (74 pages, text-heavy) |
| PDF export | ≤8s | `examples/gutterpress-user-guide`; no image-heavy budget is set |
| Theme switch (hover sample-spread render) | ≤500ms | sample spread only — full-document re-apply is exempt above N pages and shows progress |

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
  - macOS: **VoiceOver + the app**;
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
| Text field / select edge | 3:1 against every surface it sits on, both themes (#447) |

- Light + dark mode (SHIPPED, #48); auto-detect `prefers-color-scheme`, user
  override. `prefers-contrast: more`: remove decorative shadows, increase
  border weight, focus ring → 3px solid.
- No color-only state indication: icon + label accompany color, always.
- Text fields, selects and text areas take their fill, edge
  (`--app-field-border`), corners, text colour and focus ring from ONE
  zero-specificity rule in `theme.css`, as primary buttons take theirs from
  `.app-btn-primary`. A component sets only a field's layout; a control
  meant to look different (a toolbar picker) says so in its own class.

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
- Problems badge: `aria-label="Problems: 3 errors, 2 warnings"`.
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
| Save-confirmation modal/toast ("Saved!") | Interrupts writing | Subtle indicator; auto-save is shipped (§3) |
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
| Requiring save before preview | Breaks the live loop | Shipped: 500ms debounced save + live preview (default; turning auto-save off is the author's opt-in to preview-on-save) |
| Raw engine / `@page` errors shown to authors | Opaque, frightening | Plain-language Problems entries (shipped, §10) |
| Raw rule IDs / linter jargon as primary text | Writer-first product | Plain-language labels, codes demoted (shipped, §10) |
| Reintroducing stylelint or any bundler-hostile dep for editor lint | Breaks `bun build --compile` (docs/architecture-rules.md §3) | Extend `printsafe.ts` |
| A Gutterpress-specific plugin API, hosted plugin marketplace, or fake granular permissions UI | Contradicts docs/architecture-rules.md §5 and the unsandboxed runtime | §9's plain-package model and one honest full-privilege confirmation |
| Settings with more than a page of choices, or tabs inside Settings | Overwhelming; "where did X go?" | One short Settings page; a choice earns a place only when many authors need it (#442) |
| Status badges, or switches beside checkboxes, in Book setup | Noise; two controls for one meaning | Silence is success: a row speaks only when it needs attention; checkboxes for items of a set, switches only in Settings (#442) |

---

## References and inspiration

**Editor UX:** iA Writer (focus, typography-first) · Typora (seamless toggle)
· VS Code (problems panel, split editor; its palette is `Ctrl/Cmd+Shift+P`) ·
Obsidian (panel flexibility, community themes) · Bear · Ulysses.

**Print/layout:** Affinity Publisher 2 (preflight, masters) · Canva
(non-designer layout) · Visme (template-first onboarding).

**Publish:** Netlify (preflight + deploy log drawer) · Shopify (provider
cards) · Leanpub (author-centric flow).

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
- ✅ Theme package format + ZIP/CSS import + hover sample preview + revert — **#106** (0.8.0-beta.1); revert retired when looks became ordinary `extensions:` entries (#265, §11)
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
