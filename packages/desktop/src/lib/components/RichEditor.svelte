<script lang="ts">
  /**
   * RichEditor (SFE-P3ab, Lane A) — a thin wrapper around the shared rich
   * editor mount (`@dimm-city/gutterpress-editor`).
   *
   * Mirrors `MarkdownEditor.svelte`'s "one view, no reactive `$effect`"
   * discipline for the same reason (this repo bans `$effect` — CLAUDE.md
   * §8): the mount is created ONCE in `onMount` and disposed ONCE in that
   * hook's cleanup, synchronously, with no watcher on the `host`/`projection`
   * props.
   *
   * Unlike `MarkdownEditor`, this component exposes NO imperative
   * `switchFile`/`updateContent` exports. The mounted adapter already
   * subscribes to `host.subscribe(...)` internally
   * (`createVscodeEditorAdapter` — see its own header) and pushes every
   * `applyEdit`/`replaceExternal` the HOST reports into the live view on
   * its own; there is nothing this component needs to do beyond mounting
   * against whatever `host` it is given. A caller that needs this component
   * to point at a different document identity (a file switch) does so by
   * giving it a fresh `host` reference and keying its own `{#key}`/`{#if}`
   * block off that identity — Svelte then destroys and recreates this
   * component, which is a fresh `onMount`/`onDestroy` cycle and therefore a
   * fresh undo epoch (D7: "file switches ... are not undoable into the
   * prior file").
   *
   * SFE-P3ab (Lane A): the one imperative export this component DOES have
   * is `getSelection()` — a thin passthrough to the mounted handle's own
   * `getSelection()` (`EditorMount`/`GutterpressEditorMount`, both now carry
   * it — see `rich-commands.ts`'s header for the full picture). Exposed via
   * `bind:this` exactly the way `MarkdownEditor.svelte`'s `editorRef` is
   * (`+page.svelte`'s existing pattern for reading live editor state from
   * outside), not a new prop shape — this component still owns no reactive
   * state of its own; `getSelection()` just forwards to whatever the mount
   * currently reports, read fresh on every call.
   *
   * No other business logic lives here: which projection to build, which
   * host backs a document, and mode selection are ALL decided by the
   * caller. This component owns DOM lifecycle for its own subtree only —
   * create the container, mount, dispose.
   */
  import { onMount } from "svelte";
  import { mountGutterpressEditor } from "@dimm-city/gutterpress-editor/gutterpress";
  import { mountEditor } from "@dimm-city/gutterpress-editor/web";
  import type { Diagnostic, EditorDocumentHost } from "@dimm-city/gutterpress-editor/core";
  import type { GutterpressProjection } from "gutterpress/render";
  import { createPagedSurface } from "$lib/editor/paged-surface";
  import { projectAssetBase, resolveProjectAssets } from "$lib/editor/project-assets";
  import { reportError } from "$lib/diagnostics/report";

  let {
    host,
    projection,
    readonly = false,
    extraCss,
    onDiagnostic,
    paged = false,
    onPaginated,
    projectDir = null,
    filePath = null,
    zoom = "fit-width",
    stacked = false,
  }: {
    /**
     * The document this mount reads/writes through — the D3/D7
     * `EditorDocumentHost` seam (e.g. `DesktopDocumentHost`). Never the
     * raw buffer/session directly; the caller is responsible for routing
     * this host's accepted edits into whatever persistence pipeline the
     * document actually uses.
     */
    host: EditorDocumentHost;
    /**
     * The Gutterpress sparse projection (D6) for `host`'s CURRENT source,
     * if one has been built. Supplied: marker/raw-html/plugin regions
     * render as Gutterpress-aware inactive chips via
     * `mountGutterpressEditor`. Omitted: this mounts the plain
     * standard-Markdown surface via `mountEditor` — source edits behave
     * identically either way (G-01), the document just won't show marker
     * chips until a projection is supplied. Building the projection is the
     * caller's job, not this component's — it has no knowledge of how to
     * derive one from `host`.
     */
    projection?: GutterpressProjection;
    readonly?: boolean;
    extraCss?: string;
    onDiagnostic?: (diagnostic: Diagnostic) => void;
    /** Paginate the live document with the book's own `@page` geometry (`$lib/editor/paged-surface`). */
    paged?: boolean;
    onPaginated?: (totalPages: number) => void;
    /** The open project's root, so the document's own relative art resolves (`$lib/editor/project-assets`). */
    projectDir?: string | null;
    /** The open document's path, so art relative to a chapter in a subfolder resolves the way the book resolves it. */
    filePath?: string | null;
    /** The zoom the pages open at: `"fit-width"` or a scale. Later changes go through `setZoom`. */
    zoom?: string;
    /**
     * One chapter of a book laid out as a stack (`BookSurface.svelte`): this
     * host sizes to its pages instead of filling the pane, and the fork's
     * content container stops scrolling so the book's own scroller does.
     */
    stacked?: boolean;
  } = $props();

  let container = $state<HTMLDivElement | undefined>(undefined);

  // Derived, not captured: Svelte would otherwise freeze the value this
  // component saw at construction. A file switch remounts this component
  // anyway (the host is rebuilt and keyed on), so in practice it is read
  // once per document — but a captured prop is a bug waiting for the first
  // time that stops being true.
  const assetBase = $derived(projectAssetBase(projectDir, filePath));

  // Set once in onMount, cleared once on unmount — a plain instance field,
  // not `$state` (see the header: this component owns no REACTIVE state;
  // `getSelection()` below only needs a stable reference to read through,
  // never a render trigger).
  let mountHandle:
    | {
        getSelection(): { readonly from: number; readonly to: number } | undefined;
        revealRange(from: number, to?: number): void;
        setReadonly(readonly: boolean): void;
        setSelection(from: number, to?: number): void;
        refreshProjection(projection: GutterpressProjection): void;
      }
    | undefined;
  /** The paged surface of the current mount, for the workspace's zoom control. */
  let surfaceHandle: ReturnType<typeof createPagedSurface> | undefined;

  onMount(() => {
    if (!container) return;
    // A pagination failure must be REPORTED, never swallowed into a
    // silently-unpaginated editor. `createPagedSurface` reads the book's own
    // `@page` geometry, so it throws on CSS this engine cannot resolve — and
    // the author is the only one who can fix that, so they have to be told
    // which rule it was. The document still mounts and stays editable.
    let surface: ReturnType<typeof createPagedSurface> | undefined;
    if (paged && extraCss) {
      try {
        surface = createPagedSurface(extraCss, container.ownerDocument);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        reportError(`the editor could not paginate this book: ${reason}`);
        onDiagnostic?.({
          // The closest STABLE D14 category (diagnostics.ts forbids inventing
          // one): the editor cannot give this document its rich, paginated
          // projection, and falls back to showing it whole.
          category: "EDITOR_UNSUPPORTED_PROJECTION",
          message: `This book's page setup could not be read, so the editor is showing it unpaginated. ${reason}`,
          safeAction: "Fix the @page rule this names, then reopen the file",
        });
      }
    }
    if (surface && onPaginated) surface.onPaginated(onPaginated);
    surfaceHandle = surface;
    if (surface && zoom) surface.setZoom(zoom);
    const mount = projection
      ? mountGutterpressEditor(container, host, {
          projection,
          readonly,
          extraCss,
          onDiagnostic,
          // The book's own CSS supplies the typography; the fork's default
          // theme would fight it (and caps the editor at 800px).
          themeClassName: extraCss ? null : undefined,
          // Read/Edit is a workspace decision, not a per-editor toggle.
          showReadonlyToggle: false,
          afterDocumentMount: (documentElement: HTMLElement) => {
            // Art first, pagination second: an unresolved image measures as
            // a 24px broken-image box, and a page count taken from that is
            // a page count for a document the author is not reading.
            resolveProjectAssets(documentElement, assetBase);
            surface?.onDocumentMount(documentElement);
          },
        })
      : { ...mountEditor(container, host, { readonly, extraCss, onDiagnostic, showReadonlyToggle: false }), refreshProjection: () => {} };
    mountHandle = mount;
    return () => {
      mountHandle = undefined;
      surfaceHandle = undefined;
      mount.dispose();
      surface?.dispose();
    };
  });

  /** The mounted surface's LIVE caret/selection (D3 source offsets), or
   *  `undefined` when there is no caret AT THIS INSTANT — this component
   *  has not mounted (yet, or anymore), the surface has never been focused,
   *  OR a real interaction cleared it again (e.g. clicking the mount's own
   *  left gutter — SFE-P3ab review round 1, CONFIRMED finding: `undefined`
   *  is not proof of "never focused"; see `rich-commands.ts`'s header for
   *  the verified reproduction and `packages/editor/tests/web/
   *  mount.btest.ts` for the browser proof). Read fresh on every call; this
   *  component keeps no cached copy. */
  export function getSelection(): { readonly from: number; readonly to: number } | undefined {
    return mountHandle?.getSelection();
  }

  /**
   * Lock/unlock the MOUNTED editor. Called from the workspace's Read/Edit
   * handler (`setMode`) rather than reacting to the `readonly` prop: the
   * prop is only read at mount time, so before this existed switching to
   * Read left the open document editable until the next file switch.
   */
  export function setReadonly(next: boolean): void {
    mountHandle?.setReadonly(next);
  }

  /** Zoom the pages: `"fit-width"` or a scale such as `"1.25"` (see `PagedSurface.setZoom`). */
  export function setZoom(next: string): void {
    surfaceHandle?.setZoom(next);
  }

  /** Book pages before this document's first page, so its folios continue from the chapters above (see `PagedSurface.setPageOffset`). */
  export function setPageOffset(offset: number): void {
    surfaceHandle?.setPageOffset(offset);
  }

  /**
   * Swap in a projection built for the document's current text and rebuild
   * the blocks against it, keeping caret, scroll and history (see
   * `GutterpressEditorMount.refreshProjection`).
   */
  export function refreshProjection(next: GutterpressProjection): void {
    mountHandle?.refreshProjection(next);
  }

  /** Place the caret at a source offset, as a click there would (activates the block). */
  export function setSelection(from: number, to?: number): void {
    mountHandle?.setSelection(from, to);
  }

  /**
   * Scroll the 1-based source LINE into view. The workspace navigates by
   * line (an outline row, a diagnostic, a click in the book), the mounted
   * surface addresses source by OFFSET, and this component is the only
   * place that holds the host to convert between them.
   *
   * Nothing but the scroll position moves: no caret, no selection, no edit
   * — so this is safe to call while the editor is locked.
   */
  export function revealLine(line: number): void {
    if (!mountHandle) return;
    const text = host.getSnapshot().text;
    let offset = 0;
    for (let i = 1; i < line; i++) {
      const next = text.indexOf("\n", offset);
      if (next < 0) break;
      offset = next + 1;
    }
    mountHandle.revealRange(offset);
  }
</script>

<div class="rich-editor-host" class:rich-editor-host--stacked={stacked} bind:this={container}></div>

<style>
  .rich-editor-host {
    width: 100%;
    min-width: 0;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  /*
   * Height, all the way down to the fork's own scroller.
   *
   * The mounted editor sizes itself to its CONTENT — `.md-editor` grew to the
   * full 4313px of a chapter inside a 932px pane — and its scrolling
   * container only scrolls if something above it says how tall it may be.
   * Nothing did, so the pane clipped the document at its own height and the
   * author could not reach page two of their own book by any means.
   *
   * `:global` because this styles the fork's DOM, which Svelte's scoping
   * cannot reach. It sets height only: no display, no padding, nothing that
   * would change how the editor lays its content out.
   */
  .rich-editor-host :global(.md-editor) {
    height: 100%;
    min-height: 0;
    /* The fork caps a document at a reading measure (52rem) and leaves it at
       the pane's left edge. The pages are their own measure; the stage takes
       the whole pane and centres the sheets in it, the way the preview does. */
    max-width: none;
  }
  .rich-editor-host :global(.md-editor-content) {
    max-height: 100%;
    overflow: auto;
  }

  /* One chapter in a stack: the host is as tall as its pages, and nothing
     inside it scrolls -  the book's scroller (BookSurface) does. The stage
     keeps its horizontal padding, which centres the sheets; the vertical
     padding is the scroller's, once, not every chapter's. */
  .rich-editor-host--stacked {
    height: auto;
    overflow: visible;
  }
  .rich-editor-host--stacked :global(.md-editor) {
    height: auto;
  }
  .rich-editor-host--stacked :global(.md-editor-content) {
    max-height: none;
    overflow: visible;
  }
  .rich-editor-host--stacked :global(.gp-stage) {
    overflow: visible;
    padding-top: 0;
    padding-bottom: 0;
  }
</style>
