<script lang="ts">
  let {
    open = $bindable(false),
    onOpen,
  }: {
    open?: boolean;
    onOpen?: (url: string) => void;
  } = $props();

  let url = $state("");
  let error = $state<string | null>(null);
  let input = $state<HTMLInputElement | undefined>(undefined);

  $effect(() => {
    if (open) {
      error = null;
      queueMicrotask(() => input?.focus());
    }
  });

  function close() {
    open = false;
  }

  function submit() {
    const trimmed = url.trim();
    if (!trimmed) {
      error = "Enter a URL.";
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      error = "That doesn't look like a valid URL.";
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      error = "Only http:// and https:// URLs are supported.";
      return;
    }
    onOpen?.(parsed.toString());
    url = "";
    open = false;
  }
</script>

{#if open}
  <div class="backdrop" onclick={close} role="presentation"></div>

  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="open-url-title">
    <header class="dialog-header">
      <h2 id="open-url-title">Open URL</h2>
      <button class="close" onclick={close} title="Close (Esc)" aria-label="Close">&times;</button>
    </header>

    <div class="dialog-body">
      <p class="hint">
        Load a published print-md HTML output. The viewer will display the page
        read-only — saving as PDF is disabled for URL sources.
      </p>

      <label class="field">
        <span>URL</span>
        <input
          bind:this={input}
          bind:value={url}
          type="url"
          placeholder="https://example.com/book/"
          spellcheck="false"
          autocomplete="off"
          onkeydown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
      </label>

      {#if error}
        <p class="error">{error}</p>
      {/if}

      <footer class="actions">
        <button class="ghost" onclick={close}>Cancel</button>
        <button class="primary" onclick={submit}>Open</button>
      </footer>
    </div>
  </div>
{/if}

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape" && open) close();
  }}
/>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 1000;
  }
  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(520px, 92vw);
    background: #1e1e1e;
    color: #e0e0e0;
    border-radius: 8px;
    box-shadow: 0 14px 40px rgba(0, 0, 0, 0.5);
    z-index: 1001;
    display: flex;
    flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid #303030;
  }
  .dialog-header h2 { margin: 0; font-size: 16px; font-weight: 600; }
  .close {
    background: transparent;
    border: 0;
    color: #aaa;
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
    padding: 0 4px;
  }
  .close:hover { color: #fff; }
  .dialog-body { padding: 16px 18px; }
  .hint { font-size: 12px; color: #888; margin: 0 0 14px; line-height: 1.5; }
  .field { display: flex; flex-direction: column; gap: 6px; }
  .field span { font-size: 12px; color: #aaa; font-weight: 500; }
  .field input {
    background: #2a2a2a;
    border: 1px solid #404040;
    color: #e0e0e0;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 13px;
    font-family: ui-monospace, monospace;
  }
  .field input:focus {
    outline: none;
    border-color: #3a6fb5;
  }
  .error { color: #f08080; font-size: 12px; margin: 10px 0 0; }
  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding-top: 16px;
    margin-top: 16px;
    border-top: 1px solid #303030;
  }
  .actions button {
    padding: 6px 14px;
    font-size: 13px;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .actions .primary { background: #3a6fb5; color: #fff; }
  .actions .primary:hover { background: #4882d4; }
  .actions .ghost { background: transparent; color: #aaa; border-color: #404040; }
  .actions .ghost:hover { background: #262626; color: #fff; }
</style>
