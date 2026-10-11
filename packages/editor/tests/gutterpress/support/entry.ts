import { createEditorProjection, type GutterpressProjection } from "gutterpress/render";
import { MemoryDocumentHost } from "../../../src/core/index.ts";
import type { EditorDocumentHost } from "../../../src/core/index.ts";
import { withCallCounting, withSubscriberCounting } from "../../web/support/counting-host.ts";
import { mountGutterpressEditor, type GutterpressEditorMount } from "../../../src/gutterpress/mount.ts";

/**
 * SFE-P2b Lane B — the browser-side scenario driver for
 * `tests/gutterpress/gutterpress.btest.ts`. Mirrors
 * `tests/web/support/entry.ts`'s single-instance driver shape (own
 * `mount`/`dispose`, own container id, own `window.__gp*` global — a
 * DISTINCT name so `src/gutterpress/tsconfig.json`'s "include" (which pulls
 * every browser test entry it lists into ONE TypeScript program alongside
 * this one) never merges two different `declare global` shapes under the
 * same name, exactly the hazard `tests/web/support/entry.ts`'s own header
 * documents for `__gpMount` vs `__gp`/`__gpA11y`).
 *
 * Deliberately mounts ONLY through the real, production
 * `mountGutterpressEditor` (never a second hand-wired
 * `EditorModel`/`EditorView`/`EditorController`, unlike
 * `tests/vscode-adapter/custom-view/support/entry.ts`'s test-only
 * investigation driver) — every assertion this file's driver exposes is
 * therefore evidence about the actual shipped function. Caret/selection
 * checks use ONLY standard browser APIs (`window.getSelection()`, `Range`,
 * `TreeWalker`, `getBoundingClientRect()`) rather than package-internal
 * `EditorModel`/`EditorView` access.
 *
 * `segmentCharacterCenter` must be read BEFORE the click that activates a
 * block: clicking one of this module's own per-character chip segments
 * activates that block, which REPLACES the chip DOM (segments included)
 * with the fork's own real-source active rendering.
 *
 * VERIFIED LIVE (this run): `window.getSelection()` does NOT reflect the
 * fork's own editing caret at all -- a real click inside an active block
 * left the NATIVE selection anchored on an unrelated decorative element
 * (the readonly-toggle button's icon `<span>`), confirming the package
 * manages its own caret model internally rather than relying on native
 * browser selection (matching why the P1b2 investigation driver
 * (`tests/vscode-adapter/custom-view/support/entry.ts`) reads
 * `model.selection.get()` directly instead). This driver deliberately does
 * NOT reach into that package-internal API (unlike that file, which is
 * explicitly justified as investigation code for a DIFFERENT run) — instead,
 * `gutterpress.btest.ts` proves caret precision the same way an ordinary
 * author would experience it: click at a specific character, type, and
 * check the BYTE-EXACT resulting edit. A wrong caret position could not
 * produce the exact predicted edit, so this is complete, non-tautological,
 * production-only evidence with no native-selection assumption and no
 * package-internal reach-through.
 *
 * SFE-P3ab (Lane C): `getSelection()` on the driver below is a straight
 * passthrough to `GutterpressEditorMount.getSelection()` (`../mount.ts`) —
 * the mount's own new PUBLIC accessor, not `model.selection.get()` reached
 * through directly, so the "no package-internal reach-through" property
 * above still holds for this driver.
 */

export interface MountResult {
  readonly containerSelector: string;
}

export interface ChipInfo {
  readonly kind: string;
  readonly className: string;
  readonly textContent: string;
  readonly gpBlockKind: string | undefined;
}

export interface GutterpressMountOptions {
  readonly keepHost?: boolean;
  readonly readonly?: boolean;
}

declare global {
  interface Window {
    __gpGutterpress: GutterpressDriver;
    __gpReady?: boolean;
    /** Poisoned by a raw-html `<script>` payload in the fixture IF it ever executes -- must stay `false` throughout every case in this file. */
    __gpcScriptRan?: boolean;
  }
}

export interface GutterpressDriver {
  /**
   * Builds a REAL projection (via `createEditorProjection`) from `text` and
   * mounts through `mountGutterpressEditor`, backed by a fresh
   * `MemoryDocumentHost` seeded with the SAME `text` at version 0. The host
   * is wrapped in `tests/web/support/counting-host.ts`'s decorators
   * (imported, not copied) so `activeSubscriberCount()` and
   * `applyEditCallCount()` below can observe the boundary.
   *
   * `options.keepHost` (T2, mirroring `tests/web/support/entry.ts`'s option
   * of the same name) reuses the PREVIOUS mount's host - text argument
   * ignored, projection rebuilt from the host's current text and version -
   * which is what the desktop's lock/unlock remount does: BookSurface bumps a
   * slot's epoch, RichEditor's onMount mounts again on the same host with
   * `readonly` fixed for that mount's lifetime. Ignored on the very first
   * `mount()` call. `options.readonly` is passed straight to
   * `mountGutterpressEditor`.
   */
  mount(text: string, options?: GutterpressMountOptions): MountResult;
  /** Same as `mount`, but the projection is built with a `sourceVersion` that does NOT match the host's initial version -- proves G-11 stale fallthrough end-to-end. */
  mountStale(text: string): MountResult;
  dispose(): void;

  getHostText(): string;
  getHostVersion(): number;
  /** ACTIVE subscriber count on the current host (`withSubscriberCounting`). */
  activeSubscriberCount(): number;
  /** `applyEdit` calls the current host has received (`withCallCounting`). */
  applyEditCallCount(): number;
  /** Count of `.gp-marker-tags` overlay layers in the document (marker-tags.ts installs one per unlocked mount). */
  markerTagLayerCount(): number;
  /** Count of `<style data-gp-editor-css>` elements `mountEditor` injected. */
  injectedStyleElementCount(): number;
  /** Whether the mounted surface is the fork's locked view (`.md-editor.md-readonly`). */
  isReadonlySurface(): boolean;
  /** G-11 -- true once the LIVE host's version has moved past the mounted projection's own `sourceVersion`. */
  needsRefresh(): boolean;
  /** Builds a projection for the host's CURRENT text and version and hands it to `GutterpressEditorMount.refreshProjection` - the host-side refresh an edit triggers. */
  refreshFromHost(): void;

  /** Every `.md-block` element in the mounted document, in order. */
  blockCount(): number;
  blockClassName(index: number): string;
  /** SFE-P3ab (Lane C) — client-space center point of the i-th `.md-block`
   *  (a real point for `page.mouse.click`), mirroring
   *  `segmentCharacterCenter` below for a whole block instead of one
   *  chip segment — used to click into a plain (non-chip) block without
   *  depending on `:nth-child` CSS matching every sibling under
   *  `.md-document`. */
  blockCenter(index: number): { x: number; y: number };

  /** T1 (real-book sweep): scrolls the i-th `.md-block` to the viewport's center so `blockCenter(i)` is a clickable point on a long chapter. */
  scrollBlockIntoView(index: number): void;
  /** T1: the position of the i-th chip among `blockCount()`'s blocks (a chip IS a block), so the sweep can find the chip's adjacent non-chip block. */
  chipBlockIndex(chipIndex: number): number;
  /** T1: scrolls the i-th chip's margin tag to the viewport's center so `markerTagPoint(i)` is a clickable point on a long chapter. */
  scrollChipIntoView(chipIndex: number): void;

  /** Every `.gp-block-chip` element in the mounted document, in order. */
  chipCount(): number;
  chipInfo(index: number): ChipInfo;
  /** `outerHTML` of the i-th `.gp-block-chip` -- used to inspect a raw-html chip's inert source preview text directly. */
  chipOuterHTML(index: number): string;

  /** Center point of the `charIndex`-th per-character segment `Text` node inside the i-th chip's `.gp-block-chip__source` -- a real client-space point for `page.mouse.click`. Read BEFORE the click: clicking a segment activates its block, which replaces the chip DOM this reads. */
  segmentCharacterCenter(chipIndex: number, charIndex: number): { x: number; y: number };
  /**
   * A client-space point on the margin tag drawn for the i-th chip
   * (`marker-tags.ts`): the chip itself has no box in the flow, so this is
   * what a click that opens the marker lands on. Near the tag's right edge,
   * which sits inside the content container's own padding even when the
   * tag is wider than that padding.
   */
  markerTagPoint(chipIndex: number): { x: number; y: number };

  /** Whether the i-th chip's own generated-preview element (`.gp-block-chip__generated`), if present, gains focus when `.focus()` is called on it directly. */
  generatedPreviewAcceptsFocus(chipIndex: number): boolean;
  /** textContent of the i-th chip's generated-preview source `<pre>`, or undefined if it has none. */
  generatedPreviewText(chipIndex: number): string | undefined;

  /**
   * SFE-P3ab (Lane C) — passthrough to the current mount's own
   * `GutterpressEditorMount.getSelection()` (`../mount.ts`). `undefined`
   * before `mount()`/`mountStale()` has been called at all.
   */
  getSelection(): { readonly from: number; readonly to: number } | undefined;
}

const CONTAINER_ID = "gp-gutterpress-mount";

type CountingHost = EditorDocumentHost & {
  activeSubscriberCount(): number;
  applyEditCallCount(): number;
};

let mountHandle: GutterpressEditorMount | undefined;
let host: CountingHost | undefined;

function buildProjection(text: string, sourceVersion: number): GutterpressProjection {
  return createEditorProjection(text, { sourceVersion });
}

function createCountingHost(text: string): CountingHost {
  const subscriberCounted = withSubscriberCounting(new MemoryDocumentHost({ text, version: 0 }));
  const callCounted = withCallCounting(subscriberCounted);
  return { ...callCounted, activeSubscriberCount: subscriberCounted.activeSubscriberCount };
}

function doMount(text: string, projectionSourceVersion: number, options: GutterpressMountOptions = {}): MountResult {
  mountHandle?.dispose();
  document.getElementById(CONTAINER_ID)?.remove();

  let projection: GutterpressProjection;
  if (options.keepHost && host) {
    const snapshot = host.getSnapshot();
    projection = buildProjection(snapshot.text, snapshot.version);
  } else {
    host = createCountingHost(text);
    projection = buildProjection(text, projectionSourceVersion);
  }

  const container = document.createElement("div");
  container.id = CONTAINER_ID;
  document.body.appendChild(container);

  mountHandle = mountGutterpressEditor(container, host, { projection, readonly: options.readonly });

  return { containerSelector: `#${CONTAINER_ID}` };
}

function requireHost(): CountingHost {
  if (!host) throw new Error("gutterpress harness: mount() has not been called yet");
  return host;
}

function blockElements(): HTMLElement[] {
  const root = document.getElementById(CONTAINER_ID);
  if (!root) return [];
  const doc = root.querySelector(".md-document");
  if (!doc) return [];
  // TOP-LEVEL blocks. A Gutterpress marker scope mounts its blocks inside a
  // container element (`.md-block-group`, fork Patch 3), so "top level" is no
  // longer "direct child of `.md-document`" — but it is still not "any
  // descendant", which would also pick up the blocks a blockquote or a list
  // item nests inside itself. Only container wrappers may sit in between.
  const inDomOrder = Array.from(doc.querySelectorAll<HTMLElement>(".md-block")).filter((block) => {
    for (let el = block.parentElement; el && el !== doc; el = el.parentElement) {
      if (!el.classList.contains("md-block-group")) return false;
    }
    return true;
  });
  // Source order, not DOM order: the fork mounts the chip that opened a
  // group AFTER that group (Patch 9). Put each such chip back before the
  // first block inside the wrapper it follows, so an index here is still
  // the block's place in the document.
  const ordered = [...inDomOrder];
  for (const chip of inDomOrder.filter((block) => block.hasAttribute("data-gp-after-group"))) {
    const wrapper = chip.previousElementSibling;
    const first = wrapper ? ordered.find((block) => wrapper.contains(block)) : undefined;
    if (!first) continue;
    ordered.splice(ordered.indexOf(chip), 1);
    ordered.splice(ordered.indexOf(first), 0, chip);
  }
  return ordered;
}

function chipElements(): HTMLElement[] {
  const root = document.getElementById(CONTAINER_ID);
  if (!root) return [];
  // Source order, not DOM order: the fork mounts the chip that opened a
  // group AFTER that group (Patch 9), so a chip's place in the DOM is no
  // longer its place in the document. `data-gp-caret` is the chip's own
  // source offset; a chip without one keeps its DOM position.
  const chips = Array.from(root.querySelectorAll<HTMLElement>(".gp-block-chip"));
  if (!chips.every((chip) => chip.hasAttribute("data-gp-caret"))) return chips;
  return chips.sort((a, b) => Number(a.getAttribute("data-gp-caret")) - Number(b.getAttribute("data-gp-caret")));
}

function requireChip(index: number): HTMLElement {
  const el = chipElements()[index];
  if (!el) throw new Error(`gutterpress harness: no chip at index ${index}`);
  return el;
}

function segmentTextNode(chipIndex: number, charIndex: number): Text {
  const chip = requireChip(chipIndex);
  const sourceEl = chip.querySelector(".gp-block-chip__source");
  const node = sourceEl?.childNodes[charIndex];
  if (!node || node.nodeType !== Node.TEXT_NODE) {
    throw new Error(`gutterpress harness: chip ${chipIndex} has no segment text node at charIndex ${charIndex}`);
  }
  return node as Text;
}

window.__gpcScriptRan = false;

window.__gpGutterpress = {
  mount: (text: string, options?: GutterpressMountOptions) => doMount(text, 0, options),
  mountStale: (text: string) => doMount(text, 999999),
  dispose(): void {
    mountHandle?.dispose();
  },

  getHostText: () => requireHost().getSnapshot().text,
  getHostVersion: () => requireHost().getSnapshot().version,
  activeSubscriberCount: () => requireHost().activeSubscriberCount(),
  applyEditCallCount: () => requireHost().applyEditCallCount(),
  markerTagLayerCount: () => document.querySelectorAll(".gp-marker-tags").length,
  injectedStyleElementCount: () => document.querySelectorAll("style[data-gp-editor-css]").length,
  isReadonlySurface: () => document.querySelector(".md-editor.md-readonly") !== null,
  needsRefresh: () => {
    if (!mountHandle) throw new Error("gutterpress harness: mount() has not been called yet");
    return mountHandle.needsRefresh();
  },
  refreshFromHost: () => {
    if (!mountHandle) throw new Error("gutterpress harness: mount() has not been called yet");
    const snapshot = requireHost().getSnapshot();
    mountHandle.refreshProjection(buildProjection(snapshot.text, snapshot.version));
  },

  blockCount: () => blockElements().length,
  blockClassName(index: number): string {
    const el = blockElements()[index];
    if (!el) throw new Error(`gutterpress harness: no block at index ${index}`);
    return el.className;
  },
  blockCenter(index: number): { x: number; y: number } {
    const el = blockElements()[index];
    if (!el) throw new Error(`gutterpress harness: no block at index ${index}`);
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  },

  scrollBlockIntoView(index: number): void {
    const el = blockElements()[index];
    if (!el) throw new Error(`gutterpress harness: no block at index ${index}`);
    el.scrollIntoView({ block: "center" });
  },
  chipBlockIndex(chipIndex: number): number {
    const index = blockElements().indexOf(requireChip(chipIndex));
    if (index < 0) throw new Error(`gutterpress harness: chip ${chipIndex} is not among the top-level blocks`);
    return index;
  },
  scrollChipIntoView(chipIndex: number): void {
    const start = requireChip(chipIndex).getAttribute("data-gp-caret");
    const tag = start === null ? null : document.querySelector<HTMLElement>(`.gp-marker-tag[data-gp-caret="${start}"]`);
    if (!tag) throw new Error(`gutterpress harness: chip ${chipIndex} has no margin tag to scroll to`);
    tag.scrollIntoView({ block: "center" });
  },

  chipCount: () => chipElements().length,
  chipInfo(index: number): ChipInfo {
    const el = requireChip(index);
    return {
      kind: el.dataset["gpBlockKind"] ?? "",
      className: el.className,
      textContent: el.textContent ?? "",
      gpBlockKind: el.dataset["gpBlockKind"],
    };
  },
  chipOuterHTML: (index: number) => requireChip(index).outerHTML,

  segmentCharacterCenter(chipIndex: number, charIndex: number): { x: number; y: number } {
    const node = segmentTextNode(chipIndex, charIndex);
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  },
  markerTagPoint(chipIndex: number): { x: number; y: number } {
    const chip = requireChip(chipIndex);
    const start = chip.getAttribute("data-gp-caret");
    const tag = start === null ? null : document.querySelector<HTMLElement>(`.gp-marker-tag[data-gp-caret="${start}"]`);
    if (!tag) {
      const layers = document.querySelectorAll(".gp-marker-tags").length;
      const tags = [...document.querySelectorAll(".gp-marker-tag")].map((t) => t.getAttribute("data-gp-caret"));
      const docEl = document.querySelector(".md-document");
      throw new Error(
        `gutterpress harness: chip ${chipIndex} has no margin tag (start=${start}, layers=${layers}, tags=${JSON.stringify(tags)}, docConnected=${docEl?.isConnected}, docParent=${docEl?.parentElement?.className}, readonly=${!!document.querySelector(".md-editor.md-readonly")})`,
      );
    }
    const rect = tag.getBoundingClientRect();
    return { x: rect.right - 6, y: rect.top + rect.height / 2 };
  },
  generatedPreviewAcceptsFocus(chipIndex: number): boolean {
    const chip = requireChip(chipIndex);
    const preview = chip.querySelector<HTMLElement>(".gp-block-chip__generated");
    if (!preview) throw new Error(`gutterpress harness: chip ${chipIndex} has no generated preview`);
    preview.focus();
    return document.activeElement === preview;
  },
  generatedPreviewText(chipIndex: number): string | undefined {
    const chip = requireChip(chipIndex);
    const pre = chip.querySelector<HTMLElement>(".gp-block-chip__generated .gp-block-chip__preview-source");
    return pre?.textContent ?? undefined;
  },

  getSelection: () => mountHandle?.getSelection(),
};
window.__gpReady = true;
