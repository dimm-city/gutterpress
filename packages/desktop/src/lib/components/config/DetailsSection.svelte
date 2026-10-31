<script lang="ts">
  /**
   * Book setup › Book: what the book is — title, authors, page size and
   * margins, the print checks, the chapters — and Save as template. Every
   * field writes the manifest and nothing else. It saves as you go: a choice
   * commits at once; a text field commits on `change` (blur or Enter) via
   * `controller.flushPendingSave`. All state + `api.manifest.*` calls live in
   * `DetailsSectionController` (passed as the single `controller` prop); this
   * child renders the controller's rune fields and calls its intent methods
   * directly (plain text fields bind straight to controller fields via
   * `bind:value`). Shared primitives (`.block`, `.input`, buttons, …) come
   * from `config-section-shared.css`; the Book-only layout is scoped here.
   *
   * Chapters lead with their titles. The book's chapters come first, in
   * reading order, with drag and ↑/↓ (the single-pointer and keyboard path,
   * WCAG 2.5.7); the files left out follow under "Not in the book".
   */
  import { tick } from "svelte";
  import Icon from "#lib/components/Icon.svelte";
  import PageSizeFields from "#lib/components/PageSizeFields.svelte";
  import { PRESET_CHOICES } from "#lib/page-size-choices.ts";
  import {
    MARGIN_EDGES,
    type DetailsSectionController,
    type MarginEdge,
  } from "#lib/routes/details-section-controller.svelte.ts";
  import {
    PUBLISH_TARGET_CHOICES,
    missingToolsForTargets,
    toolGapMessage,
  } from "#lib/publish-targets.ts";

  let {
    controller,
    onSaveAsTemplate,
  }: {
    controller: DetailsSectionController;
    /** Open the Save-as-template dialog (owned by ProjectSettingsView). */
    onSaveAsTemplate?: (triggerEl: HTMLButtonElement) => void;
  } = $props();

  // The tool-gap explanation for the CHECKED destinations (null when nothing
  // checked needs a tool this computer lacks).
  const targetToolGap = $derived(
    toolGapMessage(
      missingToolsForTargets(controller.targetsDraft, controller.missingTools),
    ),
  );

  // The margin fields, in reading order; "Inside" is the binding edge.
  const MARGIN_LABELS: Record<MarginEdge, string> = {
    top: "Top",
    bottom: "Bottom",
    inside: "Inside",
    outside: "Outside",
  };

  // Where the margins shown come from, until the author records their own.
  const marginsSource = $derived.by(() => {
    switch (controller.pageSetup?.marginsFrom) {
      case "stylesheet":
        return "These are your look's margins.";
      case "default":
        return "These are the default margins.";
      default:
        return "";
    }
  });

  // The book's chapters (in reading order, first in the list) and the files
  // left out (after them): `setSourceIncluded` keeps the two groups apart.
  const inBook = $derived(controller.sourceFiles.filter((e) => e.included).length);
  let chaptersEl = $state<HTMLElement | null>(null);

  /** Tick or untick a chapter; it moves group, and the focus moves with it. */
  async function include(i: number, on: boolean) {
    const path = controller.sourceFiles[i]?.path;
    controller.setSourceIncluded(i, on);
    await tick();
    if (path) chaptersEl?.querySelector<HTMLInputElement>(`input[data-path="${CSS.escape(path)}"]`)?.focus();
  }

  // ── Chapter drag-and-drop reorder (HTML5 DnD; the ↑/↓ buttons are the
  //    keyboard-accessible equivalent). The pure reorder model lives in
  //    source-files.ts via the controller's moveSourceFile intent. ────────────
  let dragIndex = $state<number | null>(null);
  let dropIndex = $state<number | null>(null);

  function onRowDragStart(e: DragEvent, i: number) {
    dragIndex = i;
    // The reorder is driven entirely by `dragIndex`; nothing reads the drag
    // data store, so we set no payload (Chromium starts the drag regardless).
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }
  function onRowDragOver(e: DragEvent, i: number) {
    if (dragIndex === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    dropIndex = i;
  }
  function onRowDrop(e: DragEvent, i: number) {
    e.preventDefault();
    if (dragIndex !== null) controller.moveSourceFile(dragIndex, i);
    dragIndex = null;
    dropIndex = null;
  }
  function onRowDragEnd() {
    dragIndex = null;
    dropIndex = null;
  }
</script>

<section class="block book">
  {#if controller.detailsError}
    <p class="error" role="alert">{controller.detailsError}</p>
  {/if}
  <div class="field">
    <label class="lbl" for="details-title">Title</label>
    <input
      id="details-title"
      class="input"
      type="text"
      bind:value={controller.titleDraft}
      onchange={() => controller.flushPendingSave()}
    />
  </div>
  <div class="field" role="group" aria-labelledby="details-authors">
    <span class="lbl" id="details-authors">Authors</span>
    {#each controller.authorsDraft as _, i (i)}
      <div class="author-row">
        <input
          class="input"
          type="text"
          value={controller.authorsDraft[i]}
          oninput={(e) => controller.setAuthor(i, e.currentTarget.value)}
          onchange={() => controller.flushPendingSave()}
          aria-label={`Author ${i + 1}`}
        />
        {#if controller.authorsDraft.length > 1}
          <button class="icon-btn" onclick={() => controller.removeAuthor(i)} title="Remove author" aria-label={`Remove author ${i + 1}`}>
            <Icon name="x" size={14} />
          </button>
        {/if}
      </div>
    {/each}
    <button class="link fit" onclick={controller.addAuthor}>+ Add another author</button>
  </div>

  <!-- Page size (#357): the wizard's "What size should the pages be?" choices
       (shared #lib/page-size-choices), changeable after the book exists. A
       choice writes the manifest's preset + bounds as soon as it is complete;
       the manifest is the only place the size lives. -->
  {#if controller.pageSetup}
    <fieldset class="group">
      <legend class="lbl">Page size</legend>
      {#each PRESET_CHOICES as choice (choice.id)}
        <label class="choice">
          <input
            type="radio"
            name="details-preset"
            checked={controller.presetDraft === choice.id}
            onchange={() => controller.setPreset(choice.id)}
          />
          <span class="choice-label">{choice.label}</span>
          <span class="choice-desc">{choice.description}</span>
        </label>
      {/each}
      {#if controller.presetDraft === "custom"}
        <!-- The size select's and the inches inputs' `change` bubbles here
             after the bound values updated, and commits; their `input` marks
             the size as edited, so closing before `change` (Escape) still
             saves it. PageSizeFields itself is shared with the wizard and
             stays a plain bindable component. -->
        <div
          class="size-fields"
          oninput={controller.touchPage}
          onchange={() => controller.flushPendingSave()}
        >
          <PageSizeFields
            idPrefix="details"
            bind:sizeChoice={controller.sizeChoice}
            bind:widthIn={controller.widthIn}
            bind:heightIn={controller.heightIn}
          />
        </div>
        {#if controller.pageIncomplete}
          <span class="hint">Enter a width and height to save the page size.</span>
        {/if}
      {/if}
    </fieldset>

    <!-- Page margins: the space between the trim and the text, typed in inches
         and recorded in the manifest (`page.margin`) over whatever a stylesheet
         gives. `input` marks them as the author's, so closing before a field's
         `change` (Escape) still saves them; `change` commits. -->
    <fieldset class="group">
      <legend class="lbl">Margins (inches)</legend>
      <div class="margin-fields" oninput={controller.touchMargins} onchange={() => controller.flushPendingSave()}>
        {#each MARGIN_EDGES as edge (edge)}
          <label class="margin-field" for={`details-margin-${edge}`}>
            <span>{MARGIN_LABELS[edge]}</span>
            <input
              id={`details-margin-${edge}`}
              class="input"
              type="number"
              min="0"
              step="0.05"
              bind:value={controller.marginDrafts[edge]}
              autocomplete="off"
            />
          </label>
        {/each}
      </div>
      {#if controller.marginsIncomplete}
        <span class="hint warn">Enter all four margins to save them.</span>
      {:else}
        <span class="hint">Inside is the edge at the binding. {marginsSource}</span>
      {/if}
      {#if controller.pageSetup?.marginsFrom === "manifest"}
        <!-- The way back: drop `page.margin`, and the fields show what the book then prints with. -->
        <button class="ghost small fit" type="button" onclick={controller.useFallbackMargins}>
          {controller.pageSetup.fallbackMarginsFrom === "stylesheet" ? "Use the look's margins" : "Use the default margins"}
        </button>
      {/if}
    </fieldset>
  {/if}

  <!-- Publish targets (ADR 0008): each one is a destination's validation
       policy. Same choices and wording as the new-book wizard (shared
       #lib/publish-targets) — its label and what checking against it does — so
       the two surfaces never describe a destination differently. -->
  <fieldset class="group">
    <legend class="lbl">Check the PDF against</legend>
    {#each PUBLISH_TARGET_CHOICES as choice (choice.id)}
      <label class="choice">
        <input
          type="checkbox"
          checked={controller.targetsDraft.includes(choice.id)}
          onchange={() => controller.toggleTarget(choice.id)}
        />
        <span class="choice-label">{choice.label}</span>
        <span class="choice-desc">{choice.description}</span>
      </label>
    {/each}
    {#if targetToolGap}
      <p class="tool-note" role="note">{targetToolGap}</p>
    {/if}
    <span class="hint">The general print checks always run.</span>
  </fieldset>

  <fieldset class="group" bind:this={chaptersEl}>
    <legend class="lbl">Chapters</legend>
    {#if controller.sourceFiles.length === 0}
      <p class="hint">This book has no chapters yet. Add one with <strong>New chapter</strong> in the Files panel.</p>
    {:else}
      <span class="hint">In reading order. Drag a chapter, or use its arrows, to move it.</span>
      <ul class="chapters">
        {#each controller.sourceFiles.slice(0, inBook) as entry, i (entry.path)}
          {@const title = controller.chapterTitle(entry.path)}
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <li
            class="chapter"
            class:dragging={dragIndex === i}
            class:drop-target={dropIndex === i && dragIndex !== i}
            draggable="true"
            ondragstart={(e) => onRowDragStart(e, i)}
            ondragover={(e) => onRowDragOver(e, i)}
            ondrop={(e) => onRowDrop(e, i)}
            ondragend={onRowDragEnd}
          >
            <span class="grip" aria-hidden="true"><Icon name="grip-vertical" size={13} /></span>
            <input
              type="checkbox"
              checked
              data-path={entry.path}
              onchange={() => include(i, false)}
              aria-label={`Include ${title} in the book`}
            />
            <span class="chapter-title">{title}</span>
            <span class="chapter-file">{entry.path}</span>
            {#if entry.missing}
              <span class="missing">File not found</span>
            {/if}
            <span class="row-move">
              <button class="icon-btn" onclick={() => controller.moveSourceFile(i, i - 1)} disabled={i === 0} title="Move up" aria-label={`Move ${title} up`}>
                <Icon name="chevron-up" size={14} />
              </button>
              <button class="icon-btn" onclick={() => controller.moveSourceFile(i, i + 1)} disabled={i === inBook - 1} title="Move down" aria-label={`Move ${title} down`}>
                <Icon name="chevron-down" size={14} />
              </button>
            </span>
          </li>
        {/each}
      </ul>
      {#if inBook < controller.sourceFiles.length}
        <h4 class="subhead">Not in the book</h4>
        <ul class="chapters">
          {#each controller.sourceFiles.slice(inBook) as entry, j (entry.path)}
            {@const title = controller.chapterTitle(entry.path)}
            <li class="chapter out">
              <input
                type="checkbox"
                data-path={entry.path}
                onchange={() => include(inBook + j, true)}
                aria-label={`Add ${title} to the book`}
              />
              <span class="chapter-title">{title}</span>
              <span class="chapter-file">{entry.path}</span>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </fieldset>

  <div class="row template">
    <button class="ghost small" onclick={(e) => onSaveAsTemplate?.(e.currentTarget as HTMLButtonElement)}>Save as template…</button>
    <span class="hint">Start new books with this book's look, page and extras.</span>
  </div>
</section>

<style>
  @import "../../styles/config-section-shared.css";

  .book { gap: 16px; }
  .group { margin: 0; padding: 0; border: 0; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .group legend { margin-bottom: 4px; }
  .author-row { display: flex; gap: 4px; align-items: center; }
  .author-row .input { flex: 1; }

  /* A radio or checkbox, its name, and (for a page size) what it means, on one line. */
  .choice { display: flex; align-items: baseline; gap: 8px; cursor: pointer; font-size: 13px; }
  .choice input { margin: 0; flex-shrink: 0; align-self: center; }
  .choice-label { color: var(--app-text); min-width: 150px; }
  .choice-desc { font-size: 12px; color: var(--app-text-muted); }
  .tool-note { margin: 2px 0 0; font-size: 11.5px; line-height: 1.45; color: var(--app-warning-text); }
  .hint.warn { color: var(--app-warning-text); }
  .fit { align-self: flex-start; }

  .size-fields { display: flex; flex-direction: column; gap: 4px; padding-left: 24px; }
  .margin-fields { display: flex; flex-wrap: wrap; gap: 8px 18px; }
  .margin-field { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--app-text-secondary); }
  .margin-field .input { width: 76px; padding: 5px 7px; }

  /* 24 px icon buttons without borders (WCAG 2.5.8). */
  .icon-btn { width: 24px; height: 24px; padding: 0; justify-content: center; border: 0; background: transparent; color: var(--app-text-muted); flex-shrink: 0; }
  .icon-btn:hover:not(:disabled) { color: var(--app-text); background: var(--app-surface-hover); }

  /* ── Chapters ── */
  .chapters { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .chapter {
    display: flex; align-items: center; gap: 8px; padding: 3px 6px;
    border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-surface-sunken);
    cursor: grab;
  }
  .chapter.out { cursor: default; padding-left: 27px; }
  .chapter.dragging { opacity: 0.5; }
  .chapter.drop-target { border-color: var(--app-accent-border); background: var(--app-accent-subtle); }
  .grip { display: inline-flex; color: var(--app-text-muted); flex-shrink: 0; }
  .chapter input { margin: 0; flex-shrink: 0; }
  .chapter-title { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: var(--app-text); }
  .chapter-file { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--app-font-mono); font-size: 11px; color: var(--app-text-muted); }
  .missing { flex-shrink: 0; font-size: 11.5px; color: var(--app-warning-text); }
  .row-move { display: inline-flex; gap: 2px; flex-shrink: 0; }
  .template { flex-wrap: wrap; }
</style>
