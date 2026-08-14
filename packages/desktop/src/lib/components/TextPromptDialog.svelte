<script lang="ts">
  import { dialogBehavior } from "$lib/dialog";

  let { title, label, initialValue, options, onDone }: {
    title: string;
    label: string;
    initialValue: string;
    options?: readonly { value: string; label: string }[];
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
  use:dialogBehavior={{ onClose: () => finish(null), labelledBy: "text-prompt-title", initialFocus: options ? "select" : "input" }}
  onsubmit={(event) => { event.preventDefault(); finish(value ?? initialValue); }}
>
  <header class="dlg-header"><h2 id="text-prompt-title">{title}</h2></header>
  <label>
    <span>{label}</span>
    {#if options}
      <select value={value ?? initialValue} onchange={(event) => (value = event.currentTarget.value)}>
        {#each options as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    {:else}
      <input value={value ?? initialValue} oninput={(event) => (value = event.currentTarget.value)} autocomplete="off" />
    {/if}
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
  input, select { width: 100%; padding: 8px 10px; color: var(--app-text); background: var(--app-control-bg); border: 1px solid var(--app-border); border-radius: 5px; font: inherit; }
  input:focus, select:focus { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }
</style>
