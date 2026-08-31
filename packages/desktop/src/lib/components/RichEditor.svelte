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
   * No business logic lives here: which projection to build, which host
   * backs a document, and mode selection are ALL decided by the caller.
   * This component owns DOM lifecycle for its own subtree only — create
   * the container, mount, dispose.
   */
  import { onMount } from "svelte";
  import { mountGutterpressEditor } from "@dimm-city/gutterpress-editor/gutterpress";
  import { mountEditor } from "@dimm-city/gutterpress-editor/web";
  import type { Diagnostic, EditorDocumentHost } from "@dimm-city/gutterpress-editor/core";
  import type { GutterpressProjection } from "gutterpress/render";

  let {
    host,
    projection,
    readonly = false,
    extraCss,
    onDiagnostic,
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
  } = $props();

  let container = $state<HTMLDivElement | undefined>(undefined);

  onMount(() => {
    if (!container) return;
    const mount = projection
      ? mountGutterpressEditor(container, host, { projection, readonly, extraCss, onDiagnostic })
      : mountEditor(container, host, { readonly, extraCss, onDiagnostic });
    return () => mount.dispose();
  });
</script>

<div class="rich-editor-host" bind:this={container}></div>

<style>
  .rich-editor-host {
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
</style>
