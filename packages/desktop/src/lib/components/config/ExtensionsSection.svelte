<script lang="ts">
  /**
   * Book setup › Extensions (#243, #265): ONE list of the manifest's
   * `extensions:` entries in load order, owned by `ExtensionsSectionController`,
   * then one Add area. Every row has the model's verbs and nothing else: a
   * checkbox to use it, its kinds and source in words, move up/down, Remove.
   * A row speaks only when something needs attention — a newer npm version
   * (Update), or a load failure (Show details, and Install / Reinstall /
   * Check again). This is the one place for the built-in extras (those the
   * book does not list are offered to Add, each with what to type), npm,
   * folders, web addresses and the order; the book's look is chosen on the
   * Look tab.
   *
   * Updates: showing this list (its mount — never project load) asks npm once
   * for each pinned entry's latest. A failed check is one quiet line.
   */
  import { onMount } from "svelte";
  import Icon from "#lib/components/Icon.svelte";
  import { api } from "#lib/api.ts";
  import { extensionProblem, extensionSourceLabel, carriedKinds, describeSegments } from "./config-helpers";
  import type { ExtensionsSectionController } from "#lib/routes/extensions-section-controller.svelte.ts";

  let { controller }: { controller: ExtensionsSectionController } = $props();

  const PLUGIN_FINDER_URL = "https://gutterpress.dimm.city/plugins/";

  onMount(() => {
    if (controller.updates.status === "idle" && controller.entries.some((e) => e.kind === "npm")) {
      void controller.checkUpdates();
    }
  });
</script>

<section class="block" aria-labelledby="extensions-list">
  <h3 id="extensions-list">Your extensions</h3>
  <p class="hint">Extensions add things you can type, like callouts or math, and extra looks. They load in this order: one lower in the list wins where two disagree. Your stylesheet always comes last.</p>
  {#if controller.error}
    <p class="error" role="alert">{controller.error}</p>
  {/if}
  {#if controller.notice}
    <p class="notice" role="status">{controller.notice}</p>
  {/if}
  {#if controller.importWarnings.length > 0}
    <div class="import-warnings" role="status">
      <p class="warn-title">Imported with warnings:</p>
      <ul>
        {#each controller.importWarnings as w (w)}
          <li>{w}</li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if controller.entries.length === 0}
    <p class="muted">This book has no extensions yet.</p>
  {:else}
    <ul class="item-list">
      {#each controller.entries as e, i (e.use)}
        {@const problem = extensionProblem(e, controller.validation, controller.validating)}
        {@const newer = controller.updateFor(e)}
        <li>
          <div class="item-row">
            <label class="ext-use">
              <input type="checkbox" checked={e.enabled} disabled={controller.busy !== null} onchange={() => controller.toggle(e)} aria-label={`Use ${e.label}`} />
              <span class="item-label" title={e.use}>{e.label}</span>
            </label>
            <span class="item-caption">{[carriedKinds(e).join(", "), extensionSourceLabel(e)].filter(Boolean).join(" · ")}</span>
            <span class="item-actions">
              <button class="move" onclick={() => controller.move(e, -1)} disabled={i === 0 || controller.busy !== null} title="Move up" aria-label={`Move ${e.label} up`}>
                <Icon name="chevron-up" size={14} />
              </button>
              <button class="move" onclick={() => controller.move(e, 1)} disabled={i === controller.entries.length - 1 || controller.busy !== null} title="Move down" aria-label={`Move ${e.label} down`}>
                <Icon name="chevron-down" size={14} />
              </button>
              <button class="ghost small" onclick={() => controller.remove(e)} disabled={controller.busy !== null} aria-label={`Remove ${e.label}`} title={e.kind === "npm" ? "Remove from this book (deletes its downloaded copy)" : "Remove from this book"}>Remove</button>
            </span>
          </div>
          {#if newer}
            <p class="ext-note">
              Version {newer} is available.
              <button class="ghost small" onclick={() => controller.update(e)} disabled={controller.busy !== null} aria-label={`Update ${e.label} to ${newer}`}>{controller.busy === e.use ? "Updating…" : "Update"}</button>
            </p>
          {/if}
          {#if problem}
            <div class="ext-note problem">
              <span>{problem.label}</span>
              {#if problem.raw}
                <details class="status-raw"><summary>Show details</summary><pre>{problem.raw}</pre></details>
              {/if}
              {#if problem.fix === "check"}
                <button class="ghost small" onclick={controller.validateExtensions} disabled={controller.validating}>Check again</button>
              {:else}
                <button class="ghost small" onclick={() => controller.install(e)} disabled={controller.busy !== null} aria-label={`${problem.fix === "install" ? "Install" : "Reinstall"} ${e.label}${e.version ? ` ${e.version}` : ""}`}>
                  {controller.busy === e.use ? "Installing…" : problem.fix === "install" ? "Install" : "Reinstall"}
                </button>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
    {#if controller.updates.status === "error"}
      <p class="muted update-failed">Couldn't check npm for updates.</p>
    {/if}
  {/if}
</section>

<section class="block" aria-labelledby="extensions-add">
  <h3 id="extensions-add">Add an extension</h3>
  {#if controller.unlistedExtras.length > 0}
    <h4 class="subhead">Built-in extras</h4>
    <p class="hint">Footnotes, tables and definition lists are always on.</p>
    <ul class="add-list extras">
      {#each controller.unlistedExtras as x (x.use)}
        <li>
          <span class="add-name">{x.label}</span>
          <!-- What it does and what to type, the "what to type" set in code type. -->
          <span class="extra-desc">{#each describeSegments(x.description) as seg}{#if seg.code}<code>{seg.text}</code>{:else}{seg.text}{/if}{/each}</span>
          <button class="ghost small" onclick={() => controller.addExtra(x)} disabled={controller.busy !== null} aria-label={`Add ${x.label}`}>{controller.busy === x.use ? "Adding…" : "Add"}</button>
        </li>
      {/each}
    </ul>
    <h4 class="subhead">From npm, a folder or a web address</h4>
  {/if}
  <div class="add-row">
    <label class="add-label" for="add-npm">npm package</label>
    <input id="add-npm" class="input" type="text" bind:value={controller.npmName} onkeydown={(e) => { if (e.key === "Enter") controller.addNpm(); }} />
    <button class="ghost small" onclick={controller.addNpm} disabled={controller.busy !== null}>{controller.busy !== null && controller.busy === controller.npmName.trim() ? "Adding…" : "Add"}</button>
    <button class="link" onclick={() => api.shell.openExternal(PLUGIN_FINDER_URL).catch(() => {})}>Find extensions <Icon name="external-link" size={12} /></button>
  </div>
  <div class="row">
    <button class="ghost small" onclick={controller.addLocal} disabled={controller.busy !== null} title="It is used where it is, not copied">
      <Icon name="folder" size={13} /> Add a folder or file…
    </button>
    <button class="ghost small" onclick={controller.importFile} disabled={controller.busy !== null} title="It is copied into this book's extensions folder">
      <Icon name="cloud-upload" size={13} /> Import a .zip or .css file…
    </button>
  </div>
  <div class="add-row">
    <label class="add-label" for="add-url">Web address</label>
    <input id="add-url" class="input" type="url" bind:value={controller.url} onkeydown={(e) => { if (e.key === "Enter") controller.importUrl(); }} />
    <button class="ghost small" onclick={controller.importUrl} disabled={controller.busy !== null}>Import</button>
  </div>
  <p class="hint">Extensions from npm, folders and the web run with full access to your computer. Only add ones you trust.</p>
</section>

<style>
  @import "../../styles/config-section-shared.css";

  /* The list rows are the shared item rows (config-section-shared.css); a row's checkbox and its notes are this list's own. */
  .ext-use { display: flex; align-items: center; gap: 8px; min-width: 0; cursor: pointer; }
  .ext-note { margin: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding-left: 24px; font-size: 12px; color: var(--app-text-secondary); }
  .ext-note.problem > span { color: var(--app-warning-text); }

  .notice { color: var(--app-warning-text); font-size: 12px; margin: 0; }
  .update-failed { font-size: 12px; }
  /* "Show details" on a failing row. */
  .status-raw > summary { font-size: 12px; color: var(--app-text-muted); cursor: pointer; user-select: none; }
  .status-raw > pre { margin: 4px 0 0; padding: 6px; font-size: 11px; color: var(--app-text-muted); background: var(--app-control-bg); border: 1px solid var(--app-border); border-radius: 4px; white-space: pre-wrap; word-break: break-word; }

  /* ── Built-in extras: name, what to type, Add ── */
  .extras .add-name { flex: none; width: 120px; }
  .extra-desc { flex: 1; min-width: 0; font-size: 12px; color: var(--app-text-muted); line-height: 1.4; }
  .extra-desc code { font-family: var(--app-font-mono); font-size: 12px; color: var(--app-text); }

  .add-row { align-items: center; }
  .add-label { flex-shrink: 0; width: 96px; font-size: 12.5px; color: var(--app-text-secondary); }
  .add-row .link { white-space: nowrap; }


  /* #106: non-fatal import warnings (print-safety, missing metadata, extra files). */
  .import-warnings {
    margin: 0; padding: 8px 10px; border-radius: 6px;
    background: var(--app-warning-bg);
    border: 1px solid var(--app-warning-border);
    color: var(--app-warning-text);
  }
  .import-warnings .warn-title { margin: 0 0 4px; font-size: 11px; font-weight: 600; }
  .import-warnings ul { margin: 0; padding-left: 16px; }
  .import-warnings li { font-size: 11px; line-height: 1.4; }
</style>
