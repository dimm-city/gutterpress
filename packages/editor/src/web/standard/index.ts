/**
 * `@dimm-city/gutterpress-editor/standard` — the bounded formatting-command
 * layer (SFE-P2a Lane B). `applyCommand`/`commandState` are pure `(snapshot,
 * selection, ...) -> result` functions: no DOM, no CodeMirror, no host.
 * Package root re-exports this subpath's public surface — see
 * `package.json`'s `exports["./standard"]`, mirroring the existing
 * `"./web"`/`"./core"` subpath precedent so a consumer that wants ONLY the
 * pure command layer (no `web/mount.ts`, no `vscode-adapter/**`) can import
 * it without pulling those in.
 */
export { applyCommand, type ApplyCommandResult, type CommandSelection } from "./apply-command.ts";
// Building blocks a host reuses PER LINE / per caret where `applyCommand`
// already returns the combined answer (desktop `toolbar-actions.ts`).
export { minimalReplacement } from "./line-utils.ts";
export { currentHeadingLevel } from "./heading.ts";
export {
  commandState,
  type CommandStateEntry,
  type CommandStateMap,
  type SetHeadingState,
  type ToggleListState,
} from "./command-state.ts";
