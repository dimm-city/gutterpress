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

  let {
    host,
    projection,
    readonly = false,
    extraCss,
    onDiagnostic,
    paged = false,
    onPaginated,
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
  } = $props();

  let container = $state<HTMLDivElement | undefined>(undefined);

  // Set once in onMount, cleared once on unmount — a plain instance field,
  // not `$state` (see the header: this component owns no REACTIVE state;
  // `getSelection()` below only needs a stable reference to read through,
  // never a render trigger).
  let mountHandle:
    | {
        getSelection(): { readonly from: number; readonly to: number } | undefined;
        setReadonly(readonly: boolean): void;
      }
    | undefined;

  onMount(() => {
    if (!container) return;
    const surface = paged && extraCss ? createPagedSurface(extraCss, container.ownerDocument) : undefined;
    if (surface && onPaginated) surface.onPaginated(onPaginated);
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
          afterDocumentMount: surface?.onDocumentMount,
        })
      : mountEditor(container, host, { readonly, extraCss, onDiagnostic, showReadonlyToggle: false });
    mountHandle = mount;
    return () => {
      mountHandle = undefined;
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
</script>

<div class="rich-editor-host" bind:this={container}></div>

<style>
  .rich-editor-host {
    width: 100%;
    min-width: 0;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
</style>
