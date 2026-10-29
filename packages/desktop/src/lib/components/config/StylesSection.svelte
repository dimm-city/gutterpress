<script lang="ts">
  /**
   * Advanced › Stylesheets: the manifest's `styles:` list, in the order the
   * stylesheets load, with the extension list's rows and verbs — move up/down,
   * Remove — and an Open that edits the file. Below it, the book's other
   * `.css` files to add. All state and host calls live in
   * `StylesSectionController`; this renders its fields and calls its verbs.
   * The last stylesheet has no Remove (the controller says why); a book with
   * none is offered `styles/book.css`.
   */
  import Icon from "#lib/components/Icon.svelte";
  import type { StylesSectionController } from "#lib/routes/styles-section-controller.svelte.ts";

  let {
    controller,
    onOpen,
  }: {
    controller: StylesSectionController;
    /** Open the stylesheet (absolute path) in the editor. */
    onOpen: (path: string) => void;
  } = $props();
</script>

<section class="block" aria-labelledby="advanced-stylesheets">
  <h3 id="advanced-stylesheets">Stylesheets</h3>
  <p class="hint">Your book's own .css files, in the order they load: a later one wins where two disagree. They load after every extension. Remove only takes a stylesheet off this list; the file stays in your book.</p>
  {#if controller.error}
    <p class="error" role="alert">{controller.error}</p>
  {/if}

  {#if controller.used.length === 0}
    <p class="muted">This book has no stylesheet yet.</p>
    <div class="row">
      <button class="ghost small" onclick={controller.create} disabled={controller.busy}>Create styles/book.css</button>
    </div>
  {:else}
    <ul class="item-list">
      {#each controller.used as s, i (s.path)}
        <li>
          <div class="item-row">
            <span class="item-label" title={s.path}>{s.displayName}</span>
            <span class="item-actions">
              <button class="move" onclick={() => controller.move(s, -1)} disabled={i === 0 || controller.busy} title="Move up" aria-label={`Move ${s.displayName} up`}>
                <Icon name="chevron-up" size={14} />
              </button>
              <button class="move" onclick={() => controller.move(s, 1)} disabled={i === controller.used.length - 1 || controller.busy} title="Move down" aria-label={`Move ${s.displayName} down`}>
                <Icon name="chevron-down" size={14} />
              </button>
              <button class="ghost small" onclick={() => onOpen(s.path)} aria-label={`Open ${s.displayName}`} title="Open in the editor">Open</button>
              <button
                class="ghost small"
                onclick={() => controller.remove(s)}
                disabled={controller.busy || controller.used.length === 1}
                aria-label={`Remove ${s.displayName}`}
                title={controller.used.length === 1 ? "A book keeps at least one stylesheet. Add another first." : "Take it off this list. The file stays in your book."}
              >Remove</button>
            </span>
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  <h4 class="subhead">Add a stylesheet</h4>
  {#if controller.unused.length === 0}
    <p class="hint">No other .css files found. Put one in your book's folder or its styles folder and it shows here.</p>
  {:else}
    <ul class="add-list">
      {#each controller.unused as s (s.path)}
        <li>
          <span class="add-name" title={s.path}>{s.displayName}</span>
          <button class="ghost small" onclick={() => controller.add(s)} disabled={controller.busy} aria-label={`Add ${s.displayName}`}>Add</button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  @import "../../styles/config-section-shared.css";

  /* A stylesheet's path takes the row; its verbs sit at the right. */
  .item-row > .item-label { flex: 1; min-width: 0; }
</style>
