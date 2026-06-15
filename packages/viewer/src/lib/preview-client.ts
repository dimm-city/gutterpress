/**
 * Client for the cross-origin pagedjs-bridge.js running inside the preview iframe.
 * Sends commands via postMessage and tracks replies by id.
 */
export interface PreviewEvent {
  name:
    | "pageChanged"
    | "renderingComplete"
    | "ready"
    | "sourceLineChanged"
    | "elementActivated";
  detail: {
    currentPage?: number;
    totalPages?: number;
    /** sourceLineChanged / elementActivated: 1-based markdown source line. */
    sourceLine?: number | null;
    /** sourceLineChanged / elementActivated: chapter (source filename) the block belongs to. */
    chapter?: string | null;
    /** sourceLineChanged: page the top-visible block sits on. */
    page?: number;
    /** elementActivated: clicked element id / tag, if any. */
    id?: string | null;
    tag?: string;
  };
}

/** A heading from getOutline() — see ADR 0005. */
export interface OutlineEntry {
  level: number;
  text: string;
  id: string | null;
  sourceLine: number | null;
  /** Source filename (data-chapter-src) the heading belongs to. */
  chapter: string | null;
  page: number;
  index: number;
}

/**
 * Target for scrollTo()/highlight() — exactly one positional form is honoured.
 * A line is per-file, so pair it with `chapter` (source filename) in a
 * multi-chapter book to disambiguate.
 */
export type PreviewTarget =
  | { line: number; chapter?: string | null }
  | { id: string }
  | { selector: string }
  | { page: number };

export class PreviewClient {
  private nextId = 1;
  private pending = new Map<number, (msg: any) => void>();
  private listeners = new Set<(e: PreviewEvent) => void>();
  private win: Window | null = null;
  private handler: (e: MessageEvent) => void;

  constructor() {
    this.handler = (e: MessageEvent) => {
      const data = e.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "pmd:reply") {
        const cb = this.pending.get(data.id);
        if (cb) {
          this.pending.delete(data.id);
          cb(data);
        }
      } else if (data.type === "pmd:event") {
        for (const l of this.listeners) l({ name: data.name, detail: data.detail });
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("message", this.handler);
    }
  }

  attach(win: Window | null) {
    this.win = win;
  }

  detach() {
    if (typeof window !== "undefined") {
      window.removeEventListener("message", this.handler);
    }
    this.pending.clear();
    this.listeners.clear();
    this.win = null;
  }

  on(fn: (e: PreviewEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async call<T = unknown>(cmd: string, args: unknown[] = []): Promise<T> {
    if (!this.win) throw new Error("Preview frame not attached");
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, (msg) => {
        if (msg.ok) resolve(msg.result as T);
        else reject(new Error(msg.error || "Unknown error"));
      });
      this.win!.postMessage({ type: "pmd:cmd", id, cmd, args }, "*");
      // Timeout long-pending commands so promises don't leak forever.
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Command '${cmd}' timed out`));
        }
      }, 10_000);
    });
  }

  // ── ADR 0005 typed convenience wrappers ──────────────────────────────────
  // Thin sugar over call(); features compose these host-side so the lib bridge
  // never needs a feature-specific command.

  /** Protocol version of the bundled lib bridge (feature-detect). 1 = pre-ADR-0005. */
  async getProtocolVersion(): Promise<number> {
    try {
      return await this.call<number>("getProtocolVersion");
    } catch {
      return 1;
    }
  }

  /** Heading tree with page + source line. */
  getOutline(): Promise<OutlineEntry[]> {
    return this.call<OutlineEntry[]>("getOutline");
  }

  /** Scroll the preview to a line / id / selector / page. */
  scrollTo(
    target: PreviewTarget,
    opts?: { block?: "start" | "center"; smooth?: boolean },
  ): Promise<{ page: number; sourceLine: number | null } | null> {
    return this.call("scrollTo", [target, opts ?? {}]);
  }

  /** Source line + page of the block at the top of the viewport. */
  getVisibleSource(): Promise<{ sourceLine: number | null; page: number } | null> {
    return this.call("getVisibleSource");
  }

  /** Read-only DOM extraction (figures, links, footnotes, search candidates…). */
  queryDom(spec: {
    selector: string;
    fields?: Array<
      "text" | "id" | "sourceLine" | "page" | "tag" | "rectTop" | { attr: string }
    >;
    limit?: number;
  }): Promise<Array<Record<string, unknown>>> {
    return this.call("queryDom", [spec]);
  }

  /** Mark matched elements with a highlight class (find, cursor-echo, annotations). */
  highlight(spec: {
    line?: number;
    id?: string;
    selector?: string;
    group?: string;
    scroll?: boolean;
    transient?: boolean;
    transientMs?: number;
  }): Promise<{ count: number }> {
    return this.call("highlight", [spec]);
  }

  clearHighlights(group?: string): Promise<{ cleared: number }> {
    return this.call("clearHighlights", [group]);
  }

  setBgColor(color: string) {
    if (!this.win) return;
    this.win.postMessage({ type: "pmd:bg-color", color }, "*");
  }

  /**
   * Inject (or replace) a named <style> block inside the iframe's <head>.
   * @param id   Unique identifier used as the data-pmd-{id} attribute.
   * @param css  CSS text to write into the style block.
   */
  injectStyles(id: string, css: string) {
    if (!this.win) return;
    this.win.postMessage({ type: "pmd:inject-styles", id, css }, "*");
  }
}
