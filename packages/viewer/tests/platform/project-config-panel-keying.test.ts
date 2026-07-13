/**
 * Regression test for maintainer finding #9 (High): ProjectConfigPanel is
 * mounted once in LeftPanel and loads every section's config in `onMount`
 * (see ProjectConfigPanel.svelte's `onMount(() => { void loadAll(); ... })`,
 * with each `*SectionController` constructed once and only reloaded by an
 * explicit call, never by a `projectDir` change — this repo bans `$effect`
 * in the SPA, see CLAUDE.md §8). Without a remount hook, switching projects
 * while the Config tab is open leaves project A's in-memory drafts (Details/
 * Publish/etc.) resident; a subsequent Save writes them into project B
 * because each controller's `save` call reads the *current* live
 * `projectDir` accessor while the *draft field values* are stale from A.
 *
 * Fix: wrap <ProjectConfigPanel> in a `{#key projectDir}` block in
 * LeftPanel.svelte so a project switch remounts the panel, re-running
 * onMount's loadAll() for the new project and discarding any stale drafts.
 * This mirrors the established pattern already used in the same file for
 * FileTree/MediaPanel, and in +page.svelte for ProjectActivityView (see
 * that file's "Remount on project switch..." comment / L8 fix).
 *
 * No component-render harness exists for Svelte 5 SFCs in this repo; these
 * assertions analyze source text directly, following the pattern used
 * elsewhere (history-seam-retirement.test.ts, ProjectActivityView.test.ts).
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const LEFT_PANEL_PATH = path.resolve(__dirname, "../../src/lib/components/LeftPanel.svelte");
const CONFIG_PANEL_PATH = path.resolve(
  __dirname,
  "../../src/lib/components/ProjectConfigPanel.svelte",
);

const readLeftPanel = () => fs.readFileSync(LEFT_PANEL_PATH, "utf8");
const readConfigPanel = () => fs.readFileSync(CONFIG_PANEL_PATH, "utf8");

describe("LeftPanel — ProjectConfigPanel keyed by projectDir (finding #9)", () => {
  test("ProjectConfigPanel is wrapped in {#key projectDir}, remounting on project switch", () => {
    const src = readLeftPanel();
    // Isolate the Config tab panel region so this can't accidentally match
    // one of the other {#key projectDir} blocks (FileTree/MediaPanel) that
    // already exist earlier in the same file.
    const configTabStart = src.indexOf('id="panel-content-config"');
    expect(configTabStart).toBeGreaterThan(-1);
    const nextTabStart = src.indexOf('id="panel-content-', configTabStart + 1);
    const configTabRegion = src.slice(
      configTabStart,
      nextTabStart > -1 ? nextTabStart : configTabStart + 2000,
    );
    const panelIdx = configTabRegion.indexOf("<ProjectConfigPanel");
    expect(panelIdx).toBeGreaterThan(-1);
    // The nearest preceding {#key ...} directive (skipping past any
    // intervening {#if}/{:else} branch markers) must key on projectDir, and
    // its matching {/key} must close after the component so the whole
    // element — not just a sibling — is inside the keyed block.
    const keyIdx = configTabRegion.lastIndexOf("{#key ", panelIdx);
    expect(keyIdx).toBeGreaterThan(-1);
    expect(configTabRegion.slice(keyIdx, panelIdx)).toMatch(/^\{#key projectDir\}\s*\n\s*$/);
    const closeKeyIdx = configTabRegion.indexOf("{/key}", panelIdx);
    expect(closeKeyIdx).toBeGreaterThan(panelIdx);
  });

  test("sanity: ProjectConfigPanel really does load all section state exactly once on mount (why the remount key is required)", () => {
    const src = readConfigPanel();
    // Confirms the premise the fix relies on: there is exactly one load path
    // (onMount -> loadAll), no $effect re-running it on a projectDir change.
    expect(src).toMatch(/onMount\(\(\) => \{[\s\S]*?loadAll\(\)/);
    expect(src).not.toMatch(/\$effect\(/);
  });
});
