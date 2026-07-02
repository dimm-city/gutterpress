import { test, expect } from "bun:test";
import { commandForSaveShortcut } from "../../src/lib/editor/save-shortcuts";

test("plain Cmd/Ctrl+S saves source edits when an editor file is open", () => {
  expect(
    commandForSaveShortcut({
      key: "s",
      ctrlOrMeta: true,
      shift: false,
      editorFileOpen: true,
      canSavePdf: true,
    }),
  ).toBe("save-source");
});

test("plain Cmd/Ctrl+S does not export PDF when no editor file is open", () => {
  expect(
    commandForSaveShortcut({
      key: "s",
      ctrlOrMeta: true,
      shift: false,
      editorFileOpen: false,
      canSavePdf: true,
    }),
  ).toBe("none");
});

test("Cmd/Ctrl+Shift+E is the explicit PDF export shortcut", () => {
  expect(
    commandForSaveShortcut({
      key: "E",
      ctrlOrMeta: true,
      shift: true,
      editorFileOpen: true,
      canSavePdf: true,
    }),
  ).toBe("save-pdf");
});

test("shortcut helper ignores unrelated keys", () => {
  expect(
    commandForSaveShortcut({
      key: "s",
      ctrlOrMeta: false,
      shift: false,
      editorFileOpen: true,
      canSavePdf: true,
    }),
  ).toBe("none");
});
