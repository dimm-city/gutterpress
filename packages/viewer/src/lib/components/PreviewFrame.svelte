<script lang="ts">
  import { PreviewClient } from "../preview-client";

  let { url, client = $bindable(), onError }: {
    url: string;
    client?: PreviewClient;
    onError?: (msg: string) => void;
  } = $props();

  // Wire the PreviewClient to the iframe on mount, tear down on destroy — a
  // use: action on the <iframe>, not a $effect (no `frame` state needed).
  function wirePreview(node: HTMLIFrameElement) {
    const c = new PreviewClient();
    client = c;
    const onLoad = () => c.attach(node.contentWindow);
    const onErr = () => onError?.(`Preview iframe failed to load ${url}`);
    node.addEventListener("load", onLoad);
    node.addEventListener("error", onErr);
    return {
      destroy() {
        node.removeEventListener("load", onLoad);
        node.removeEventListener("error", onErr);
        c.detach();
        client = undefined;
      },
    };
  }
</script>

<iframe use:wirePreview src={url} title="print-md preview"></iframe>

<style>
  /*
   * The preview iframe is INTENTIONALLY EXCLUDED from app theming (#48). It
   * renders the author's own document CSS and must always sit on a fixed,
   * neutral print-condition background regardless of the app's light/dark
   * theme. This literal is the one deliberate exception to the no-hardcoded-
   * colour rule; see iframe-styles.ts buildViewerStyles for the matching
   * in-iframe canvas background. Do NOT replace it with an app theme token.
   */
  iframe {
    flex: 1;
    width: 100%;
    height: 100%;
    border: 0;
    background: #5a5a5a;
    /* NEVER hide this iframe (opacity/visibility/display) while paged.js is
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
