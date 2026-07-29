<script lang="ts">
  /**
   * SnippetPicker (#29) — pick a reusable markdown snippet and insert it at the
   * editor cursor, prompting for any `{{variable}}` placeholders first.
   *
   * Architecture:
   * - Snippets live in the open project's `snippets/` folder. The host does the
   *   file IO via `api.snip.*` server routes. The
   *   variable substitution is pure renderer code (`snippet-vars.ts`) so no Node
   *   lib is pulled into the SPA bundle (§8 / ADR 0004).
   * - The component owns no editor knowledge: it calls `onInsert(text)` with the
   *   final text and `getSelectionText()` to seed "Save selection as snippet".
   * - Desktop-only in v1 (file IO host gate); the trigger is hidden on web.
   *
   * Delete (M25) is a two-step inline confirm — the trash button arms on the
   * first click ("Delete?" in place, no separate element popping up under
   * the cursor) and a Cancel button appears alongside it; a second click on
   * the (now armed) trash button actually deletes. Mirrors
   * CrashRecoveryDialog's Discard button via the shared
   * `requestInlineConfirm`/`cancelInlineConfirm` helpers (`$lib/dialog`).
   */
  import Icon from "$lib/components/Icon.svelte";
  import { api } from "$lib/api";
  import type { SnippetEntry } from "$lib/api";
  import { extractVariables, substituteVariables } from "$lib/editor/snippet-vars";
  import {
    dialogBehavior,
    requestInlineConfirm,
    cancelInlineConfirm,
    type InlineConfirmState,
  } from "$lib/dialog";

  let {
    open = $bindable(false),
    projectDir,
    /** Insert the resolved snippet text at the editor cursor. */
    onInsert,
    /** Read the editor's current selection (for "Save as snippet"). */
    getSelectionText,
  }: {
    open?: boolean;
    projectDir: string | null;
    onInsert: (text: string) => void;
    getSelectionText?: () => string;
  } = $props();

  // The button that opened the picker — focus is restored to it on close.
  let triggerEl = $state<HTMLButtonElement | undefined>(undefined);

  type Mode = "list" | "vars" | "save";
  let mode = $state<Mode>("list");

  let snippets = $state<SnippetEntry[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  // Variable-prompt step state.
  let activeBody = $state("");
  let activeVars = $state<string[]>([]);
  let varValues = $state<Record<string, string>>({});

  // Save-as-snippet step state.
  let saveName = $state("");
  let saveBody = $state("");

  let dialogEl = $state<HTMLDivElement | undefined>(undefined);

  /**
   * Open the picker and load the project's snippets (#29). Called directly from
   * the parent's trigger handler (a user gesture) — no `$effect` reaction on
   * `open`, per the runes-mode rule. Records the trigger element for focus
   * restoration on close.
   */
  export async function show(trigger?: HTMLButtonElement): Promise<void> {
    if (trigger) triggerEl = trigger;
    open = true;
    await refresh();
    queueMicrotask(() =>
      dialogEl?.querySelector<HTMLElement>("button, input")?.focus(),
    );
  }

  async function refresh() {
    if (!projectDir) {
      snippets = [];
      return;
    }
    mode = "list";
    error = null;
    loading = true;
    try {
      snippets = await api.snip.list(projectDir);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      snippets = [];
    } finally {
      loading = false;
    }
  }

  function close() {
    // Focus restoration to `triggerEl` is handled by the dialogBehavior action.
    open = false;
  }

  async function choose(entry: SnippetEntry) {
    if (!projectDir) return;
    error = null;
    try {
      const body = await api.snip.read(projectDir, entry.fileName);
      const vars = extractVariables(body);
      if (vars.length === 0) {
        onInsert(body);
        close();
        return;
      }
      activeBody = body;
      activeVars = vars;
      varValues = Object.fromEntries(vars.map((v) => [v, ""]));
      mode = "vars";
      queueMicrotask(() =>
        dialogEl?.querySelector<HTMLInputElement>("input.var-input")?.focus(),
      );
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  function confirmVars() {
    onInsert(substituteVariables(activeBody, varValues));
    close();
  }

  function startSave() {
    saveBody = getSelectionText?.() ?? "";
    saveName = "";
    error = null;
    mode = "save";
    queueMicrotask(() =>
      dialogEl?.querySelector<HTMLInputElement>("input.save-name")?.focus(),
    );
  }

  async function confirmSave() {
    if (!projectDir) return;
    if (!saveName.trim()) {
      error = "Give your snippet a name.";
      return;
    }
    if (!saveBody.trim()) {
      error = "A snippet needs some content.";
      return;
    }
    error = null;
    try {
      await api.snip.save(projectDir, saveName.trim(), saveBody);
      await refresh();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function remove(entry: SnippetEntry) {
    if (!projectDir) return;
    try {
      await api.snip.delete(projectDir, entry.fileName);
      await refresh();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  // ── Two-step delete confirm (M25) ───────────────────────────────────────
  let confirmDelete = $state<InlineConfirmState>({});

  function requestDelete(entry: SnippetEntry) {
    const { state, confirmed } = requestInlineConfirm(confirmDelete, entry.fileName);
    confirmDelete = state;
    if (confirmed) void remove(entry);
  }

  /** Cancelling returns focus to the (now-unarmed) trash button — the
   *  Cancel button itself is removed from the DOM on click, so without this
   *  focus would drop to <body>. */
  function cancelDelete(entry: SnippetEntry, event: MouseEvent) {
    confirmDelete = cancelInlineConfirm(confirmDelete, entry.fileName);
    const row = (event.currentTarget as HTMLElement).closest("li");
    queueMicrotask(() => row?.querySelector<HTMLButtonElement>(".snippet-del")?.focus());
  }
</script>

{#if open}
  <div class="dlg-backdrop" onclick={close} role="presentation"></div>

  <div
    bind:this={dialogEl}
    class="dlg-shell"
    use:dialogBehavior={{ onClose: close, triggerEl, labelledBy: "snippet-picker-title" }}
  >
    <header class="dlg-header">
      <h2 id="snippet-picker-title">
        {#if mode === "list"}Snippets{:else if mode === "vars"}Fill in the snippet{:else}Save as snippet{/if}
      </h2>
      <button class="dlg-close" onclick={close} title="Close (Esc)" aria-label="Close">
        <Icon name="x" size={16} />
      </button>
    </header>

    <div class="dialog-body">
      {#if error}
        <p class="error" role="alert">{error}</p>
      {/if}

      {#if mode === "list"}
        {#if loading}
          <p class="muted">Loading…</p>
        {:else if snippets.length === 0}
          <p class="muted">
            No snippets yet. Select some text in the editor and choose
            “Save selection as snippet” to create one.
          </p>
        {:else}
          <ul class="snippet-list">
            {#each snippets as entry (entry.fileName)}
              {@const armed = confirmDelete[entry.fileName] ?? false}
              <li>
                <button class="snippet-row" onclick={() => choose(entry)} title={`Insert “${entry.name}” at the cursor`}>
                  <span class="snippet-name">{entry.name}</span>
                  <span class="snippet-row-end">
                    {#if entry.variables.length > 0}
                      <span class="snippet-vars">{entry.variables.length} field{entry.variables.length === 1 ? "" : "s"}</span>
                    {/if}
                    <span class="snippet-insert">Insert</span>
                    <Icon name="chevron-right" size={14} />
                  </span>
                </button>
                <!-- Single persistent button (M25) — arming the confirm only
                     swaps its label/class in place so the first click never
                     loses focus. -->
                <button
                  class="snippet-del"
                  class:dlg-danger-armed={armed}
                  title={armed ? "Click again to permanently delete" : "Delete snippet"}
                  aria-label={armed ? `Really delete ${entry.name}? This can't be undone.` : `Delete ${entry.name}`}
                  onclick={() => requestDelete(entry)}
                >
                  {#if armed}
                    <span class="snippet-del-confirm">Delete?</span>
                  {:else}
                    <Icon name="trash" size={14} />
                  {/if}
                </button>
                {#if armed}
                  <button class="snippet-del-cancel" onclick={(e) => cancelDelete(entry, e)}>Cancel</button>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
        <footer class="dlg-actions">
          <button class="dlg-ghost" onclick={close}>Close</button>
          <button class="dlg-primary app-btn-primary" onclick={startSave}>Save selection as snippet</button>
        </footer>
      {:else if mode === "vars"}
        <p class="muted">Enter values for this snippet, then insert it.</p>
        {#each activeVars as v (v)}
          <label class="field">
            <span>{v}</span>
            <input class="var-input" type="text" bind:value={varValues[v]} autocomplete="off" />
          </label>
        {/each}
        <footer class="dlg-actions">
          <button class="dlg-ghost" onclick={() => (mode = "list")}>Back</button>
          <button class="dlg-primary app-btn-primary" onclick={confirmVars}>Insert</button>
        </footer>
      {:else}
        <label class="field">
          <span>Snippet name</span>
          <input class="save-name" type="text" bind:value={saveName} placeholder="Callout" autocomplete="off" />
        </label>
        <label class="field">
          <span>Content <em class="optional">(use <code>{"{{name}}"}</code> for fill-in fields)</em></span>
          <textarea class="save-body" bind:value={saveBody} rows="6"></textarea>
        </label>
        <footer class="dlg-actions">
          <button class="dlg-ghost" onclick={() => (mode = "list")}>Back</button>
          <button class="dlg-primary app-btn-primary" onclick={confirmSave}>Save snippet</button>
        </footer>
      {/if}
    </div>
  </div>
{/if}

<style>
  @import "$lib/styles/dialog-shell.css";

  .dlg-shell {
    width: min(480px, 94vw);
    max-height: 80vh;
  }
  .dialog-body { padding: 18px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto; flex: 1; }
  .muted { margin: 0; font-size: 13px; color: var(--app-text-muted); }
  .error { color: var(--app-error-text); font-size: 12px; margin: 0; }
  .snippet-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .snippet-list li { display: flex; align-items: stretch; gap: 4px; }
  /* A clickable list item, NOT a text input — distinct from the sunken input
     styling so authors see it affords "insert at cursor" (the core action). */
  .snippet-row {
    flex: 1; display: flex; align-items: center; justify-content: space-between;
    gap: 10px; text-align: left; padding: 8px 10px; border-radius: 6px;
    background: var(--app-surface); border: 1px solid var(--app-border);
    color: var(--app-text); cursor: pointer; font-size: 13px; font-weight: 500;
  }
  .snippet-row:hover {
    background: var(--app-surface-hover);
    border-color: var(--app-accent);
  }
  .snippet-row:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }
  .snippet-row-end { display: flex; align-items: center; gap: 8px; color: var(--app-text-muted); }
  /* "Insert" hint stays subtle until hover/focus so the row reads clean at rest. */
  .snippet-insert { font-size: 11px; font-weight: 600; opacity: 0; transition: opacity 0.12s; }
  .snippet-row:hover .snippet-insert,
  .snippet-row:focus-visible .snippet-insert { opacity: 1; color: var(--app-accent); }
  .snippet-vars { font-size: 11px; color: var(--app-text-muted); }
  .snippet-del {
    background: transparent; border: 1px solid var(--app-border); border-radius: 6px;
    color: var(--app-text-muted); cursor: pointer; padding: 0 8px; min-width: 32px;
    font-size: 11px; font-weight: 600; white-space: nowrap;
  }
  /* FIX ROUND 1: the base `.snippet-del` rule above sets background/border/
     color longhands scoped to this component (Svelte's hash raises it to
     0,2,0), which otherwise outranks the imported `.dlg-danger-armed`
     (0,1,0) and leaves the armed "Delete?" button with zero red. Restate
     the danger tokens here, scoped + more specific (0,3,0), so arming wins. */
  .snippet-del.dlg-danger-armed {
    background: var(--app-error-bg);
    border-color: var(--app-error-border);
    color: var(--app-error-text);
  }
  .snippet-del:hover:not(.dlg-danger-armed) { color: var(--app-error-text); background: var(--app-surface-hover); }
  .snippet-del:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }
  .snippet-del-confirm { padding: 0 2px; }
  .snippet-del-cancel {
    background: transparent; border: 1px solid var(--app-border); border-radius: 6px;
    color: var(--app-text-muted); cursor: pointer; padding: 0 10px; font-size: 11px;
  }
  .snippet-del-cancel:hover { background: var(--app-surface-hover); color: var(--app-text); }
  .snippet-del-cancel:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }
  .field { display: flex; flex-direction: column; gap: 6px; }
  .field > span { font-size: 12px; color: var(--app-text-muted); font-weight: 500; }
  .optional { font-style: italic; color: var(--app-text-muted); font-weight: 400; }
  .field input[type="text"], .save-body {
    background: var(--app-surface-sunken); border: 1px solid var(--app-border);
    color: var(--app-text-secondary); padding: 8px 10px; border-radius: 6px;
    font-size: 14px; font-family: inherit;
  }
  .save-body { font-family: var(--app-font-mono); resize: vertical; }
  .field input:focus, .save-body:focus { outline: none; border-color: var(--app-focus-ring); }
  /* In-flow footer (last item inside the scrolling body, not a pinned
     sibling) — restore the original spacing; the shared default assumes a
     pinned bar. */
  .dlg-actions {
    padding-top: 14px;
    padding-left: 0;
    padding-right: 0;
    padding-bottom: 0;
    margin-top: 4px;
  }
  .dlg-actions button { padding: 7px 16px; }
</style>
