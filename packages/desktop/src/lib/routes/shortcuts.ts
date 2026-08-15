// Pure keyboard-shortcut resolvers extracted from routes/+page.svelte.
// Zero deps — mirrors commandForSaveShortcut in src/lib/editor/save-shortcuts.ts.
// The DOM glue (addEventListener, target/contenteditable/.cm-editor guards,
// previewUrl/defaultPrevented gate, e.preventDefault) stays in the component;
// these functions only decide WHICH command a key event maps to.

export type GlobalShortcutCommand =
  | "settings"
  | "toggle-editor"
  | "toggle-left-panel"
  | "snippet"
  | "focus-mode"
  | "find"
  | "none";

export interface ShortcutInput {
  ctrlOrMeta: boolean;
  shift: boolean;
  key: string;
}

/**
 * Global shortcuts available without a loaded document. Mirrors onGlobalKey.
 * Note: there is intentionally NO shift guard on the toggle-editor branch, so
 * Cmd/Ctrl+Shift+E resolves to "toggle-editor" here while save-pdf is handled
 * independently by commandForSaveShortcut — preserving the known dual-fire.
 */
export function resolveGlobalShortcut(i: ShortcutInput): GlobalShortcutCommand {
  if (i.ctrlOrMeta && i.key === ",") return "settings";
  if (i.ctrlOrMeta && (i.key === "e" || i.key === "E")) return "toggle-editor";
  if (i.ctrlOrMeta && i.key === "\\") return "toggle-left-panel";
  if (i.ctrlOrMeta && i.shift && (i.key === "s" || i.key === "S")) return "snippet";
  // Cmd/Ctrl+Shift+F toggles focus mode; plain Cmd/Ctrl+F is find. The
  // shift guard is what keeps the two apart (and the preview's bare "f"
  // fit-width stays untouched by both).
  if (i.ctrlOrMeta && i.shift && (i.key === "f" || i.key === "F")) return "focus-mode";
  if (i.ctrlOrMeta && (i.key === "f" || i.key === "F")) return "find";
  return "none";
}

export type PreviewNavCommand =
  | "export-pdf"
  | "next"
  | "prev"
  | "first"
  | "last"
  | "zoom-in"
  | "zoom-out"
  | "fit-width"
  | "none";

/**
 * Preview-navigation shortcuts, active whenever a preview is open. Mirrors onKey.
 */
export function resolvePreviewNavCommand(i: ShortcutInput): PreviewNavCommand {
  if (i.ctrlOrMeta && i.shift && (i.key === "e" || i.key === "E")) return "export-pdf";

  switch (i.key) {
    case "ArrowRight":
    case "PageDown":
      return "next";
    case "ArrowLeft":
    case "PageUp":
      return "prev";
    case "Home":
      return "first";
    case "End":
      return "last";
    case "+":
    case "=":
      return "zoom-in";
    case "-":
      return "zoom-out";
    case "f":
    case "F":
      if (!i.ctrlOrMeta) return "fit-width";
      return "none";
    default:
      return "none";
  }
}
