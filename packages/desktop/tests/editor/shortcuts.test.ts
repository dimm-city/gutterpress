import { test, expect } from "bun:test";
import {
  resolveGlobalShortcut,
  resolvePreviewNavCommand,
  type GlobalShortcutCommand,
  type PreviewNavCommand,
} from "../../src/lib/routes/shortcuts";

// ---------------------------------------------------------------------------
// resolveGlobalShortcut — mirrors the onGlobalKey handler in +page.svelte.
// Pure function, zero deps (like commandForSaveShortcut in save-shortcuts.ts).
// ---------------------------------------------------------------------------

test("Cmd/Ctrl+, opens Settings", () => {
  expect(
    resolveGlobalShortcut({ ctrlOrMeta: true, shift: false, key: "," }),
  ).toBe<GlobalShortcutCommand>("settings");
});

test("Cmd/Ctrl+E toggles the editor (lowercase)", () => {
  expect(
    resolveGlobalShortcut({ ctrlOrMeta: true, shift: false, key: "e" }),
  ).toBe("toggle-editor");
});

test("Cmd/Ctrl+E toggles the editor (uppercase)", () => {
  expect(
    resolveGlobalShortcut({ ctrlOrMeta: true, shift: false, key: "E" }),
  ).toBe("toggle-editor");
});

test("Cmd/Ctrl+Shift+E still toggles the editor (no shift guard — known dual-fire)", () => {
  // The original handler has NO shift guard on the toggle-editor branch, so
  // Cmd/Ctrl+Shift+E fires toggle-editor here AND save-pdf via the
  // independently-called commandForSaveShortcut. This resolver preserves that.
  expect(
    resolveGlobalShortcut({ ctrlOrMeta: true, shift: true, key: "e" }),
  ).toBe("toggle-editor");
  expect(
    resolveGlobalShortcut({ ctrlOrMeta: true, shift: true, key: "E" }),
  ).toBe("toggle-editor");
});

test("Cmd/Ctrl+\\ toggles the left panel", () => {
  expect(
    resolveGlobalShortcut({ ctrlOrMeta: true, shift: false, key: "\\" }),
  ).toBe("toggle-left-panel");
});

test("Cmd/Ctrl+Shift+S opens the snippet picker (lowercase)", () => {
  expect(
    resolveGlobalShortcut({ ctrlOrMeta: true, shift: true, key: "s" }),
  ).toBe("snippet");
});

test("Cmd/Ctrl+Shift+S opens the snippet picker (uppercase)", () => {
  expect(
    resolveGlobalShortcut({ ctrlOrMeta: true, shift: true, key: "S" }),
  ).toBe("snippet");
});

test("Cmd/Ctrl+S (no shift) is NOT a snippet shortcut", () => {
  expect(
    resolveGlobalShortcut({ ctrlOrMeta: true, shift: false, key: "s" }),
  ).toBe("none");
});

test("Cmd/Ctrl+Shift+F toggles focus mode (lowercase)", () => {
  expect(
    resolveGlobalShortcut({ ctrlOrMeta: true, shift: true, key: "f" }),
  ).toBe<GlobalShortcutCommand>("focus-mode");
});

test("Cmd/Ctrl+Shift+F toggles focus mode (uppercase)", () => {
  expect(
    resolveGlobalShortcut({ ctrlOrMeta: true, shift: true, key: "F" }),
  ).toBe("focus-mode");
});

test("Cmd/Ctrl+F (no shift) is NOT focus mode — it is the global find (2026-08-15)", () => {
  expect(
    resolveGlobalShortcut({ ctrlOrMeta: true, shift: false, key: "f" }),
  ).toBe("find");
});

test("plain keys without a modifier resolve to none", () => {
  expect(
    resolveGlobalShortcut({ ctrlOrMeta: false, shift: false, key: "e" }),
  ).toBe("none");
  expect(
    resolveGlobalShortcut({ ctrlOrMeta: false, shift: false, key: "," }),
  ).toBe("none");
  expect(
    resolveGlobalShortcut({ ctrlOrMeta: false, shift: false, key: "\\" }),
  ).toBe("none");
});

test("unrelated modified keys resolve to none", () => {
  expect(
    resolveGlobalShortcut({ ctrlOrMeta: true, shift: false, key: "q" }),
  ).toBe("none");
});

// ---------------------------------------------------------------------------
// resolvePreviewNavCommand — mirrors the onKey preview-nav handler.
// ---------------------------------------------------------------------------

test("Cmd/Ctrl+Shift+E exports PDF", () => {
  expect(
    resolvePreviewNavCommand({ ctrlOrMeta: true, shift: true, key: "e" }),
  ).toBe<PreviewNavCommand>("export-pdf");
  expect(
    resolvePreviewNavCommand({ ctrlOrMeta: true, shift: true, key: "E" }),
  ).toBe("export-pdf");
});

test("ArrowRight / PageDown go to the next page", () => {
  expect(
    resolvePreviewNavCommand({ ctrlOrMeta: false, shift: false, key: "ArrowRight" }),
  ).toBe("next");
  expect(
    resolvePreviewNavCommand({ ctrlOrMeta: false, shift: false, key: "PageDown" }),
  ).toBe("next");
});

test("ArrowLeft / PageUp go to the previous page", () => {
  expect(
    resolvePreviewNavCommand({ ctrlOrMeta: false, shift: false, key: "ArrowLeft" }),
  ).toBe("prev");
  expect(
    resolvePreviewNavCommand({ ctrlOrMeta: false, shift: false, key: "PageUp" }),
  ).toBe("prev");
});

test("Home goes to the first page", () => {
  expect(
    resolvePreviewNavCommand({ ctrlOrMeta: false, shift: false, key: "Home" }),
  ).toBe("first");
});

test("End goes to the last page", () => {
  expect(
    resolvePreviewNavCommand({ ctrlOrMeta: false, shift: false, key: "End" }),
  ).toBe("last");
});

test("+ / = zoom in", () => {
  expect(
    resolvePreviewNavCommand({ ctrlOrMeta: false, shift: false, key: "+" }),
  ).toBe("zoom-in");
  expect(
    resolvePreviewNavCommand({ ctrlOrMeta: false, shift: false, key: "=" }),
  ).toBe("zoom-in");
});

test("- zooms out", () => {
  expect(
    resolvePreviewNavCommand({ ctrlOrMeta: false, shift: false, key: "-" }),
  ).toBe("zoom-out");
});

test("f / F fit width only without Cmd/Ctrl", () => {
  expect(
    resolvePreviewNavCommand({ ctrlOrMeta: false, shift: false, key: "f" }),
  ).toBe("fit-width");
  expect(
    resolvePreviewNavCommand({ ctrlOrMeta: false, shift: false, key: "F" }),
  ).toBe("fit-width");
});

test("Cmd/Ctrl+F is NOT fit-width (browser find is left alone)", () => {
  expect(
    resolvePreviewNavCommand({ ctrlOrMeta: true, shift: false, key: "f" }),
  ).toBe("none");
});

test("Cmd/Ctrl+Shift+F is NOT a preview-nav command (no fit-width collision with focus mode)", () => {
  expect(
    resolvePreviewNavCommand({ ctrlOrMeta: true, shift: true, key: "f" }),
  ).toBe("none");
  expect(
    resolvePreviewNavCommand({ ctrlOrMeta: true, shift: true, key: "F" }),
  ).toBe("none");
});

test("unknown keys resolve to none", () => {
  expect(
    resolvePreviewNavCommand({ ctrlOrMeta: false, shift: false, key: "x" }),
  ).toBe("none");
  expect(
    resolvePreviewNavCommand({ ctrlOrMeta: false, shift: false, key: "Enter" }),
  ).toBe("none");
});

test("Cmd/Ctrl+F resolves to find; Ctrl+Shift+F stays focus-mode (global find, 2026-08-15)", () => {
  expect(resolveGlobalShortcut({ ctrlOrMeta: true, shift: false, key: "f" })).toBe("find");
  expect(resolveGlobalShortcut({ ctrlOrMeta: true, shift: false, key: "F" })).toBe("find");
  expect(resolveGlobalShortcut({ ctrlOrMeta: true, shift: true, key: "f" })).toBe("focus-mode");
});

test("bare f (preview fit-width) stays untouched by the find shortcut", () => {
  expect(resolveGlobalShortcut({ ctrlOrMeta: false, shift: false, key: "f" })).toBe("none");
});
