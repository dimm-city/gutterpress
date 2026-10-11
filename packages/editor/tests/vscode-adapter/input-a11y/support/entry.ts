import {
  createVscodeEditorAdapter,
  type VscodeEditorAdapter,
} from "../../../../src/vscode-adapter/index.ts";
import { MemoryDocumentHost } from "../../../../src/core/index.ts";
import type { EditorDocumentHost, SourceEdit } from "../../../../src/core/index.ts";
import { withTracking, type TrackingHost } from "./tracking-host.ts";

/**
 * SFE-P1b Lane B — the browser-side scenario driver for
 * tests/vscode-adapter/input-a11y/input-a11y.btest.ts (D5 cases 7 and 8).
 * Runs INSIDE the real browser, bundled and served by
 * tests/browser-harness (Lane A's reusable harness — imported, never
 * edited, matching this run's write-ownership boundary).
 *
 * Deliberately imports ONLY this package's own public surfaces
 * (`../../../../src/vscode-adapter/index.ts`,
 * `../../../../src/core/index.ts`) — never `@vscode/markdown-editor`
 * directly — matching D5's "No application code outside
 * packages/editor/src/vscode-adapter/ may import package internals" and
 * mirroring Lane A's own `tests/vscode-adapter/support/entry.ts` exactly
 * (this file is a from-scratch, self-contained sibling, not an edit of
 * that one — Lane B may not write `tests/vscode-adapter/support/**`).
 *
 * Unlike Lane A's single-instance driver, this one is a REGISTRY of named
 * instances — case 7c requires two independently mounted editors to coexist
 * on the page at once, which Lane A's "mount() disposes the previous
 * instance" driver deliberately does not support (it does not need to; its
 * cases never mount two documents at the same time).
 *
 * DOM scaffold (built once, before `window.__gpReady`, by `ensureScaffold`):
 *   - an "outside probe" `<p>`/`<h1>` pair, OUTSIDE every mount container,
 *     wrapped in a `display: flow-root` box so a computed-style diff can
 *     only be explained by a leaked CSS RULE match — never by incidental
 *     margin collapsing against an unrelated box (case 7b);
 *   - two sentinel `<button>`s bracketing the region every `mount()` call
 *     inserts its container into, so Tab order is deterministic regardless
 *     of how many instances exist: sentinel-before, container(s)...,
 *     sentinel-after (case 8's keyboard/no-trap proof).
 */

export interface MountOptions {
  readonly readonly?: boolean;
  /** Passed through as `EditorViewOptions.classNames` — case 7 mounts WITH
   * the package's own theme class (`md-theme-default`) alongside our custom
   * stylesheet, matching the case's "editor.css + themes/default.css PLUS
   * an additional custom stylesheet" requirement. */
  readonly classNames?: readonly string[];
  /** Passed through as `EditorViewOptions.showReadonlyToggle`. The default
   * `true` renders an extra, real, focusable `<button>` inside `.md-editor`
   * (verified live via `Locator.ariaSnapshot()` while writing this file:
   * `- button "Editing; switch to locked mode"`) — a legitimate additional
   * a11y control, but an extra Tab stop the keyboard/no-trap case needs to
   * exclude to test the MAIN text surface's own Tab behavior in isolation. */
  readonly showReadonlyToggle?: boolean;
}

interface Instance {
  readonly container: HTMLElement;
  readonly host: TrackingHost;
  adapter: VscodeEditorAdapter | undefined;
}

export interface GutterpressA11yDriver {
  /**
   * Mounts (or, called again with the same `id`, CLEANLY remounts) a named
   * editor instance. A remount disposes and REMOVES the previous instance's
   * container/adapter/host entirely and builds fresh ones — case 8's
   * "remount works clean" proof deliberately never reuses a DOM node or
   * host across two adapter lifetimes, so a pass there cannot be explained
   * by an accidental artifact of node/object reuse. Returns the CSS
   * selector for the freshly mounted container.
   */
  mount(id: string, initialText: string, options?: MountOptions): string;
  /**
   * Disposes instance `id`'s adapter ONLY — the container element is left
   * in the DOM, now empty (case 8: "the container is empty" is asserted
   * against this exact state, distinct from a remount's full removal).
   * Idempotent: disposing an already-disposed or never-mounted id is a
   * no-op.
   */
  dispose(id: string): void;
  getHostText(id: string): string;
  getHostVersion(id: string): number;
  replaceExternal(id: string, text: string): void;
  applyEditCallCount(id: string): number;
  activeSubscriberCount(id: string): number;
  lastSubmittedEdit(id: string): SourceEdit | undefined;
  /** Appends one more `<style>` element with `cssText` to `document.head`.
   * Case 7's "additional custom stylesheet", injected purely client-side so
   * no change to tests/browser-harness/server.ts's fixed CSS routes is
   * needed. */
  injectCustomStyle(cssText: string): void;
  readonly outsideProbeParagraphSelector: string;
  readonly outsideProbeHeadingSelector: string;
  readonly sentinelBeforeSelector: string;
  readonly sentinelAfterSelector: string;
}

declare global {
  interface Window {
    // A DISTINCT global name from Lane A's `window.__gp`
    // (tests/vscode-adapter/support/entry.ts) is required, not just
    // stylistic: `src/web.tsconfig.json`'s "include" pulls BOTH files'
    // `declare global` blocks into the SAME TypeScript program (they are
    // bundled into separate browser pages at RUNTIME, but typechecked
    // together), and TypeScript merges same-named ambient `Window` members
    // — two different shapes for `Window.__gp` would be a compile error
    // ("Subsequent property declarations must have the same type"),
    // verified live while writing this file.
    __gpA11y: GutterpressA11yDriver;
    __gpReady?: boolean;
  }
}

const OUTSIDE_PROBE_P_ID = "gp-a11y-outside-p";
const OUTSIDE_PROBE_H1_ID = "gp-a11y-outside-h1";
const SENTINEL_BEFORE_ID = "gp-a11y-sentinel-before";
const SENTINEL_AFTER_ID = "gp-a11y-sentinel-after";

const instances = new Map<string, Instance>();
let sentinelAfter: HTMLButtonElement | undefined;

function ensureScaffold(): void {
  if (sentinelAfter) return;

  const outsideWrapper = document.createElement("div");
  outsideWrapper.id = "gp-a11y-outside-wrapper";
  // flow-root: blocks margin collapsing with the rest of the page, so
  // case 7b's before/after-mount computed-style diff is never explained by
  // incidental layout, only by an actual matching CSS rule.
  outsideWrapper.style.display = "flow-root";
  const p = document.createElement("p");
  p.id = OUTSIDE_PROBE_P_ID;
  p.textContent = "outside probe paragraph";
  const h1 = document.createElement("h1");
  h1.id = OUTSIDE_PROBE_H1_ID;
  h1.textContent = "Outside probe heading";
  outsideWrapper.append(p, h1);
  document.body.appendChild(outsideWrapper);

  const before = document.createElement("button");
  before.id = SENTINEL_BEFORE_ID;
  before.type = "button";
  before.textContent = "before";
  document.body.appendChild(before);

  const after = document.createElement("button");
  after.id = SENTINEL_AFTER_ID;
  after.type = "button";
  after.textContent = "after";
  document.body.appendChild(after);
  sentinelAfter = after;
}

function containerSelector(id: string): string {
  return `#gp-a11y-mount-${id}`;
}

function requireInstance(id: string): Instance {
  const instance = instances.get(id);
  if (!instance) throw new Error(`gp a11y harness: no instance mounted for id "${id}"`);
  return instance;
}

function mount(id: string, initialText: string, options: MountOptions = {}): string {
  ensureScaffold();

  // A remount (same id called again): dispose and fully remove the prior
  // container/adapter/host before building fresh ones — see the driver
  // interface doc comment above for why this is deliberate, not merely
  // convenient.
  const previous = instances.get(id);
  if (previous) {
    previous.adapter?.dispose();
    previous.container.remove();
    instances.delete(id);
  }

  const container = document.createElement("div");
  container.id = `gp-a11y-mount-${id}`;
  sentinelAfter!.before(container);

  const baseHost: EditorDocumentHost = new MemoryDocumentHost({ text: initialText, version: 0 });
  const host = withTracking(baseHost);

  const viewOptions =
    options.classNames || options.showReadonlyToggle !== undefined
      ? {
          ...(options.classNames ? { classNames: options.classNames } : {}),
          ...(options.showReadonlyToggle !== undefined
            ? { showReadonlyToggle: options.showReadonlyToggle }
            : {}),
        }
      : undefined;

  const adapter = createVscodeEditorAdapter(container, host, {
    readonly: options.readonly ?? false,
    viewOptions,
  });

  instances.set(id, { container, host, adapter });
  return containerSelector(id);
}

window.__gpA11y = {
  mount,
  dispose(id: string): void {
    const instance = instances.get(id);
    if (!instance) return;
    instance.adapter?.dispose();
    instance.adapter = undefined;
  },
  getHostText: (id) => requireInstance(id).host.getSnapshot().text,
  getHostVersion: (id) => requireInstance(id).host.getSnapshot().version,
  replaceExternal: (id, text) => requireInstance(id).host.replaceExternal(text),
  applyEditCallCount: (id) => requireInstance(id).host.applyEditCallCount(),
  activeSubscriberCount: (id) => requireInstance(id).host.activeSubscriberCount(),
  lastSubmittedEdit: (id) => requireInstance(id).host.lastSubmittedEdit(),
  injectCustomStyle(cssText: string): void {
    const style = document.createElement("style");
    style.textContent = cssText;
    document.head.appendChild(style);
  },
  outsideProbeParagraphSelector: `#${OUTSIDE_PROBE_P_ID}`,
  outsideProbeHeadingSelector: `#${OUTSIDE_PROBE_H1_ID}`,
  sentinelBeforeSelector: `#${SENTINEL_BEFORE_ID}`,
  sentinelAfterSelector: `#${SENTINEL_AFTER_ID}`,
};

ensureScaffold();
window.__gpReady = true;
