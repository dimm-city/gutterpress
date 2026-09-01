import type { SourceEdit } from "@dimm-city/gutterpress-editor/core";
import type { GutterpressProjection } from "gutterpress/render";
import { mountGutterpressWebview, type WebviewSession } from "../../../src/webview/index.ts";
import {
  createFakeExtensionHost,
  type FakeExtensionHostOptions,
  type FakeExtensionHostSession,
} from "./fake-extension-host.ts";

/**
 * SFE-P3c Lane C — the browser-side scenario driver
 * `tests/webview/*.btest.ts` mounts and drives (via
 * `@dimm-city/gutterpress-editor/test-harness`'s
 * `openHarnessSession`/`waitForHarnessReady`, imported, never edited — this
 * run's deliverable 3). Runs INSIDE the real browser; the Node-side test
 * drives it through `window.__gpWebview` plus real Playwright keyboard
 * input, exactly mirroring `packages/editor/tests/web/support/entry.ts`'s
 * own pattern for `mountEditor`.
 *
 * AP-21 (liveness before behavior): drives the REAL, exported
 * `mountGutterpressWebview` from `../../../src/webview/index.ts` — the
 * SAME function production wiring calls at the bottom of that file — never
 * a reimplementation of it. This file's job is to construct a FAKE
 * extension host per scenario and hand its transport to that one real
 * function; `../../../src/webview/index.ts`'s own production auto-bootstrap
 * (gated on `typeof acquireVsCodeApi === "function"`, a global this harness
 * page never defines) stays inert here, so importing it has no side effect
 * beyond making `mountGutterpressWebview` available to call directly.
 *
 * Mirrors `packages/editor/tests/web/support/entry.ts`'s single-shared
 * `beforeAll`/`afterAll` session convention: every `.btest.ts` file in this
 * directory opens ONE Chromium session and drives every one of its own
 * `test()` cases through repeated `mount()`/`dispose()`/`remount()` calls on
 * this one page, never one Chromium launch per test (`browser-harness`'s own
 * header: a second Chromium launch hangs in this sandboxed environment).
 */

/**
 * JSON-safe mirror of `FakeExtensionHostOptions`: `latencyMs` is a plain
 * NUMBER here, not a function — `page.evaluate`'s arguments cross the
 * Node/browser boundary as JSON, which cannot carry a closure. `mount()`
 * below (browser-side) constructs the real `() => number` closure
 * `createFakeExtensionHost` expects from this number.
 */
export type MountOptions = Omit<FakeExtensionHostOptions, "latencyMs"> & { readonly latencyMs?: number };

export interface GutterpressWebviewHarnessDriver {
  /** Mounts (disposing any previous session first) against a FRESH fake
   *  extension host and returns the CSS selector for the container. */
  mount(initialText: string, options?: MountOptions): string;
  /** Disposes the current session, if any. Calling this more than once in a
   *  row exercises `WebviewSession.dispose()`'s own idempotency directly —
   *  `session` is never reset to `undefined` here, only `mount()`/`remount()`
   *  replace it. */
  dispose(): void;
  /** Disposes the current session (if any) and mounts AGAIN on the SAME
   *  fake host / same underlying document — the "a remount in the same
   *  session works" case (run spec DETAILS #4e). Requires `mount()` to have
   *  been called at least once. */
  remount(): string;
  hostText(): string;
  hostVersion(): number;
  /** Every `SourceEdit` the CURRENT fake host has received, in order —
   *  `{from, to, insert}`, independently comparable against expected values
   *  (run spec DETAILS #4b: byte-exact). */
  recordedEdits(): readonly SourceEdit[];
  applyEditCount(): number;
  /** `SimulatedExtensionHost.disconnect()` passthrough — the run spec's
   *  "Host disconnection" wire-message path. */
  disconnectHost(): void;
  /** `SimulatedExtensionHost.externalChange(text)` passthrough. */
  externalChange(text: string): void;
  /** Live transport-listener count on the CURRENT fake host — see
   *  `fake-extension-host.ts`'s own doc comment on `listenerCount()`. */
  listenerCount(): number;
  /** `FakeExtensionHostSession.sendProjectionUpdate` passthrough on the
   *  CURRENT fake host — sends a projection-bearing `presentation-input`
   *  resend, driving `mountGutterpressWebview`'s dispose-then-remount
   *  upgrade. */
  sendProjectionUpdate(payload: { readonly projection: GutterpressProjection; readonly pluginCss?: string }): void;
  hasEditorMounted(): boolean;
  /** `.md-document`'s rendered text, or `null` if no editor is mounted. */
  documentText(): string | null;
  /** Every `.gp-block-chip` element currently in the mounted document —
   *  present only once `mountGutterpressEditor` (not the plain `mountEditor`)
   *  has actually mounted, per `../../../src/gutterpress/mount.ts`'s (via
   *  `@dimm-city/gutterpress-editor/gutterpress`) `renderCustomBlock`
   *  provider. Used to prove the reconciliation addendum's projection
   *  upgrade actually swapped the mount, not merely that no error was
   *  thrown (AP-21). */
  chipCount(): number;
  /** Every `.md-document > .md-block` element, in order — mirrors
   *  `packages/editor/tests/gutterpress/support/entry.ts`'s own
   *  `blockCount()`/`blockCenter()` pair. */
  blockCount(): number;
  /** Client-space center point of the i-th `.md-document > .md-block` — a
   *  real point for `page.mouse.click`, used to click a specific ORDINARY
   *  (non-chip) block precisely rather than guessing where a plain
   *  paragraph sits relative to an unknown number of chips. */
  blockCenter(index: number): { x: number; y: number };
  /** The fallback DOM's `data-gp-fallback` attribute value (the D14
   *  category), or `null` if no fallback is showing. */
  fallbackCategory(): string | null;
  fallbackMessage(): string | null;
  fallbackAction(): string | null;
  readonly containerSelector: string;
}

declare global {
  interface Window {
    // A name DISTINCT from every OTHER browser test entry's own global in
    // this workspace (`packages/editor/tests/**/support/entry.ts`'s
    // `__gpMount`/`__gp`/`__gpA11y`) — this package's own tsconfig program
    // (`src/webview/tsconfig.json`) is a SEPARATE TypeScript program from
    // packages/editor's, so a name COLLISION would not actually be a
    // cross-package compile error here (each program merges `declare
    // global` blocks only within its own file set) — kept distinct anyway,
    // for the same reason those files document: one glance at
    // `window.__gpWebview` in a Playwright trace unambiguously identifies
    // which suite produced it.
    __gpWebview: GutterpressWebviewHarnessDriver;
    __gpReady?: boolean;
  }
}

const CONTAINER_ID = "gp-editor-root";

let session: WebviewSession | undefined;
let fakeHost: FakeExtensionHostSession | undefined;

function freshContainer(): HTMLDivElement {
  document.getElementById(CONTAINER_ID)?.remove();
  const container = document.createElement("div");
  container.id = CONTAINER_ID;
  document.body.appendChild(container);
  return container;
}

function mount(initialText: string, options: MountOptions = {}): string {
  // WebviewSession.dispose() is idempotent by contract (mirrors
  // EditorMount.dispose()), so calling it even when the previous session
  // was already disposed by the caller is always safe.
  session?.dispose();
  const { latencyMs, ...rest } = options;
  // See MountOptions's own doc comment: this browser-side closure is what
  // page.evaluate's JSON argument boundary cannot carry directly.
  const hostOptions: FakeExtensionHostOptions =
    latencyMs === undefined ? rest : { ...rest, latencyMs: () => latencyMs };
  fakeHost = createFakeExtensionHost(initialText, hostOptions);
  session = mountGutterpressWebview(freshContainer(), fakeHost.transport);
  return `#${CONTAINER_ID}`;
}

function requireFakeHost(): FakeExtensionHostSession {
  if (!fakeHost) throw new Error("gp webview harness: mount() has not been called yet");
  return fakeHost;
}

window.__gpWebview = {
  mount,
  dispose(): void {
    session?.dispose();
  },
  remount(): string {
    session?.dispose();
    session = mountGutterpressWebview(freshContainer(), requireFakeHost().transport);
    return `#${CONTAINER_ID}`;
  },
  hostText: () => requireFakeHost().simulated.currentSnapshot().text,
  hostVersion: () => requireFakeHost().simulated.currentSnapshot().version,
  recordedEdits: () => requireFakeHost().recordedEdits(),
  applyEditCount: () => requireFakeHost().recordedEdits().length,
  disconnectHost: () => requireFakeHost().simulated.disconnect(),
  externalChange: (text: string) => requireFakeHost().simulated.externalChange(text),
  listenerCount: () => requireFakeHost().listenerCount(),
  sendProjectionUpdate: (payload) => requireFakeHost().sendProjectionUpdate(payload),
  hasEditorMounted: () => document.querySelectorAll(`#${CONTAINER_ID} .md-editor`).length > 0,
  documentText: () => document.querySelector(`#${CONTAINER_ID} .md-document`)?.textContent ?? null,
  chipCount: () => document.querySelectorAll(`#${CONTAINER_ID} .gp-block-chip`).length,
  blockCount: () => document.querySelectorAll(`#${CONTAINER_ID} .md-document > .md-block`).length,
  blockCenter(index: number): { x: number; y: number } {
    const el = document.querySelectorAll<HTMLElement>(`#${CONTAINER_ID} .md-document > .md-block`)[index];
    if (!el) throw new Error(`gp webview harness: no block at index ${index}`);
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  },
  fallbackCategory: () =>
    document.querySelector(`#${CONTAINER_ID} [data-gp-fallback]`)?.getAttribute("data-gp-fallback") ?? null,
  fallbackMessage: () => document.querySelector(`#${CONTAINER_ID} [data-gp-fallback-message]`)?.textContent ?? null,
  fallbackAction: () => document.querySelector(`#${CONTAINER_ID} [data-gp-fallback-action]`)?.textContent ?? null,
  containerSelector: `#${CONTAINER_ID}`,
};
window.__gpReady = true;
