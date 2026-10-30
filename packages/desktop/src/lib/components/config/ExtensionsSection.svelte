<script lang="ts">
  /**
   * Book setup › Extensions (#243, #265): ONE list of the manifest's
   * `extensions:` entries in load order, owned by `ExtensionsSectionController`,
   * then one Add area. Every row has the model's verbs and nothing else: a
   * checkbox to use it, its kinds and source in words, move up/down, Remove.
   * A row speaks when something needs attention — a newer npm version (the
   * "x.y.z available" badge and Update), or a load failure (Show details, and
   * Install / Reinstall / Check again) — and an npm row also has its version
   * picker. This is the one place for the built-in extras (those the
   * book does not list are offered to Add, each with what to type), finding
   * a published extension on npm, folders, web addresses and the order; the
   * book's look is chosen on the Look tab.
   *
   * Search: the box asks npm when the author submits it (Enter or Search),
   * never at project load or on a keystroke. Each result is a name, its
   * description, its kind when npm's keywords say (`searchKindLabel`) and Add
   * — or "Added" when the book lists it. A failure is one quiet line.
   *
   * Updates (a book with an npm package): showing this list (its mount —
   * never project load) asks npm once for each pinned entry's latest, and
   * *Check for updates* asks again ("Checking npm…" while it runs). An entry
   * that is behind shows the newer version as a badge with Update. A failed
   * check is one quiet line under the list, as is "every package is at its
   * latest version".
   *
   * Versions: every npm row has a version picker (published versions, newest
   * first; stable only unless "Include pre-release versions" is on; the pinned
   * version always listed, marked "(current)"). A row's list loads when the
   * row is shown (and again when its picker is focused after a failed load),
   * cached for the session. Choosing a version installs it — behind the same
   * trust gate as any npm install — and the picker keeps showing the pin until
   * that install succeeded. The pre-release switch is an app setting
   * (`includeExtensionPrereleases`), so it applies to every book.
   */
  import { onMount } from "svelte";
  import Icon from "#lib/components/Icon.svelte";
  import { api } from "#lib/api.ts";
  import { extensionProblem, extensionSourceLabel, carriedKinds, describeSegments, searchKindLabel } from "./config-helpers";
  import type { ProjectExtensionEntry } from "#lib/platform/dtos.ts";
  import type { ExtensionsSectionController } from "#lib/routes/extensions-section-controller.svelte.ts";

  let { controller }: { controller: ExtensionsSectionController } = $props();

  const PLUGIN_FINDER_URL = "https://gutterpress.dimm.city/plugins/";

  /** The update tools (Check for updates, the pre-release switch) are about npm packages; a book with none has nothing to ask npm. */
  const hasNpm = $derived(controller.entries.some((e) => e.kind === "npm"));

  onMount(() => {
    if (controller.updates.status === "idle" && hasNpm) void controller.checkUpdates();
  });

  // Each npm row loads its package's version list when the row appears — the
  // tab being shown, or a package added later — never on re-render (a loaded
  // or in-flight list is cached for the session).
  function loadVersionsOnShow(_select: HTMLSelectElement, name: string) {
    void controller.loadVersions(name);
  }

  // A cancelled trust prompt or a failed install leaves the pin where it was;
  // the native <select> must show that again, not the version just chosen.
  async function pickVersion(e: ProjectExtensionEntry, select: HTMLSelectElement) {
    await controller.switchVersion(e, select.value);
    select.value = e.version ?? "";
  }
</script>

<section class="block" aria-labelledby="extensions-list">
  <div class="block-head">
    <h3 id="extensions-list">Your extensions</h3>
    {#if hasNpm}
      <button class="ghost small" onclick={() => controller.checkUpdates()} disabled={controller.updates.status === "loading"} title="Ask npm whether a newer version of any package from npm exists">
        <Icon name="refresh-cw" size={13} /> {controller.updates.status === "loading" ? "Checking npm…" : "Check for updates"}
      </button>
    {/if}
  </div>
  <p class="hint">Extensions add things you can type, like callouts or math, and extra looks. They load in this order: one lower in the list wins where two disagree. Your stylesheet always comes last.</p>
  {#if hasNpm}
    <div class="prerelease-row">
      <div class="prerelease-text">
        <label for="include-prereleases">Include pre-release versions</label>
        <span class="hint" id="include-prereleases-hint">Also offer alpha, beta and release-candidate versions in the version lists, and count them as updates. For every book.</span>
      </div>
      <input id="include-prereleases" type="checkbox" role="switch" aria-describedby="include-prereleases-hint" checked={controller.includePrerelease} onchange={(ev) => controller.setIncludePrerelease(ev.currentTarget.checked)} />
    </div>
  {/if}
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
          {#if e.kind === "npm"}
            {@const versions = controller.versions[e.name]}
            <div class="ext-note version-pick">
              <label for={`version-${e.use}`}>Version</label>
              <select id={`version-${e.use}`} class="input" use:loadVersionsOnShow={e.name} value={e.version ?? ""} disabled={controller.busy !== null} onfocus={() => controller.loadVersions(e.name)} onchange={(ev) => pickVersion(e, ev.currentTarget)}>
                {#if !e.version}<option value="" disabled>Choose a version</option>{/if}
                {#each controller.versionChoices(e) as v (v)}
                  <option value={v}>{v}{v === e.version ? " (current)" : ""}</option>
                {/each}
              </select>
              {#if newer}
                <span class="update-badge" title={`npm has ${e.name}@${newer}; this book uses ${e.version}.`}>{newer} available</span>
                <button class="ghost small" onclick={() => controller.update(e)} disabled={controller.busy !== null} title={`Update to ${e.name}@${newer}`} aria-label={`Update ${e.label} to ${newer}`}>{controller.busy === e.use ? "Updating…" : "Update"}</button>
              {/if}
              {#if controller.busy === e.use}
                <span class="pick-status" role="status">Installing…</span>
              {:else if versions?.status === "loading"}
                <span class="pick-status">Loading versions…</span>
              {:else if versions?.status === "error"}
                <span class="pick-status" title={versions.message ?? ""}>Couldn't load the version list.</span>
              {/if}
            </div>
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
      <p class="muted update-status" role="status">Couldn't check npm for updates: {controller.updates.message}</p>
    {:else if controller.updates.status === "ready" && controller.updates.checks.length > 0 && !controller.updates.checks.some((c) => c.outdated)}
      <p class="muted update-status" role="status">Every installed package is at its latest version.</p>
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
  {/if}

  <h4 class="subhead">Find one on npm</h4>
  <p class="hint">Looks and extras other authors have shared. Search with nothing typed to see the most relevant.</p>
  <div class="add-row">
    <label class="add-label" for="search-npm">Search npm</label>
    <input id="search-npm" class="input" type="text" placeholder="a word, like footnote or emoji" bind:value={controller.searchQuery} onkeydown={(e) => { if (e.key === "Enter") controller.runSearch(); }} />
    <button class="ghost small" onclick={controller.runSearch} disabled={controller.search.status === "loading"}>Search</button>
    <button class="link" onclick={() => api.shell.openExternal(PLUGIN_FINDER_URL).catch(() => {})}>Find extensions <Icon name="external-link" size={12} /></button>
  </div>
  {#if controller.search.status === "loading"}
    <p class="muted search-status" role="status">Searching npm…</p>
  {:else if controller.search.status === "error"}
    <p class="notice" role="status">{controller.search.message}</p>
  {:else if controller.search.status === "ready" && controller.searchResults.length === 0}
    <p class="muted search-status" role="status">{controller.search.query ? `No extensions found for "${controller.search.query}".` : "No extensions found on npm."}</p>
  {:else if controller.searchResults.length > 0}
    <ul class="add-list results" aria-label="Search results">
      {#each controller.searchResults as m (m.name)}
        {@const kind = searchKindLabel(m)}
        <li>
          <div class="result-main">
            <span class="result-head"><span class="result-name">{m.name}</span>{#if kind}<span class="result-kind">{kind}</span>{/if}</span>
            {#if m.description}<span class="result-desc" title={m.description}>{m.description}</span>{/if}
          </div>
          {#if m.added}
            <span class="result-added">Added</span>
          {:else}
            <button class="ghost small" onclick={() => controller.addSearched(m)} disabled={controller.busy !== null} aria-label={`Add ${m.name}`}>{controller.busy === m.name ? "Adding…" : "Add"}</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <h4 class="subhead">Other ways to add</h4>
  <div class="add-row">
    <label class="add-label" for="add-npm">Exact name</label>
    <input id="add-npm" class="input" type="text" placeholder="name or name@version, for a package search can't find" bind:value={controller.npmName} onkeydown={(e) => { if (e.key === "Enter") controller.addNpm(); }} />
    <button class="ghost small" onclick={controller.addNpm} disabled={controller.busy !== null}>{controller.busy !== null && controller.busy === controller.npmName.trim() ? "Adding…" : "Add"}</button>
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
  .update-status { font-size: 12px; }

  /* ── The update tools: Check for updates in the head, the pre-release switch, each npm row's version line ── */
  .prerelease-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .prerelease-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .prerelease-text label { font-size: 13px; color: var(--app-text); }
  .version-pick select { width: auto; max-width: 200px; padding: 3px 6px; font-size: 12px; }
  .update-badge { padding: 1px 7px; border-radius: 9px; font-size: 12px; color: var(--app-link); background: var(--app-accent-subtle); }
  .pick-status { color: var(--app-text-muted); }

  /* The switch is Settings' (SettingsView.svelte): a native checkbox, so it
     keeps the keyboard and the accessibility of one; the thumb's side says on
     or off, not colour alone, and off keeps 3:1 against the page in both themes. */
  input[role="switch"] {
    appearance: none; flex-shrink: 0; position: relative; width: 36px; height: 20px; margin: 0;
    border: 1px solid var(--app-text-muted); border-radius: 10px; background: transparent; cursor: pointer;
  }
  input[role="switch"]::before {
    content: ""; position: absolute; top: 3px; left: 3px; width: 12px; height: 12px;
    border-radius: 50%; background: var(--app-text-muted); transition: transform 0.15s;
  }
  input[role="switch"]:checked { background: var(--app-focus-ring); border-color: var(--app-focus-ring); }
  input[role="switch"]:checked::before { top: 1px; left: 1px; width: 16px; height: 16px; background: var(--app-text-on-accent); transform: translateX(16px); }
  input[role="switch"]:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  /* "Show details" on a failing row. */
  .status-raw > summary { font-size: 12px; color: var(--app-text-muted); cursor: pointer; user-select: none; }
  .status-raw > pre { margin: 4px 0 0; padding: 6px; font-size: 11px; color: var(--app-text-muted); background: var(--app-control-bg); border: 1px solid var(--app-border); border-radius: 4px; white-space: pre-wrap; word-break: break-word; }

  /* ── Built-in extras: name, what to type, Add ── */
  .extras .add-name { flex: none; width: 120px; }
  .extra-desc { flex: 1; min-width: 0; font-size: 12px; color: var(--app-text-muted); line-height: 1.4; }
  .extra-desc code { font-family: var(--app-font-mono); font-size: 12px; color: var(--app-text); }

  /* ── Search results: name and kind, the description under it, then Add (or Added) ── */
  .search-status { font-size: 12px; }
  .results li { align-items: flex-start; }
  .result-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .result-head { display: flex; align-items: baseline; gap: 8px; }
  .result-name { font-size: 13px; font-weight: 600; color: var(--app-text); overflow-wrap: anywhere; }
  .result-kind { font-size: 12px; color: var(--app-text-muted); }
  .result-desc { font-size: 12px; line-height: 1.4; color: var(--app-text-muted); display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  /* Where Add was: the same width, so a row does not change size when it is added. */
  .result-added { flex-shrink: 0; min-width: 46px; padding: 5px 0; font-size: 12px; text-align: center; color: var(--app-text-muted); }

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
