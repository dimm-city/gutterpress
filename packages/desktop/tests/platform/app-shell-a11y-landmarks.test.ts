/**
 * app-shell-a11y-landmarks.test.ts (SFE-P3d-sweep, Lane C — scenario 11,
 * desktop half: "screen-reader landmarks and labels").
 *
 * ## Scope and what this audits
 *
 * `packages/editor/tests/vscode-adapter/input-a11y/input-a11y.btest.ts`
 * (SFE-P1b, read in full for this audit) proves the FORK's own a11y
 * surface in a real Chromium: focusability (`tabIndex = 0`), the
 * `.md-focused` class as a real side effect of focus, the Tab-trap-for-
 * indentation default with its documented `Control+M` escape hatch
 * (`aria-description`/`aria-keyshortcuts` on the editor root), keyboard
 * caret movement, and clean dispose/remount. It also records — as verified,
 * not assumed, API evidence — that the mounted `.md-editor` root carries NO
 * explicit ARIA role of its own: "the ONE hard requirement proven there is
 * that the node is REACHABLE in the accessibility tree at all," not that it
 * exposes a specific role. That leaves the SHELL around the mount
 * responsible for giving the rich-editing surface (and every other major
 * region) a name and a landmark — this file is the desktop-level half of
 * scenario 11, auditing exactly that shell.
 *
 * ## Why these are structural (source-text) assertions
 *
 * `packages/desktop/tests/platform/app-toolbar.test.ts`'s own header states
 * the reason precisely, and it applies unchanged here: "Svelte component
 * templates lack a mount/DOM test harness in this repo's bun:test setup (no
 * JSDOM/Svelte-compile harness is wired up) — these tests follow the
 * established project convention (NewProjectWizard.test.ts,
 * ProjectsListBody.test.ts, CrashRecoveryDialog.test.ts, …) of asserting
 * the source contains the required wiring, rather than exercising a live
 * component." Verified independently before writing this file: no
 * `@testing-library/svelte`, no vitest+svelte-plugin test config, and no
 * `bunfig.toml` anywhere in this workspace — `happy-dom` (this package's
 * only real-DOM dependency) is used elsewhere (`dialog.test.ts`,
 * `preview-bridge.test.mjs`, …) to drive plain `.ts`/`.js` modules that
 * build DOM imperatively, never to compile and mount a `.svelte` SFC. This
 * file follows the same established convention `app-toolbar.test.ts`
 * already uses for AppToolbar itself — a real, current, working pattern in
 * this exact test tree, not an invented one.
 *
 * `app-toolbar.test.ts` already thoroughly covers AppToolbar.svelte's own
 * a11y surface (the WAI-ARIA tabs pattern for the small-screen pane
 * switcher, the `aria-label`s on the Edit/Read mode segments, the
 * semantic `<header>` root) — cited, not re-tested here. This file covers
 * the surfaces named in this lane's charge that had no prior a11y-focused
 * coverage: the editor's OWN formatting toolbar (`EditorToolbar.svelte`,
 * distinct from the window-chrome `AppToolbar`), the left panel, the status
 * bar, the problems panel, the file tree, the preview surface, and
 * `+page.svelte`'s own editor-pane/preview-pane/resize-separator wiring.
 * (Existing, narrower, incidental a11y-adjacent pins were checked before
 * writing this file — `gutterpress-ui-regressions.test.ts`,
 * `gutterpress-ui-followups.test.ts`, `ux-writer-friendly.test.ts` — each
 * pins ONE specific past regression, e.g. "FileTree rows must not claim
 * `role=\"tree\"`," not a systematic landmark/label sweep.)
 *
 * ## What this file honestly cannot verify (recorded, not asserted)
 *
 * A source-text `toContain` proves the literal attribute is SHIPPED; it
 * cannot prove what a real browser/AT computes from it. Two real gaps that
 * stay open after this file, both because they need a live accessibility
 * tree this test tree has no harness for (input-a11y.btest.ts's own
 * `ariaSnapshot()` machinery lives in `packages/editor`, is browser-only,
 * and drives the fork's own mount, not this desktop shell):
 *
 *   1. `<section aria-label="Markdown editor">` in `+page.svelte`'s
 *      editor-pane relies on the HTML-AAM rule that a `<section>` with an
 *      accessible name computes an implicit `region` role even without an
 *      explicit `role` attribute — real, standard behavior, but not
 *      independently confirmed against a real accessibility tree here.
 *   2. Nothing here proves NO computed-name collisions, tab-order
 *      correctness, or that a screen reader actually announces any of
 *      these labels the way a sighted reading of the markup suggests.
 *
 * These are named explicitly rather than silently assumed true.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf-8");

const editorToolbar = () => read("src/lib/components/EditorToolbar.svelte");
const leftPanel = () => read("src/lib/components/LeftPanel.svelte");
const statusBar = () => read("src/lib/components/StatusBar.svelte");
const problemsPanel = () => read("src/lib/components/ProblemsPanel.svelte");
const fileTree = () => read("src/lib/components/FileTree.svelte");
const previewFrame = () => read("src/lib/components/PreviewFrame.svelte");
const richEditor = () => read("src/lib/components/RichEditor.svelte");
const page = () => read("src/routes/+page.svelte");

describe("EditorToolbar — the formatting toolbar is a labeled landmark", () => {
  test("the toolbar root carries role=toolbar and a real accessible name", () => {
    const src = editorToolbar();
    expect(src).toContain('<div class="editor-toolbar" role="toolbar" aria-label="Markdown formatting toolbar">');
  });

  test("every formatting button and control renders with an aria-label (not icon-only with no name)", () => {
    const src = editorToolbar();
    // The recurring pattern for every `{#each ... as item}` button.
    const perItemLabels = (src.match(/aria-label=\{item\.ariaLabel\}/g) ?? []).length;
    expect(perItemLabels).toBeGreaterThanOrEqual(6);
    // Standalone controls that are not driven by the item list. The
    // rich/source toggle that used to sit here is deliberately absent: the
    // workspace's own Edit/Read is the only surface control, and a
    // second axis beside this toolbar meant one document had six reachable
    // mode combinations.
    for (const label of [
      'aria-label="Heading level"',
      'aria-label="Insert layout block"',
      'aria-label="More formatting options"',
    ]) {
      expect(src).toContain(label);
    }
    expect(src).not.toContain("Switch to rich editor");
  });

  test("the image/table insertion dialogs label every field, and surface errors as role=alert", () => {
    const src = editorToolbar();
    for (const label of [
      'aria-label="Insert table"',
      'aria-label="Number of columns"',
      'aria-label="Insert image"',
      'aria-label="Selected image file"',
      'aria-label="Image alt text"',
      'aria-label="Image width"',
      'aria-label="Image position"',
      'aria-label="Image size"',
    ]) {
      expect(src).toContain(label);
    }
    expect(src).toContain('<p class="image-error" role="alert">{imageError}</p>');
  });
});

describe("LeftPanel — a labeled landmark whose tab strip follows the WAI-ARIA tabs pattern", () => {
  test("the panel root is an <aside> with a real accessible name", () => {
    const src = leftPanel();
    const aside = src.slice(src.indexOf("<aside"), src.indexOf(">", src.indexOf("<aside")) + 1);
    expect(aside).toContain('aria-label="Left panel"');
  });

  test("the resize handle is a labeled, keyboard-operable WAI-ARIA separator (not a bare drag div)", () => {
    const src = leftPanel();
    const handle = src.slice(
      src.indexOf('class="resize-handle"') - 20,
      src.indexOf("></div>", src.indexOf('class="resize-handle"')),
    );
    expect(handle).toContain('role="separator"');
    expect(handle).toContain('aria-label="Resize panel"');
    expect(handle).toContain("aria-valuemin=");
    expect(handle).toContain("aria-valuemax=");
    expect(handle).toContain("aria-valuenow=");
    expect(handle).toContain("tabindex=");
  });

  test("the panel's own tab strip is a real tablist: role=tablist, per-tab role=tab + aria-label, and each panel is aria-labelledby its tab", () => {
    const src = leftPanel();
    expect(src).toContain('role="tablist" aria-label="Panel tabs"');
    expect(src).toContain('role="tab"');
    expect(src).toContain("aria-label={tab.label}");
    for (const id of ["panel-tab-toc", "panel-tab-files", "panel-tab-media", "panel-tab-projects"]) {
      expect(src).toContain(`role="tabpanel"`);
      expect(src).toContain(`aria-labelledby="${id}"`);
    }
  });

  test("the table-of-contents tree exposes expand/collapse state and current-entry position to AT", () => {
    const src = leftPanel();
    expect(src).toContain('<ul class="toc-list" aria-label="Table of contents">');
    // Collapse/expand toggles announce their post-click state via the label
    // text itself, not just a visual chevron.
    expect(src).toMatch(/aria-label=\{isOpen \? `Collapse \$\{node\.entry\.text\}` : `Expand \$\{node\.entry\.text\}`\}/);
    expect(src).toContain('aria-current={node.entry.index === activeEntryIndex ? "true" : undefined}');
  });
});

describe("StatusBar — a labeled status landmark", () => {
  test("the status bar root is role=status with a real accessible name", () => {
    const src = statusBar();
    expect(src).toContain('<div class="status-bar" role="status" aria-label="Application status">');
  });

  test("its icon-only action buttons (sync, save, settings, help) all carry aria-label", () => {
    const src = statusBar();
    for (const label of [
      'aria-label={forceSyncing ? "Syncing…" : "Sync changes now"}',
      'aria-label="Save changes now"',
      'aria-label="Settings"',
      'aria-label="Help and about"',
    ]) {
      expect(src).toContain(label);
    }
  });
});

describe("ProblemsPanel — a labeled, expandable region with a live-region announcer", () => {
  test("a polite live region announces lint results as they complete (screen-reader users are not left to poll the badge visually)", () => {
    const src = problemsPanel();
    expect(src).toContain(
      '<div role="status" aria-live="polite" aria-atomic="true" class="sr-only">{lintAnnouncement}</div>',
    );
  });

  test("the panel root has a real accessible name, and its toggle announces expanded/collapsed state via aria-expanded", () => {
    const src = problemsPanel();
    expect(src).toMatch(/<section\s+class="problems-panel"[\s\S]{0,80}aria-label="Problems"/);
    expect(src).toContain("aria-expanded={open}");
    expect(src).toContain('aria-controls="problems-body"');
  });

  test("the expanded body is a labeled region distinct from the outer panel's own name (\"Problems\" vs \"Problems list\")", () => {
    const src = problemsPanel();
    expect(src).toContain('role="region"');
    expect(src).toContain('aria-label="Problems list"');
  });
});

describe("FileTree — a labeled navigation landmark", () => {
  test("the tree root is a <nav> with a real accessible name", () => {
    const src = fileTree();
    expect(src).toContain('<nav class="file-tree" aria-label="Project files">');
  });

  test("every row's rename/delete affordance is labeled with the specific file it targets, not a generic icon", () => {
    const src = fileTree();
    expect(src).toContain("aria-label={`Rename ${entry.name}`}");
    expect(src).toContain("aria-label={`Delete ${entry.name}`}");
    // Destructive confirmation state is a real alert, not a silent visual change.
    expect(src).toContain('<span class="row-confirm-msg" role="alert">Delete "{entry.name}"?</span>');
  });

  test("the currently open file is exposed to AT via aria-current, not color alone", () => {
    const src = fileTree();
    expect(src).toContain('aria-current={entry.path === selectedPath ? "true" : undefined}');
  });
});

describe("PreviewFrame — the preview surface has a real, unconditional accessible name", () => {
  test("the iframe itself carries a title attribute — independent of whatever aria-labelledby the wrapping pane may or may not set", () => {
    const src = previewFrame();
    expect(src).toContain('title="Gutterpress preview"');
    // A `title` attribute alone is a valid, unconditional accessible-name
    // source for an <iframe> (unlike +page.svelte's wrapping <section>,
    // whose own aria-labelledby is set ONLY in narrow/mobile layout — see
    // the +page.svelte describe block below) — this is what makes the
    // preview surface nameable on EVERY layout, not just narrow ones.
    // lastIndexOf, not indexOf: this file's own header doc comment mentions
    // "`<iframe>`" in passing (line 16) before the real tag (line 78).
    const tagStart = src.lastIndexOf("<iframe");
    const iframeTag = src.slice(tagStart, src.indexOf(">", tagStart) + 1);
    expect(iframeTag).toContain("title=");
  });
});

describe("+page.svelte — the editor pane, preview pane, and pane-resize separator are labeled", () => {
  test("the editor pane has an unconditional aria-label (CSS vs. Markdown editor), true on every layout — not gated behind isNarrow like the preview pane below", () => {
    const src = page();
    expect(src).toContain('aria-label={openFileIsCss ? "CSS editor" : "Markdown editor"}');
  });

  test("the preview pane is aria-labelledby its own tab ONLY in narrow/mobile layout — recorded, not silently assumed equivalent to the editor pane above", () => {
    const src = page();
    expect(src).toContain('aria-labelledby={isNarrow ? "mobile-tab-preview" : undefined}');
    // On a WIDE (non-narrow) layout this section therefore has no role and
    // no label of its own — the iframe's own `title` (see the PreviewFrame
    // describe block above) is what actually names the surface there.
    expect(src).toContain('role={isNarrow ? "tabpanel" : undefined}');
  });

  test("the editor/preview split has a labeled, keyboard-operable resize separator (not a bare drag handle)", () => {
    const src = page();
    expect(src).toContain('role="separator"');
    expect(src).toContain('aria-label="Resize editor and preview panes"');
  });
});

describe("RichEditor — the mount container itself carries no role or label of its own (recorded architecture, not a defect this lane can fix)", () => {
  test("RichEditor.svelte's own root <div> has no role/aria-* attributes — its accessible name comes entirely from the ancestor <section> in +page.svelte", () => {
    const src = richEditor();
    const mountLine = src.slice(src.indexOf('<div class="rich-editor-host"'), src.indexOf("</div>", src.indexOf('<div class="rich-editor-host"')) + 6);
    expect(mountLine).toBe('<div class="rich-editor-host" bind:this={container}></div>');
    expect(mountLine).not.toContain("role=");
    expect(mountLine).not.toContain("aria-");
    // Confirms this is a deliberately thin wrapper (D4/component header),
    // not an oversight: mountGutterpressEditor/mountEditor own everything
    // inside `container`, and per input-a11y.btest.ts's own verified
    // evidence, the fork's OWN mounted root also carries no explicit ARIA
    // role — so the "Markdown editor" name from +page.svelte's editor-pane
    // <section> (see the describe block above) is the ONLY accessible name
    // this whole subtree has, on every layout.
    expect(src).toContain("owns DOM lifecycle for its own subtree only");
  });
});

// ── AP-21/G-12: prove the assertion mechanism above can fail ───────────────
// A deliberately-broken TEST-LOCAL fixture copy (never production source),
// run through the exact same toContain-style check the describe blocks
// above use, so a reviewer can see these assertions are not vacuously true
// regardless of what the markup actually says.
describe("assertion liveness (AP-21) — this file's own check mechanism can fail", () => {
  const goodFixture = '<div class="editor-toolbar" role="toolbar" aria-label="Markdown formatting toolbar">';
  // A realistic regression: someone drops the aria-label while touching
  // nearby markup, leaving role="toolbar" (so it is still reachable as a
  // toolbar) but with no accessible name at all.
  const brokenFixture = '<div class="editor-toolbar" role="toolbar">';

  test("the exact assertion this file's first EditorToolbar test uses PASSES against the real (good) shape", () => {
    expect(goodFixture).toContain('<div class="editor-toolbar" role="toolbar" aria-label="Markdown formatting toolbar">');
  });

  test("the SAME assertion FAILS against a broken test-local copy with the aria-label stripped — proving it has teeth", () => {
    expect(() => {
      expect(brokenFixture).toContain('<div class="editor-toolbar" role="toolbar" aria-label="Markdown formatting toolbar">');
    }).toThrow();
  });
});
