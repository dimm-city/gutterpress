import { createEditorProjection, type GutterpressProjection } from "gutterpress/render";
import { MemoryDocumentHost } from "../../../src/core/index.ts";
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

declare global {
  interface Window {
    __gpGutterpress: GutterpressDriver;
    __gpReady?: boolean;
    /** Poisoned by a raw-html `<script>` payload in the fixture IF it ever executes -- must stay `false` throughout every case in this file. */
    __gpcScriptRan?: boolean;
  }
}

export interface GutterpressDriver {
  /** Builds a REAL projection (via `createEditorProjection`) from `text` and mounts through `mountGutterpressEditor`, backed by a fresh `MemoryDocumentHost` seeded with the SAME `text` at version 0. */
  mount(text: string): MountResult;
  /** Same as `mount`, but the projection is built with a `sourceVersion` that does NOT match the host's initial version -- proves G-11 stale fallthrough end-to-end. */
  mountStale(text: string): MountResult;
  dispose(): void;

  getHostText(): string;
  getHostVersion(): number;
  /** G-11 -- true once the LIVE host's version has moved past the mounted projection's own `sourceVersion`. */
  needsRefresh(): boolean;

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

  /** Every `.gp-block-chip` element in the mounted document, in order. */
  chipCount(): number;
  chipInfo(index: number): ChipInfo;
  /** `outerHTML` of the i-th `.gp-block-chip` -- used to inspect a raw-html chip's inert source preview text directly. */
  chipOuterHTML(index: number): string;

  /** Center point of the `charIndex`-th per-character segment `Text` node inside the i-th chip's `.gp-block-chip__source` -- a real client-space point for `page.mouse.click`. Read BEFORE the click: clicking a segment activates its block, which replaces the chip DOM this reads. */
  segmentCharacterCenter(chipIndex: number, charIndex: number): { x: number; y: number };

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

let mountHandle: GutterpressEditorMount | undefined;
let host: MemoryDocumentHost | undefined;

function buildProjection(text: string, sourceVersion: number): GutterpressProjection {
  return createEditorProjection(text, { sourceVersion });
}

function doMount(text: string, projectionSourceVersion: number): MountResult {
  mountHandle?.dispose();
  document.getElementById(CONTAINER_ID)?.remove();

  host = new MemoryDocumentHost({ text, version: 0 });
  const projection = buildProjection(text, projectionSourceVersion);

  const container = document.createElement("div");
  container.id = CONTAINER_ID;
  document.body.appendChild(container);

  mountHandle = mountGutterpressEditor(container, host, { projection });

  return { containerSelector: `#${CONTAINER_ID}` };
}

function requireHost(): MemoryDocumentHost {
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
  return Array.from(doc.querySelectorAll<HTMLElement>(".md-block")).filter((block) => {
    for (let el = block.parentElement; el && el !== doc; el = el.parentElement) {
      if (!el.classList.contains("md-block-group")) return false;
    }
    return true;
  });
}

function chipElements(): HTMLElement[] {
  const root = document.getElementById(CONTAINER_ID);
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(".gp-block-chip"));
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
  mount: (text: string) => doMount(text, 0),
  mountStale: (text: string) => doMount(text, 999999),
  dispose(): void {
    mountHandle?.dispose();
  },

  getHostText: () => requireHost().getSnapshot().text,
  getHostVersion: () => requireHost().getSnapshot().version,
  needsRefresh: () => {
    if (!mountHandle) throw new Error("gutterpress harness: mount() has not been called yet");
    return mountHandle.needsRefresh();
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
