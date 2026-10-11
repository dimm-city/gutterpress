<script lang="ts">
  /**
   * The ONE spinner. Every busy indicator in the app (open overlay, hot-reload
   * pill, export pill, start-screen card, editor pane) draws this
   * ring so they read as one system. Decorative: the words beside it carry the
   * status, so it is hidden from assistive tech. Under prefers-reduced-motion
   * the global guard in theme.css stops the rotation and the ring stays as a
   * static partial arc.
   */
  let { size = 14 }: { size?: number } = $props();
</script>

<span class="spinner" style:--spinner-size="{size}px" aria-hidden="true"></span>

<style>
  .spinner {
    display: inline-block;
    flex: 0 0 auto;
    box-sizing: border-box;
    width: var(--spinner-size);
    height: var(--spinner-size);
    border: max(2px, calc(var(--spinner-size) * 0.075)) solid var(--app-spinner-track);
    border-top-color: var(--app-spinner-head);
    border-radius: 50%;
    animation: spinner-turn 0.8s linear infinite;
  }
  @keyframes spinner-turn {
    to { transform: rotate(360deg); }
  }
</style>
