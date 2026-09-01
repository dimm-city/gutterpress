/**
 * App-lifecycle capability (SFE-P5b, D10's named bounded context "app
 * lifecycle (flush/close, folder events, file launch)"). Replaces the
 * corresponding `getPlatform()` members consumed by `FileTree.svelte`,
 * `MediaPanel.svelte`, and `+page.svelte`.
 *
 * All four members are real 1:1 delegation to the preload bridge (push
 * subscriptions / a request+push pair) — grouped into one module because
 * `onFolderChanged` has three real consumers sharing the same "why we need
 * the bridge" reasoning, and the other three are the same file-lifecycle
 * bounded context.
 */
import { bridge } from "$lib/platform/bridge";
import type { FolderChangedEvent, MarkdownFileLaunchEvent } from "$lib/platform/contract";

/**
 * Subscribe to debounced folder-change notifications for the open project
 * (#44), backing external-edit detection. Returns an unsubscribe fn.
 */
export function onFolderChanged(cb: (data: FolderChangedEvent) => void): () => void {
  return bridge().onFolderChanged(cb);
}

/**
 * Subscribe to the main process's request to flush before the window closes
 * (#44). Returning false reports that the buffer did not reach disk; main
 * records the durable failure marker and still closes after bounded waits.
 */
export function onFlushBeforeClose(cb: () => boolean | void | Promise<boolean | void>): () => void {
  return bridge().onFlushBeforeClose(cb);
}

/**
 * Subscribe to `.md` launches from the desktop shell. Initial paths are
 * replayed before a `ready` sentinel; later Finder/Explorer launches stream
 * through the same callback.
 */
export function onOpenMarkdownFile(cb: (event: MarkdownFileLaunchEvent) => void): () => void {
  return bridge().onOpenMarkdownFile(cb);
}

/** Raw folder-watch IPC (#44). Subscribes to change events for `path`. */
export function watchFolder(path: string, cb: () => void): () => void {
  return bridge().watchFolder(path, cb);
}
