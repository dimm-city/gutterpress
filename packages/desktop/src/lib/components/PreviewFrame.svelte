<script lang="ts">
  import { onMount } from "svelte";
  import { PreviewClient } from "../preview-client";

  let { url, client = $bindable(), onError, onClientReady }: {
    url: string;
    client?: PreviewClient;
    onError?: (msg: string) => void;
    /** Called when a new PreviewClient is created and attached to this frame. */
    onClientReady?: (c: PreviewClient) => void;
  } = $props();

  let frame = $state<HTMLIFrameElement | undefined>(undefined);

  /**
   * The mounted `<iframe>` element, or undefined before mount / after unmount.
   * Exported so callers stop reaching for `document.querySelector("iframe")`
   * (the pattern `+page.svelte`'s `measureContainerWidth`/context-menu
   * positioning used) — this component owns the one iframe on the page, so it
   * should be the one source of its element.
   */
  export function getIframe(): HTMLIFrameElement | undefined {
    return frame;
  }

  onMount(() => {
    if (!frame) return;
    const c = new PreviewClient();
    client = c;
    onClientReady?.(c);
    // Attach NOW, not on the iframe's "load" event. `contentWindow` is the
    // frame's WindowProxy, which is created with the element and survives
    // every navigation of it — so binding it here is the same window the
    // shell posts from, just bound sooner. Waiting for "load" opened a real
    // drop window: the outer load event waits for the shell's whole subtree
    // (the book iframe and all its subresources), while the book paginates on
    // its own DOMContentLoaded and posts `ready`/`renderingComplete` straight
    // away. Every event in that gap hit `PreviewClient`'s `!this.win` guard
    // and was discarded with no replay, leaving a permanent "Rendering…"
    // scrim over a finished book, a page count stuck at 0, and no re-lint.
    // preview-shell.js latches the identical race one hop down
    // (`__GUTTERPRESS_RENDERED__`); this hop had nothing.
    // M31 is untouched: `attach()` only names the window, and messages are
    // still accepted only when BOTH the source is this frame and the origin
    // is the one `onClientReady` pinned above (and a URL-preview client has
    // already called `lockDown()`, which makes this a permanent no-op).
    c.attach(frame.contentWindow);
    const onErr = (_e: Event) => {
      onError?.(`Preview iframe failed to load ${url}`);
    };
    frame.addEventListener("error", onErr);
    return () => {
      frame!.removeEventListener("error", onErr);
      c.detach();
      client = undefined;
    };
  });
</script>

<!--
  ARCH review finding #1: the preview is cross-origin (http://127.0.0.1 inside
  app://local) and renders author markdown with html:true, so a raw
  `<a target="_top">` in a shared project could otherwise navigate the top
  frame straight to a remote origin (which then inherits the live preload
  bridge via main.ts's — now closed — will-navigate hole). `sandbox` denies
  top-navigation and popups outright, as defense in depth alongside the host's
  will-navigate/setWindowOpenHandler policy.
  allow-scripts is required: the preview-bridge.js running inside the frame
  drives native viewer layout and the postMessage command bridge (preview-client.ts).
  allow-same-origin is required too: without it the sandboxed frame gets an
  opaque origin, which breaks its own same-origin resource fetches (fonts,
  images, the adapter-node routes it's served from) — normally allow-scripts +
  allow-same-origin together would let a same-origin frame strip its own
  sandbox, but that escape needs the frame's real origin to match the
  embedding document's, and this frame's real origin (http://127.0.0.1:<port>)
  never matches the parent's (app://local), so the combination is safe here.
-->
<iframe
  bind:this={frame}
  src={url}
  title="Gutterpress preview"
  sandbox="allow-scripts allow-same-origin"
></iframe>

<style>
  /*
   * The preview iframe is INTENTIONALLY EXCLUDED from app theming (#48). It
   * renders the author's own document CSS and must always sit on a fixed,
   * neutral print-condition background regardless of the app's light/dark
   * theme. This literal is the one deliberate exception to the no-hardcoded-
   * colour rule; see iframe-styles.ts's buildCanvasBackgroundStyles for the
   * matching in-iframe canvas background. Do NOT replace it with an app
   * theme token.
   */
  iframe {
    flex: 1;
    width: 100%;
    height: 100%;
    border: 0;
    background: #5a5a5a;
    /* NEVER hide this iframe (opacity/visibility/display) while the viewer is
       laying out. It is CROSS-ORIGIN (http://127.0.0.1 inside app://), and
       Chromium throttles invisible cross-origin iframes to ~1fps — which
       turned a ~10s layout into ~5 minutes (~1 page/sec) on a 287-page book
       (the 0.4.1 regression, proven by forcing opacity:1 mid-render: the
       remaining 247 pages completed in <14s). The page/layout shuffle is
       hidden by the TRANSLUCENT LoadingOverlay sitting on top instead; the
       cross-fade happens on the overlay, not the iframe. */
    opacity: 1;
  }
</style>
