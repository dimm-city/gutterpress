/**
 * Source-level checks for UX review L8 / ARCH #41 (retire LeftPanel's no-op
 * history seam) and the H2 wiring that replaces it (ProjectActivityView
 * restore + sync-completion refresh).
 *
 * No component-render harness exists for Svelte 5 SFCs in this repo; these
 * assertions analyze source text directly, following the pattern used
 * elsewhere (RecoveryConfirmDialog.test.ts, ProjectActivityView.test.ts).
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const PAGE_PATH = path.resolve(__dirname, "../../src/routes/+page.svelte");
const LEFT_PANEL_PATH = path.resolve(__dirname, "../../src/lib/components/LeftPanel.svelte");
const SESSION_CTRL_PATH = path.resolve(
  __dirname,
  "../../src/lib/routes/project-session-controller.svelte.ts",
);

const readPage = () => fs.readFileSync(PAGE_PATH, "utf8");
const readLeftPanel = () => fs.readFileSync(LEFT_PANEL_PATH, "utf8");
const readSessionCtrl = () => fs.readFileSync(SESSION_CTRL_PATH, "utf8");

describe("LeftPanel — no-op history seam retired (L8 / ARCH #41)", () => {
  test("no longer exports notifyOpened", () => {
    expect(readLeftPanel()).not.toMatch(/export function notifyOpened/);
  });

  test("no longer exports notifyHistoryRefresh", () => {
    expect(readLeftPanel()).not.toMatch(/export function notifyHistoryRefresh/);
  });

  test("no longer exports resetHistoryState", () => {
    expect(readLeftPanel()).not.toMatch(/export function resetHistoryState/);
  });

  test("the .tab-label CSS is decided once — no typography ruleset immediately undone by an unconditional display:none, no duplicate @container hide", () => {
    const src = readLeftPanel();
    const styleBlock = src.slice(src.indexOf("<style>"), src.indexOf("</style>"));
    // Strip CSS comments first so prose mentioning "@container" inside an
    // explanatory comment can't be mistaken for a live at-rule.
    const styleNoComments = styleBlock.replace(/\/\*[\s\S]*?\*\//g, "");
    // Exactly one rule body targets .tab-label (a single `{ ... }` following it).
    const tabLabelRuleCount = (styleNoComments.match(/\.tab-label\s*\{/g) ?? []).length;
    expect(tabLabelRuleCount).toBe(1);
    // No second, width-conditional hide of the same class (a live @container
    // at-rule wrapping another .tab-label rule).
    expect(styleNoComments).not.toMatch(/@container[^}]*\.tab-label\s*\{\s*display:\s*none/);
  });
});

describe("+page.svelte — LeftPanel ceremonial call sites removed (L8)", () => {
  test("no leftPanelRef variable or references remain", () => {
    expect(readPage()).not.toMatch(/\bleftPanelRef\b/);
  });

  test("no calls to the retired notifyOpened/notifyHistoryRefresh/resetHistoryState", () => {
    const src = readPage();
    expect(src).not.toMatch(/\.notifyOpened\(/);
    expect(src).not.toMatch(/\.notifyHistoryRefresh\(/);
    expect(src).not.toMatch(/\.resetHistoryState\(/);
  });
});

describe("ProjectSessionController — notifyHistoryRefresh dependency retired (L8 / ARCH #41)", () => {
  test("ProjectSessionDeps no longer requires notifyHistoryRefresh", () => {
    expect(readSessionCtrl()).not.toMatch(/notifyHistoryRefresh/);
  });
});

describe("+page.svelte — H2 sync-completion refresh wired to ProjectActivityView", () => {
  test("declares an activityViewRef bound to ProjectActivityView", () => {
    const src = readPage();
    expect(src).toMatch(/let activityViewRef = \$state</);
    expect(src).toMatch(/bind:this=\{activityViewRef\}/);
  });

  test("onSyncCompleted refreshes the activity view's history instead of the retired LeftPanel seam", () => {
    const src = readPage();
    const fn = src.slice(
      src.indexOf("function onSyncCompleted("),
      src.indexOf("function onSyncReconnect("),
    );
    expect(fn).toContain("activityViewRef?.refreshHistory()");
  });

  test("ProjectActivityView is passed onRestored, wired to reconcile the editor buffer", () => {
    const src = readPage();
    expect(src).toMatch(/onRestored=\{onSnapshotRestored\}/);
    const fn = src.slice(
      src.indexOf("function onSnapshotRestored("),
      src.indexOf("function onSnapshotRestored(") + 400,
    );
    expect(fn).toContain("buffer?.reconcileExternalChange()");
    expect(fn).toContain("refreshProblems()");
  });

  test("ProjectActivityView remounts on project switch (no stale snapshot/log list from a prior project)", () => {
    const src = readPage();
    expect(src).toMatch(/\{#key currentDir\}\s*\n\s*<ProjectActivityView/);
  });
});
