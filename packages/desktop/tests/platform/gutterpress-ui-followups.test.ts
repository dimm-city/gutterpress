import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

test("hidden preview is collapsed to zero width instead of unmounted and editor gets full track", () => {
  const page = read("src/routes/+page.svelte");
  expect(page).toContain("previewCollapseGridColumns");
  expect(page).toContain("class:preview-collapsed={!previewVisible}");
  expect(page).toContain("aria-hidden={!previewVisible}");
  expect(page).toContain("inert={!previewVisible");
  expect(page).not.toContain("{#if previewVisible}\n      <section");
});

test("project activity view has an explicit close action returning to the editor", () => {
  const page = read("src/routes/+page.svelte");
  const activity = read("src/lib/components/ProjectActivityView.svelte");
  expect(page).toContain("closeActivityView");
  expect(page).toContain("onClose={closeActivityView}");
  expect(activity).toContain("onClose");
  expect(activity).toContain("Close previous versions");
});

test("files tab no longer has configure project button and embedded panels own their own consistent headers", () => {
  const left = read("src/lib/components/LeftPanel.svelte");
  const media = read("src/lib/components/MediaPanel.svelte");
  expect(left).not.toContain("Configure project");
  expect(left).toContain("Projects");
  expect(left).toContain("Table of contents");
  expect(left).toContain("Files");
  expect(left).toContain("sidebarEmbedded={true}");
  expect(media).toContain("sidebarEmbedded");
  expect(media).not.toContain("{#if !sidebarEmbedded}");
  expect(media).toContain("Media");
  expect(media).toContain("icon-mini");
});

test("bottom status uses save icons and compact mobile rules", () => {
  const status = read("src/lib/components/StatusBar.svelte");
  const contract = read("src/lib/platform/contract.ts");
  // DEFAULT_SETTINGS is the single shared copy in shared-types.ts (#29);
  // contract.ts and electron/settings-store.ts both import it from there
  // instead of hand-duplicating the literal.
  const settingsStore = read("electron/settings-store.ts");
  expect(contract).toContain("DEFAULT_SETTINGS");
  expect(contract).toContain("shared-types");
  expect(settingsStore).toContain("DEFAULT_SETTINGS");
  expect(settingsStore).toContain("bridge-types");
  expect(status).toContain("saveStateIcon");
  expect(status).toContain("Pending changes");
  expect(status).toContain("@media screen and (max-width: 820px)");
  expect(status).toContain("display: none");
  // L9: Problems access used to disappear entirely below 820px
  // (`!isCompact` gated the whole cluster off). It now always renders, and
  // below 820px opens the list as a full-viewport sheet — see ProblemsPanel's
  // own `compact` prop, whose sheet CSS lives with the list.
  expect(status).toContain('showProblems = $derived(!!projectDir && sourceMode === "folder")');
  expect(status).toContain("compact={isCompact}");
  expect(read("src/lib/components/ProblemsPanel.svelte")).toContain(".problems-panel.compact .panel-body");
});

test("#316: the save state keeps its text at the narrow breakpoint; only the Problems label drops, much later", () => {
  const status = read("src/lib/components/StatusBar.svelte");
  // At the app's single-pane width (820px) the lower-priority items drop out…
  const narrow = /@media screen and \(max-width: 820px\) \{([^}]*)\}/.exec(status)?.[1] ?? "";
  expect(narrow).toContain(".sync-pill");
  expect(narrow).toContain(".status-action");
  // …but "All work saved" used to collapse to an unlabeled check icon here.
  expect(narrow).not.toContain(".save-text");
  expect(status).not.toMatch(/\.save-text[^{]*\{[^}]*display:\s*none/);
  // The Problems label only drops out at phone widths, and the toggle then
  // still has an accessible name (always set, since its icons + counts say
  // nothing to a screen reader).
  const phone = /@media screen and \(max-width: 560px\) \{([^}]*)\}/.exec(status)?.[1] ?? "";
  expect(phone).toContain(".strip-title");
  expect(phone).toContain(".strip-status");
  expect(status).toContain("aria-label={stripLabel}");
});

test("#307: the Problems list is a row of its own above the bar — it never overlays the workspace", () => {
  const status = read("src/lib/components/StatusBar.svelte");
  const panel = read("src/lib/components/ProblemsPanel.svelte");
  // Rendered before (above) the bar, not inside it. The page's .shell is a
  // flex column, so a list in normal flow shrinks the workspace above it.
  const listIdx = status.indexOf("<ProblemsPanel");
  expect(listIdx).toBeGreaterThan(-1);
  expect(listIdx).toBeLessThan(status.indexOf('class="status-bar"'));
  // The old mechanism — an absolutely-positioned body reaching up out of the
  // bar over the left panel and editor — is gone…
  expect(status).not.toContain(":global(.panel-body)");
  // …and the only out-of-flow mode left is the narrow sheet (a deliberate,
  // dismissible full-viewport surface).
  const outsideSheet = panel.replace(/\.problems-panel\.compact \.panel-body \{[^}]*\}/, "");
  expect(outsideSheet).not.toMatch(/\.panel-body[^{]*\{[^}]*position:\s*(absolute|fixed)/);
  // The toggle in the bar still drives the list by id.
  expect(status).toContain('aria-controls="problems-body"');
  expect(panel).toContain('id="problems-body"');
  expect(status).toContain("aria-expanded={problemsOpen}");
});

test("#307: a clean project shows 'No problems' in the bar with no button to open an empty list", () => {
  const status = read("src/lib/components/StatusBar.svelte");
  // The toggle exists only when there is something to expand…
  const ifIdx = status.indexOf("{#if canExpand}");
  const elseIdx = status.indexOf("{:else}", ifIdx);
  expect(ifIdx).toBeGreaterThan(-1);
  expect(elseIdx).toBeGreaterThan(ifIdx);
  expect(status.slice(ifIdx, elseIdx)).toContain('class="toggle-strip"');
  // …and the rest of that block is a plain, non-interactive label.
  const idle = status.slice(elseIdx, status.indexOf("{/if}", status.indexOf('class="strip-idle"')));
  expect(idle).toContain('class="strip-idle"');
  expect(idle).toContain("No problems");
  expect(idle).not.toContain("<button");
  expect(idle).not.toContain("onclick");
});

test("status bar groups saving/syncing on the right and puts Problems beside the book switcher", () => {
  const status = read("src/lib/components/StatusBar.svelte");
  // DOM order IS the layout: book switcher, problems, save/sync, app actions.
  const order = ["status-left", "status-problems", "status-right", "shell-actions"];
  const positions = order.map((cls) => status.indexOf(`class="${cls}"`));
  expect(positions.every((p) => p > -1)).toBe(true);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  // The sync pill and save indicator live in the right cluster…
  const rightIdx = status.indexOf('class="status-right"');
  const actionsIdx = status.indexOf('class="shell-actions"');
  const right = status.slice(rightIdx, actionsIdx);
  expect(right).toContain("<SyncStatusPill");
  expect(right).toContain("save-indicator");
  expect(right).toContain("Sync changes now");
  // …and Problems no longer sits in it.
  expect(right).not.toContain("<ProblemsPanel");
  // The right cluster hugs the app actions even with no problems panel.
  expect(status).toMatch(/\.status-right \{[^}]*margin-left: auto;/s);
});

test("L9 regression: compact Problems overlay has a reachable close control and closes on select/Escape", () => {
  // The compact sheet (`.problems-panel.compact .panel-body`, fixed and
  // z-index:900) visually covers the toggle that would otherwise collapse it,
  // so the panel must not depend on that toggle to be dismissed.
  const panel = read("src/lib/components/ProblemsPanel.svelte");
  const problems = read("src/lib/problems.ts");
  // Decision logic is real, unit-tested predicates (see problems.test.ts),
  // not inline booleans only checkable by reading the component.
  expect(problems).toContain("export function closesPanelOnSelect");
  expect(problems).toContain("export function closesPanelOnEscape");
  expect(panel).toContain("closesPanelOnSelect");
  expect(panel).toContain("closesPanelOnEscape");
  // A visible, always-reachable close button lives inside the overlay itself
  // (it closes AND hands focus back to the toggle — see the keyboard test).
  expect(panel).toContain('{#if compact}');
  expect(panel).toContain('aria-label="Close problems panel"');
  expect(panel).toContain("onclick={closeToToggle}");
  // Escape is wired via a window-level keydown handler.
  expect(panel).toContain("<svelte:window onkeydown={handleWindowKeydown} />");
  // Selecting an entry routes through the shared close-aware handler, not the
  // raw onSelect callback directly.
  expect(panel).toContain("onclick={() => selectEntry(entry)}");
  expect(panel).not.toContain("onclick={() => onSelect?.(entry)}");
});

test("#307: keyboard — opening the list moves focus into it; Escape and Close hand it back to the toggle; no trap", () => {
  const status = read("src/lib/components/StatusBar.svelte");
  const panel = read("src/lib/components/ProblemsPanel.svelte");
  // The list is BEFORE the bar in the DOM, so Tab from the toggle would skip
  // past it: opening focuses into it, as the editor toolbar's popups do.
  expect(status).toContain("onclick={toggleProblems}");
  expect(status).toContain("if (problemsOpen) void tick().then(() => panelRef?.focusList());");
  expect(panel).toContain("export function focusList()");
  // The first entry — or the body itself (tabindex="-1") when the list only
  // shows a message, so Escape still works there.
  expect(panel).toContain('(bodyEl?.querySelector<HTMLElement>(".entry.clickable") ?? bodyEl)?.focus()');
  expect(panel).toContain('tabindex="-1"');
  // Escape and the compact sheet's Close hand focus back to the toggle, which
  // the StatusBar passes down.
  expect(status).toContain("bind:this={toggleEl}");
  expect(status).toContain("{toggleEl}");
  expect(panel).toContain("toggleEl?.focus()");
  expect(panel).toContain("onclick={closeToToggle}");
  // Escape is honoured from inside the list (or anywhere in the compact sheet).
  expect(panel).toContain("closesPanelOnEscape(compact, open, e.key, focusInside)");
  // It is a panel, not a modal: nothing traps Tab.
  expect(panel).not.toContain("trapFocus");
  expect(panel).not.toMatch(/key === ["']Tab["']/);
});

test("#307: until the first check has run the bar says 'Checking…', never 'No problems'", () => {
  const page = read("src/routes/+page.svelte");
  const status = read("src/lib/components/StatusBar.svelte");
  // "Not checked yet" is the lint running OR the render that triggers it still
  // in flight: renderingComplete clears `rendering` and starts the lint in the
  // same synchronous call, so the two flags leave no gap between them.
  expect(page).toContain("problemsLoading={problemsLoading || lifecycle.rendering}");
  // The plain label follows that flag.
  expect(status).toContain('{problemsLoading ? "Checking…" : "No problems"}');
});

test("top toolbar small-screen styles/config controls are removed", () => {
  const page = read("src/routes/+page.svelte");
  expect(page).not.toContain("Configure project…");
  expect(page).not.toContain("openProjectConfig(); closeMenu");
});
