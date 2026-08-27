import { createVscodeEditorAdapter, type VscodeEditorAdapter } from "../../../src/vscode-adapter/index.ts";
import { MemoryDocumentHost } from "../../../src/core/index.ts";
import type { Diagnostic, EditorDocumentHost, SourceEdit } from "../../../src/core/index.ts";
import { withFixedRejection } from "./rejecting-host.ts";
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

function mount(initialText: string, options: MountOptions = {}): void {
  adapter?.dispose();
  adapter = undefined;
  document.getElementById(CONTAINER_ID)?.remove();
  collectedDiagnostics = [];

  const baseHost: EditorDocumentHost = options.rejectReason
    ? withFixedRejection(options.rejectReason, { text: initialText, version: 0 })
    : new MemoryDocumentHost({ text: initialText, version: 0 });
  host = withCallCounting(baseHost);

  const container = document.createElement("div");
  container.id = CONTAINER_ID;
  document.body.appendChild(container);

  adapter = createVscodeEditorAdapter(container, host, {
    readonly: options.readonly ?? false,
    onDiagnostic: (diagnostic) => collectedDiagnostics.push(diagnostic),
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
  containerSelector: `#${CONTAINER_ID}`,
};
window.__gpReady = true;
