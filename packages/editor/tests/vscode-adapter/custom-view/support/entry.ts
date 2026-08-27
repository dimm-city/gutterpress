import {
  EditorController,
  EditorModel,
  EditorView,
  OffsetRange,
  StringValue,
  type BlockAstNode,
  type EditorViewOptions,
} from "@vscode/markdown-editor";
import { stringEditToSourceEdit } from "../../../../src/vscode-adapter/index.ts";
import { MemoryDocumentHost } from "../../../../src/core/index.ts";

/**
 * SFE-P1b Lane C — the browser-side scenario driver for D5 cases 4, 5, 6
 * (custom inactive Gutterpress-block rendering, active/source-aware editing
 * of a projected block, selection mapping through projected content).
 *
 * Deliberately DIFFERENT from Lane A's own
 * `tests/vscode-adapter/support/entry.ts` in one load-bearing way: THIS file
 * imports `@vscode/markdown-editor` DIRECTLY (`EditorModel`/`EditorView`/
 * `EditorController`/`OffsetRange` below), not just this package's own
 * `src/vscode-adapter/index.ts` surface. That is deliberate, not an
 * oversight of D5's "no application code outside `src/vscode-adapter/` may
 * import package internals" rule:
 *
 *   - D5 governs the adopted ADAPTER's production import boundary. This
 *     file is investigation code for the run whose entire job is to answer
 *     whether that boundary is even sufficient — the run spec's own
 *     instructions require probing `EditorView.overlayContainer`,
 *     `EditorView.rangeRects`, `EditorView.forcedMarkerVisibleBlocks`, and
 *     `EditorModel.selection`, none of which
 *     `createVscodeEditorAdapter`'s current return value exposes (by
 *     design — Lane A's own `VscodeEditorAdapter` only exposes
 *     `dispose()`). There is no way to honestly investigate cases 4-6
 *     without reaching these, and the only place left to do that, given
 *     this lane's write boundary (`tests/vscode-adapter/custom-view/**`
 *     only, `src/vscode-adapter/**` is Lane A's), is a test-only file here.
 *   - This file therefore mirrors `src/vscode-adapter/adapter.ts`'s own
 *     model/view/controller wiring (constructor, `onWillApplySourceEdit`
 *     -> `host.applyEdit`, `known` snapshot bookkeeping) closely enough to
 *     get REAL host-backed edit-locality evidence for case 5, but it is
 *     NOT a second adapter and is never proposed as one — see this run's
 *     decision record (`docs/plans/source-first-editor/runs/
 *     SFE-P1b-decision.md`) for the exact hook citations this file's tests
 *     produce evidence for.
 */

export interface CustomViewMountOptions {
  /**
   * When set, wires `EditorViewOptions.renderCustomCodeBlock` to return a
   * `<div class="gpc-custom-chip" data-language="…">` labelled with this
   * string for EVERY fenced code block's language, and records every
   * invocation (language + content) so a test can assert whether the hook
   * fired for a given block. This is the ONE hook D5's Recorded facts
   * confirm exists — used both as the case-4 "known hook" baseline (a real
   * ```gutterpress-region fence) and as the instrument that proves the hook
   * is NEVER invoked for a paragraph-shaped probe.
   */
  readonly customCodeBlockChipLabel?: string;
}

interface DirectMountState {
  readonly host: MemoryDocumentHost;
  readonly model: EditorModel;
  readonly view: EditorView;
  readonly controller: EditorController;
  known: { text: string; version: number };
  readonly codeBlockCalls: Array<{ language: string; content: string }>;
  submittingOwnEdit: boolean;
  lastOverlay: HTMLElement | undefined;
}

export interface CodeBlockHookCall {
  readonly language: string;
  readonly content: string;
}

export interface SelectionOffsets {
  readonly anchor: number;
  readonly active: number;
  readonly start: number;
  readonly endExclusive: number;
}

export interface BlockInfo {
  readonly kind: string;
  readonly absoluteStart: number;
  readonly length: number;
  readonly className: string;
  readonly textContent: string;
}

export interface CustomViewDriver {
  /**
   * Mounts a real `@vscode/markdown-editor` surface directly (model + view +
   * controller), backed by a fresh `MemoryDocumentHost` seeded with `text`.
   * Every model-owned edit is submitted to that host via the same
   * `stringEditToSourceEdit` conversion the real adapter uses (imported from
   * `src/vscode-adapter/index.ts`, never reimplemented here), so case 5's
   * "no byte drift" / edit-locality claims are checked against the same
   * conversion the adopted adapter ships.
   */
  mount(text: string, options?: CustomViewMountOptions): void;
  dispose(): void;
  readonly containerSelector: string;

  getHostText(): string;
  getHostVersion(): number;

  documentBlockCount(): number;
  /** DOM + AST info for the block at `index` (source order). */
  blockInfo(index: number): BlockInfo;

  codeBlockHookCalls(): readonly CodeBlockHookCall[];

  /** Forces (or un-forces) `forcedMarkerVisibleBlocks` for the block at
   * `index` -- the one real "force this block active" seam the package
   * exposes to a host (used by its own Find contribution). */
  forceBlockMarkersVisible(index: number, visible: boolean): void;

  /**
   * Mounts a decorative "chip" into `EditorView.overlayContainer`,
   * positioned via `rangeRects()` over the block at `index`. Returns whether
   * at least one rect was found (i.e. the block is currently laid out).
   */
  mountOverlayChip(index: number, label: string): boolean;
  /** textContent of the most recently mounted overlay chip, or undefined. */
  overlayChipText(): string | undefined;
  /** Whether the overlay chip element is a DIRECT descendant of
   * `overlayContainer` (proving it is layered on top, not substituted into
   * the block's own flow position). */
  overlayChipInOverlayContainer(): boolean;

  selectionOffsets(): SelectionOffsets | undefined;
  /** `sourceText.substring([start, endExclusive))` against the CURRENT host
   * text -- what a real "copy" would read, since (per the package's own
   * `EditorController._discardNativeSelection` doc) "copy/cut read the
   * model," not the browser's native DOM selection. */
  sourceSlice(start: number, endExclusive: number): string;
}

declare global {
  interface Window {
    __gpc: CustomViewDriver;
    __gpcReady?: boolean;
    // The generic harness contract (`tests/browser-harness/index.ts`'s
    // `waitForHarnessReady`) polls `window.__gpReady` specifically -- set
    // below alongside this file's own `__gpcReady` so `waitForHarnessReady`
    // (reused as-is from Lane A's harness, per this run's instructions)
    // resolves correctly for this entry too.
    __gpReady?: boolean;
  }
}

const CONTAINER_ID = "gpc-mount";

let state: DirectMountState | undefined;

function freshContainer(): HTMLElement {
  document.getElementById(CONTAINER_ID)?.remove();
  const container = document.createElement("div");
  container.id = CONTAINER_ID;
  document.body.appendChild(container);
  return container;
}

function disposeCurrent(): void {
  if (!state) return;
  state.controller.dispose();
  state.view.dispose();
  state.view.element.remove();
  state = undefined;
}

function requireState(): DirectMountState {
  if (!state) throw new Error("gpc harness: mount() has not been called yet");
  return state;
}

function mount(text: string, options: CustomViewMountOptions = {}): void {
  disposeCurrent();
  const container = freshContainer();

  const host = new MemoryDocumentHost({ text, version: 0 });
  let known = host.getSnapshot();

  const codeBlockCalls: Array<{ language: string; content: string }> = [];
  const viewOptions: EditorViewOptions | undefined = options.customCodeBlockChipLabel
    ? {
        renderCustomCodeBlock: (language: string, content: string): HTMLElement => {
          codeBlockCalls.push({ language, content });
          const chip = document.createElement("div");
          chip.className = "gpc-custom-chip";
          chip.dataset["language"] = language;
          chip.textContent = `${options.customCodeBlockChipLabel}:${language}`;
          return chip;
        },
      }
    : undefined;

  const model = new EditorModel();
  model.replaceSourceText(new StringValue(known.text));

  const view = new EditorView(model, viewOptions);
  container.appendChild(view.element);
  const controller = new EditorController(model, view);

  const localState: DirectMountState = {
    host,
    model,
    view,
    controller,
    known,
    codeBlockCalls,
    submittingOwnEdit: false,
    lastOverlay: undefined,
  };
  state = localState;

  // Mirrors src/vscode-adapter/adapter.ts's own onWillApplySourceEdit wiring
  // (see this file's header) -- kept deliberately minimal: no
  // rejection-revert path, since MemoryDocumentHost only ever rejects a
  // STALE edit and every edit here is submitted against the version this
  // driver itself just observed, in order, so a real rejection should never
  // occur in these cases. If one ever did, throwing loudly here is exactly
  // right (AP-20: never fail silently) -- a rejection would mean case 5's
  // "no byte drift" premise is already broken.
  model.onWillApplySourceEdit((event) => {
    const sourceEdit = stringEditToSourceEdit(localState.known.text, event.edit, localState.known.version);
    localState.submittingOwnEdit = true;
    let result: ReturnType<MemoryDocumentHost["applyEdit"]>;
    try {
      result = host.applyEdit(sourceEdit);
    } finally {
      localState.submittingOwnEdit = false;
    }
    if (!result.ok) {
      throw new Error(
        `gpc harness: host rejected an edit unexpectedly (reason: ${result.reason}) -- ` +
          "this driver has no revert path; see this file's header comment.",
      );
    }
    localState.known = result.snapshot;
  });

  host.subscribe((snapshot) => {
    if (localState.submittingOwnEdit) return;
    localState.known = snapshot;
    model.replaceSourceText(new StringValue(snapshot.text));
  });
}

function blockElements(): HTMLElement[] {
  const root = document.getElementById(CONTAINER_ID);
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(".md-document > .md-block"));
}

function astBlocks(): readonly BlockAstNode[] {
  const vd = requireState().view.viewData.get();
  return vd ? vd.blocks.map((b) => b.ast) : [];
}

function blockAbsoluteStart(index: number): number {
  const vd = requireState().view.viewData.get();
  const b = vd?.blocks[index];
  if (!b) throw new Error(`gpc harness: no block at index ${index}`);
  return b.absoluteStart;
}

window.__gpc = {
  mount,
  dispose(): void {
    disposeCurrent();
  },
  containerSelector: `#${CONTAINER_ID}`,

  getHostText: () => requireState().host.getSnapshot().text,
  getHostVersion: () => requireState().host.getSnapshot().version,

  documentBlockCount: () => astBlocks().length,
  blockInfo(index: number): BlockInfo {
    const vd = requireState().view.viewData.get();
    const b = vd?.blocks[index];
    if (!b) throw new Error(`gpc harness: no block at index ${index}`);
    const el = blockElements()[index];
    if (!el) throw new Error(`gpc harness: no DOM block at index ${index}`);
    return {
      kind: b.ast.kind,
      absoluteStart: b.absoluteStart,
      length: b.ast.length,
      className: el.className,
      textContent: el.textContent ?? "",
    };
  },

  codeBlockHookCalls: () => requireState().codeBlockCalls.slice(),

  forceBlockMarkersVisible(index: number, visible: boolean): void {
    const s = requireState();
    const ast = astBlocks()[index];
    if (!ast) throw new Error(`gpc harness: no block at index ${index}`);
    const current = new Set(s.view.forcedMarkerVisibleBlocks.get());
    if (visible) current.add(ast);
    else current.delete(ast);
    s.view.forcedMarkerVisibleBlocks.set(current, undefined);
  },

  mountOverlayChip(index: number, label: string): boolean {
    const s = requireState();
    const ast = astBlocks()[index];
    if (!ast) throw new Error(`gpc harness: no block at index ${index}`);
    const start = blockAbsoluteStart(index);
    const range = OffsetRange.fromTo(start, start + ast.length);
    const rects = s.view.rangeRects(range).get();
    const overlay = document.createElement("div");
    overlay.className = "gpc-overlay-chip";
    overlay.textContent = label;
    overlay.style.position = "absolute";
    const rect = rects[0];
    if (rect) {
      overlay.style.left = `${rect.x}px`;
      overlay.style.top = `${rect.y}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
    }
    s.view.overlayContainer.appendChild(overlay);
    s.lastOverlay = overlay;
    return rects.length > 0;
  },
  overlayChipText: () => requireState().lastOverlay?.textContent ?? undefined,
  overlayChipInOverlayContainer: () => {
    const s = requireState();
    return s.lastOverlay !== undefined && s.lastOverlay.parentElement === s.view.overlayContainer;
  },

  selectionOffsets(): SelectionOffsets | undefined {
    const sel = requireState().model.selection.get();
    if (!sel) return undefined;
    return {
      anchor: sel.anchor,
      active: sel.active,
      start: sel.range.start,
      endExclusive: sel.range.endExclusive,
    };
  },
  sourceSlice: (start: number, endExclusive: number): string =>
    requireState().host.getSnapshot().text.slice(start, endExclusive),
};
window.__gpcReady = true;
window.__gpReady = true;
