export type SaveShortcutCommand = "save-source" | "save-pdf" | "none";

export interface SaveShortcutInput {
  key: string;
  ctrlOrMeta: boolean;
  shift: boolean;
  editorFileOpen: boolean;
}

export function commandForSaveShortcut(_input: SaveShortcutInput): SaveShortcutCommand {
  const input = _input;
  if (!input.ctrlOrMeta) return "none";
  const key = input.key.toLowerCase();
  if (key === "s" && !input.shift) {
    return input.editorFileOpen ? "save-source" : "none";
  }
  if (key === "e" && input.shift) {
    return "save-pdf";
  }
  return "none";
}
