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
 * Host coupling (the preview client, geometry, and the small
 * text-prompt/toast/clipboard/media-panel glue) is injected so this stays
 * testable with fakes and PWA-clean (§8 / ADR 0004): ZERO direct DOM /
 * `node:*` / lib value imports.
 *
 * Every action addresses a NODE in the galley's document (ADR 0011) and is
 * applied by the frame; the editor's own whole-file save writes it to disk.
 * The pre-galley design resolved targets from `data-source-range` and wrote
 * through source-token splices — that path was deleted with the editing
 * surface it belonged to, along with the token splicers, the rendered-text
 * source search, and the rect/mask geometry it needed.
 */
import type { PreviewEvent, ContextTarget } from "$lib/preview-client";
import {
  IMAGE_PIN_ALIGNMENT_OPTIONS,
  IMAGE_PIN_CLASS,
  IMAGE_LAYER_OPTIONS,
  IMAGE_POSITION_OPTIONS,
  IMAGE_SIZE_OPTIONS,
  IMAGE_SPACING_OPTIONS,
  getPinAlignment,
  getLayerClass,
  getPositionClass,
  getSizeClass,
  getSpacingClass,
  getWidth,
  hasShapeClass,
  normalizeClassInput,
  serializeImageAttrs,
  setPinAlignment,
  setLayerClass,
  setPositionClass,
  setShapeClass,
  setSizeClass,
  setSpacingClass,
  setWidth,
  tokenizeImageAttrs,
  type ImagePropertiesValue,
} from "$lib/editor/image-classes";

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
  /** A small modal prompt. `options` renders a constrained select; null = cancelled. */
  promptText: (opts: {
    title: string;
    label: string;
    initialValue: string;
    options?: readonly { value: string; label: string }[];
  }) => Promise<string | null>;
  /** Edit every supported image property in one modal and apply once. */
  promptImageProperties: (initial: ImagePropertiesValue) => Promise<ImagePropertiesValue | null>;
  /** Switch the left panel to the Media tab ("Reveal in Media panel"). */
  openMediaPanel: () => void;
  /** Copy text to the OS clipboard. */
  copyToClipboard: (text: string) => Promise<void>;
  toastSuccess: (message: string) => void;
  toastError: (message: string) => void;
  /**
   * Galley (protocol v8) node edits — the controller's only write path.
   * Actions mutate the DOCUMENT; the editor's whole-file save writes it out.
   */
  galley?: {
    setImageAttrs: (spec: {
      pos: number;
      src?: string;
      alt?: string;
      attrsRaw?: string;
    }) => Promise<{ ok: boolean }>;
    setLink: (spec: { pos?: number; href: string | null }) => Promise<{ ok: boolean }>;
    /** Open the opaque-source editor on a raw block at `pos`. */
    openOpaqueEditor: (
      chapter: string,
      pos: number,
      src: string,
      anchor: { x: number; y: number },
    ) => void;
  };
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
        void this.handleContextMenuRequested(e.detail);
        break;
      case "renderingComplete":
        // Content changed under the menu — it is now anchored to stale
        // geometry. (The generation bump that closes the stale-commit window
        // is owned by BlockOverlayController, which documents itself as
        // correct standalone; duplicating it here bought nothing.)
        this.close();
        break;
      case "renderingStarted":
        // A frame replacement invalidates the captured source.
        this.close();
        break;
    }
  }

  private async handleContextMenuRequested(detail: PreviewEvent["detail"]): Promise<void> {
    // Every request supersedes the previous one, even when the new target is
    // ineligible. Otherwise a kind:"none" request can leave an old menu open,
    // or an older asynchronous source read can reopen it afterward.
    const requestId = ++this.requestId;
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
      // Protocol v8: the galley resolves targets against its document and
      // sends a node handle INSTEAD of a source range. Dropping it here left
      // every galley target rangeless, so `buildItems` produced no items and
      // the menu silently never opened.
      galley: detail.galley ?? null,
    };

    const anchor = { x: detail.x ?? 0, y: detail.y ?? 0 };
    const items = this.buildItems(target, anchor);
    // A render/navigation could have raced the async item-build above.
    if (requestId !== this.requestId || this.deps.rendering()) return;
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

  // ── Menu-item resolution (plan §4.3–4.4) ───────────────────────────────────

  private buildItems(
    target: ContextTarget,
    anchor: { x: number; y: number },
  ): ContextMenuItem[] {
    // The galley is the editing surface, and its targets are node-addressed:
    // the editor's DOM carries no `data-source-range`, and a source splice
    // would be reverted by the document's own next whole-file save.
    if (!target.galley || !this.deps.galley) return [];
    return this.galleyItems(target, anchor);
  }

  private galleyItems(
    target: ContextTarget,
    anchor: { x: number; y: number },
  ): ContextMenuItem[] {
    const galley = this.deps.galley!;
    const pos = target.galley!.pos;

    // A selection. The frame calls preventDefault for every non-"none"
    // target, so if this returned nothing the author would get NO menu on a
    // selection — not even Copy. Formatting lives in the selection bubble;
    // the menu carries the clipboard action the native menu would have.
    if (target.kind === "selection") {
      const text = target.selection?.text ?? "";
      return [
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
      ];
    }

    if (target.kind === "image" && target.image) {
      const image = target.image;
      return [
        {
          id: "image-properties",
          label: "Set properties…",
          enabled: true,
          run: async () => {
            const tokens = tokenizeImageAttrs(image.attrsRaw ?? "");
            const position = getPositionClass(tokens);
            const initial: ImagePropertiesValue = {
              src: image.src ?? "",
              alt: image.alt ?? "",
              width: getWidth(tokens),
              position: position ? normalizeClassInput(IMAGE_POSITION_OPTIONS, position) ?? "" : "",
              pinAlignment: getPinAlignment(tokens) ?? "center",
              size: getSizeClass(tokens) ?? "",
              spacing: getSpacingClass(tokens) ?? "",
              shape: hasShapeClass(tokens),
              layer: getLayerClass(tokens) ?? "",
            };
            const next = await this.deps.promptImageProperties(initial);
            if (next == null) return;
            const invalid = this.validateImageProperties(next);
            if (invalid) {
              this.deps.toastError(invalid);
              return;
            }
            const width = next.width.trim();
            let updated = tokens;
            if (width !== initial.width) updated = setWidth(updated, width || null);
            if (next.position !== initial.position) {
              updated = setPositionClass(updated, next.position || null);
            }
            if (
              next.position === IMAGE_PIN_CLASS &&
              (initial.position !== IMAGE_PIN_CLASS || next.pinAlignment !== initial.pinAlignment)
            ) {
              updated = setPinAlignment(updated, next.pinAlignment);
            }
            if (next.size !== initial.size) updated = setSizeClass(updated, next.size || null);
            if (next.spacing !== initial.spacing) updated = setSpacingClass(updated, next.spacing || null);
            if (next.shape !== initial.shape) updated = setShapeClass(updated, next.shape);
            if (next.layer !== initial.layer) updated = setLayerClass(updated, next.layer || null);
            const changes: { pos: number; src?: string; alt?: string; attrsRaw?: string } = { pos };
            if (updated !== tokens) changes.attrsRaw = serializeImageAttrs(updated);
            if (next.src.trim() !== initial.src) changes.src = next.src.trim();
            if (next.alt !== initial.alt) changes.alt = next.alt;
            this.close();
            if (changes.src === undefined && changes.alt === undefined && changes.attrsRaw === undefined) {
              return;
            }
            const res = await galley.setImageAttrs(changes);
            if (res.ok) this.deps.toastSuccess("Updated.");
            else this.deps.toastError("Couldn't update this image.");
          },
        },
        {
          id: "image-reveal",
          label: "Reveal in Media panel",
          enabled: true,
          run: () => {
            this.deps.openMediaPanel();
            this.close();
          },
        },
      ];
    }

    if (target.kind === "link" && target.link) {
      const link = target.link;
      return [
        {
          id: "link-edit",
          label: "Edit link…",
          enabled: true,
          run: async () => {
            const next = await this.deps.promptText({
              title: "Edit link",
              label: "Web address",
              initialValue: link.href ?? "",
            });
            if (next == null) return;
            this.close();
            const res = await galley.setLink({ pos, href: next });
            if (!res.ok) this.deps.toastError("Couldn't update this link.");
          },
        },
        {
          id: "link-remove",
          label: "Remove link",
          enabled: true,
          run: async () => {
            this.close();
            const res = await galley.setLink({ pos, href: null });
            if (!res.ok) this.deps.toastError("Couldn't remove this link.");
          },
        },
        {
          id: "link-copy",
          label: "Copy link target",
          enabled: !!link.href,
          disabledReason: link.href ? undefined : "No link target to copy.",
          run: async () => {
            if (link.href) await this.deps.copyToClipboard(link.href);
            this.close();
          },
        },
      ];
    }

    // Opaque/raw block — the one target whose content is still plain source.
    const src = target.galley!.src;
    if (src != null) {
      const chapter = target.chapter;
      return [
        {
          id: "block-edit-source",
          label: "Edit source…",
          enabled: !!chapter,
          disabledReason: chapter ? undefined : "This block has no chapter.",
          run: () => {
            if (chapter) galley.openOpaqueEditor(chapter, pos, src, anchor);
            this.close();
          },
        },
      ];
    }

    // Plain text block: the caret is already in it — the formatting bubble
    // owns inline styling, so the menu offers navigation only.
    return [];
  }

  /** Shared validation for the image-properties modal (both write paths). */
  private validateImageProperties(next: ImagePropertiesValue): string | null {
    if (!next.src.trim()) return "Choose an image path or URL.";
    const validPosition =
      !next.position || IMAGE_POSITION_OPTIONS.some((option) => option.class === next.position);
    const validAlignment = IMAGE_PIN_ALIGNMENT_OPTIONS.some(
      (option) => option.value === next.pinAlignment,
    );
    const validSize = !next.size || IMAGE_SIZE_OPTIONS.some((option) => option.class === next.size);
    const validSpacing =
      !next.spacing || IMAGE_SPACING_OPTIONS.some((option) => option.class === next.spacing);
    const validLayer =
      !next.layer || IMAGE_LAYER_OPTIONS.some((option) => option.class === next.layer);
    if (!validPosition || !validAlignment || !validSize || !validSpacing || !validLayer) {
      return "Choose image options from the lists.";
    }
    if (next.width.trim() && next.size) {
      return "Choose either a custom width or a preset size, not both.";
    }
    return null;
  }

}
