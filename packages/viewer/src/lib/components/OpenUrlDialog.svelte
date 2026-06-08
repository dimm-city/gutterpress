<script lang="ts">
  let {
    open = $bindable(false),
    onOpen,
    triggerEl,
  }: {
    open?: boolean;
    onOpen?: (url: string) => void;
    triggerEl?: HTMLButtonElement | undefined;
  } = $props();

  let url = $state("");
  let error = $state<string | null>(null);
  let input = $state<HTMLInputElement | undefined>(undefined);
  let dialogEl = $state<HTMLDivElement | undefined>(undefined);

  function focusableElements() {
    return Array.from(
      dialogEl?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []
    );
  }

  function trapFocus(e: KeyboardEvent) {
    if (e.key !== "Tab") return;
    const focusable = focusableElements();
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  $effect(() => {
    if (open) {
      error = null;
      queueMicrotask(() => input?.focus() ?? focusableElements()[0]?.focus());
    }
  });

  function close() {
    open = false;
    triggerEl?.focus();
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
    triggerEl?.focus();
  }
</script>

{#if open}
  <div class="backdrop" onclick={close} role="presentation"></div>

  <div bind:this={dialogEl} class="dialog" role="dialog" aria-modal="true" aria-labelledby="open-url-title" tabindex="-1" onkeydown={trapFocus}>
    <header class="dialog-header">
      <h2 id="open-url-title">Preview from Web</h2>
      <button class="close" onclick={close} title="Close (Esc)" aria-label="Close">&times;</button>
    </header>

    <div class="dialog-body">
      <p class="hint">
        Enter the web address of a print-md document to preview it here. <strong>PDF export is not available for web previews</strong> — open a local folder to save a PDF.
      </p>

      <label class="field">
        <span>Web address</span>
        <input
          bind:this={input}
          bind:value={url}
          type="url"
          placeholder="https://example.com/your-document/"
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
    background: var(--app-backdrop);
    z-index: 1000;
  }
  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(520px, 92vw);
    background: var(--app-surface);
    color: var(--app-text-secondary);
    border-radius: 8px;
    box-shadow: 0 14px 40px var(--app-shadow-lg);
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
    border-bottom: 1px solid var(--app-border-subtle);
  }
  .dialog-header h2 { margin: 0; font-size: 16px; font-weight: 600; }
  .close {
    background: transparent;
    border: 0;
    color: var(--app-text-muted);
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
    padding: 0 4px;
  }
  .close:hover { color: var(--app-text); }
  .dialog-body { padding: 16px 18px; }
  .hint { font-size: 12px; color: var(--app-text-faint); margin: 0 0 14px; line-height: 1.5; }
  .field { display: flex; flex-direction: column; gap: 6px; }
  .field span { font-size: 12px; color: var(--app-text-muted); font-weight: 500; }
  .field input {
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-border);
    color: var(--app-text-secondary);
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 13px;
    font-family: ui-monospace, monospace;
  }
  .field input:focus {
    outline: none;
    border-color: var(--app-focus-ring);
  }
  .error { color: var(--app-error-text); font-size: 12px; margin: 10px 0 0; }
  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding-top: 16px;
    margin-top: 16px;
    border-top: 1px solid var(--app-border-subtle);
  }
  .actions button {
    padding: 6px 14px;
    font-size: 13px;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .actions .primary { background: var(--app-focus-ring); color: var(--app-text-on-accent); }
  .actions .primary:hover { background: var(--app-accent-hover); }
  .actions .ghost { background: transparent; color: var(--app-text-muted); border-color: var(--app-border); }
  .actions .ghost:hover { background: var(--app-surface-hover); color: var(--app-text); }
</style>
