<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { isDesktop } from "$lib/platform";
  import { api } from "$lib/api";
  import type { TemplateInfo } from "$lib/api";
  import { trapFocus } from "$lib/a11y";

  let {
    open = $bindable(false),
    onCreated,
    onClosed,
    triggerEl,
  }: {
    open?: boolean;
    /** Called with the created project folder so the host can open it. */
    onCreated?: (projectDir: string) => void;
    /**
     * Called after the dialog closes and focus was (attempted to be) returned
     * to `triggerEl`. Hosts whose opener isn't focusable at close time — e.g.
     * the start screen, whose workspace is inert — refocus their own surface.
     */
    onClosed?: () => void;
    triggerEl?: HTMLButtonElement | undefined;
  } = $props();

  // Single screen (UX audit P3#10): name, author, template, folder and history
  // are one short form — no Continue/Back step split.
  let name = $state("");
  let author = $state("");
  let parentDir = $state<string | null>(null);
  let useVersionHistory = $state(true);

  // Template selection (#29). Built-in + custom templates, loaded on open.
  let templates = $state<TemplateInfo[]>([]);
  let selectedTemplate = $state<TemplateInfo | null>(null);
  let importing = $state(false);

  const BUILTIN_IDS = ["book", "ttrpg", "zine", "technical"];

  async function loadTemplates() {
    try {
      const builtins = await api.tpl.listBuiltIn();
      let customs: TemplateInfo[] = [];
      try {
        customs = await api.tpl.listCustom();
      } catch {
        customs = [];
      }
      templates = [...builtins, ...customs];
      // Default to the "book" built-in (or the first template available).
      selectedTemplate =
        templates.find((t) => t.id === "book") ?? templates[0] ?? null;
    } catch {
      templates = [];
      selectedTemplate = null;
    }
  }

  async function importTemplate() {
    if (!isDesktop()) return;
    importing = true;
    error = null;
    try {
      const imported = await api.tpl.importFromFolder();
      if (imported) {
        await loadTemplates();
        selectedTemplate = templates.find((t) => t.id === imported.id) ?? imported;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      importing = false;
    }
  }

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

  let nameValid = $derived(name.trim().length > 0 && folderPreview.length > 0);
  let canCreate = $derived(nameValid && !!parentDir && !creating);

  function reset() {
    name = "";
    author = "";
    parentDir = null;
    useVersionHistory = true;
    creating = false;
    error = null;
  }

  /** Open the wizard (a user gesture from the parent) — resets + loads templates.
   *  No `$effect` on `open`, matching the other dialogs' show() pattern. */
  export function show(trigger?: HTMLButtonElement): void {
    if (trigger) triggerEl = trigger;
    reset();
    open = true;
    void loadTemplates();
    queueMicrotask(() => nameInput?.focus());
  }

  function close() {
    open = false;
    triggerEl?.focus();
    onClosed?.();
  }

  async function chooseLocation() {
    if (!isDesktop()) {
      error = "Creating a project needs the desktop app.";
      return;
    }
    error = null;
    try {
      const pathStr = await api.dialog.openDirectory();
      if (pathStr) parentDir = pathStr;
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
      const tpl = selectedTemplate;
      const result = await api.app.createProject({
        name: name.trim(),
        author: author.trim() || undefined,
        parentDir,
        // Built-in templates pass an id; custom templates pass the directory.
        template:
          tpl && tpl.kind === "builtin" && BUILTIN_IDS.includes(tpl.id)
            ? (tpl.id as "book" | "ttrpg" | "zine" | "technical")
            : undefined,
        templateDir: tpl && tpl.kind === "custom" ? tpl.dir : undefined,
        versionHistory: useVersionHistory ? "local-git" : "none",
      }) as { projectDir: string };
      // Successful create goes through close() like every other dismiss path,
      // so the onClosed/triggerEl focus-restore contract holds on success too.
      close();
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
    onkeydown={(e) => trapFocus(e, dialogEl)}
  >
    <header class="dialog-header">
      <h2 id="new-project-title">Create a new book</h2>
      <button class="close" onclick={close} title="Close (Esc)" aria-label="Close"><Icon name="x" size={16} /></button>
    </header>

    <div class="dialog-body">
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
          onkeydown={(e) => { if (e.key === "Enter" && canCreate) { e.preventDefault(); void create(); } }}
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
          onkeydown={(e) => { if (e.key === "Enter" && canCreate) { e.preventDefault(); void create(); } }}
        />
      </label>

      {#if templates.length > 0}
        <div class="field">
          <span>Start from a template</span>
          <ul class="template-list" role="radiogroup" aria-label="Project template">
            {#each templates as tpl (tpl.kind + ":" + tpl.id)}
              <li>
                <button
                  type="button"
                  class="template-card"
                  class:selected={selectedTemplate?.id === tpl.id && selectedTemplate?.kind === tpl.kind}
                  role="radio"
                  aria-checked={selectedTemplate?.id === tpl.id && selectedTemplate?.kind === tpl.kind}
                  onclick={() => (selectedTemplate = tpl)}
                >
                  <span class="template-label">
                    {tpl.label}
                    {#if tpl.kind === "custom"}<em class="template-tag">custom</em>{/if}
                  </span>
                  <span class="template-desc">{tpl.description}</span>
                </button>
              </li>
            {/each}
          </ul>
          {#if isDesktop()}
            <button type="button" class="import-tpl" onclick={importTemplate} disabled={importing}>
              {importing ? "Importing…" : "Import template from folder…"}
            </button>
          {/if}
        </div>
      {/if}

      <div class="field">
        <span>Where should we save it?</span>
        <div class="location-row">
          <button class="ghost browse" onclick={chooseLocation} disabled={creating}>
            Choose folder…
          </button>
          {#if parentDir}
            <span class="location-path" title={parentDir}>{parentDir}{folderPreview ? `/${folderPreview}` : ""}</span>
          {:else}
            <span class="location-empty">No folder chosen yet</span>
          {/if}
        </div>
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
        <button class="ghost" onclick={close}>Cancel</button>
        <button class="primary" onclick={create} disabled={!canCreate}>
          {creating ? "Creating…" : "Create book"}
        </button>
      </footer>
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
  .template-list {
    list-style: none; margin: 0; padding: 0;
    display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
  }
  .template-card {
    display: flex; flex-direction: column; gap: 3px; width: 100%;
    text-align: left; padding: 8px 10px; border-radius: 6px;
    background: var(--app-surface-sunken); border: 1px solid var(--app-border);
    color: var(--app-text-secondary); cursor: pointer;
  }
  .template-card:hover { background: var(--app-surface-hover); }
  .template-card.selected { border-color: var(--app-focus-ring); background: var(--app-surface-hover); }
  .template-card:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }
  .template-label { font-size: 13px; font-weight: 600; color: var(--app-text); display: flex; align-items: center; gap: 6px; }
  .template-tag { font-size: 10px; font-style: normal; text-transform: uppercase; letter-spacing: 0.04em; color: var(--app-text-faint); border: 1px solid var(--app-border); border-radius: 3px; padding: 0 4px; }
  .template-desc { font-size: 11px; color: var(--app-text-faint); line-height: 1.35; }
  .import-tpl {
    align-self: flex-start; margin-top: 2px; background: transparent;
    border: 1px solid var(--app-border); border-radius: 5px; cursor: pointer;
    color: var(--app-text-muted); font-size: 12px; padding: 5px 10px;
  }
  .import-tpl:hover:not(:disabled) { background: var(--app-surface-hover); color: var(--app-text); }
  .import-tpl:disabled { opacity: 0.5; cursor: default; }

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
