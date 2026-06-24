<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { getPlatform, isDesktop } from "$lib/platform";

  let {
    open = $bindable(false),
    onCreated,
    triggerEl,
  }: {
    open?: boolean;
    /** Called with the created project folder so the host can open it. */
    onCreated?: (projectDir: string) => void;
    triggerEl?: HTMLButtonElement | undefined;
  } = $props();

  // Two steps: details (name + author), then location (folder picker + create).
  type Step = "details" | "location";
  let step = $state<Step>("details");

  let name = $state("");
  let author = $state("");
  let parentDir = $state<string | null>(null);
  let useVersionHistory = $state(true);

  let creating = $state(false);
  let error = $state<string | null>(null);

  let dialogEl = $state<HTMLDivElement | undefined>(undefined);
  let nameInput = $state<HTMLInputElement | undefined>(undefined);

  // A friendly preview of the folder name we'll create (slug of the title). Kept
  // purely informational — the writer never types a slug.
  let folderPreview = $derived.by<string>(() => {
    const slug = name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug;
  });

  let canContinue = $derived(name.trim().length > 0 && folderPreview.length > 0);

  function reset() {
    step = "details";
    name = "";
    author = "";
    parentDir = null;
    useVersionHistory = true;
    creating = false;
    error = null;
  }

  $effect(() => {
    if (open) {
      reset();
      queueMicrotask(() => nameInput?.focus());
    }
  });

  function close() {
    open = false;
    triggerEl?.focus();
  }

  function focusableElements() {
    return Array.from(
      dialogEl?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
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

  function goToLocation() {
    if (!canContinue) {
      error = "Give your book a name to continue.";
      return;
    }
    error = null;
    step = "location";
  }

  async function chooseLocation() {
    if (!isDesktop()) {
      error = "Creating a project needs the desktop app.";
      return;
    }
    error = null;
    try {
      const dir = await getPlatform().openFolder();
      if (dir) parentDir = dir.key;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function create() {
    if (!isDesktop()) {
      error = "Creating a project needs the desktop app.";
      return;
    }
    if (!parentDir) {
      error = "Choose where to save your book first.";
      return;
    }
    creating = true;
    error = null;
    try {
      const result = await getPlatform().createProject({
        name: name.trim(),
        author: author.trim() || undefined,
        parentDir,
        versionHistory: useVersionHistory ? "local-git" : "none",
      });
      open = false;
      onCreated?.(result.projectDir);
    } catch (e) {
      error = friendlyCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      creating = false;
    }
  }

  // Turn lib error text into writer-friendly copy (no codes / jargon).
  function friendlyCreateError(msg: string): string {
    if (/already exists/i.test(msg)) {
      return "There's already a book with that name in this folder. Try a different name or location.";
    }
    if (/can't be written|not be written|writable/i.test(msg)) {
      return "That location can't be saved to. Pick a different folder.";
    }
    return msg;
  }
</script>

{#if open}
  <div class="backdrop" onclick={close} role="presentation"></div>

  <div
    bind:this={dialogEl}
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="new-project-title"
    tabindex="-1"
    onkeydown={trapFocus}
  >
    <header class="dialog-header">
      <h2 id="new-project-title">Create a new book</h2>
      <button class="close" onclick={close} title="Close (Esc)" aria-label="Close"><Icon name="x" size={16} /></button>
    </header>

    <div class="dialog-body">
      {#if step === "details"}
        <p class="lead">Let's set up your book. You can change any of this later.</p>

        <label class="field" for="np-name">
          <span>What's your book called?</span>
          <input
            id="np-name"
            bind:this={nameInput}
            bind:value={name}
            type="text"
            placeholder="My First Book"
            autocomplete="off"
            spellcheck="false"
            onkeydown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                goToLocation();
              }
            }}
          />
        </label>

        <label class="field" for="np-author">
          <span>Who's writing it? <em class="optional">(optional)</em></span>
          <input
            id="np-author"
            bind:value={author}
            type="text"
            placeholder="Your name"
            autocomplete="off"
            onkeydown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                goToLocation();
              }
            }}
          />
        </label>

        {#if folderPreview}
          <p class="hint">
            We'll create a folder named <code>{folderPreview}</code> for your book.
          </p>
        {/if}

        {#if error}
          <p class="error" role="alert">{error}</p>
        {/if}

        <footer class="actions">
          <button class="ghost" onclick={close}>Cancel</button>
          <button class="primary" onclick={goToLocation} disabled={!canContinue}>
            Continue
          </button>
        </footer>
      {:else}
        <p class="lead">Where should we save <strong>{name.trim()}</strong>?</p>

        <div class="location-row">
          <button class="ghost browse" onclick={chooseLocation} disabled={creating}>
            Choose folder…
          </button>
          {#if parentDir}
            <span class="location-path" title={parentDir}>{parentDir}</span>
          {:else}
            <span class="location-empty">No folder chosen yet</span>
          {/if}
        </div>

        <label class="checkbox">
          <input type="checkbox" bind:checked={useVersionHistory} disabled={creating} />
          <span>
            Keep a history of my changes
            <em class="optional">(lets you go back to earlier versions — recommended)</em>
          </span>
        </label>

        {#if error}
          <p class="error" role="alert">{error}</p>
        {/if}

        <footer class="actions">
          <button class="ghost" onclick={() => (step = "details")} disabled={creating}>
            Back
          </button>
          <button class="primary" onclick={create} disabled={!parentDir || creating}>
            {creating ? "Creating…" : "Create book"}
          </button>
        </footer>
      {/if}
    </div>
  </div>
{/if}

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape" && open && !creating) close();
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
    width: min(520px, 94vw);
    max-height: 80vh;
    background: var(--app-surface);
    color: var(--app-text-secondary);
    border-radius: 8px;
    box-shadow: 0 14px 40px var(--app-shadow-lg);
    z-index: 1001;
    display: flex;
    flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    overflow: hidden;
  }
  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--app-border-subtle);
    flex-shrink: 0;
  }
  .dialog-header h2 { margin: 0; font-size: 16px; font-weight: 600; }
  .close {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 5px;
    color: var(--app-text-muted);
    line-height: 1;
    cursor: pointer;
    padding: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* WCAG 2.5.8: minimum target size 24x24px */
    min-width: 28px;
    min-height: 28px;
  }
  .close:hover { color: var(--app-text); background: var(--app-surface-hover); }
  .close:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  .dialog-body {
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    overflow-y: auto;
    flex: 1;
  }
  .lead { margin: 0; font-size: 13px; color: var(--app-text-muted); }
  .field { display: flex; flex-direction: column; gap: 6px; }
  .field > span { font-size: 12px; color: var(--app-text-muted); font-weight: 500; }
  .optional { font-style: italic; color: var(--app-text-faint); font-weight: 400; }
  .field input[type="text"] {
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-border);
    color: var(--app-text-secondary);
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 14px;
  }
  .field input[type="text"]:focus {
    outline: none;
    border-color: var(--app-focus-ring);
  }
  .hint { margin: 0; font-size: 12px; color: var(--app-text-faint); }
  .hint code {
    font-family: ui-monospace, monospace;
    background: var(--app-surface-sunken);
    padding: 1px 5px;
    border-radius: 4px;
  }
  .error { color: var(--app-error-text); font-size: 12px; margin: 0; }

  .location-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .browse { flex-shrink: 0; }
  .location-path {
    font-size: 12px;
    color: var(--app-text-secondary);
    font-family: ui-monospace, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .location-empty { font-size: 12px; color: var(--app-text-faint); font-style: italic; }

  .checkbox {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 13px;
    color: var(--app-text-secondary);
    cursor: pointer;
  }
  .checkbox input { margin-top: 2px; flex-shrink: 0; }

  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding-top: 14px;
    margin-top: 4px;
    border-top: 1px solid var(--app-border-subtle);
    flex-shrink: 0;
  }
  .actions button {
    padding: 7px 16px;
    font-size: 13px;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .actions button:disabled { opacity: 0.45; cursor: default; }
  .actions .primary { background: var(--app-focus-ring); color: var(--app-text-on-accent); }
  .actions .primary:not(:disabled):hover { background: var(--app-accent-hover); }
  .actions .ghost { background: transparent; color: var(--app-text-muted); border-color: var(--app-border); }
  .actions .ghost:not(:disabled):hover { background: var(--app-surface-hover); color: var(--app-text); }
</style>
