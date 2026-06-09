<script lang="ts">
  import { PreviewClient } from "../preview-client";

  let { url, client = $bindable(), onError, revealed = false }: {
    url: string;
    client?: PreviewClient;
    onError?: (msg: string) => void;
    /** When false the iframe is invisible (opacity 0). Set to true to fade it in. */
    revealed?: boolean;
  } = $props();

  let frame = $state<HTMLIFrameElement | undefined>(undefined);

  $effect(() => {
    if (!frame) return;
    const c = new PreviewClient();
    client = c;
    const onLoad = () => {
      c.attach(frame!.contentWindow);
    };
    const onErr = (_e: Event) => {
      onError?.(`Preview iframe failed to load ${url}`);
    };
    frame.addEventListener("load", onLoad);
    frame.addEventListener("error", onErr);
    return () => {
      frame!.removeEventListener("load", onLoad);
      frame!.removeEventListener("error", onErr);
      c.detach();
      client = undefined;
    };
  });
</script>

<iframe bind:this={frame} src={url} title="print-md preview" class:revealed></iframe>

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
    /* Hidden (opacity 0) until paged.js layout is complete, so the user never
       sees the page/layout shuffle. The `revealed` prop flips to true ~250ms
       after renderingComplete, at the same moment the LoadingOverlay starts its
       400ms out:fade — so the pages fade IN as the overlay fades OUT (cross-fade),
       both over 400ms. */
    opacity: 0;
    transition: opacity 400ms ease;
  }

  iframe.revealed {
    opacity: 1;
  }
</style>
