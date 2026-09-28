import { createVscodeEditorAdapter, type VscodeEditorAdapter } from "../../../src/vscode-adapter/index.ts";
import { MemoryDocumentHost } from "../../../src/core/index.ts";
import type { Diagnostic, EditorDocumentHost, SourceEdit } from "../../../src/core/index.ts";
import { withFixedRejection, withRejectOnceThenExternalChange } from "./rejecting-host.ts";
import { withCallCounting, type CallCountingHost } from "./counting-host.ts";

/**
 * SFE-P1b Lane A — the browser-side scenario driver every
 * tests/vscode-adapter/browser.cases.btest.ts case bundles and mounts (via
 * tests/browser-harness's `openHarnessSession`/`withHarnessPage`). Runs
 * INSIDE the real browser;
 * the Node-side test drives it through `window.__gp` (see the
 * `GutterpressHarnessDriver` type below) plus real Playwright keyboard/mouse
 * input against the mounted DOM.
 *
 * Deliberately imports ONLY this package's own public surfaces
 * (`../../../src/vscode-adapter/index.ts`, `../../../src/core/index.ts`) —
 * never `@vscode/markdown-editor` directly — so this test entry, like every
 * other file outside `src/vscode-adapter/`, proves D5's "the adapter's
 * public exports are what future lanes consume" by construction rather
 * than by convention.
 */

export interface MountOptions {
  readonly readonly?: boolean;
  /** When set, the mounted host's `applyEdit` ALWAYS rejects with this
   * reason (see `rejecting-host.ts`) — used by the rejection-path case. */
  readonly rejectReason?: "stale" | "readonly" | "invalid-range";
  /** When set, the mounted host rejects exactly its first `applyEdit` call
   * as stale and also fires a genuine `replaceExternal` during the
   * rejection window, in the given ordering (see
   * `withRejectOnceThenExternalChange` in `rejecting-host.ts`) — used by
   * the rejection-window-external-change repair case. Mutually exclusive
   * with `rejectReason`. */
  readonly rejectThenExternal?: { readonly mode: "sync" | "microtask"; readonly externalText: string };
  /** When set, the mounted host keeps a history of its own and hands it to the
   * adapter as `history` (see `withHistory` below) - used by case 3's second
   * half. The chords the adapter routes to it are listed by `historyCalls()`. */
  readonly history?: boolean;
}

export interface GutterpressHarnessDriver {
  mount(initialText: string, options?: MountOptions): void;
  dispose(): void;
  getHostText(): string;
  getHostVersion(): number;
  replaceExternal(text: string): void;
  applyEditCallCount(): number;
  notificationCount(): number;
  lastSubmittedEdit(): SourceEdit | undefined;
  diagnostics(): readonly Diagnostic[];
  /** The history chords the adapter routed to the host, in order (`"undo"` / `"redo"`). */
  historyCalls(): readonly string[];
  /** CSS selector for the element `mount()` appended the adapter into. */
  readonly containerSelector: string;
}

declare global {
  interface Window {
    __gp: GutterpressHarnessDriver;
    __gpReady?: boolean;
  }
}

const CONTAINER_ID = "gp-mount";

let adapter: VscodeEditorAdapter | undefined;
let host: CallCountingHost | undefined;
let collectedDiagnostics: Diagnostic[] = [];
let historyCalls: string[] = [];

/**
 * The least a host that keeps its own history does (the desktop's
 * `DesktopDocumentHost` is the real one): remember each edit it accepts,
 * and undo by replaying the inverse through its own `applyEdit`, so the
 * replayed edit reaches the adapter's model over `subscribe` like any
 * other host-side change. One entry per accepted edit - no grouping.
 */
function withHistory(base: EditorDocumentHost): EditorDocumentHost & { undo(): void; redo(): void } {
  type Entry = { from: number; insert: string; removed: string };
  const past: Entry[] = [];
  const future: Entry[] = [];
  let replaying = false;
  const replay = (edit: Omit<SourceEdit, "expectedVersion">): boolean => {
    replaying = true;
    try {
      return host.applyEdit({ ...edit, expectedVersion: base.getSnapshot().version }).ok;
    } finally {
      replaying = false;
    }
  };
  const host: EditorDocumentHost & { undo(): void; redo(): void } = {
    getSnapshot: () => base.getSnapshot(),
    subscribe: (listener) => base.subscribe(listener),
    replaceExternal: (text) => base.replaceExternal(text),
    applyEdit(edit) {
      const before = base.getSnapshot().text;
      const result = base.applyEdit(edit);
      if (result.ok && !replaying) {
        past.push({ from: edit.from, insert: edit.insert, removed: before.slice(edit.from, edit.to) });
        future.length = 0;
      }
      return result;
    },
    undo() {
      const entry = past.at(-1);
      if (entry && replay({ from: entry.from, to: entry.from + entry.insert.length, insert: entry.removed })) {
        past.pop();
        future.push(entry);
      }
    },
    redo() {
      const entry = future.at(-1);
      if (entry && replay({ from: entry.from, to: entry.from + entry.removed.length, insert: entry.insert })) {
        future.pop();
        past.push(entry);
      }
    },
  };
  return host;
}

function mount(initialText: string, options: MountOptions = {}): void {
  adapter?.dispose();
  adapter = undefined;
  document.getElementById(CONTAINER_ID)?.remove();
  collectedDiagnostics = [];
  historyCalls = [];

  const baseHost: EditorDocumentHost = options.rejectThenExternal
    ? withRejectOnceThenExternalChange(
        options.rejectThenExternal.mode,
        { text: initialText, version: 0 },
        options.rejectThenExternal.externalText,
      )
    : options.rejectReason
      ? withFixedRejection(options.rejectReason, { text: initialText, version: 0 })
      : new MemoryDocumentHost({ text: initialText, version: 0 });
  host = withCallCounting(baseHost);

  const container = document.createElement("div");
  container.id = CONTAINER_ID;
  document.body.appendChild(container);

  const historied = options.history ? withHistory(host) : undefined;
  adapter = createVscodeEditorAdapter(container, historied ?? host, {
    readonly: options.readonly ?? false,
    onDiagnostic: (diagnostic) => collectedDiagnostics.push(diagnostic),
    history: historied
      ? {
          undo: () => {
            historyCalls.push("undo");
            historied.undo();
          },
          redo: () => {
            historyCalls.push("redo");
            historied.redo();
          },
        }
      : undefined,
  });
}

function requireHost(): CallCountingHost {
  if (!host) throw new Error("gp harness: mount() has not been called yet");
  return host;
}

window.__gp = {
  mount,
  dispose(): void {
    adapter?.dispose();
    adapter = undefined;
  },
  getHostText: () => requireHost().getSnapshot().text,
  getHostVersion: () => requireHost().getSnapshot().version,
  replaceExternal: (text: string) => requireHost().replaceExternal(text),
  applyEditCallCount: () => requireHost().applyEditCallCount(),
  notificationCount: () => requireHost().notificationCount(),
  lastSubmittedEdit: () => requireHost().lastSubmittedEdit(),
  diagnostics: () => collectedDiagnostics.slice(),
  historyCalls: () => historyCalls.slice(),
  containerSelector: `#${CONTAINER_ID}`,
};
window.__gpReady = true;
