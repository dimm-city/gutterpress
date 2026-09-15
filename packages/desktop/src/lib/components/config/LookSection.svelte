<script lang="ts">
  /**
   * Look view of the Extensions surface (#243, #265): the extensions that
   * carry STYLES, as one view over the ONE `extensions:` list the shared
   * `ExtensionsSectionController` owns — `FeaturesSection` is the other view,
   * over the same list and the same verbs (an extension that carries both
   * styles and markdown is the same row in both). No section wrapper or
   * `<h3>` of its own: the parent (ProjectSettingsView) owns the outer
   * "Look & style" block, exactly as before.
   *
   * There is no active look and no Apply/Revert (#265). Several looks can be
   * on at once; they stack in list order (a later one wins ties) and the
   * project's own stylesheets always come last. So a configured look is a ROW
   * in that stack — toggle, move up/down, remove — and the built-in looks are
   * a grid of things to ADD: "Use" copies one into `extensions/<id>/` as the
   * author's own editable files, after which the card reads "Added". A folder
   * the author already has is referenced in place (never copied); a `.zip`,
   * a `.css`, or a URL is unpacked into `extensions/<id>/` by the host (#106).
   *
   * Thumbnails render an entry's stylesheets (`readCss` — entries with a
   * folder only) into a fixed sample through the same sandboxed-iframe
   * mechanism as before; hovering a row enlarges it to a two-page spread.
   */
  import Icon from "$lib/components/Icon.svelte";
  import type { ProjectExtensionEntry } from "$lib/platform/dtos";
  import { extensionSourceLabel } from "./config-helpers";
  import type { ExtensionsSectionController } from "$lib/routes/extensions-section-controller.svelte";

  let { controller }: { controller: ExtensionsSectionController } = $props();

  /** The row's sample srcdoc, or null while loading / when there is no CSS to render. */
  function thumbOf(e: ProjectExtensionEntry): string | null {
    const t = controller.thumbs[e.use];
    return t && t !== "__fallback__" ? t : null;
  }

  function removeTitle(e: ProjectExtensionEntry): string {
    return e.kind === "npm"
      ? "Remove from this project (deletes its downloaded copy)"
      : "Remove from this project (the folder stays on disk)";
  }
</script>

<div class="look-subsection theme-subsection">
  <h4 class="subhead">Look</h4>
  {#if controller.error}
    <p class="error" role="alert">{controller.error}</p>
  {/if}
  {#if controller.notice}
    <p class="notice" role="status">{controller.notice}</p>
  {/if}
  {#if controller.importWarnings.length > 0}
    <div class="theme-warnings" role="status">
      <p class="warn-title">Imported with warnings:</p>
      <ul>
        {#each controller.importWarnings as w (w)}
          <li>{w}</li>
        {/each}
      </ul>
    </div>
  {/if}
  <p class="hint">Looks stack from top to bottom — a lower one wins where they disagree, and your own stylesheets always come last. Hover a look to preview a two-page spread.</p>

  {#if controller.looks.length === 0}
    <p class="muted">No look added yet. Use a built-in look below, or bring in your own.</p>
  {:else}
    <ul class="look-list">
      {#each controller.looks as e, i (e.use)}
        <li
          class="look-row"
          class:disabled={!e.enabled}
          onmouseenter={() => controller.showHoverPreview(e)}
          onmouseleave={controller.hideHoverPreview}
          onfocusin={() => controller.showHoverPreview(e)}
          onfocusout={controller.hideHoverPreview}
        >
          <div class="thumb">
            {#if thumbOf(e)}
              <iframe title={`Preview of ${e.label}`} srcdoc={thumbOf(e)} sandbox="allow-same-origin" loading="lazy"></iframe>
            {:else}
              {@render placeholder(e.label)}
            {/if}
          </div>
          <div class="look-info">
            <span class="look-name">{e.label}</span>
            {#if e.author}<span class="look-author">{e.author}</span>{/if}
            <span class="look-meta">
              <span class="kind">{extensionSourceLabel(e)}</span>
              {#if e.carries.markdown}
                <span class="badge" title="This extension also adds markdown features — see the Features tab.">+ features</span>
              {/if}
              {#if !e.enabled}<span class="badge">off</span>{/if}
            </span>
            {#if e.warnings?.length}<p class="status-detail">{e.warnings.join(" ")}</p>{/if}
          </div>
          <div class="look-actions">
            <button class="ghost icononly" onclick={() => controller.move(e, -1, "looks")} disabled={i === 0 || controller.busy !== null} title="Move up" aria-label={`Move ${e.label} up`}>
              <Icon name="chevron-up" size={13} />
            </button>
            <button class="ghost icononly" onclick={() => controller.move(e, 1, "looks")} disabled={i === controller.looks.length - 1 || controller.busy !== null} title="Move down (wins over the looks above it)" aria-label={`Move ${e.label} down`}>
              <Icon name="chevron-down" size={13} />
            </button>
            <button class="toggle" class:on={e.enabled} role="switch" aria-checked={e.enabled} aria-label={`${e.enabled ? "Turn off" : "Turn on"} ${e.label}`} disabled={controller.busy !== null} onclick={() => controller.toggle(e)}>
              <span class="knob"></span>
            </button>
            <button class="ghost icononly" onclick={() => controller.remove(e)} disabled={controller.busy !== null} title={removeTitle(e)} aria-label={`Remove ${e.label}`}>
              <Icon name="trash" size={13} />
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  <h4 class="subhead">Built-in looks</h4>
  <p class="hint">Use one and it's copied into your project's <code>extensions</code> folder as your own files, ready to fine-tune under Design.</p>
  <ul class="theme-grid">
    {#each controller.builtIns as b (b.id)}
      <li class="theme-card">
        <div class="thumb">{@render placeholder(b.name)}</div>
        <div class="theme-info">
          <span class="theme-name">{b.name}</span>
          {#if b.description}<span class="theme-desc">{b.description}</span>{/if}
        </div>
        <div class="theme-actions">
          {#if controller.isBuiltInAdded(b.id)}
            <span class="muted dim added"><Icon name="circle-check" size={12} /> Added</span>
          {:else}
            <button class="primary small app-btn-primary" onclick={() => controller.useBuiltIn(b.id)} disabled={controller.busy !== null}>{controller.busy === b.id ? "Adding..." : "Use"}</button>
          {/if}
        </div>
      </li>
    {/each}
  </ul>

  <div class="actions row">
    <button class="ghost small" onclick={controller.importFile} disabled={controller.busy !== null} title="Import an extension package (.zip) or a stylesheet (.css) into this project">
      <Icon name="cloud-upload" size={13} /> Import a look (.zip/.css)...
    </button>
    <button class="ghost small" onclick={controller.addLocal} disabled={controller.busy !== null} title="Add a folder on disk — it is used where it is, not copied">
      <Icon name="folder" size={13} /> Add from folder...
    </button>
  </div>
  <div class="add-row">
    <input
      class="input"
      type="text"
      aria-label="Look URL"
      placeholder="URL (.css or an extension folder)"
      bind:value={controller.url}
      onkeydown={(e) => { if (e.key === "Enter") controller.importUrl(); }}
    />
    <button class="ghost small" onclick={controller.importUrl} disabled={controller.busy !== null}>Import</button>
  </div>
</div>

<!--
  #106 hover preview: an enlarged, FIXED two-page sample spread rendered with the
  hovered look's CSS (reusing the thumbnail readCss -> srcdoc -> sandboxed iframe
  mechanism). It never renders the author's document. pointer-events:none so it
  can't steal the hover; aria-hidden as it's a decorative enlargement of the row.
-->
{#if controller.hoverPreview}
  <div class="hover-preview" aria-hidden="true">
    <iframe title="Look sample spread preview" srcdoc={controller.hoverPreview} sandbox="allow-same-origin"></iframe>
  </div>
{/if}

<!-- The non-blank fallback every thumbnail slot renders until (or instead of)
     a sample: a built-in look has no folder to read until it is used, and a
     configured look's CSS may still be loading. -->
{#snippet placeholder(label: string)}
  <div class="thumb-placeholder" role="img" aria-label={`Sample preview for ${label}`}>
    <span class="theme-fallback-title">Aa</span>
    <span class="theme-fallback-line"></span>
    <span class="theme-fallback-line short"></span>
  </div>
{/snippet}

<style>
  @import "$lib/styles/config-section-shared.css";

  /* Configured looks: one row per entry, top-to-bottom = cascade order. */
  .look-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .look-row {
    display: flex; align-items: center; gap: 10px; padding: 6px 8px;
    border: 1px solid var(--app-border); border-radius: 7px; background: var(--app-surface-sunken);
  }
  .look-row.disabled { opacity: 0.6; }
  .look-row .thumb { flex: 0 0 96px; width: 96px; }
  .look-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .look-name { font-size: 12px; font-weight: 600; color: var(--app-text); }
  .look-author { font-size: 10px; color: var(--app-text-muted); }
  .look-meta { display: flex; align-items: center; gap: 6px; font-size: 11px; flex-wrap: wrap; }
  .look-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }

  /* Built-in looks: a grid of cards to add from. */
  .theme-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
  .theme-card {
    display: flex; flex-direction: column; gap: 4px; padding: 6px;
    border: 1px solid var(--app-border); border-radius: 7px; background: var(--app-surface-sunken);
  }
  .theme-info { display: flex; flex-direction: column; gap: 1px; }
  .theme-name { font-size: 12px; font-weight: 600; color: var(--app-text); }
  .theme-desc { font-size: 10.5px; color: var(--app-text-muted); line-height: 1.35; }
  .theme-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .added { display: inline-flex; align-items: center; gap: 4px; }

  /* Sample thumbnails (shared by rows and cards). */
  .thumb { width: 100%; aspect-ratio: 4 / 3; border-radius: 4px; overflow: hidden; background: var(--app-control-bg); border: 1px solid var(--app-border-subtle); }
  .thumb iframe { border: 0; transform: scale(0.6); transform-origin: top left; width: 167%; height: 167%; }
  .thumb-placeholder {
    width: 100%; height: 100%; display: grid; place-content: center;
    gap: 5px; padding: 12px; background:
      linear-gradient(135deg, var(--app-surface), var(--app-control-bg));
  }
  .theme-fallback-title { font-size: 22px; font-weight: 700; color: var(--app-text); line-height: 1; }
  .theme-fallback-line { display: block; width: 68px; height: 4px; border-radius: 999px; background: var(--app-border-strong); }
  .theme-fallback-line.short { width: 46px; }

  /* #106: non-fatal import warnings (print-safety, missing metadata, extra files). */
  .theme-warnings {
    margin: 0 0 8px; padding: 8px 10px; border-radius: 6px;
    background: var(--app-warning-bg);
    border: 1px solid var(--app-warning-border);
    color: var(--app-warning-text);
  }
  .theme-warnings .warn-title { margin: 0 0 4px; font-size: 11px; font-weight: 600; }
  .theme-warnings ul { margin: 0; padding-left: 16px; }
  .theme-warnings li { font-size: 11px; line-height: 1.4; }

  /* #106: enlarged fixed 2-page sample spread shown while hovering a row. It is
     a decorative overlay (pointer-events:none) pinned to the desktop's right edge. */
  .hover-preview {
    position: fixed; right: 16px; top: 50%; transform: translateY(-50%);
    width: 360px; max-width: 42vw; aspect-ratio: 3 / 2;
    z-index: 40; pointer-events: none;
    border-radius: 8px; overflow: hidden;
    border: 1px solid var(--app-border-strong); background: var(--app-surface);
    box-shadow: 0 8px 30px var(--app-shadow-lg);
  }
  .hover-preview iframe { width: 100%; height: 100%; border: 0; background: #fff; }

  /* The viewport-pinned flyout needs true free space RIGHT of the settings
     view's centered 860px column: its left edge (100vw - 376px) crosses the
     column's right edge ((100vw + 860px) / 2) below ~1620px, where it would
     cover the very rows being hovered. Below that, the row's own thumbnail is
     the preview. */
  @media (max-width: 1620px) {
    .hover-preview { display: none; }
  }

  /* 480px: two-column grid on very narrow panels — component-local,
     unrelated to the 820px app tier. */
  @media (max-width: 480px) {
    .theme-grid { grid-template-columns: 1fr 1fr; }
  }
</style>
