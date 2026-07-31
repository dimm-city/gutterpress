<script lang="ts">
  let { size = 24 }: { size?: number } = $props();
</script>

<span class="brand-mark" style:width="{size}px" style:height="{size}px" aria-hidden="true">
  <img class="for-light" src="./icons/gutterpress-icon-light.svg" alt="" />
  <img class="for-dark" src="./icons/gutterpress-icon-dark.svg" alt="" />
</span>

<style>
  .brand-mark {
    display: inline-flex;
    flex: 0 0 auto;
  }
  img {
    display: block;
    width: 100%;
    height: 100%;
  }
  .for-dark { display: none; }
  :global(:root[data-theme="dark"]) .for-light { display: none; }
  :global(:root[data-theme="dark"]) .for-dark { display: block; }
</style>
