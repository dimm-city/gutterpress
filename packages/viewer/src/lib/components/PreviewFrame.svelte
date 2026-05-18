<script lang="ts">
  import { onMount } from "svelte";
  import { PreviewClient } from "../preview-client";

  let { url, client = $bindable() }: { url: string; client?: PreviewClient } = $props();

  let frame: HTMLIFrameElement;

  onMount(() => {
    const c = new PreviewClient();
    client = c;
    const onLoad = () => {
      c.attach(frame.contentWindow);
    };
    frame.addEventListener("load", onLoad);
    return () => {
      frame.removeEventListener("load", onLoad);
      c.detach();
    };
  });
</script>

<iframe bind:this={frame} src={url} title="print-md preview"></iframe>

<style>
  iframe {
    flex: 1;
    width: 100%;
    height: 100%;
    border: 0;
    background: #5a5a5a;
  }
</style>
