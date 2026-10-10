<script lang="ts">
  /**
   * SnippetPicker (#29) — pick a reusable markdown snippet and insert it at the
   * editor cursor, prompting for any `{{variable}}` placeholders first.
   *
   * Architecture:
   * - Snippets live in the open project's `snippets/` folder. The host does the
   *   file IO via `api.snip.*` server routes. The
   *   variable substitution is pure renderer code (`snippet-vars.ts`) so no Node
   *   lib is pulled into the SPA bundle (§8).
   * - The component owns no editor knowledge: it calls `onInsert(text)` with the
   *   final text and `getSelectionText()` to seed "Save selection as snippet".
   *
   * Delete is a two-step inline confirm — the trash button arms on the
   * first click ("Delete?" in place, no separate element popping up under
   * the cursor) and a Cancel button appears alongside it; a second click on
   * the (now armed) trash button actually deletes. Mirrors
   * CrashRecoveryDialog's Discard button via the shared
   * `requestInlineConfirm`/`cancelInlineConfirm` helpers (`$lib/dialog`).
   *
   * Levels — `api.snip.list` returns every snippet from every level (the
   * book's own, each enabled extension's, and core's), bodies included, each
   * with a `source`. Same-named snippets at different levels are all listed,
   * as cards in a responsive grid under one heading per level (`sections`);
   * only the book's can be deleted (the write path can't touch anything else
   * regardless). A card that is a component's example snippet shows its
   * `@name`.
   *
   * Finding one — a search box (focused on open) and level / "Components"
   * chips narrow the loaded list client-side (`snippet-filter.ts`); Enter in
   * the box inserts the first match. Arrow keys move between cards by their
   * on-screen position (`onGridKeydown`); Tab/Enter/Space work natively since
   * every card is a real button.
   */
  import Icon from "$lib/components/Icon.svelte";
  import { api } from "$lib/api";
  import type { SnippetEntry } from "$lib/api";
  import { extractVariables, substituteVariables } from "$lib/editor/snippet-vars";
  import {
    filterSnippets,
    firstMatch,
    groupSnippets,
    snippetPreview,
    type LevelFilter,
  } from "$lib/editor/snippet-filter";
  import { tick } from "svelte";
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

  /** `{#each}` identity: a file name is unique within its level only. */
  function rowKey(entry: SnippetEntry): string {
    return `${entry.source.kind === "extension" ? entry.source.ref : entry.source.kind}:${entry.fileName}`;
  }

  // Search + chips. Reset each time the picker opens (`show`).
  let query = $state("");
  let level = $state<LevelFilter>("all");
  let componentsOnly = $state(false);
  let filter = $derived({ query, level, componentsOnly });
  let visible = $derived(filterSnippets(snippets, filter));
  let sections = $derived(groupSnippets(visible));
  let isFiltered = $derived(query.trim() !== "" || level !== "all" || componentsOnly);

  // Only offer chips the loaded data can satisfy.
  let levelChips = $derived(
    (["project", "extension", "core"] as const).filter((k) => snippets.some((s) => s.source.kind === k)),
  );
  let hasComponents = $derived(snippets.some((s) => s.component));
  const LEVEL_LABEL = { project: "Book", extension: "Extension", core: "Core" } as const;

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
    query = "";
    level = "all";
    componentsOnly = false;
    await refresh();
    focusSearch();
  }

  async function focusSearch() {
    await tick();
    dialogEl?.querySelector<HTMLInputElement>("input.snippet-search")?.focus();
  }

  function backToList() {
    mode = "list";
    void focusSearch();
  }

  function clearFilters() {
    query = "";
    level = "all";
    componentsOnly = false;
    void focusSearch();
  }

  /** Enter in the search box inserts the first match; ArrowDown enters the grid. */
  function onSearchKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = firstMatch(snippets, filter);
      if (first) choose(first);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      cards()[0]?.focus();
    }
  }

  function cards(): HTMLButtonElement[] {
    return Array.from(dialogEl?.querySelectorAll<HTMLButtonElement>("button.snippet-main") ?? []);
  }

  /**
   * Arrow-key navigation across the grid, by on-screen position so it follows
   * however many columns the width gives: Left/Right step through the cards in
   * reading order; Up/Down go to the nearest card in the adjacent row (Up from
   * the top row returns to the search box).
   */
  function onGridKeydown(e: KeyboardEvent) {
    const key = e.key;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) return;
    const current = (e.target as HTMLElement).closest<HTMLButtonElement>("button.snippet-main");
    if (!current) return;
    e.preventDefault();
    const all = cards();
    const i = all.indexOf(current);
    if (key === "ArrowLeft" || key === "ArrowRight") {
      all[i + (key === "ArrowRight" ? 1 : -1)]?.focus();
      return;
    }
    const down = key === "ArrowDown";
    const here = current.getBoundingClientRect();
    const rows = all
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => (down ? r.top > here.top + 1 : r.top < here.top - 1));
    if (rows.length === 0) {
      if (!down) dialogEl?.querySelector<HTMLInputElement>("input.snippet-search")?.focus();
      return;
    }
    const rowTop = down ? Math.min(...rows.map(({ r }) => r.top)) : Math.max(...rows.map(({ r }) => r.top));
    rows
      .filter(({ r }) => Math.abs(r.top - rowTop) < 1)
      .sort((a, b) => Math.abs(a.r.left - here.left) - Math.abs(b.r.left - here.left))[0]
      ?.el.focus();
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

  /** Insert the snippet now, or prompt for its `{{variables}}` first. */
  function choose(entry: SnippetEntry) {
    error = null;
    const body = entry.body;
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

  // ── Two-step delete confirm ─────────────────────────────────────────────
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
    const card = (event.currentTarget as HTMLElement).closest(".snippet-card");
    queueMicrotask(() => card?.querySelector<HTMLButtonElement>(".snippet-del")?.focus());
  }
</script>

{#if open}
  <div class="dlg-backdrop" onclick={close} role="presentation"></div>

  <div
    bind:this={dialogEl}
    class="dlg-shell"
    class:wide={mode === "list"}
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
          <!-- Search + chips ride at the top of the scrolling body (sticky), so
               they stay in reach however far the grid is scrolled. -->
          <div class="snippet-toolbar">
            <div class="snippet-search-wrap">
              <Icon name="search" size={14} />
              <input
                class="snippet-search"
                type="text"
                bind:value={query}
                onkeydown={onSearchKeydown}
                placeholder="Search snippets…"
                aria-label="Search snippets"
                autocomplete="off"
                spellcheck="false"
              />
              <span class="snippet-count" aria-live="polite">
                {visible.length}{isFiltered ? ` of ${snippets.length}` : ""}
              </span>
            </div>
            {#if levelChips.length > 1 || hasComponents}
              <div class="snippet-chips" role="group" aria-label="Filter snippets">
                {#if levelChips.length > 1}
                  <button class="snippet-chip" aria-pressed={level === "all"} onclick={() => (level = "all")}>All</button>
                  {#each levelChips as k (k)}
                    <button class="snippet-chip" aria-pressed={level === k} onclick={() => (level = k)}>{LEVEL_LABEL[k]}</button>
                  {/each}
                {/if}
                {#if hasComponents}
                  <button class="snippet-chip" aria-pressed={componentsOnly} onclick={() => (componentsOnly = !componentsOnly)}>
                    Components only
                  </button>
                {/if}
              </div>
            {/if}
          </div>

          {#if visible.length === 0}
            <div class="snippet-empty" role="status">
              <p>
                Nothing matches{query.trim() ? ` “${query.trim()}”` : " those filters"}.
                Try a different word, or clear the filters to see every snippet.
              </p>
              <button class="snippet-clear" onclick={clearFilters}>Clear filters</button>
            </div>
          {:else}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="snippet-sections" onkeydown={onGridKeydown}>
              {#each sections as section (section.key)}
                <section aria-labelledby={`snippet-h-${section.key}`}>
                  <h3 class="snippet-group-header" id={`snippet-h-${section.key}`}>
                    {section.kind === "extension" ? section.extensionName : LEVEL_LABEL[section.kind]}
                    <span class="snippet-group-hint">
                      {#if section.kind === "project"}your book · editable
                      {:else if section.kind === "extension"}extension · read-only
                      {:else}Gutterpress · read-only{/if}
                    </span>
                  </h3>
                  <ul class="snippet-grid">
                    {#each section.entries as entry (rowKey(entry))}
                      <!-- The two-step delete confirm stays keyed by `fileName`
                           alone — it is only ever armed for a project-sourced
                           card (see the delete button's own {#if} below), and
                           project fileNames are unique among themselves. -->
                      {@const armed = confirmDelete[entry.fileName] ?? false}
                      <li class="snippet-card" class:has-del={entry.source.kind === "project"}>
                        <button class="snippet-main" onclick={() => choose(entry)} title={`Insert “${entry.name}” at the cursor`}>
                          <span class="snippet-name">{entry.name}</span>
                          <span class="snippet-meta">
                            <span class="snippet-level">{LEVEL_LABEL[entry.source.kind]}</span>
                            {#if entry.component}
                              <span class="dlg-badge snippet-component" title="The example for the @{entry.component} component">@{entry.component}</span>
                            {/if}
                            {#if entry.variables.length > 0}
                              <span class="snippet-fields">{entry.variables.length} field{entry.variables.length === 1 ? "" : "s"}</span>
                            {/if}
                          </span>
                          <span class="snippet-preview">{snippetPreview(entry.body)}</span>
                        </button>
                        <!-- An extension- or core-provided snippet is READ-ONLY
                             in the picker — no delete affordance at all (there
                             was never an in-place "edit" affordance for ANY
                             snippet here, only Insert / Delete / Save-as-new,
                             so omitting Delete keeps the picker from silently
                             modifying a file inside an installed extension's
                             folder — see this file's header comment). -->
                        {#if entry.source.kind === "project"}
                          <!-- A sibling of the card button (a button can't nest
                               a button), pinned to its top-right corner. A single
                               persistent button — arming the confirm only swaps
                               its label/class in place so the first click never
                               loses focus. -->
                          <div class="snippet-del-wrap" class:armed>
                            {#if armed}
                              <button class="snippet-del-cancel" onclick={(e) => cancelDelete(entry, e)}>Cancel</button>
                            {/if}
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
                          </div>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                </section>
              {/each}
            </div>
          {/if}
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
          <button class="dlg-ghost" onclick={backToList}>Back</button>
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
          <button class="dlg-ghost" onclick={backToList}>Back</button>
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
  /* The list wants room for a 3-column card grid; the fill-in and save steps
     are short forms and keep the narrow frame. */
  .dlg-shell.wide { width: min(860px, 94vw); max-height: 84vh; }
  .dialog-body { padding: 18px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto; flex: 1; }
  .muted { margin: 0; font-size: 13px; color: var(--app-text-muted); }
  .error { color: var(--app-error-text); font-size: 12px; margin: 0; }

  /* Search + chips — sticky at the top of the scrolling body (negative margins
     cancel the body's padding so the bar spans edge to edge). */
  .snippet-toolbar {
    position: sticky; top: -18px; z-index: 1;
    margin: -18px -18px 0; padding: 14px 18px 12px;
    background: var(--app-surface); border-bottom: 1px solid var(--app-border-subtle);
    display: flex; flex-direction: column; gap: 10px;
  }
  .snippet-search-wrap {
    display: flex; align-items: center; gap: 8px; padding: 0 10px;
    background: var(--app-surface-sunken); border: 1px solid var(--app-border); border-radius: 6px;
    color: var(--app-text-muted);
  }
  .snippet-search-wrap:focus-within { border-color: var(--app-focus-ring); }
  .snippet-search {
    flex: 1; min-width: 0; padding: 8px 0; border: none; outline: none; background: transparent;
    color: var(--app-text); font-size: 14px; font-family: inherit;
  }
  .snippet-search::placeholder { color: var(--app-text-muted); }
  .snippet-count { font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .snippet-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .snippet-chip {
    padding: 3px 11px; border-radius: 999px; font-size: 12px; font-weight: 500; cursor: pointer;
    background: transparent; border: 1px solid var(--app-border); color: var(--app-text-muted);
  }
  .snippet-chip:hover { background: var(--app-surface-hover); color: var(--app-text); }
  .snippet-chip[aria-pressed="true"] {
    background: var(--app-surface-hover); border-color: var(--app-accent); color: var(--app-text);
  }
  .snippet-chip:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }

  .snippet-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 28px 12px; text-align: center; }
  .snippet-empty p { margin: 0; max-width: 340px; font-size: 13px; line-height: 1.5; color: var(--app-text-muted); }

  .snippet-clear {
    padding: 5px 14px; border-radius: 6px; font-size: 12px; cursor: pointer;
    background: transparent; border: 1px solid var(--app-border); color: var(--app-text-muted);
  }
  .snippet-clear:hover { background: var(--app-surface-hover); color: var(--app-text); }
  .snippet-clear:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }

  .snippet-sections { display: flex; flex-direction: column; gap: 18px; }
  /* A level heading ("Book" / "<Extension>" / "Core") over its grid. */
  .snippet-group-header {
    margin: 0 0 8px; padding: 0 2px; display: flex; align-items: baseline; gap: 8px;
    font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
    color: var(--app-text);
  }
  .snippet-group-hint { font-size: 11px; font-weight: 400; text-transform: none; letter-spacing: 0; color: var(--app-text-muted); }
  /* 3 columns at the full modal width, 2 below ~690px, 1 below ~450px. */
  .snippet-grid {
    list-style: none; margin: 0; padding: 0; display: grid; gap: 10px;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 210px), 1fr));
  }
  .snippet-card { position: relative; display: flex; min-width: 0; }
  /* A clickable card, NOT a text input — distinct from the sunken input
     styling so authors see it affords "insert at cursor" (the core action). */
  .snippet-main {
    flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
    text-align: left; padding: 10px 12px; border-radius: 8px; font-family: inherit;
    background: var(--app-surface); border: 1px solid var(--app-border);
    color: var(--app-text); cursor: pointer;
  }
  .snippet-main:hover { background: var(--app-surface-hover); border-color: var(--app-accent); }
  .snippet-main:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; border-color: var(--app-accent); }
  .snippet-name {
    max-width: 100%; font-size: 13px; font-weight: 600; line-height: 1.3;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .has-del .snippet-name { padding-right: 26px; }
  .snippet-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; min-height: 18px; }
  .snippet-level { font-size: 11px; color: var(--app-text-muted); }
  .snippet-component { color: var(--app-text); background: var(--app-surface-hover); border-color: var(--app-accent); text-transform: none; letter-spacing: 0; }
  .snippet-fields { font-size: 11px; color: var(--app-text-muted); }
  /* Up to three lines; grid rows stretch, so cards in a row share a height. */
  .snippet-preview {
    font-size: 12px; line-height: 1.45; color: var(--app-text-muted);
    display: -webkit-box; -webkit-box-orient: vertical; line-clamp: 3; -webkit-line-clamp: 3;
    overflow: hidden; overflow-wrap: anywhere;
  }
  .snippet-del-wrap { position: absolute; top: 6px; right: 6px; display: flex; gap: 4px; }
  .snippet-del {
    background: transparent; border: 1px solid transparent; border-radius: 6px;
    color: var(--app-text-muted); cursor: pointer; padding: 3px 6px; min-width: 26px;
    font-size: 11px; font-weight: 600; white-space: nowrap; line-height: 1;
    opacity: 0; transition: opacity 0.12s;
  }
  /* Hidden at rest so the card reads clean; revealed on hover/focus, and kept
     visible while armed. (`:focus-within` also covers keyboard users.) */
  .snippet-card:hover .snippet-del,
  .snippet-card:focus-within .snippet-del,
  .snippet-del.dlg-danger-armed { opacity: 1; }
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
    background: var(--app-surface); border: 1px solid var(--app-border); border-radius: 6px;
    color: var(--app-text-muted); cursor: pointer; padding: 3px 10px; font-size: 11px; line-height: 1;
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
