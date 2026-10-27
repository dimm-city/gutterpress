<script lang="ts">
  /**
   * Details section of ProjectSettingsView — title, authors, chapters, page
   * size, publish targets. It saves as you go: a choice commits at once; a
   * text field commits on `change` (blur or Enter) via
   * `controller.flushPendingSave`. All state + `api.manifest.*` calls live in
   * `DetailsSectionController` (passed as the single `controller` prop); this
   * child renders the controller's rune fields and calls its intent methods
   * directly (plain text fields bind straight to controller fields via
   * `bind:value`). Shared primitives (`.block`,
   * `.field`, `.input`, buttons, …) come from `config-section-shared.css`;
   * the Details-only layout (`.authors`, `.author-row`, `.add`) is scoped
   * here.
   */
  import Icon from "#lib/components/Icon.svelte";
  import PageSizeFields from "#lib/components/PageSizeFields.svelte";
  import { PRESET_CHOICES, pointsToInches } from "#lib/page-size-choices.ts";
  import type { DetailsSectionController } from "#lib/routes/details-section-controller.svelte.ts";
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

  // The stylesheet and the manifest drifted apart (hand-edited `@page`, or an
  // older book): say so, and offer to put them back in step.
  const pageDrift = $derived.by(() => {
    const css = controller.pageSetup?.css;
    const bounds = controller.pageSetup?.bounds;
    if (!css || !bounds) return null;
    if (Math.abs(css.width - bounds.width) < 0.5 && Math.abs(css.height - bounds.height) < 0.5) {
      return null;
    }
    const inches = (w: number, h: number) => `${pointsToInches(w)} × ${pointsToInches(h)} in`;
    return (
      `Your stylesheet (${css.file}) prints at ${inches(css.width, css.height)}, but this book is ` +
      `checked against ${inches(bounds.width, bounds.height)}.`
    );
  });

  // ── Source-files drag-and-drop reorder (HTML5 DnD; the up/down buttons are
  //    the keyboard-accessible equivalent). The pure reorder model lives in
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

<section class="block">
  <!-- The heading shares its row with the save badge and "Save as template…"
       (the DesignSection / ExtensionsSection head-row pattern): there is no
       Save button — every change here saves as you go. -->
  <div class="block-head">
    <h3>Details</h3>
    <div class="row">
      <!-- Always in the DOM with its text swapped: a live region announces a
           change to its content, not its own arrival (WCAG 2.2 SC 4.1.3). -->
      <span
        class="save-status"
        class:saving={controller.detailsSaveStatus === "saving"}
        class:saved={controller.detailsSaveStatus === "saved"}
        aria-live="polite"
      >{controller.detailsSaveStatus === "saving" ? "Saving…" : controller.detailsSaveStatus === "saved" ? "Changes saved" : ""}</span>
      {#if onSaveAsTemplate}
        <button
          class="ghost small"
          onclick={(e) => onSaveAsTemplate?.(e.currentTarget as HTMLButtonElement)}
          title="Save this book as a reusable starter for new books"
        >
          Save as template…
        </button>
      {/if}
    </div>
  </div>
  {#if controller.detailsError}
    <p class="error" role="alert">{controller.detailsError}</p>
  {/if}
  <!-- Bound by for/id as well as by nesting, so the input is named "Title"
       rather than after its placeholder ("Untitled book"). -->
  <label class="field" for="details-title">
    <span class="lbl">Title</span>
    <input
      id="details-title"
      class="input"
      type="text"
      bind:value={controller.titleDraft}
      onchange={() => controller.flushPendingSave()}
      placeholder="Untitled book"
    />
  </label>
  <div class="field">
    <span class="lbl">Authors</span>
    <div class="authors">
      {#each controller.authorsDraft as _, i (i)}
        <div class="author-row">
          <input
            class="input"
            type="text"
            value={controller.authorsDraft[i]}
            oninput={(e) => controller.setAuthor(i, e.currentTarget.value)}
            onchange={() => controller.flushPendingSave()}
            placeholder="Author name"
            aria-label={`Author ${i + 1}`}
          />
          <button class="ghost icononly" onclick={() => controller.removeAuthor(i)} title="Remove author" aria-label={`Remove author ${i + 1}`}>
            <Icon name="x" size={13} />
          </button>
        </div>
      {/each}
      <button class="ghost small add" onclick={controller.addAuthor}><Icon name="plus" size={12} /> Add author</button>
    </div>
  </div>
  <div class="field">
    <span class="lbl">Chapters</span>
    {#if controller.sourceFiles.length === 0}
      <p class="hint">No markdown files in this book folder yet.</p>
    {:else}
      <ul class="source-list" aria-label="Chapters (drag to reorder)">
        {#each controller.sourceFiles as entry, i (entry.path)}
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <li
            class="source-row"
            class:excluded={!entry.included}
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
              checked={entry.included}
              onchange={(e) => controller.setSourceIncluded(i, e.currentTarget.checked)}
              aria-label={`Include ${entry.path}`}
            />
            <span class="source-path" class:mono={true}>{entry.path}</span>
            {#if entry.missing}
              <span class="missing" title="This file is listed in the book but isn't in the folder.">missing</span>
            {/if}
            <span class="row-move">
              <button
                class="ghost icononly"
                onclick={() => controller.moveSourceFile(i, i - 1)}
                disabled={i === 0}
                title="Move up"
                aria-label={`Move ${entry.path} up`}
              ><Icon name="chevron-up" size={12} /></button>
              <button
                class="ghost icononly"
                onclick={() => controller.moveSourceFile(i, i + 1)}
                disabled={i === controller.sourceFiles.length - 1}
                title="Move down"
                aria-label={`Move ${entry.path} down`}
              ><Icon name="chevron-down" size={12} /></button>
            </span>
          </li>
        {/each}
      </ul>
      <span class="hint">Your book's markdown files, in reading order. Drag rows (or use the arrows) to reorder; unchecked files are left out.</span>
    {/if}
  </div>
  <!-- Page size (#357): the wizard's "What size should the pages be?" choices
       (shared #lib/page-size-choices), changeable after the book exists. A
       choice writes the manifest's preset + bounds and the stylesheet's page
       size together, as soon as it is complete. -->
  {#if controller.pageSetup}
    <div class="field" role="radiogroup" aria-label="Page size">
      <span class="lbl">Page size</span>
      <ul class="target-list">
        {#each PRESET_CHOICES as choice (choice.id)}
          <li>
            <label class="target-row">
              <input
                type="radio"
                name="details-preset"
                checked={controller.presetDraft === choice.id}
                onchange={() => controller.setPreset(choice.id)}
              />
              <span class="target-copy">
                <span class="target-label">{choice.label}</span>
                <span class="target-desc">{choice.description}</span>
              </span>
            </label>
          </li>
        {/each}
      </ul>
      {#if controller.presetDraft === "custom"}
        <!-- The size select's and the inches inputs' `change` bubbles here
             after the bound values updated, and commits; their `input` marks
             the size as edited, so closing before `change` (Escape) still
             saves it. PageSizeFields itself is shared with the wizard and
             stays a plain bindable component. -->
        <div
          class="size-fields"
          oninput={controller.touchPage}
          onchange={() => controller.flushPendingSave({ page: true })}
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
      {#if pageDrift}
        <p class="tool-note" role="note">
          {pageDrift}
          <button class="ghost small" onclick={controller.matchPageSize}>Use this size in the stylesheet too</button>
        </p>
      {/if}
      <span class="hint">
        The size your book prints at and the size the finished PDF is checked against.
      </span>
    </div>
  {/if}
  <!-- Publish targets (ADR 0008): WHERE this book is published — each one is
       a destination's validation policy. Same choices and wording as the
       new-book wizard (shared #lib/publish-targets), so the two surfaces
       never describe a destination differently. -->
  <div class="field">
    <span class="lbl">Check the PDF against</span>
    <ul class="target-list">
      {#each PUBLISH_TARGET_CHOICES as choice (choice.id)}
        <li>
          <label class="target-row">
            <input
              type="checkbox"
              checked={controller.targetsDraft.includes(choice.id)}
              onchange={() => controller.toggleTarget(choice.id)}
            />
            <span class="target-copy">
              <span class="target-label">{choice.label}</span>
              <span class="target-desc">{choice.description}</span>
            </span>
          </label>
        </li>
      {/each}
    </ul>
    {#if targetToolGap}
      <p class="tool-note" role="note">{targetToolGap}</p>
    {/if}
    <span class="hint">
      Gutterpress has no checks for other places you publish to (Amazon KDP, Google Drive…); you
      choose where to send the PDF when you publish. With none checked, only the general print
      checks run.
    </span>
  </div>
</section>

<style>
  @import "../../styles/config-section-shared.css";

  .target-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .target-row { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; }
  .target-row input { margin-top: 2px; flex-shrink: 0; }
  .target-copy { display: flex; flex-direction: column; gap: 1px; }
  .target-label { font-size: 13px; font-weight: 600; color: var(--app-text); }
  .target-desc { font-size: 11px; color: var(--app-text-muted); line-height: 1.35; }
  .tool-note { margin: 4px 0 0; font-size: 11px; line-height: 1.45; color: var(--app-warning-text); }

  .save-status { font-size: 11px; }
  .save-status.saving { color: var(--app-text-muted); }
  .save-status.saved { color: var(--app-success-text); }
  .size-fields { display: flex; flex-direction: column; gap: 4px; }
  .tool-note .ghost { margin-left: 6px; vertical-align: baseline; }
  .authors { display: flex; flex-direction: column; gap: 4px; }
  .author-row { display: flex; gap: 4px; align-items: center; }
  .author-row .input { flex: 1; }
  .add { align-self: flex-start; }

  /* ── Source-files DnD list ── */
  .source-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
  .source-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border: 1px solid var(--app-border);
    border-radius: 6px;
    background: var(--app-surface-sunken);
    cursor: grab;
  }
  .source-row.dragging { opacity: 0.5; }
  .source-row.drop-target { border-color: var(--app-accent-border); background: var(--app-accent-subtle); }
  .source-row.excluded .source-path { color: var(--app-text-muted); text-decoration: line-through; }
  .grip { display: inline-flex; color: var(--app-text-muted); flex-shrink: 0; }
  .source-path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: var(--app-text-secondary);
  }
  .source-path.mono { font-family: var(--app-font-mono); }
  .missing {
    flex-shrink: 0;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--app-warning-text);
  }
  .row-move { display: inline-flex; gap: 2px; flex-shrink: 0; }
</style>
