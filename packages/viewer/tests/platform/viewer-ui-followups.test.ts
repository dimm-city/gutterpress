import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

test("hidden preview is collapsed to zero width instead of unmounted and editor gets full track", () => {
  const page = read("src/routes/+page.svelte");
  expect(page).toContain("previewCollapseGridColumns");
  expect(page).toContain("class:preview-collapsed={previewHidden}");
  expect(page).toContain("aria-hidden={previewHidden}");
  expect(page).toContain("inert={previewHidden");
  expect(page).not.toContain("{#if !previewHidden}\n      <section");
});

test("project activity view has an explicit close action returning to the editor", () => {
  const page = read("src/routes/+page.svelte");
  const activity = read("src/lib/components/ProjectActivityView.svelte");
  expect(page).toContain("closeActivityView");
  expect(page).toContain("onClose={closeActivityView}");
  expect(activity).toContain("onClose");
  expect(activity).toContain("Close activity view");
});

test("files tab no longer has configure project button and embedded panels own their own consistent headers", () => {
  const left = read("src/lib/components/LeftPanel.svelte");
  const media = read("src/lib/components/MediaPanel.svelte");
  const config = read("src/lib/components/ProjectConfigPanel.svelte");
  expect(left).not.toContain("Configure project");
  expect(left).toContain("Projects");
  expect(left).toContain("Table of contents");
  expect(left).toContain("Files");
  expect(left).toContain("sidebarEmbedded={true}");
  expect(media).toContain("sidebarEmbedded");
  expect(config).toContain("sidebarEmbedded");
  expect(media).not.toContain("{#if !sidebarEmbedded}");
  expect(media).toContain("Media");
  expect(media).toContain("icon-mini");
  expect(config).not.toContain("{#if !sidebarEmbedded}");
  expect(config).toContain("Project settings");
});

test("bottom status uses save icons, slower autosave default, and compact mobile rules", () => {
  const status = read("src/lib/components/StatusBar.svelte");
  const contract = read("src/lib/platform/contract.ts");
  // DEFAULT_SETTINGS is the single shared copy in shared-types.ts (#29);
  // contract.ts and electron/settings-store.ts both import it from there
  // instead of hand-duplicating the literal.
  const sharedTypes = read("src/lib/platform/shared-types.ts");
  const settingsStore = read("electron/settings-store.ts");
  expect(sharedTypes).toContain("autoSaveDelay: 2500");
  expect(contract).toContain("DEFAULT_SETTINGS");
  expect(contract).toContain("shared-types");
  expect(settingsStore).toContain("DEFAULT_SETTINGS");
  expect(settingsStore).toContain("bridge-types");
  expect(status).toContain("saveStateIcon");
  expect(status).toContain("pending changes");
  expect(status).toContain("@media screen and (max-width: 820px)");
  expect(status).toContain("display: none");
  // L9: Problems access used to disappear entirely below 820px
  // (`!isCompact` gated the whole cluster off). It now always renders as a
  // compact icon + count badge that opens the panel as a full-viewport
  // overlay — see ProblemsPanel's own `compact` prop.
  expect(status).toContain('showProblems = $derived(!!projectDir && sourceMode === "folder")');
  expect(status).toContain("compact={isCompact}");
  expect(status).toContain(".status-right.compact");
});

test("L9 regression: compact Problems overlay has a reachable close control and closes on select/Escape", () => {
  // The compact overlay (`.status-right.compact :global(.panel-body)`, fixed
  // and z-index:900) visually covers the toggle strip that would otherwise
  // collapse it, so the panel must not depend on that strip to be dismissed.
  const panel = read("src/lib/components/ProblemsPanel.svelte");
  const problems = read("src/lib/problems.ts");
  // Decision logic is real, unit-tested predicates (see problems.test.ts),
  // not inline booleans only checkable by reading the component.
  expect(problems).toContain("export function closesPanelOnSelect");
  expect(problems).toContain("export function closesPanelOnEscape");
  expect(panel).toContain("closesPanelOnSelect");
  expect(panel).toContain("closesPanelOnEscape");
  // A visible, always-reachable close button lives inside the overlay itself.
  expect(panel).toContain('{#if compact}');
  expect(panel).toContain('aria-label="Close problems panel"');
  expect(panel).toContain("onclick={() => (open = false)}");
  // Escape is wired via a window-level keydown handler.
  expect(panel).toContain("<svelte:window onkeydown={handleWindowKeydown} />");
  // Selecting an entry routes through the shared close-aware handler, not the
  // raw onSelect callback directly.
  expect(panel).toContain("onclick={() => selectEntry(entry)}");
  expect(panel).not.toContain("onclick={() => onSelect?.(entry)}");
});

test("top toolbar small-screen styles/config controls are removed", () => {
  const page = read("src/routes/+page.svelte");
  expect(page).not.toContain("Configure project…");
  expect(page).not.toContain("openProjectConfig(); closeMenu");
});
