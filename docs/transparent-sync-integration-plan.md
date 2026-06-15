# Transparent Git Sync — Integration Plan

> Status: **proposal** · Author: AI session 2026-06-15 · Supersedes nothing
> yet; complements ADR 0006 (`docs/adr/0006-remote-git-device-flow-and-clone-model.md`).
>
> Source material: an external design doc, *"Transparent Git Sync Strategy for
> Non-Technical Markdown/CSS Print Teams"* (the **Doc** below). This plan
> evaluates the Doc against print-md's existing sync stack and proposes what to
> adopt, what to reject, and how to integrate.

## TL;DR

The Doc and print-md **agree on the philosophy** — Git is a hidden, durable
sync protocol; users make content decisions, never Git decisions. But print-md
already shipped that philosophy in `0.5.0`, and the **library layer is more
mature and more correct than the Doc's reference code** (the Doc would OOM or
silently lie on large repos; print-md fixed exactly those bugs through the
"0.5.0 sync saga"). So this is **not a replacement** of the sync engine.

The genuinely "clunky" part the user is reacting to is the **interaction
model**, not the engine: sync today is a *manual, modal, button-driven dialog*
with explicit Pull / Push and an "incoming / outgoing changes" mental model.
The Doc's real contribution is the **ambient automatic orchestration layer** —
a file-watcher → debounce → single-flight state machine that runs
commit→fetch→merge→push for the user and surfaces one plain-language status —
which print-md does **not** have (it has auto-*snapshot* but not auto-*sync*).

**Plan in one line:** keep the lib primitives exactly as they are; build the
Doc's orchestration + ambient-status layer *on top of them* in the host; make
sync **fully transparent and ON by default whenever a remote is configured**
(§6, decided) — the author sees only a small "Saving changes… / Everything is
in sync" status and is interrupted *only* for a real content conflict, with
plain-language choices; demote the manual Sync dialog to an advanced/details
affordance the normal author never opens.

---

## 1. What already exists (and must be reused, not rewritten)

| Doc component | print-md equivalent | Verdict |
|---|---|---|
| `GitSyncEngine.syncOnce` (commit→fetch→merge→push) | `remote-auth/sync.ts → syncProject` (= `pullChanges` then `pushChanges`) | **Reuse.** Already snapshot-first, two-parent honest merges, race re-run. |
| `hasLocalChanges()` via `statusMatrix` | `source-provider.ts → hasPendingChanges` via `listWorkdirChanges` (WORKDIR+STAGE walk, **no TREE**) | **Reuse print-md's.** See §3.1 — the Doc's `statusMatrix` is the OOM bug print-md already fixed. |
| Snapshot-before-merge | `snapshotBeforeAction` (ADR 0006 D5 "snapshot-first invariant") | **Reuse.** Stronger than the Doc: never leaves conflict markers in the tree. |
| `ConflictManager` (copy local/remote/base aside) | `resolveConflicts` + `(online copy)` files + per-file `mine/theirs/both` | **Reuse.** print-md's is markerless and produces honest two-parent commits. |
| Non-fast-forward retry | `pushChanges → "pull-first"` + `syncProject`'s single re-run | **Reuse.** |
| `AuthProvider` / token in OS keychain | `remote-auth/token-store.ts` + `credential-store.ts` (host) + GitHub device-flow (ADR 0006) | **Reuse.** |
| Error classification → status enum | `classifyFailure` → `auth` / `offline` / `error` | **Reuse.** |
| `.gitignore` template (PDF/build/node_modules) | New-project scaffold (#25) | **Verify & extend** — see §5.4. |
| Single-flight lock + `runAgain` | *(host has none for sync; has it for snapshot via the per-repo queue `withRepoLock`)* | **Build** — see §4. |
| `FileWatcher` (chokidar) | `electron/main.ts` `fs.watch` folder watcher (debounced) + auto-snapshot timer | **Reuse the existing `fs.watch`; do NOT add chokidar** (§3.4). |
| `SyncScheduler` (debounce + triggers) | *(host auto-**snapshot** scheduler only; no auto-**sync**)* | **Build** — the core new work (§4). |
| `SyncState` / `StatusStore` + status UI | `getSyncStatus` / `previewSync` (lib) + `SyncDialog.svelte` (modal) | **Build a new ambient indicator**; keep dialog as "details" (§5). |
| Presence / soft-locks | none | **Defer** (§7, out of scope). |

**Bottom line:** ~70% of the Doc is already in `packages/lib`. The new work is
the host-side scheduler/state-machine and the renderer's ambient status.

---

## 2. The real problem: the interaction model is manual + modal

Today (0.5.0):

- **Auto-snapshot** runs automatically (host timer, debounced, default 10 min) —
  but it only makes *local* commits. Nothing leaves the machine automatically.
- **Sync** is a deliberate user action: toolbar button → `SyncDialog` →
  two-stage preview ("4 new changes in the online copy" / "You have changes to
  send") → user pulls/pushes → per-file conflict choices.

That dialog is good engineering but it still asks a non-technical author to
*think about sync as a thing they operate*. The Doc's thesis — and the print-md
Primary Goal "make handling … trivial" — says the author should mostly never
see it: edits flow out and teammates' edits flow in, with a single ambient
"Everything is in sync / Saving… / Offline" indicator, and a dialog only when a
real **content** conflict needs a human.

So the integration is fundamentally a **UX promotion of automation**, backed by
a small new orchestration layer, reusing the existing engine verbatim.

---

## 3. Where the Doc is WRONG for print-md (do NOT adopt)

These are not stylistic disagreements — each maps to a hard-won fix recorded in
project memory. Adopting the Doc's version here would reintroduce a shipped bug.

### 3.1 ❌ `git.statusMatrix` on any hot/check path
The Doc's `hasLocalChanges()` calls `statusMatrix({ dir })`. On a large repo
`statusMatrix` (and any walk that touches HEAD/packfiles) loads the **entire
packfile into the object cache → multi-GB RSS → OOM**. This is the literal
root cause of the 0.5.0 "sync uses 2 GB" report. print-md's `listWorkdirChanges`
deliberately walks only `WORKDIR` + `STAGE` (no `TREE`) and runs only at action
time under a function-scoped cache. **Keep print-md's.** (Memory:
*Sync simplicity mandate* — "Never statusMatrix/walks/APIs on the check path".)

### 3.2 ❌ `git.merge({ theirs: "origin/main" })` leaving conflict markers
The Doc lets merge write conflict markers into the working file, then recovers
copies from them. print-md uses `abortOnConflict` so the tree is **never** left
with markers, snapshots first, and resolves via a custom `mergeDriver` that
yields the chosen side's content — an honest two-parent commit with both
histories intact. **Keep print-md's.** (ADR 0006 D5.)

### 3.3 ❌ `git.fetch` with the local branch tip as the negotiation `have`
The Doc fetches with `ref: branch`. With `singleBranch`, isomorphic-git sends
the *local* tip as the only `have`; because that tip is usually an
auto-snapshot the server has never seen, the server finds no common base and
ships the **entire repo as one in-memory pack → OOM**. print-md's
`fetchRemoteTip` fetches into and negotiates from the **remote-tracking ref**,
guaranteeing a common base and an incremental pack. This is the single most
important hard-won fix in the file. **Keep print-md's.**

### 3.4 ❌ Add `chokidar`
The Doc suggests `chokidar`. print-md already has a debounced `fs.watch` folder
watcher feeding preview-reload + auto-snapshot. Occam's razor (project
foundational principle) + the no-heavy-deps posture (CLAUDE.md §1/§3): a new
native-binding-carrying watch dependency must *prove* necessity. It hasn't.
**Reuse `fs.watch`.** If watch fidelity ever proves insufficient, revisit then.

### 3.5 ❌ Counting commits for the badge ("4 changes to send")
The Doc's status implies counts. print-md's check path is intentionally
**count-less** (`hasChanges: true|false|null`) because counting walks history.
The new ambient indicator must follow the same rule: show *direction + state*,
never a count, on any path that could run frequently. (Memory: simplicity
mandate; `SyncDirectionInfo` is already count-less by contract.)

---

## 4. New work: the host-side Auto-Sync Orchestrator

A small state machine in the Electron **main** process (host layer — CLAUDE.md
§8: never in the renderer), reusing the existing lib calls. It mirrors the
existing auto-snapshot scheduler's shape so the codebase stays consistent.

### 4.1 State machine (maps to the Doc's, trimmed to print-md's outcomes)

```
idle ─▶ debounced ─▶ syncing ─▶ {synced | up-to-date}
                         │
                         ├─▶ conflict   (pause auto-sync; surface choices)
                         ├─▶ offline    (saved locally; retry on triggers)
                         └─▶ auth        (one "Reconnect" action)
```

- **One source of truth**: `syncProject(...)` already encodes
  commit→fetch→merge→push + the mid-sync race re-run. The orchestrator only
  *decides when to call it* and *maps its `SyncOutcome` to a status*.
- **Single-flight + `runAgain`** (the Doc's one genuinely missing primitive):
  if a sync is in flight and another trigger fires, set `runAgain = true`;
  re-run once on completion. (The per-repo `withRepoLock` already serializes at
  the git level, but we want *coalescing* at the scheduler level so we don't
  queue N syncs behind one burst.)
- **Conflict latches auto-sync OFF** for that project until the user resolves
  via the existing per-file choices flow (`resolveConflicts`). Auto-snapshot
  keeps running so work is never lost.

### 4.2 Triggers (the Doc's table, mapped to host events we already have)

| Trigger | Host hook today | Action |
|---|---|---|
| App start / project open | project-open IPC | sync once (after first auto-snapshot settles) |
| File change | `fs.watch` debounce (already feeds auto-snapshot) | arm sync debounce (longer than snapshot debounce) |
| Network restored | `powerMonitor` / `net` online event (**new wiring**) | sync once |
| Periodic safety | new interval (default ~2 min, only when remote + idle) | sync once |
| Before PDF export | build IPC entrypoint | if online & dirty → sync first; if offline/conflict → warn (§5.3) |
| Manual "Sync now" | existing toolbar button | force sync (bypass debounce) |

**Ordering invariant:** auto-snapshot must commit a burst *before* auto-sync
pushes it. Easiest correct design: auto-sync's debounce is **strictly longer**
than auto-snapshot's, and `syncProject` snapshots-first anyway, so even a race
is safe (it just snapshots, then pushes).

### 4.3 Settings (extend the existing `versionHistory` policy group)

Add to the existing settings object alongside `autoSnapshot` /
`autoSnapshotMinutes`:

```ts
autoSync: boolean;          // master switch — DEFAULT ON (see §6)
autoSyncMinutes: number;    // periodic safety cadence (clamped, like snapshot)
```

Reuse the exact clamp/parse pattern of `autoSnapshotDelayMs` (pure, testable
in lib) → add `autoSyncDelayMs` next to it. Auto-sync is **gated on
`canSync`** (HTTPS remote + stored credential, ADR 0006 D4): local-only
projects never auto-sync; **connected projects auto-sync ON by default** (§6).
The Settings toggle exists for the rare user who wants to pause it, but the
default path requires zero setup and zero awareness.

### 4.4 Files touched

- `packages/lib/src/lib/source-provider.ts` — add `autoSyncDelayMs` (pure,
  next to `autoSnapshotDelayMs`) + its constants/tests. *No engine change.*
- `packages/viewer/electron/main.ts` — new `scheduleAutoSync` /
  `runAutoSync` mirroring the auto-snapshot scheduler; wire triggers; emit a
  `sync:status` event to the renderer.
- `packages/viewer/electron/preload.ts`, `types.d.ts`,
  `src/lib/platform/contract.ts`, `electron-adapter.ts`, `web-adapter.ts` —
  the 5-layer seam for the new `onSyncStatus` subscription + `setAutoSync`
  prefs (CLAUDE.md §8). WebAdapter stubs to a safe no-op.

---

## 5. Renderer: ambient status replaces the modal as the default surface

### 5.1 One status pill (the Doc's user-language table)

A single always-visible indicator (toolbar/status-bar) driven by the
`sync:status` event, using the Doc's plain-language mapping — which print-md
already half-has as message constants in `sync.ts`:

| State | Pill text (reuse/extend existing constants) |
|---|---|
| synced / up-to-date | "Everything is in sync" |
| syncing | "Saving changes…" |
| offline | "Offline — changes are saved on this computer" |
| auth | "Reconnect your repository" → opens reconnect (existing D7 flow) |
| conflict | "Changes happened in two places — review" → opens choices |

No Git words (the Doc's forbidden-terms list already matches print-md's copy
discipline). **No counts** on the pill (§3.5).

### 5.2 The modal is no longer part of the normal flow
With transparent auto-sync (§6), the manual preview/Pull/Push dialog is
**removed from the everyday path** — there is no "Sync" button the author is
expected to press. Keep its machinery only as an **advanced/details**
click-through from the pill (collapsed by default), for the power user or
support: see direction, force a sync, reconnect, retry, open the conflict
folder, restore a pre-merge snapshot (the Doc's "Recovery Tools for
Advanced/Admin UI"; print-md already has History/restore). A normal author
should be able to use print-md for months and never open it. The **conflict
choices screen** (§6.1) is the *only* sync surface a normal author ever sees,
and only when a real content conflict occurs.

### 5.3 PDF-export safety gate (the Doc's best small idea — adopt fully)
Wire into the existing build entrypoint:
- synced → export.
- dirty + online → sync first, then export.
- offline → export but warn "may not include recent teammate changes."
- conflict → block (or clearly mark unsafe) until resolved.

This is new behavior worth adopting verbatim from the Doc.

### 5.4 `.gitignore` template
Confirm the #25 scaffold ignores `*.pdf`, `build/ dist/ out/ exports/`,
`node_modules/`, OS noise. Add a print-md metadata ignore if any sync state is
ever written under the project (today it is not — state lives in `.git` and
host `userData`; **do not** introduce a `.print-sync/` dir in the repo unless
needed). Adopt the Doc's list, minus its `.print-sync/` (we keep metadata out
of the working tree).

---

## 6. Decision (locked): transparent auto-sync, ON when a remote is configured

**Decided 2026-06-15.** Auto-sync defaults **ON** for any project with a remote
+ credential (`canSync`); local-only projects are unchanged (no sync). The
experience is **fully transparent**:

- The user **never operates sync**. There is no "Sync now" step in the normal
  flow, no preview-before-sync dialog, no Pull/Push verbs in their face.
- The **only** ambient signal is a small status: "Saving changes…" while a sync
  runs, "Everything is in sync" at rest, "Offline — saved on this computer"
  when disconnected. (See §5.1.) The user can ignore it entirely.
- The user is interrupted **only** for a genuine **content** conflict — and
  even then with plain-language choices, never Git terminology (§6.1).

This is safe to default ON precisely because of the **snapshot-first
invariant** (ADR 0006 D5): every burst of work is committed locally *before*
any network or merge step touches it, so even an unwanted/auto push is fully
recoverable from History — **work is never lost**. The Settings toggle exists
to pause auto-sync, but the zero-config default is the product.

### 6.1 Conflict UX — "do the right thing," plain language, never lose work

Auto-sync runs unattended, so the conflict path must be *bulletproof and
self-explanatory*. The engine already guarantees the safety properties; this
section is the contract the orchestrator + UI must honor.

**Engine guarantees already in place (reuse, do not weaken):**
- On a real conflict, `git.merge` runs with `abortOnConflict` → the working
  tree is left **completely untouched**; conflict markers are **never** written
  into the author's files.
- A safety snapshot of the author's unsaved work is committed **before** the
  attempt; it always appears in History.
- Resolution produces an **honest two-parent merge commit** via the custom
  `mergeDriver` — both sides' history stays intact and visible; the repo stays
  in a valid state no matter which choice the user makes.
- "Keep both" writes the other side to `<name> (online copy).ext`, uniquified
  so nothing is ever overwritten.

**Orchestrator behavior on conflict:**
- Auto-sync **latches OFF for that project** until the user resolves — it must
  not loop or repeatedly re-prompt. Auto-*snapshot* keeps running so ongoing
  edits stay saved.
- The status pill switches to one calm line: **"Some changes happened in two
  places — tap to review"** (no "merge", "conflict marker", "branch", "HEAD").

**The choices screen (reuse `resolveConflicts`'s `mine`/`theirs`/`both`),
worded for a non-technical author:**

| Internal choice | Button the author sees | Plain explanation under it |
|---|---|---|
| `mine` | **Keep my version** | Use what's on this computer. |
| `theirs` | **Use the online version** | Use what a teammate changed. |
| `both` | **Keep both** | Save mine and add theirs as a copy next to it. |

Plus an always-available, no-pressure default: **"Not sure? Keep both"** is the
recommended/highlighted option, because it is the only choice that is
*guaranteed lossless* for everyone — it never discards either side. The screen
shows one row per affected file with a short, human label ("Chapter 3") and,
where cheap, a tiny before/after preview; it must work for the binary cases
(images/fonts) with the same three buttons (no diff shown, "Keep both" still
the safe default).

After the user confirms, the orchestrator calls `resolveConflicts`, then
**re-enables auto-sync** and resumes the transparent flow.

---

## 7. Out of scope (explicitly deferred)

- **Presence / soft-locks** (the Doc's optional section): valuable for a team
  but a new networked side-channel with its own metadata. Defer to a separate
  proposal; not required for transparent sync.
- **Two-branch (`main` + `work`) model:** the Doc itself says only adopt with a
  real review process. print-md is single-branch (`main`); keep it.
- **Engine rewrite:** none. The lib is the spec.

---

## 8. Phased implementation

1. **Lib (pure, no engine change):** `autoSyncDelayMs` + constants + unit tests.
   *(half day)*
2. **Host orchestrator:** `scheduleAutoSync`/`runAutoSync`, single-flight +
   `runAgain`, conflict-latch, trigger wiring (start/change/periodic/manual);
   emit `sync:status`. Reuse `syncProject`. *(largest piece)*
3. **Seam + prefs:** 5-layer `onSyncStatus` + `setAutoSync` (CLAUDE.md §8);
   WebAdapter stubs.
4. **Network-restored trigger:** wire `net`/`powerMonitor` online event.
5. **Ambient pill UI** + demote SyncDialog to "Details".
6. **PDF-export gate** (§5.3).
7. **Settings toggle** + default per §6.

## 9. Testing (extend, don't replace, the existing two-clone harness)

The lib already has `sync-e2e.test.ts` / `pull-push.test.ts` /
`preview-sync.test.ts` against a real git-http test server — the Doc's
"two local clones of a bare remote" plan is already realized there. Add:

- **Pure:** `autoSyncDelayMs` clamp/disable cases (mirror the snapshot tests).
- **Orchestrator (host, mockable):** single-flight coalescing (`runAgain` fires
  exactly once); conflict latches auto-sync off; offline → retry on next
  trigger; `canSync=false` never auto-syncs.
- **Export gate:** dirty+online syncs first; offline warns; conflict blocks.
- **Regression guards** (the saga's lessons): assert the orchestrator NEVER
  calls `statusMatrix`/count-walks on the check/trigger path, and only ever
  reaches the network through `syncProject`/`previewSync`.

## 10. Architectural compliance checklist

- [ ] No engine rewrite; `sync.ts` primitives unchanged (USE THE LIBRARY).
- [ ] No `statusMatrix`/history-walk on any trigger/check path (§3.1, §3.5).
- [ ] No `chokidar`; reuse `fs.watch` (§3.4, Occam's razor).
- [ ] Renderer stays PWA-clean; all host work via `getPlatform()` 5-layer seam
      (CLAUDE.md §8); WebAdapter stubs the new methods.
- [ ] No Git jargon in any user-facing string (Doc + project copy discipline).
- [ ] "Sync" terminology only; "Publish" stays reserved for output distribution
      (memory: *Publish = output distribution only*).
- [ ] Snapshot-first invariant preserved end-to-end (ADR 0006 D5) — work is
      never lost even though sync runs unattended.
- [ ] Auto-sync defaults ON when `canSync`, OFF/absent for local-only (§6).
- [ ] Normal author never operates sync: no Sync button / preview dialog in the
      everyday path; only the status pill + (rarely) the conflict choices.
- [ ] Conflict path latches auto-sync off, never loops, offers plain-language
      `Keep my version` / `Use the online version` / `Keep both` with
      "Keep both" as the lossless recommended default (§6.1).
```
