<script lang="ts">
  /**
   * RichEditor — the WYSIWYG surface, showing the author's text at print size.
   *
   * A sibling of `MarkdownEditor.svelte`, deliberately sharing its contract:
   * the same props (`filePath`, `content`, `onChange`, `onSave`) and the same
   * imperative methods (`switchFile`, `updateContent`, `focus`, `hasFile`), so
   * the host can drive either without special-casing. Like that component it
   * takes no reactive dependency on `content` — this repo bans `$effect`, and
   * reading `content` reactively would also fire on every keystroke's
   * onChange -> buffer round trip and fight the author's own typing.
   *
   * ## Why an iframe
   *
   * The promise is that text looks as it will print, so the BOOK'S stylesheet
   * has to apply to the editing surface — and a book stylesheet has bare `h1`,
   * `p` and `table` rules that would repaint the whole application if they
   * landed in the app's document. Some isolation is mandatory.
   *
   * A shadow root was tried first and is WRONG here, for a concrete measured
   * reason: `:root` matches nothing inside a shadow tree, so every
   * `:root { --font-body: … }` custom property silently stops applying — and
   * custom properties are Gutterpress's primary styling surface for
   * non-technical authors. Measured on the user guide: every font fell back to
   * Times. Fixing it would mean rewriting the author's CSS (`:root` -> `:host`),
   * i.e. becoming a general CSS rewriter, which `gcpm-extract.ts` names as the
   * signal that this design has drifted.
   *
   * An iframe reads the author's stylesheet VERBATIM — the same bytes the PDF
   * gets, evaluated the same way — so there is nothing to rewrite. Measured
   * side by side on the user guide: identical pagination (9 pages, 648px
   * columns), identical editing behaviour, `--font-body` resolving correctly,
   * and no leak into the host document.
   *
   * ProseMirror itself runs in THIS document and drives DOM inside the frame
   * (`view.root` resolves to the frame's document) — so the frame needs no
   * script of its own, which is what makes the CSP below free.
   *
   * NOTE for whoever adds the editor pane's show/hide: never merely hide this
   * iframe while it is live. Chromium throttles invisible frames to ~1fps —
   * the same trap `PreviewFrame.svelte` documents. Unmount it instead.
   */
  import { onMount } from "svelte";
  import { createEditorRenderer } from "$lib/editor/markdown-doc";
  import { editorStylesheet } from "$lib/editor/paginate";
  import EditorChrome from "$lib/components/EditorChrome.svelte";
  import {
    clearSlashQuery,
    mountRichEditor,
    type ChromeState,
    type RichEditorHandle,
  } from "$lib/editor/rich-editor";
  import { slashAction, type ChromeAnchor, type SlashItem } from "$lib/editor/rich-chrome.svelte";
  import type { RichToolbarAction, ToolbarPayloadLike } from "$lib/editor/rich-commands";

  let {
    filePath = null,
    content = "",
    bookCss = "",
    assetBase = "",
    columns = 1,
    onChange,
    onSave,
    onAnchorLine,
  }: {
    filePath?: string | null;
    content?: string;
    /** The book's fully-inlined CSS — the same text the preview renders with. */
    bookCss?: string;
    /**
     * Base URL for relative asset references (usually the preview server's
     * origin). Without it, `![](images/x.png)` cannot resolve inside a frame
     * that has no document URL of its own.
     */
    assetBase?: string;
    /** 1 = a vertical stack of pages, 2 = facing spreads. */
    columns?: 1 | 2;
    onChange?: (value: string) => void;
    onSave?: () => void;
    /** Editor→preview sync; same contract as MarkdownEditor's. */
    onAnchorLine?: (line: number, origin: "scroll" | "caret") => void;
  } = $props();

  /** Gutterpress's own markdown-it pipeline — the one that prints. */
  const md = createEditorRenderer();

  let frame: HTMLIFrameElement;
  let handle: RichEditorHandle | null = null;
  let styleEl: HTMLStyleElement | null = null;
  let openPath: string | null = filePath;
  let appliedCss = "";

  /**
   * Where the inline chrome goes, in APP coordinates.
   *
   * The editor reports frame-viewport coordinates because that is all it can
   * know; only this component knows where the frame sits on screen, so the
   * translation happens here — the same split `BlockEditOverlay` uses for the
   * preview.
   */
  let chrome = $state<ChromeAnchor | null>(null);

  function onChrome(state: ChromeState | null): void {
    if (!state || !frame) {
      chrome = null;
      return;
    }
    const rect = frame.getBoundingClientRect();
    chrome = {
      kind: state.kind,
      x: rect.left + state.x,
      y: rect.top + state.y,
      query: state.query,
      // Keep the panel inside the frame, not merely inside the window: a menu
      // hanging over the preview pane would be pointing at nothing.
      workspace: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    };
  }

  function runSlash(item: SlashItem): void {
    const mapped = slashAction(item.id);
    if (!mapped || !handle) return;
    // Remove the `/query` the author typed before inserting, or it would be
    // left behind in the text.
    clearSlashQuery(handle.view);
    handle.runToolbarAction(
      mapped.action as Parameters<RichEditorHandle["runToolbarAction"]>[0],
      mapped.payload as Parameters<RichEditorHandle["runToolbarAction"]>[1],
    );
    chrome = null;
  }

  onMount(() => {
    const doc = frame.contentDocument;
    if (!doc) return;

    // `script-src 'none'` is what lets the surface render an author's raw HTML
    // (see `rawHtmlView` in rich-editor.ts) without also running an author's
    // `<script>`. The preview frame gets this protection from being
    // cross-origin and sandboxed; this frame is deliberately same-origin so
    // ProseMirror can reach its DOM, so it states the restriction directly.
    doc.open();
    doc.write(
      "<!doctype html><meta charset=utf-8>" +
        `<meta http-equiv="Content-Security-Policy" content="script-src 'none'">` +
        (assetBase ? `<base href="${assetBase.replace(/"/g, "&quot;")}">` : "") +
        "<body></body>",
    );
    doc.close();

    styleEl = doc.createElement("style");
    doc.head.appendChild(styleEl);

    const flow = doc.createElement("div");
    flow.className = "gp-editor-page-flow";
    doc.body.appendChild(flow);

    applyCss(bookCss);
    handle = mountRichEditor({ mount: flow, md, content, onChange, onSave, onAnchorLine, onChrome });

    return () => {
      handle?.destroy();
      handle = null;
      styleEl = null;
    };
  });

  /**
   * Put the book's stylesheet and the page-flow rules into the frame.
   *
   * Recomputed only when the CSS text actually changes: `editorStylesheet()`
   * parses the whole stylesheet, and a live preview can re-emit identical CSS
   * on every rebuild.
   */
  function applyCss(css: string): void {
    if (!styleEl || css === appliedCss) return;
    appliedCss = css;
    styleEl.textContent = `${css}\n\n${editorStylesheet(css, { columns })}`;
  }

  /** The host changed which file is open. */
  export function switchFile(newPath: string | null, newContent: string): void {
    openPath = newPath;
    handle?.setContent(newContent);
  }

  /** Same file, new bytes — an external-edit auto-reload. */
  export function updateContent(nextDoc: string): void {
    if (handle && handle.getMarkdown() !== nextDoc) handle.setContent(nextDoc);
  }

  /** The book's stylesheet changed (the author edited CSS, or a rebuild ran). */
  export function setBookCss(css: string): void {
    applyCss(css);
  }

  /** Scroll a 1-based source line into view (preview "go to source"). */
  export function revealLine(line: number, focusEditor = false): void {
    handle?.revealLine(line, focusEditor);
  }

  export function focus(): void {
    frame?.focus();
    handle?.focus();
  }

  export function hasFile(path: string): boolean {
    return handle !== null && openPath === path;
  }

  /** Run a toolbar action. False when it does not apply to the selection. */
  export function runToolbarAction(
    action: RichToolbarAction,
    payload?: ToolbarPayloadLike,
  ): boolean {
    return handle?.runToolbarAction(action, payload) ?? false;
  }

  export function getSelectionText(): string {
    return handle?.getSelectionText() ?? "";
  }

  export function insertSnippet(text: string): void {
    handle?.insertSnippet(text);
  }

  /**
   * Whether a source-offset edit can be applied to `path` right now.
   *
   * The host asks this before routing a CommitEngine edit here; a `false`
   * sends it down CommitEngine's own buffer path instead. See
   * `rich-editor.ts` — offsets index into the file on disk, and on a project
   * that has not been normalized the document's canonical text differs from
   * it.
   */
  export function canApplySourceOffsets(path: string, diskContent: string): boolean {
    return hasFile(path) && (handle?.canApplySourceOffsets(diskContent) ?? false);
  }

  /**
   * Apply a source-offset edit. Returns false when it was refused.
   *
   * Same signature as `MarkdownEditor.applyRangeEditIn` so the host calls one
   * method without branching on mode — but here `expectedSource` is REQUIRED,
   * because a document tree has no source offsets of its own and applying the
   * caller's against different text would write at a position the author
   * never chose.
   */
  export function applyRangeEditIn(
    path: string,
    from: number,
    to: number,
    insert: string,
    expectedSource?: string,
  ): boolean {
    if (!hasFile(path) || expectedSource === undefined) return false;
    return handle?.applyRangeEdit(expectedSource, from, to, insert) ?? false;
  }

  /** Canonical markdown for what is on screen right now. */
  export function getMarkdown(): string {
    return handle?.getMarkdown() ?? content;
  }
</script>

<iframe bind:this={frame} class="rich-editor" title="Gutterpress editor"></iframe>

<EditorChrome
  anchor={chrome}
  onRunSlash={runSlash}
  onFormat={(action) => {
    handle?.runToolbarAction(action);
    chrome = null;
  }}
  onClose={() => (chrome = null)}
/>

<style>
  /* The frame is the whole surface; everything inside it is the book's own
     CSS plus the page-flow box. Nothing here styles author content. */
  .rich-editor {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    background: var(--gp-editor-backdrop, #2a2a2e);
  }
</style>
