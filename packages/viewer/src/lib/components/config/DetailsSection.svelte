<script lang="ts">
  /**
   * Details section of ProjectConfigPanel — title, authors, output filename,
   * source files. Presentational: all state + `api.*` calls live in the
   * composition root; this child renders props and emits changes via callbacks
   * ($bindable drafts for the plain text fields). Styles come from the root's
   * `.config-panel :global(...)` layer, so this file carries none.
   */
  import Icon from "$lib/components/Icon.svelte";

  let {
    detailsError,
    titleDraft = $bindable(""),
    authorsDraft,
    outputDraft = $bindable(""),
    sourceDraft = $bindable(""),
    detailsSaving,
    addAuthor,
    removeAuthor,
    setAuthor,
    saveDetails,
  }: {
    detailsError: string | null;
    titleDraft: string;
    authorsDraft: string[];
    outputDraft: string;
    sourceDraft: string;
    detailsSaving: boolean;
    addAuthor: () => void;
    removeAuthor: (i: number) => void;
    setAuthor: (i: number, v: string) => void;
    saveDetails: () => void;
  } = $props();
</script>

<section class="block">
  <h3>Details</h3>
  {#if detailsError}
    <p class="error" role="alert">{detailsError}</p>
  {/if}
  <label class="field">
    <span class="lbl">Title</span>
    <input
      class="input"
      type="text"
      value={titleDraft}
      oninput={(e) => (titleDraft = e.currentTarget.value)}
      placeholder="Untitled project"
    />
  </label>
  <div class="field">
    <span class="lbl">Authors</span>
    <div class="authors">
      {#each authorsDraft as _, i (i)}
        <div class="author-row">
          <input
            class="input"
            type="text"
            value={authorsDraft[i]}
            oninput={(e) => setAuthor(i, e.currentTarget.value)}
            placeholder="Author name"
            aria-label={`Author ${i + 1}`}
          />
          <button class="ghost icononly" onclick={() => removeAuthor(i)} title="Remove author" aria-label={`Remove author ${i + 1}`}>
            <Icon name="x" size={13} />
          </button>
        </div>
      {/each}
      <button class="ghost small add" onclick={addAuthor}><Icon name="plus" size={12} /> Add author</button>
    </div>
  </div>
  <label class="field">
    <span class="lbl">Output filename</span>
    <input
      class="input"
      type="text"
      value={outputDraft}
      oninput={(e) => (outputDraft = e.currentTarget.value)}
      placeholder="book.pdf"
    />
  </label>
  <label class="field">
    <span class="lbl">Source files</span>
    <textarea
      class="input"
      rows="3"
      placeholder="chapter-01.md&#10;chapter-02.md&#10;(Leave blank to include all chapter files.)"
      oninput={(e) => (sourceDraft = e.currentTarget.value)}
    >{sourceDraft}</textarea>
    <span class="hint">One file per line. Leave blank to include all markdown files in the project.</span>
  </label>
  <button class="primary small" onclick={saveDetails} disabled={detailsSaving}>
    {detailsSaving ? "Saving…" : "Save details"}
  </button>
</section>
