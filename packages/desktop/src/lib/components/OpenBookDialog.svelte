<script lang="ts">
  /**
   * "Open a book" source picker. Pure chooser: each card hands off to the
   * existing flow (native folder dialog, GitHub clone dialog); no logic here.
   */
  import Icon from "$lib/components/Icon.svelte";
  import { dialogBehavior } from "$lib/dialog";

  let { onLocal, onGitHub, onClose }: {
    onLocal: () => void;
    /** The GitHub choice renders only when this is passed. */
    onGitHub?: () => void;
    onClose: () => void;
  } = $props();
</script>

<div class="dlg-backdrop" role="presentation" onclick={onClose}></div>
<div class="dlg-shell open-book" use:dialogBehavior={{ onClose, labelledBy: "open-book-title" }}>
  <header class="dlg-header"><h2 id="open-book-title">Open a book</h2></header>
  <div class="choices">
    <button type="button" class="choice" onclick={onLocal}>
      <span class="choice-icon"><Icon name="folder-open" size={22} /></span>
      <span class="choice-text">
        <span class="choice-title">From this computer</span>
        <span class="choice-sub">A book folder saved on this computer</span>
      </span>
    </button>
    {#if onGitHub}
      <button type="button" class="choice" onclick={onGitHub}>
        <span class="choice-icon"><Icon name="github" size={22} /></span>
        <span class="choice-text">
          <span class="choice-title">From GitHub</span>
          <span class="choice-sub">Download a book from your online copy</span>
        </span>
      </button>
    {/if}
  </div>
  <footer class="dlg-actions">
    <button type="button" class="dlg-ghost" onclick={onClose}>Cancel</button>
  </footer>
</div>

<style>
  @import "$lib/styles/dialog-shell.css";
  .open-book { width: min(420px, 92vw); }
  .choices { display: grid; gap: 10px; padding: 18px; }
  .choice {
    display: flex; align-items: center; gap: 14px; width: 100%;
    padding: 14px; text-align: left; cursor: pointer; font: inherit;
    background: var(--app-control-bg); color: var(--app-control-text);
    border: 1px solid var(--app-control-border); border-radius: 8px;
  }
  .choice:hover { background: var(--app-control-hover-bg); border-color: var(--app-control-hover-border); }
  .choice:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  .choice-icon { flex-shrink: 0; display: inline-flex; color: var(--app-accent); }
  .choice-text { display: grid; gap: 2px; min-width: 0; }
  .choice-title { font-size: 14px; font-weight: 600; color: var(--app-text); }
  .choice-sub { font-size: 12px; color: var(--app-text-muted); }
</style>
