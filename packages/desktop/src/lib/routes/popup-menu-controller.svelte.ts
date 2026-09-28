/**
 * PopupMenuController: the open/position/items state of a context menu the
 * SPA opens ITSELF, at a pointer position, for `ContextMenu.svelte`.
 *
 * The preview's menu (`context-menu-controller.svelte.ts`) is driven by
 * events the preview iframe sends, with targets the book's own DOM
 * resolved. The paged editor lives in this document, so its menu needs no
 * event bridge: a `contextmenu` handler on the editor pane decides the
 * items from the element under the pointer and hands them here. Both
 * controllers present the same `MenuSurface` to the component, so the one
 * menu component draws either.
 *
 * `.svelte.ts` suffix is deliberate: open/position/items are `$state` the
 * component reads.
 */
import type { ContextMenuItem, ContextMenuRect, MenuSurface } from "./context-menu-controller.svelte";

/** Default size estimate used to clamp the menu on open, before the component reports its real size. */
const ESTIMATED_WIDTH = 240;
const ESTIMATED_HEIGHT = 200;

export class PopupMenuController implements MenuSurface {
  open = $state(false);
  x = $state(0);
  y = $state(0);
  items = $state<ContextMenuItem[]>([]);

  private rawX = 0;
  private rawY = 0;
  private justOpened = false;
  private readonly getBounds: () => ContextMenuRect | null;

  /** `getBounds`: the rect (client coordinates) the menu must stay inside. */
  constructor(getBounds: () => ContextMenuRect | null) {
    this.getBounds = getBounds;
  }

  /** Open at client coordinates with these items; no items, no menu. */
  openAt(clientX: number, clientY: number, items: ContextMenuItem[]): void {
    this.close();
    if (items.length === 0) return;
    this.items = items;
    this.rawX = clientX;
    this.rawY = clientY;
    const pos = this.computePosition(ESTIMATED_WIDTH, ESTIMATED_HEIGHT);
    this.x = pos.x;
    this.y = pos.y;
    this.open = true;
    this.justOpened = true;
    queueMicrotask(() => {
      this.justOpened = false;
    });
  }

  reportMenuSize(width: number, height: number): void {
    if (!this.open) return;
    const pos = this.computePosition(width, height);
    this.x = pos.x;
    this.y = pos.y;
  }

  wasJustOpened(): boolean {
    return this.justOpened;
  }

  close(): void {
    this.open = false;
    this.items = [];
  }

  async runItem(item: ContextMenuItem): Promise<void> {
    if (!item.enabled) return;
    await item.run();
  }

  private computePosition(width: number, height: number): { x: number; y: number } {
    const bounds = this.getBounds();
    if (!bounds) return { x: this.rawX, y: this.rawY };
    const maxX = bounds.left + bounds.width;
    const maxY = bounds.top + bounds.height;
    let x = this.rawX + width > maxX ? this.rawX - width : this.rawX;
    let y = this.rawY + height > maxY ? this.rawY - height : this.rawY;
    x = Math.min(Math.max(x, bounds.left), Math.max(bounds.left, maxX - width));
    y = Math.min(Math.max(y, bounds.top), Math.max(bounds.top, maxY - height));
    return { x, y };
  }
}
