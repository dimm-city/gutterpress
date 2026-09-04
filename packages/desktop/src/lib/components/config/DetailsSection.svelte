<script lang="ts">
  /**
   * Details section of ProjectConfigPanel — title, authors, output filename,
   * source files. All state + `manifest*` capability calls live in
   * `DetailsSectionController` (passed as the single `controller` prop, per
   * the design-controller pattern — see M14); this child renders the
   * controller's rune fields and calls its intent methods directly (plain
   * text fields bind straight to controller fields via `bind:value`, same as
   * `pageNav.pageEditValue` in `+page.svelte`). Shared primitives (`.block`,
   * `.field`, `.input`, buttons, …) come from `config-section-shared.css`;
   * the Details-only layout (`.authors`, `.author-row`, `.add`) is scoped
   * here.
   */
  import Icon from "$lib/components/Icon.svelte";
  import type { DetailsSectionController } from "$lib/routes/details-section-controller.svelte";
  import {
    PUBLISH_TARGET_CHOICES,
    missingToolsForTargets,
    toolGapMessage,
  } from "$lib/publish-targets";

  let { controller }: { controller: DetailsSectionController } = $props();

  // The tool-gap explanation for the CHECKED destinations (null when nothing
  // checked needs a tool this computer lacks).
  const targetToolGap = $derived(
    toolGapMessage(
      missingToolsForTargets(controller.targetsDraft, controller.missingTools),
    ),
  );

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
  <h3>Details</h3>
  {#if controller.detailsError}
    <p class="error" role="alert">{controller.detailsError}</p>
  {/if}
  <label class="field">
    <span class="lbl">Title</span>
    <input
      class="input"
      type="text"
      bind:value={controller.titleDraft}
      placeholder="Untitled project"
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
    <span class="lbl">Source files</span>
    {#if controller.sourceFiles.length === 0}
      <p class="hint">No markdown files found in this project yet.</p>
    {:else}
      <ul class="source-list" aria-label="Source files (drag to reorder)">
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
              <span class="missing" title="This manifest entry has no matching file in the project">missing</span>
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
      <span class="hint">Drag rows (or use the arrows) to set the chapter order. Unchecked files are left out of the book.</span>
    {/if}
  </div>
  <!-- Publish targets (ADR 0008): WHERE this book is published — each one is
       a destination's validation policy. Same choices and wording as the
       new-book wizard (shared $lib/publish-targets), so the two surfaces
       never describe a destination differently. -->
  <div class="field">
    <span class="lbl">Publish targets</span>
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
      Checked destinations are validated when you build. With none checked,
      only the general print checks run.
    </span>
  </div>
  <button class="primary small app-btn-primary" onclick={controller.saveDetails} disabled={controller.detailsSaving}>
    {controller.detailsSaving ? "Saving…" : "Save details"}
  </button>
</section>

<style>
  @import "$lib/styles/config-section-shared.css";

  .target-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .target-row { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; }
  .target-row input { margin-top: 2px; flex-shrink: 0; }
  .target-copy { display: flex; flex-direction: column; gap: 1px; }
  .target-label { font-size: 13px; font-weight: 600; color: var(--app-text); }
  .target-desc { font-size: 11px; color: var(--app-text-muted); line-height: 1.35; }
  .tool-note { margin: 4px 0 0; font-size: 11px; line-height: 1.45; color: var(--app-warning-text); }

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
