# Startup landing-page UX — review and refactor options

Status: design proposal (no code changes yet).
Scope: `packages/viewer` startup sequence only.

## 1. Current startup sequence (as reviewed)

Boot order on desktop:

1. `electron/main.ts` `app.whenReady()` → `createSplashWindow()` (small frameless
   splash, `electron/splash.html`) → adapter-node SvelteKit server on
   `127.0.0.1` → `createWindow()`. The main window is created **visible but
   fully covered by the always-on-top splash**, so the renderer runs at full
   speed (`disable-renderer-backgrounding` / `disable-background-timer-throttling`
   / `disable-backgrounding-occluded-windows`, `electron/main.ts:1847-1849`).
   A 15s fallback timer force-reveals the window.
2. The SPA mounts `src/routes/+page.svelte`. The auto-reopen block
   (`+page.svelte:1009-1074`) reads `viewer-prefs.json` via
   `api.app.getViewerPrefs()`:
   - **No `lastProjectDir`** → open the left panel on the Projects tab
     (`ProjectsListBody` = the de-facto welcome screen), call
     `api.app.rendererReady()` → splash closes, empty hero shows.
   - **`lastProjectDir` present** → fetch per-project restore state and call
     `startFolderPreview(dir, "Reopening previous folder…", restoreState)`.
3. `startFolderPreview` (`+page.svelte:1284-1437`): `projectSession.classify(dir)`
   (repo root + book list + active-book resolution), `platform.startPreview`
   (spins up the lib's preview HTTP server), mounts the preview iframe, preloads
   the first file into the editor buffer, starts the folder watcher and the
   crash-recovery scan.
4. paged.js lays out the **whole book** inside the cross-origin iframe. Only
   when `renderingComplete` fires does `PreviewEventController` call
   `api.app.rendererReady()` → `showMainWindowAndCloseSplash()`.

So today's launch UX with a previous project is: **stare at the splash's
progress bar until the entire book has been laid out**, then land directly in
the workspace. The recents/welcome surface is only ever seen when there is no
last project or reopen fails.

Persistence: everything lives in `viewer-prefs.json` (Electron `userData`) —
`lastProjectDir`, `recentFolders[]` (cap 8), `favorites[]`, per-project
`projectStates{}`, `leftPanel` state. Written by main on every successful
preview start (`electron/main.ts:1480-1497`).

### Load-bearing constraints

- **Never hide the preview iframe** (opacity/visibility/display) while paged.js
  is laying out — Chromium throttles invisible cross-origin iframes to ~1fps
  (the 0.4.1 regression: 287-page book, ~10s → ~5min). The established pattern
  is a **translucent overlay above the iframe**; the cross-fade happens on the
  overlay (`PreviewFrame.svelte:54-62`, `LoadingOverlay`, `RecoveryOverlay`).
  Covering the whole *window* is fine (the splash already does) because
  occlusion throttling is disabled app-wide.
- The renderer stays **PWA-clean** (CLAUDE.md §8): any landing surface is
  ordinary SPA code talking to `/api/app/*`.
- Repo goal: changes must **reduce complexity** or justify themselves.

## 2. Multi-book / repo-root session changes (as reviewed)

From PR #92 + follow-ups (`4e300d0`, `1103c2a`, `62a03fb`, `13b127b`):

- Opening any folder classifies it via `detectProjectSource`; a folder inside a
  git repo resolves to a **repo-root session** (`repoRoot` + sorted `books[]`,
  each `{ path, title, subPath }`). "A project is its git repo."
- `resolveActiveBookDir` (`project-session-controller.svelte.ts:82-91`) picks
  the active book automatically — picked folder if it is a book, else the first
  book by `subPath`. **No picker/prompt exists anywhere.**
- **Recents are repo-level**: one entry per repo, keyed on `repoRoot`, with
  `lastActiveBook` remembering the most recent book
  (`electron/recent-folders.ts:10-23`, `main.ts:1489-1496`). A recent row
  reopens `lastActiveBook ?? repoRoot`.
- In-session switching is `BookSwitcher` in the status bar (multi-book repos
  only); `switchBook(path)` is just `startFolderPreview(path)` — classify
  re-resolves the same repo, all surfaces retarget off `currentDir`.
- Startup auto-reopen uses `lastProjectDir` = the exact last-opened **book**
  path, so relaunch restores the precise book.

Implication for a landing page: the data model is already landing-ready — repo
cards with a "continue with *{book}*" default plus an expandable book list can
be built from `recentFolders[].lastActiveBook` + `classify-project`'s `books[]`
with **no new persistence**. A landing page is also the natural home for the
book *choice* moment that currently happens silently (first-book-alphabetical +
toast).

## 3. Prior art

- **VS Code** — restores the last workspace by default (`window.restoreWindows`);
  the Welcome / "Get Started" surface is an **editor tab inside the restored
  workspace** (`workbench.startupEditor`), showing recents, walkthroughs, new/open
  actions, and release notes after updates. Welcome never blocks restore — the
  workspace loads behind/around it and the tab is dismissible & re-openable.
- **JetBrains IDEs** — a separate Welcome *window* (recents + new/open/get-from-VCS)
  appears **only when no project is open**; otherwise straight into the last
  project.
- **Obsidian** — vault picker window only when no vault is known.
- **Sublime / Zed** — silent session restore; welcome only on first run.

The converged pattern: **(a)** always restore the last workspace, **(b)** the
welcome surface lives *inside* the main window as a dismissible layer, and
**(c)** a separate welcome window exists only for the no-project case. The
user's ask — landing page with the previous project pre-rendering behind it —
is exactly VS Code's shape, and it happens to be one small step from what
print-md already does (the app already pre-renders behind a cover; the cover is
just the passive splash).

## 4. Options

### Option A — Interactive landing overlay in the main window (splash shrinks to a boot flash) — **recommended**

**Shape.** Keep the auto-reopen pipeline byte-for-byte: on mount, read prefs and
immediately `startFolderPreview(lastProjectDir)` — the preview server starts and
paged.js renders exactly as today. Add one new full-window layer,
`WelcomeLanding.svelte`, rendered at the top of the app root (same layering
family as `LoadingOverlay variant="app"`), using the established translucent
frosted scrim so the iframe is never hidden. Call `api.app.rendererReady()` as
soon as the landing paints — the OS splash now lives ~1s (SPA boot only)
instead of the full render.

**Landing content.**
- **Continue card** (primary): last repo/book title, repo name + book count,
  and a *live* render status wired to the existing `rendering` /
  `renderProgressPage` runes — "Laying out page 42…" → "Ready ✓". One click
  (or Enter/Esc) fades the landing out onto an already-rendered (or visibly
  rendering) preview.
- For a multi-book repo, the card lists the repo's other books
  (`projectSession.books` is populated behind the landing by the prewarm's
  classify) — "Continue with a different book" becomes an explicit choice
  instead of today's silent first-book-alphabetical + toast.
- **Recents / favorites / discovered** grid — reuse `ProjectsListBody`
  (compact) verbatim, including its filter input ("search for other projects")
  and `exists` badges. Clicking a different project calls
  `startFolderPreview(that)` and dismisses; the pipeline already stops the
  in-flight preview.
- **Actions row**: New book (`NewProjectWizard`), Open folder (browse), Open
  from GitHub (`GitHubDialog`), Getting-started guide (`openSetupGuide`).
- **Footer**: version badge + "What's new" link (opens the GitHub releases page
  via the shell route; net-new but one line — no release-notes surface exists
  today beyond the update banner).
- First-run (no `lastProjectDir`): the landing *is* the welcome screen — no
  continue card, bigger create/open actions. This **replaces** the current
  `empty-hero` block and the "auto-open left panel on Projects tab" branch, so
  net surfaces go from three (splash-wait, empty hero, Projects tab) to one.
- A `startup.landing` setting (`always | never`) lets power users keep today's
  straight-into-the-book behavior; "never" simply doesn't show the layer.

**Behavior details.**
- Workspace chrome beneath the landing is `inert` (focus trapped in the layer).
- Reopen failure no longer strands or toasts: the landing stays up and the
  continue card swaps to the inline error + "Set up this folder as a book"
  affordance that the empty hero has today.
- The crash-recovery scan (`scanForRecovery`) and external-edit banner are
  deferred until the landing dismisses, so recovery dialogs never fight the
  landing for focus. The folder watcher and the preview server's own file
  watching start immediately as today.
- The splash's `splashStatus` render-progress plumbing becomes nearly dead code
  → deletion candidate (complexity win).

**Pre-render story.** Free. It is literally today's behavior with the cover
swapped from a passive OS window to an interactive in-window layer.

**Cost / risk.** Small–medium. One new component + ~30 lines of wiring in the
auto-reopen block; no changes to `startFolderPreview` ordering (the most
bug-history-laden code in the app). Main risks: layer stacking vs. dialogs, and
`+page.svelte` (3,600 lines) growing further — mitigated by keeping the landing
self-contained and, ideally, extracting the reopen decision into a tiny
controller (Option B's first step).

### Option B — Explicit startup modes: `StartupController` with a prewarm/activate split

**Shape.** Make startup a first-class state machine, following the repo's
controller-extraction pattern (`PageNavController`, `SyncController`, …):

- `StartupUiController` (runes class) owns `mode: "landing" | "workspace"`, the
  prefs read, the reopen decision, landing dismissal, and error routing. The
  auto-reopen `onMount` block moves out of `+page.svelte` wholesale.
- Split the open pipeline: `prewarmPreview(dir)` does only classify +
  `startPreview` + iframe mount (what pre-rendering needs); `enterWorkspace()`
  runs the deferred side-effects — editor-buffer preload, folder watch,
  recovery scan, history refresh, panel restore — when the user actually enters.
  The landing renders in `mode === "landing"` above a workspace whose preview
  pane is mounted (it must be, for paged.js speed) but whose chrome is inert.

**Pre-render story.** Same as A (iframe mounts during prewarm), but the
*policy* is explicit and unit-testable instead of implicit in call order.

**Pros.** `+page.svelte` shrinks instead of grows (aligns with the repo's
reduce-complexity mandate and the stated intent in
`project-session-controller.svelte.ts:28-33` to extract session state); the
landing/recovery/watcher interleavings that Option A special-cases fall out of
the mode machine structurally; startup becomes testable like the other
extracted FSMs.

**Cons.** It refactors `startFolderPreview`'s ordering — the code carrying the
#43 restore, #44 flush-on-switch, and C2 classify-first fixes — so regression
risk is the highest of the three. Bigger review surface for the same visible
UX as A.

### Option C — Landing as its own window (the splash grows up; JetBrains-style)

**Shape.** Replace `splash.html` with a real landing *window* that loads a new
`/welcome` SvelteKit route from the same adapter-node server (so it reuses
`/api/app/*` and components). The main window boots the workspace exactly as
today — hidden behind the landing window, rendering at full speed. "Continue"
→ `showMainWindowAndCloseSplash()`. Choosing a different project → the landing
tells the main window (new push channel or main-process orchestration) to
`startFolderPreview(other)` before revealing.

**Pre-render story.** Identical to today's splash behavior; zero changes to the
workspace page beyond `rendererReady` timing.

**Pros.** Hard separation — no z-index/inert/scrim concerns in the workspace;
closest to the JetBrains/Obsidian precedent; the landing window could paint
before the SPA finishes booting.

**Cons.** Highest complexity, and it's coordination complexity — the worst
kind here: two windows to choreograph (focus, close ordering, flicker on
handoff), a new renderer↔renderer "open X over there" channel, dialogs
(`NewProjectWizard`, `GitHubDialog`) either duplicated in the landing window or
awkwardly handed off mid-flow, and no smooth in-window cross-fade from landing
to rendered preview (it's a window swap). Two un-throttled webContents during
render. Contradicts the repo's reduce-complexity mandate and the industry trend
(VS Code deliberately keeps welcome *inside* the workspace window).

## 5. Comparison

| | A — overlay layer | B — mode controller | C — landing window |
|---|---|---|---|
| Pre-render behind landing | free (today's behavior) | free, made explicit | free (today's behavior) |
| New user-visible UX | full landing | full landing (same as A) | full landing, window-swap feel |
| Splash lifetime | ~1s (SPA boot) | ~1s | replaced by landing |
| `+page.svelte` impact | grows a little | shrinks | ~unchanged |
| Riskiest touch | layer/dialog stacking | `startFolderPreview` ordering | window/IPC choreography |
| Complexity trend | ↓ (kills empty-hero + splash progress plumbing) | ↓↓ long-term, ↑ during refactor | ↑↑ |
| Effort | S–M | M–L | L |

## 6. Recommendation

**Ship Option A, stealing Option B's first step.** Concretely:

1. Extract just the auto-reopen decision (`+page.svelte:1009-1074`) into a
   small `StartupUiController` — the low-risk half of B.
2. Add `WelcomeLanding.svelte` (translucent layer, inert workspace beneath,
   reuses `ProjectsListBody`), shown at mount; `rendererReady()` on first
   landing paint; continue card wired to live render progress; recents /
   new / open / GitHub / guide / what's-new actions.
3. Defer `scanForRecovery` + external-edit banner until landing dismissal;
   route reopen failures into the landing's continue-card error state; delete
   the `empty-hero` block and the splash's per-page progress plumbing.
4. Add the `startup.landing` setting.

Option B's full prewarm/activate split remains available as a later cleanup if
the landing's deferral special-cases accumulate; Option C is rejected as
complexity without a matching UX payoff.
