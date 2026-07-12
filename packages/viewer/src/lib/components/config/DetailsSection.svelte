<script lang="ts">
  /**
   * Details section of ProjectConfigPanel — title, authors, output filename,
   * source files. All state + `api.manifest.*` calls live in
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

  let { controller }: { controller: DetailsSectionController } = $props();
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
  <label class="field">
    <span class="lbl">Output filename</span>
    <input
      class="input"
      type="text"
      bind:value={controller.outputDraft}
      placeholder="book.pdf"
    />
  </label>
  <label class="field">
    <span class="lbl">Source files</span>
    <textarea
      class="input"
      rows="3"
      placeholder="chapter-01.md&#10;chapter-02.md&#10;(Leave blank to include all chapter files.)"
      bind:value={controller.sourceDraft}
    ></textarea>
    <span class="hint">One file per line. Leave blank to include all markdown files in the project.</span>
  </label>
  <button class="primary small" onclick={controller.saveDetails} disabled={controller.detailsSaving}>
    {controller.detailsSaving ? "Saving…" : "Save details"}
  </button>
</section>

<style>
  @import "$lib/styles/config-section-shared.css";

  .authors { display: flex; flex-direction: column; gap: 4px; }
  .author-row { display: flex; gap: 4px; align-items: center; }
  .author-row .input { flex: 1; }
  .add { align-self: flex-start; }
</style>
