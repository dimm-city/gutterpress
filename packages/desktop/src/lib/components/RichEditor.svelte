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
  import { canEditRichly } from "$lib/editor/markdown-doc";
  import { getProjectRenderer } from "$lib/editor/project-renderer";
  import type { ProjectPluginIssue } from "$lib/editor/project-plugins";
  import type MarkdownIt from "markdown-it";
  import { nextEditorSheet, paginatedWidth, type EditorSheet } from "$lib/editor/paginate";
  import EditorChrome from "$lib/components/EditorChrome.svelte";
  import {
    clearSlashQuery,
    mountRichEditor,
    type ChromeState,
    type RichEditorHandle,
  } from "$lib/editor/rich-editor";
  import { slashAction, type ChromeAnchor, type SlashItem } from "$lib/editor/rich-chrome.svelte";
  import type { RichToolbarAction, ToolbarPayloadLike } from "$lib/editor/rich-commands";
  import type { ToolbarAction, ToolbarPayload } from "$lib/components/EditorToolbar.svelte";

  let {
    filePath = null,
    content = "",
    projectDir = null,
    bookCss = "",
    assetBase = "",
    columns = 1,
    backdrop = "",
    onChange,
    onSave,
    onAnchorLine,
    onUnsupported,
    onPluginIssues,
  }: {
    filePath?: string | null;
    content?: string;
    /**
     * The open project. Read once at mount (like `bookCss`): it selects which
     * plugin-loaded dialect this surface parses with. The host remounts the
     * editor on project switches, so there is nothing to react to.
     */
    projectDir?: string | null;
    /** The book's fully-inlined CSS — the same text the preview renders with. */
    bookCss?: string;
    /**
     * Base URL for relative asset references (usually the preview server's
     * origin). Without it, `![](images/x.png)` cannot resolve inside a frame
     * that has no document URL of its own.
     */
    assetBase?: string;
    /**
     * 1 = a vertical stack of pages, 2 = two pages abreast.
     *
     * The app's `preview.viewMode`, mapped by the host — the editor is a
     * consumer of that one setting, not a second owner of it. Read once at
     * mount, like `bookCss`/`assetBase`; later changes come through
     * `setColumns()` (this component takes no reactive dependency on its
     * props). A 2 is a REQUEST, not a guarantee — see `setColumns`.
     */
    columns?: 1 | 2;
    /**
     * The colour around the pages — the author's `appearance.previewBg`.
     *
     * The same setting the preview canvas uses, so the two surfaces match.
     * This used to be a `var(--gp-editor-backdrop, #2a2a2e)` whose custom
     * property was never defined anywhere, i.e. a hardcoded grey wearing a
     * token's clothes — and an author who had chosen a canvas colour got it in
     * the preview and not while editing.
     */
    backdrop?: string;
    onChange?: (value: string) => void;
    onSave?: () => void;
    /** Editor→preview sync; same contract as MarkdownEditor's. */
    onAnchorLine?: (line: number, origin: "scroll" | "caret") => void;
    /**
     * Content was pushed in that the schema cannot model — the host should
     * show this file in source mode, with the reason.
     */
    onUnsupported?: (path: string | null, reason: string) => void;
    /**
     * Some manifest plugins could not be loaded into the editor's dialect.
     * The host shows them next to the surface: the affected marker lines
     * render as plain markdown here (content-safe; preview/PDF unaffected).
     */
    onPluginIssues?: (issues: ProjectPluginIssue[]) => void;
  } = $props();

  /**
   * Gutterpress's own markdown-it pipeline WITH the project's plugins — the
   * one that prints. Resolved async at mount (plugin modules are fetched from
   * the host); every method that needs it runs against a mounted handle, which
   * only exists once this is set.
   */
  let md: MarkdownIt | null = null;

  let frame: HTMLIFrameElement;
  let handle: RichEditorHandle | null = null;
  let styleEl: HTMLStyleElement | null = null;
  let scaleBox: HTMLDivElement | null = null;
  // Read inside onMount, not at init: referencing a prop here captures only
  // its first value, which Svelte warns about and which would silently go
  // stale if the host ever mounted this with a file already chosen.
  let openPath: string | null = null;
  let baseEl: HTMLBaseElement | null = null;
  /** What the app asked for; seeded from the prop in onMount. */
  let requestedColumns: 1 | 2 = 1;
  /**
   * The stylesheet the frame is carrying, and what it was derived from — the
   * whole of this component's pagination state. `nextEditorSheet()` owns the
   * decision (including the spread fit and its memo) so it is unit-testable
   * without layout; see its header.
   */
  let applied: EditorSheet | null = null;

  /**
   * The frame's base URL.
   *
   * `about:blank` when there is nothing to resolve against, so relative asset
   * references simply fail to load rather than resolving somewhere unintended.
   */
  function baseHref(url: string): string {
    return (url || "about:blank").replace(/"/g, "&quot;");
  }

  /**
   * Point relative asset references at the preview server.
   *
   * Called when the preview starts, which is usually AFTER this component
   * mounts — the frame's document is written once, so the `<base>` element is
   * updated in place rather than the document rewritten.
   */
  export function setAssetBase(url: string): void {
    if (baseEl) baseEl.setAttribute("href", baseHref(url));
  }

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

  /**
   * Anything that moves the frame invalidates the chrome's position.
   *
   * The coordinates are computed once, when the editor reports a caret or
   * selection — so a window resize, a splitter drag or a panel toggle leaves
   * the menu painted where the caret USED to be, pointing at nothing, until
   * the next keystroke. The preview's overlay re-anchors on the preview
   * client's `viewportChanged`, but this frame deliberately runs no script of
   * its own (`script-src 'none'`), so a `ResizeObserver` on the frame element
   * is the equivalent signal — and it catches the splitter, which a `window`
   * resize listener would miss.
   *
   * Closing rather than re-anchoring: both panels are transient and tied to a
   * caret the author is about to move anyway, and a menu that quietly stays
   * open across a layout change is more surprising than one that dismisses.
   *
   * It is also where a requested spread starts and stops fitting: the splitter
   * drag and the window resize that change the answer both land here, and
   * `applyCss` no-ops unless the fitted count actually changed.
   */
  function onFrameGeometryChanged(): void {
    if (chrome) chrome = null;
    if (requestedColumns === 2) applyCss(applied?.css ?? "");
    else applyScale();
  }

  function runSlash(item: SlashItem): void {
    const mapped = slashAction(item.id);
    if (!mapped || !handle) return;
    // Remove the `/query` the author typed before inserting, or it would be
    // left behind in the text.
    clearSlashQuery(handle.view);
    handle.runToolbarAction(mapped.action, mapped.payload);
    chrome = null;
  }

  onMount(() => {
    openPath = filePath;
    requestedColumns = columns;
    const doc = frame.contentDocument;
    if (!doc) return;

    // `script-src 'none'` is what lets the surface render an author's raw HTML
    // (see `rawHtmlView` in rich-editor.ts) without also running an author's
    // `<script>`. The preview frame gets this protection from being
    // cross-origin and sandboxed; this frame is deliberately same-origin so
    // ProseMirror can reach its DOM, so it states the restriction directly.
    //
    // The `<base>` is ALWAYS written, even with no asset base to put in it.
    // It used to be conditional, and `previewUrl` is null from the moment a
    // project opens until its preview server reports ready — indefinitely, if
    // the preview never starts, which is a supported non-fatal state. The
    // editor can mount inside that window and this document is written exactly
    // once, so such an instance had no `<base>` for its whole life. The first
    // `<base>` in tree order wins, so an author's raw HTML could supply its
    // own and re-point every relative URL in the document; verified in
    // Chromium, `document.baseURI` really does become the injected origin.
    // That is not code execution, but it sends the author's own images and
    // links to someone else's server. Occupying the slot first settles it.
    //
    // A CSP `base-uri` would be the other way to close this, and is wrong
    // here: the asset base is the preview server on 127.0.0.1, a different
    // origin from the app's own, so both `'none'` and `'self'` would block our
    // own `<base>` along with the attacker's.
    doc.open();
    doc.write(
      "<!doctype html><meta charset=utf-8>" +
        `<meta http-equiv="Content-Security-Policy" content="script-src 'none'">` +
        `<base href="${baseHref(assetBase)}">` +
        "<body></body>",
    );
    doc.close();
    baseEl = doc.querySelector("base");

    styleEl = doc.createElement("style");
    doc.head.appendChild(styleEl);

    // Scale wrapper (fit-width) around the page flow. The transform is VISUAL
    // ONLY — layout inside stays at print size, so pagination is untouched —
    // and it also hosts the sheet backdrop (see paginationCss). The wrapper
    // sits between body and flow, outside the editable root, so it is neither
    // a document node nor anything the author's CSS addresses.
    scaleBox = doc.createElement("div");
    scaleBox.className = "gp-editor-scale";
    doc.body.appendChild(scaleBox);

    const flow = doc.createElement("div");
    flow.className = "gp-editor-page-flow";
    scaleBox.appendChild(flow);

    applyCss(bookCss);

    // The dialect resolves async (plugin modules come from the host). Props
    // read inside the callback read their CURRENT values, so content pushed
    // while the fetch was in flight still lands in the first mount.
    let disposed = false;
    void getProjectRenderer(projectDir).then(({ md: projectMd, issues }) => {
      if (disposed) return;
      md = projectMd;
      // Unconditional: an empty list REPLACES a previous project's issues in
      // the host, so a remount never inherits a stale banner.
      onPluginIssues?.(issues);
      handle = mountRichEditor({
        mount: flow, md: projectMd, content, onChange, onSave, onAnchorLine, onChrome,
      });
    });

    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onFrameGeometryChanged);
    observer?.observe(frame);
    window.addEventListener("resize", onFrameGeometryChanged);

    return () => {
      disposed = true;
      window.removeEventListener("resize", onFrameGeometryChanged);
      observer?.disconnect();
      handle?.destroy();
      handle = null;
      styleEl = null;
    };
  });

  /**
   * Put the book's stylesheet and the page-flow rules into the frame.
   *
   * The decision — how many pages fit, and whether anything changed at all —
   * belongs to `nextEditorSheet()`; all this adds is the one measurement only a
   * mounted frame can make. That is the frame BODY's content box, which is the
   * flow's own containing block: it already nets out the vertical scrollbar the
   * stacked pages always produce and any margin the author's `body` rule sets.
   */
  function applyCss(css: string): void {
    if (!styleEl) return;
    const width = frame?.contentDocument?.body?.clientWidth ?? 0;
    const next = nextEditorSheet(applied, css, requestedColumns, width);
    if (next) {
      applied = next;
      styleEl.textContent = next.text;
    }
    applyScale();
  }

  /**
   * Fit the page (or spread) to the pane — VISUALLY.
   *
   * The transform never touches layout: everything inside the wrapper is laid
   * out at print size, so line breaks and page breaks are exactly what
   * prints. Without this the surface rendered at true print width into a
   * ~500px pane and a third of every line sat off-screen — the author read
   * their own sentences with a horizontal scrollbar.
   */
  function applyScale(): void {
    if (!scaleBox || !applied?.css) return;
    const frameW = frame?.contentDocument?.body?.clientWidth ?? 0;
    const flowW = paginatedWidth(applied.css, { columns: applied.columns });
    if (frameW <= 0 || flowW <= 0) {
      scaleBox.style.transform = "";
      scaleBox.style.marginLeft = "";
      return;
    }
    const s = Math.min(Math.max(frameW / flowW, 0.2), 2);
    scaleBox.style.transform = s === 1 ? "" : `scale(${s})`;
    // Center the scaled pages. `margin: auto` cannot — auto margins resolve
    // against LAYOUT width, and the transform changes only the painted width.
    scaleBox.style.marginLeft = `${Math.max(0, (frameW - flowW * s) / 2)}px`;
  }

  /**
   * The host changed which file is open.
   *
   * No-ops when the file has not actually changed, matching
   * `MarkdownEditor.switchFile` — `setContent` builds a fresh `EditorState`
   * and drops undo history, so a redundant call is not free. The host makes
   * exactly one such call today (`reseedEditor` after a mode toggle, into a
   * component that already mounted with these props).
   */
  export function switchFile(newPath: string | null, newContent: string): void {
    if (newPath === openPath && handle?.getMarkdown() === newContent) return;
    openPath = newPath;
    if (handle && !handle.setContent(newContent)) refuse(newPath, newContent);
  }

  /** Same file, new bytes — an external-edit auto-reload. */
  export function updateContent(nextDoc: string): void {
    if (!handle || handle.getMarkdown() === nextDoc) return;
    if (!handle.setContent(nextDoc)) refuse(openPath, nextDoc);
  }

  /**
   * Content arrived that this schema cannot model.
   *
   * The host's preflight only decides which component MOUNTS; content pushed
   * into an already-mounted editor never passed it. An external edit that adds
   * a footnote to the open file is the ordinary way to get here. Ask the host
   * for source mode rather than leaving the previous file's text on screen
   * under the new file's name.
   */
  function refuse(path: string | null, text: string): void {
    const why = md ? canEditRichly(md, text) : null;
    onUnsupported?.(path, why && !why.ok ? why.reason : "this file cannot be edited richly");
  }

  /** The book's stylesheet changed (the author edited CSS, or a rebuild ran). */
  export function setBookCss(css: string): void {
    applyCss(css);
  }

  /**
   * The app's view mode changed — show one page or two abreast.
   *
   * The same push seam `setBookCss`/`setAssetBase` use, for the same reason:
   * this component takes no reactive dependency on its props, so a prop alone
   * would be dead wiring. A 2 that does not fit the pane is recorded and honoured
   * later, when the pane is wide enough (see `nextEditorSheet`) — refusing outright
   * would mean an author who widens the editor never gets the spread they asked
   * for.
   */
  export function setColumns(next: 1 | 2): void {
    requestedColumns = next;
    applyCss(applied?.css ?? "");
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

  /**
   * Run a toolbar action.
   *
   * Takes the host's FULL action union so both editors share one signature.
   * `snippet` and `focus-mode` are intercepted by the host before they reach
   * an editor, so they resolve to no command here and report false — the same
   * outcome `MarkdownEditor` produces by having no case for them.
   */
  export function runToolbarAction(action: ToolbarAction, payload?: ToolbarPayload): boolean {
    return (
      handle?.runToolbarAction(
        action as RichToolbarAction,
        payload as ToolbarPayloadLike,
      ) ?? false
    );
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
</script>

<iframe
  bind:this={frame}
  class="rich-editor"
  title="Gutterpress editor"
  style={backdrop ? `background: ${backdrop}` : undefined}
></iframe>

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
    /* Overridden inline by `backdrop`; this is the fallback when the author
       has not chosen a canvas colour. */
    background: #2a2a2e;
  }
</style>
