/**
 * ContextMenuController — single owner of the preview right-click/`Shift+F10`
 * context menu's open/position/target state (inline-editing plan §4.1–4.5,
 * PR 3).
 *
 * `.svelte.ts` suffix is deliberate: menu open/position/items are `$state`
 * consumed by `ContextMenu.svelte`, matching `page-nav-controller.svelte.ts` /
 * `zoom-view-controller.svelte.ts`.
 *
 * Subscribes to the preview client via its OWN `client.on()` listener —
 * separate from `PreviewEventController`'s switch (PR 0 already owns the
 * `elementActivated` case there; this controller neither touches nor
 * duplicates it, per the plan's ownership split).
 *
 * SFE-P4: the menu is read-only. It offers exactly four items — go-to-source,
 * selection-copy, link-copy, image-reveal — none of which write source. The
 * mutation half (image-properties, image-unwrap, link-edit, marker-edit,
 * page-marker-edit, block-break-before/after, the four selection formats,
 * make-link, and "Edit this block") was deleted along with the single
 * source-write-path class and the in-flow block-editor class that drove
 * them; every deleted capability has a replacement command in source mode
 * and/or the shared rich editor — see
 * docs/plans/source-first-editor/parity-matrix.md. The commit-write engine
 * and the "start an in-flow edit" callback are consequently NOT constructor
 * dependencies any more (P3d-parity's separability proof,
 * `preview-separability-mutation-inert.test.ts`, named this exact signature
 * change as P4's to make).
 */
import type { PreviewEvent, ContextTarget, SourceRange } from "$lib/preview-client";
import { isSafeChapterId } from "$lib/editor/chapter-path";

/** Minimal preview-client surface the controller drives. */
export interface ContextMenuClient {
  on(fn: (e: PreviewEvent) => void): () => void;
}

/** A `getBoundingClientRect()`-shaped rect, spread into a plain object. */
export interface ContextMenuRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ContextMenuDeps {
  /** The live preview client, or undefined when no document is loaded. */
  client: () => ContextMenuClient | undefined;
  /** `preview.contextMenu` setting — false disables the whole feature. */
  enabled: () => boolean;
  /** True while a preview render is in flight (ignore contextMenuRequested). */
  rendering: () => boolean;
  /** The preview iframe's own `getBoundingClientRect()` (left/top only needed), or null if unmounted. */
  getIframeOrigin: () => { left: number; top: number } | null;
  /** The workspace container's rect, for clamping the menu on-screen. */
  getWorkspaceRect: () => ContextMenuRect | null;
  /** Open the editor, reveal the chapter, and place its caret on the source line. */
  goToSource: (chapter: string, line: number) => void;
  /** Switch the left panel to the Media tab ("Reveal in Media panel"). */
  openMediaPanel: () => void;
  /** Copy text to the OS clipboard. */
  copyToClipboard: (text: string) => Promise<void>;
}

export interface ContextMenuItem {
  id: string;
  label: string;
  enabled: boolean;
  /** Tooltip explaining why the item is disabled; undefined when enabled. */
  disabledReason?: string;
  run: () => void | Promise<void>;
}

/** Default size estimate used to clamp the menu on open, BEFORE the component
 *  has mounted and can report its real size via {@link ContextMenuController.reportMenuSize}. */
const ESTIMATED_WIDTH = 240;
const ESTIMATED_HEIGHT = 260;

export class ContextMenuController {
  private deps: ContextMenuDeps;

  // ── Public rune state (read by ContextMenu.svelte) ────────────────────────
  open = $state(false);
  x = $state(0);
  y = $state(0);
  items = $state<ContextMenuItem[]>([]);

  private rawX = 0;
  private rawY = 0;
  private target: ContextTarget | null = null;
  private requestId = 0;
  // Set for a short window right after open(), across the SAME event-loop
  // discipline as EditorToolbar.svelte's outside-click popover handling —
  // reused here defensively (plan §4.2) even though the menu's OPENING
  // interaction happens inside a different document (the preview iframe) and
  // so cannot itself bubble into this SPA's own outside-mousedown listener.
  private justOpened = false;

  constructor(deps: ContextMenuDeps) {
    this.deps = deps;
  }

  /** Subscribe to a preview client's event stream. Returns the unsubscribe fn. */
  subscribe(client: ContextMenuClient): () => void {
    return client.on((e) => this.handleEvent(e));
  }

  private handleEvent(e: PreviewEvent): void {
    switch (e.name) {
      case "contextMenuRequested":
        this.handleContextMenuRequested(e.detail);
        break;
      case "renderingComplete":
        // Content changed under the menu (or a build just finished) — the
        // menu itself is now anchored to stale geometry.
        this.close();
        break;
      case "renderingStarted":
        // A frame replacement invalidates the captured target.
        this.close();
        break;
    }
  }

  private handleContextMenuRequested(detail: PreviewEvent["detail"]): void {
    // Every request supersedes the previous one, even when the new target is
    // ineligible. Otherwise a kind:"none" request can leave an old menu open.
    this.requestId++;
    this.reset();
    if (!this.deps.enabled()) return;
    // Ignore while a render is in flight (same guard the sync controller uses).
    if (this.deps.rendering()) return;
    const kind = detail.kind;
    // PR 2's keyboard path can dispatch kind:"none" (anchor resolved to
    // nothing annotated); its mouse path cannot (native behavior is kept for
    // those clicks instead — see preview-interface.js). Either way: no menu.
    if (!kind || kind === "none") return;
    const target: ContextTarget = {
      kind,
      chapter: detail.chapter ?? null,
      range: detail.range ?? null,
      blockTag: detail.blockTag ?? null,
      split: !!detail.split,
      rect: detail.rect ?? null,
      image: detail.image ?? null,
      link: detail.link ?? null,
      selection: detail.selection ?? null,
    };
    const items = this.buildItems(target);
    if (items.length === 0) return;

    this.target = target;
    this.items = items;
    this.rawX = detail.x ?? 0;
    this.rawY = detail.y ?? 0;
    const pos = this.computePosition(this.rawX, this.rawY, ESTIMATED_WIDTH, ESTIMATED_HEIGHT);
    this.x = pos.x;
    this.y = pos.y;
    this.open = true;
    this.justOpened = true;
    queueMicrotask(() => {
      this.justOpened = false;
    });
  }

  /** Called by `ContextMenu.svelte` once it mounts and can measure its own
   *  rendered size, to reflow the clamp/flip with the REAL dimensions. */
  reportMenuSize(width: number, height: number): void {
    if (!this.open) return;
    const pos = this.computePosition(this.rawX, this.rawY, width, height);
    this.x = pos.x;
    this.y = pos.y;
  }

  /** True during the brief window right after `open()` — see `justOpened`'s comment. */
  wasJustOpened(): boolean {
    return this.justOpened;
  }

  close(): void {
    this.requestId++;
    this.reset();
  }

  private reset(): void {
    this.open = false;
    this.items = [];
    this.target = null;
  }

  async runItem(item: ContextMenuItem): Promise<void> {
    if (!item.enabled) return;
    await item.run();
  }

  // ── Positioning (plan §4.2) ────────────────────────────────────────────────

  private computePosition(
    px: number,
    py: number,
    width: number,
    height: number,
  ): { x: number; y: number } {
    const origin = this.deps.getIframeOrigin();
    const baseX = (origin?.left ?? 0) + px;
    const baseY = (origin?.top ?? 0) + py;
    const workspace = this.deps.getWorkspaceRect();
    if (!workspace) return { x: baseX, y: baseY };

    const maxX = workspace.left + workspace.width;
    const maxY = workspace.top + workspace.height;
    // Flip near the right/bottom edge.
    let x = baseX + width > maxX ? baseX - width : baseX;
    let y = baseY + height > maxY ? baseY - height : baseY;
    // Clamp fully inside the workspace either way.
    x = Math.min(Math.max(x, workspace.left), Math.max(workspace.left, maxX - width));
    y = Math.min(Math.max(y, workspace.top), Math.max(workspace.top, maxY - height));
    return { x, y };
  }

  // ── Menu-item resolution (read-only surface only — D8) ──────────────────────

  private buildItems(target: ContextTarget): ContextMenuItem[] {
    if (target.kind === "selection") {
      if (target.selection?.withinSingleBlock) return this.singleBlockSelectionItems(target);
      return this.crossBlockSelectionItems(target);
    }
    if (!target.chapter || !isSafeChapterId(target.chapter) || !target.range) return [];
    switch (target.kind) {
      case "image":
        return this.imageItems(target);
      case "link":
        return this.linkItems(target);
      case "marker":
      case "block":
        return [this.goToSourceItem(target)];
      default:
        return [];
    }
  }

  private goToSourceItem(
    target: ContextTarget,
    /**
     * Overrides `target.chapter`/`target.range` (the RIGHT-CLICK POINT's
     * resolved block) with an explicit chapter/range. Used by single-block
     * selections (plan §4.6): a selection's anchor block
     * (`selection.chapter`/`selection.range`) is the block the point
     * actually landed on and can, in principle, differ from the point the
     * context-menu event fired at. "Go to source" must jump to the
     * selection's own block, not wherever the pointer happened to land.
     */
    override?: { chapter: string; range: SourceRange },
  ): ContextMenuItem {
    const chapter = override?.chapter ?? target.chapter;
    const range = override?.range ?? target.range;
    const enabled = !!chapter && isSafeChapterId(chapter) && !!range;
    return {
      id: "go-to-source",
      label: "Go to source",
      enabled,
      disabledReason: enabled ? undefined : "This source location is invalid.",
      run: () => {
        if (chapter && range) this.deps.goToSource(chapter, range[0] + 1);
        this.close();
      },
    };
  }

  // ── Image (read-only: Reveal in Media panel, Go to source) ──────────────────

  private imageItems(target: ContextTarget): ContextMenuItem[] {
    return [
      {
        id: "image-reveal",
        label: "Reveal in Media panel",
        enabled: true,
        run: () => {
          this.deps.openMediaPanel();
          this.close();
        },
      },
      this.goToSourceItem(target),
    ];
  }

  // ── Link (read-only: Copy link target, Go to source) ────────────────────────

  private linkItems(target: ContextTarget): ContextMenuItem[] {
    const link = target.link;
    return [
      {
        id: "link-copy",
        label: "Copy link target",
        enabled: !!link?.href,
        disabledReason: link?.href ? undefined : "No link target to copy.",
        run: async () => {
          if (link?.href) await this.deps.copyToClipboard(link.href);
          this.close();
        },
      },
      this.goToSourceItem(target),
    ];
  }

  // ── Selection (read-only: Copy for a cross-block selection, Go to source) ───

  private singleBlockSelectionItems(target: ContextTarget): ContextMenuItem[] {
    const sel = target.selection;
    if (!sel || !sel.chapter || !sel.range) {
      return [this.goToSourceItem(target)];
    }
    return [this.goToSourceItem(target, { chapter: sel.chapter, range: sel.range })];
  }

  private crossBlockSelectionItems(target: ContextTarget): ContextMenuItem[] {
    const text = target.selection?.text ?? "";
    const items: ContextMenuItem[] = [
      {
        id: "selection-copy",
        label: "Copy",
        enabled: !!text,
        disabledReason: text ? undefined : "Nothing to copy.",
        run: async () => {
          if (text) await this.deps.copyToClipboard(text);
          this.close();
        },
      },
      this.goToSourceItem(target),
    ];
    return items;
  }
}
