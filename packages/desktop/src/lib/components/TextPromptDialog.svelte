<script lang="ts">
  import { dialogBehavior } from "$lib/dialog";

  let { title, label, initialValue, onDone }: {
    title: string;
    label: string;
    initialValue: string;
    onDone: (value: string | null) => void;
  } = $props();
  let value = $state<string | undefined>();
  let finished = false;

  function finish(result: string | null): void {
    if (finished) return;
    finished = true;
    onDone(result);
  }
</script>

<div class="dlg-backdrop" role="presentation" onclick={() => finish(null)}></div>
<form
  class="dlg-shell text-prompt"
  use:dialogBehavior={{ onClose: () => finish(null), labelledBy: "text-prompt-title", initialFocus: "input" }}
  onsubmit={(event) => { event.preventDefault(); finish(value ?? initialValue); }}
>
  <header class="dlg-header"><h2 id="text-prompt-title">{title}</h2></header>
  <label>
    <span>{label}</span>
    <input value={value ?? initialValue} oninput={(event) => (value = event.currentTarget.value)} autocomplete="off" />
  </label>
  <footer class="dlg-actions">
    <button type="button" class="dlg-ghost" onclick={() => finish(null)}>Cancel</button>
    <button type="submit" class="dlg-primary app-btn-primary">Apply</button>
  </footer>
</form>

<style>
  @import "$lib/styles/dialog-shell.css";
  .text-prompt { width: min(440px, 92vw); }
  label { display: grid; gap: 7px; padding: 18px; color: var(--app-text-secondary); font-size: 13px; }
  input { padding: 8px 10px; color: var(--app-text); background: var(--app-control-bg); border: 1px solid var(--app-border); border-radius: 5px; font: inherit; }
  input:focus { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }
</style>
