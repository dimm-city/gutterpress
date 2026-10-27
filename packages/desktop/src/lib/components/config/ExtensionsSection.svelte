<script lang="ts">
  /**
   * The Looks & features tab (id `extensions`; #243, #265): ONE list of the
   * manifest's `extensions:` entries in cascade order, owned by
   * `ExtensionsSectionController`. A row is a look, a feature, or both — its
   * badges say which (`carriedKinds`) — and every row has the same verbs:
   * move up/down, enable toggle, remove, plus an npm package's version
   * picker, Update and Install. A row that carries styles shows a sample
   * thumbnail of its CSS — in the list and on the Built in tab before it is
   * added; there is no hover preview. The book's own stylesheets always load
   * after the whole list; fine-tuning a look is the Design tab's job.
   *
   * Below the list, one Add area in three tabs (`Tabs.svelte`, the start
   * screen's strip; the selection lives on the controller). *Built in* is the
   * bundled looks (first, with thumbnails) and features in plain language
   * (#309 — a name, one line, what to type, the package name only as a
   * tooltip). *Search* is the npm
   * search (#246), run the first time the tab is shown (`showAddTab`, called on
   * mount too, for a remembered Search tab) — never at project load.
   * *Advanced* is install by name, a plugin file or folder used where it is,
   * and a `.zip`/`.css`/URL import. Everything developer-shaped stays off the
   * first tab.
   *
   * Updates: opening this tab (its mount — never project load) asks npm once
   * for each pinned entry's latest; an entry that is behind shows the newer
   * version with an Update button, and *Check for updates* asks again. A
   * failed check is one quiet line under the list.
   *
   * Versions: every npm row has a version picker (published versions, newest
   * first; stable only unless "Include pre-release versions" is on; the pinned
   * version always listed). A row's list loads when the row is shown (and again
   * when its picker is focused after a failed load), cached for the session.
   * Choosing a version installs it — the pin only moves once the install
   * succeeded. A row whose downloaded copy is missing or broken shows an
   * Install button for exactly the pinned version.
   */
  import { onMount } from "svelte";
  import Icon from "#lib/components/Icon.svelte";
  import Tabs from "#lib/components/Tabs.svelte";
  import { api } from "#lib/api.ts";
  import { extensionStatus, extensionSourceLabel, describeSegments, carriedKinds } from "./config-helpers";
  import type { BundledExtensionInfo, ProjectExtensionEntry } from "#lib/platform/dtos.ts";
  import { ADD_TABS, type ExtensionsSectionController } from "#lib/routes/extensions-section-controller.svelte.ts";

  let { controller }: { controller: ExtensionsSectionController } = $props();

  // An npm entry is what the update controls are for.
  const hasNpm = $derived(controller.entries.some((e) => e.kind === "npm"));

  onMount(() => {
    controller.showAddTab(controller.addTab);
    if (controller.updates.status === "idle" && hasNpm) {
      void controller.checkUpdates();
    }
  });

  // Each npm row loads its package's version list when the row appears — the
  // tab being shown, or a package added later — never on re-render (a loaded
  // or in-flight list is cached for the session).
  function loadVersionsOnShow(_select: HTMLSelectElement, name: string) {
    void controller.loadVersions(name);
  }

  // A cancelled trust prompt or a failed install leaves the pin where it was;
  // the native <select> must show that again, not the version just clicked.
  async function pickVersion(e: ProjectExtensionEntry, select: HTMLSelectElement) {
    await controller.switchVersion(e, select.value);
    select.value = e.version ?? "";
  }

  /** The sample srcdoc for a `use`, or null while loading / when there is no CSS to render. */
  function thumbOf(use: string): string | null {
    const t = controller.thumbs[use];
    return t && t !== "__fallback__" ? t : null;
  }

  const bundledLooks = $derived(controller.availableBundled.filter((b) => b.look));
  const bundledFeatures = $derived(controller.availableBundled.filter((b) => !b.look));
</script>

<!-- A built-in's one line, its "what to type" spans set in code type — under
     the row that adds it AND under the row once it is in the list. -->
{#snippet oneLiner(description: string)}
  <p class="rec-desc">{#each describeSegments(description) as seg}{#if seg.code}<code>{seg.text}</code>{:else}{seg.text}{/if}{/each}</p>
{/snippet}

<!-- A look's sample thumbnail (its CSS over a fixed sample), the same on a
     list row and on a Built in row. Until the CSS arrives, or when there is
     none to show, a non-blank placeholder. -->
{#snippet thumb(use: string, label: string)}
  {@const src = thumbOf(use)}
  <div class="thumb">
    {#if src}
      <iframe title={`Preview of ${label}`} srcdoc={src} sandbox="allow-same-origin" loading="lazy"></iframe>
    {:else}
      <div class="thumb-placeholder" role="img" aria-label={`Sample preview for ${label}`}>
        <span class="fallback-title">Aa</span>
        <span class="fallback-line"></span>
        <span class="fallback-line short"></span>
      </div>
    {/if}
  </div>
{/snippet}

<!-- One bundled look or feature on the Built in tab: a thumbnail for a look,
     the name, one line, a kind badge, and Add. -->
{#snippet bundledRow(b: BundledExtensionInfo)}
  <li>
    {#if b.look}{@render thumb(b.use, b.label)}{/if}
    <div class="rec-main">
      <span class="rec-label" title={b.use}>{b.label}</span>
      {@render oneLiner(b.description)}
      <span class="ext-meta"><span class="badge">{b.look ? "Look" : "Feature"}</span></span>
    </div>
    <button class="primary small app-btn-primary" aria-label={`Add ${b.label}`} onclick={() => controller.addBundled(b)} disabled={controller.busy !== null}>{controller.busy === b.use ? "Adding…" : "Add"}</button>
  </li>
{/snippet}

<section class="block">
  <div class="block-head">
    <h3>Looks &amp; features</h3>
    <!-- Developer-shaped controls only when they have something to act on:
         npm updates need an npm entry; a load re-check needs a list. -->
    <span class="head-actions">
      {#if hasNpm}
        <button class="ghost small" onclick={() => controller.checkUpdates()} disabled={controller.updates.status === "loading"} title="Ask npm whether a newer version of any installed package exists">
          <Icon name="refresh-cw" size={13} /> {controller.updates.status === "loading" ? "Checking npm…" : "Check for updates"}
        </button>
      {/if}
      {#if controller.entries.length > 0}
        <button class="ghost small" onclick={controller.validateExtensions} disabled={controller.validating} title="Re-check that each look and feature loads">
          <Icon name="refresh-cw" size={13} /> Re-check
        </button>
      {/if}
    </span>
  </div>
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
  <p class="hint">Looks and features apply from top to bottom: a lower one wins where they disagree, and your changes on the Design tab always win.</p>
  {#if hasNpm}
    <div class="prerelease-row">
      <span id="prerelease-label">Include pre-release versions</span>
      <button class="toggle" class:on={controller.includePrerelease} role="switch" aria-checked={controller.includePrerelease} aria-labelledby="prerelease-label" title="Also offer alpha, beta and release-candidate versions in the version lists, and count them as updates" onclick={() => controller.setIncludePrerelease(!controller.includePrerelease)}>
        <span class="knob"></span>
      </button>
    </div>
  {/if}

  {#if controller.entries.length === 0}
    <p class="muted">No looks or features yet. Add one below.</p>
  {:else}
    <ul class="ext-list">
      {#each controller.entries as e, i (e.use)}
        {@const st = extensionStatus(e, controller.validation, controller.validating)}
        <li class:disabled={!e.enabled}>
          {#if e.carries.styles}{@render thumb(e.use, e.label)}{/if}
          <div class="ext-main">
            <span class="ext-label" title={e.use}>{e.label}</span>
            {#if e.author}<span class="ext-author">{e.author}</span>{/if}
            {#if e.kind === "bundled"}
              {#if e.description}{@render oneLiner(e.description)}{/if}
            {:else if e.kind === "npm" && e.label !== e.use}
              <span class="ext-name">{e.use}</span>
            {/if}
            <span class="ext-meta">
              <span class="kind">{extensionSourceLabel(e)}</span>
              {#each carriedKinds(e) as k (k)}<span class="badge">{k}</span>{/each}
              {#if controller.updateFor(e)}
                <span class="badge update-badge" title={`npm has ${e.name}@${controller.updateFor(e)}; this book pins ${e.version}.`}>{controller.updateFor(e)} available</span>
              {/if}
              <span class={`status ${st.kind}`} class:stale-status={st.kind === "stale"}>
                {#if st.kind === "ok"}<Icon name="circle-check" size={12} />
                {:else if st.kind === "error"}<Icon name="triangle-alert" size={12} />
                {:else if st.kind === "checking"}<Icon name="refresh-cw" size={12} />
                {:else if st.kind === "stale"}<Icon name="circle-help" size={12} />{/if}
                {st.label}
              </span>
            </span>
            {#if st.detail}<p class="status-detail">{st.detail}</p>{/if}
            {#if st.raw}
              <details class="status-raw"><summary>Show details</summary><pre>{st.raw}</pre></details>
            {/if}
            {#if e.kind === "npm"}
              <div class="version-pick">
                <label for={`version-${e.use}`}>Version</label>
                <select id={`version-${e.use}`} class="input" use:loadVersionsOnShow={e.name} value={e.version ?? ""} disabled={controller.busy !== null} onfocus={() => controller.loadVersions(e.name)} onchange={(ev) => pickVersion(e, ev.currentTarget)}>
                  {#if !e.version}<option value="" disabled>Choose a version</option>{/if}
                  {#each controller.versionChoices(e) as v (v)}
                    <option value={v}>{v}{v === e.version ? " (current)" : ""}</option>
                  {/each}
                </select>
                {#if controller.busy === e.use}
                  <span class="muted" role="status">Installing…</span>
                {:else if controller.versions[e.name]?.status === "loading"}
                  <span class="muted">Loading versions…</span>
                {:else if controller.versions[e.name]?.status === "error"}
                  <span class="muted" title={controller.versions[e.name]?.message ?? ""}>Couldn't load the version list.</span>
                {/if}
              </div>
            {/if}
          </div>
          {#if st.fix}
            <button class="primary small app-btn-primary" onclick={() => controller.install(e)} disabled={controller.busy !== null} aria-label={`${st.fix === "install" ? "Install" : "Reinstall"} ${e.label}${e.version ? ` ${e.version}` : ""}`}>
              {controller.busy === e.use ? "Installing…" : st.fix === "install" ? "Install" : "Reinstall"}
            </button>
          {/if}
          {#if controller.updateFor(e)}
            <button class="primary small app-btn-primary" onclick={() => controller.update(e)} disabled={controller.busy !== null} title={`Update to ${e.name}@${controller.updateFor(e)}`} aria-label={`Update ${e.label} to ${controller.updateFor(e)}`}>
              {controller.busy === e.use ? "Updating…" : "Update"}
            </button>
          {/if}
          <div class="ext-actions">
            <button class="ghost icononly" onclick={() => controller.move(e, -1)} disabled={i === 0 || controller.busy !== null} title="Move up" aria-label={`Move ${e.label} up`}>
              <Icon name="chevron-up" size={13} />
            </button>
            <button class="ghost icononly" onclick={() => controller.move(e, 1)} disabled={i === controller.entries.length - 1 || controller.busy !== null} title="Move down (wins over the ones above it)" aria-label={`Move ${e.label} down`}>
              <Icon name="chevron-down" size={13} />
            </button>
            <button class="toggle" class:on={e.enabled} role="switch" aria-checked={e.enabled} aria-label={`${e.enabled ? "Turn off" : "Turn on"} ${e.label}`} disabled={controller.busy !== null} onclick={() => controller.toggle(e)}>
              <span class="knob"></span>
            </button>
            <button class="ghost icononly" onclick={() => controller.remove(e)} disabled={controller.busy !== null} title={e.kind === "npm" ? "Remove from this book (deletes its downloaded copy)" : "Remove from this book"} aria-label={`Remove ${e.label}`}>
              <Icon name="trash" size={13} />
            </button>
          </div>
        </li>
      {/each}
    </ul>
    {#if controller.updates.status === "error"}
      <p class="muted search-status">Couldn't check npm for updates: {controller.updates.message}</p>
    {:else if controller.updates.status === "ready" && controller.updates.checks.length > 0 && !controller.updates.checks.some((c) => c.outdated)}
      <p class="muted search-status">Every installed package is at its latest version.</p>
    {/if}
  {/if}

  <h4 class="subhead">Add</h4>
  <Tabs tabs={ADD_TABS} active={controller.addTab} label="Ways to add a look or feature" idPrefix="add" onselect={controller.showAddTab} />
  <div id="add-panel" class="tab-body" role="tabpanel" aria-labelledby="add-tab-{controller.addTab}">
  {#if controller.addTab === "built-in"}
    {#if controller.availableBundled.length === 0}
      <p class="muted">Every built-in look and feature is already in your list.</p>
    {:else}
      <p class="hint">Built in, nothing to install. A look styles the whole book; a feature adds something you can type. Footnotes (<code>[^1]</code>), tables and definition lists are always on.</p>
      {#if bundledLooks.length > 0}
        <h5 class="subhead">Looks</h5>
        <ul class="rec-list" aria-label="Built-in looks">
          {#each bundledLooks as b (b.use)}{@render bundledRow(b)}{/each}
        </ul>
      {/if}
      {#if bundledFeatures.length > 0}
        <h5 class="subhead">Features</h5>
        <ul class="rec-list" aria-label="Built-in features">
          {#each bundledFeatures as b (b.use)}{@render bundledRow(b)}{/each}
        </ul>
      {/if}
    {/if}

  {:else if controller.addTab === "search"}
    <!-- #246: npm search — beyond the bundled set. Loading/error is one quiet
         line; it never blocks the rest of the panel. -->
    <p class="hint">More looks and features other authors have shared on npm. Only add ones you trust.</p>
    <div class="add-row">
      <input class="input" type="text" aria-label="Search npm for looks and features" placeholder="emoji, task lists, anchors…" bind:value={controller.searchQuery} onkeydown={(e) => { if (e.key === "Enter") controller.runSearch(); }} />
      <button class="ghost small" onclick={() => controller.runSearch()} disabled={controller.search.status === "loading"}>Search</button>
    </div>
    {#if controller.search.status === "loading"}
      <p class="muted search-status">Searching npm…</p>
    {:else if controller.search.status === "error"}
      <p class="muted search-status">Couldn't search npm: {controller.search.message}</p>
    {:else if controller.search.status === "ready" && controller.availableSearch.length === 0}
      <p class="muted search-status">Nothing on npm matches that.</p>
    {:else if controller.availableSearch.length > 0}
      <p class="muted search-status">Showing {controller.availableSearch.length} of {controller.search.total}.</p>
      <ul class="rec-list">
        {#each controller.availableSearch as match (match.name)}
          <li>
            <div class="rec-main">
              <span class="rec-label">{match.name}</span>
              <p class="rec-desc">{match.description ?? ""}</p>
              <span class="ext-name">{match.name}@{match.version}</span>
              <span class="badge">{match.kind === "gutterpress" ? "gutterpress" : "markdown-it plugin"}</span>
              {#if match.npmUrl}
                <button class="inline-link" onclick={() => match.npmUrl && api.shell.openExternal(match.npmUrl).catch(() => {})}>{match.npmUrl}</button>
              {/if}
            </div>
            <button class="primary small app-btn-primary" onclick={() => controller.addSearched(match)} disabled={controller.busy !== null}>Add</button>
          </li>
        {/each}
      </ul>
    {/if}

  {:else}
    <p class="hint">Packages, folders and files from elsewhere. Most books never need these.</p>

    <h4 class="subhead">Install from npm</h4>
    <div class="add-row">
      <input class="input" type="text" aria-label="npm package name or exact version" placeholder="markdown-it-highlightjs or markdown-it-highlightjs@4.3.0" bind:value={controller.npmName} onkeydown={(e) => { if (e.key === "Enter") controller.addNpm(); }} />
      <input class="input export-input" type="text" aria-label="named plugin export (optional)" placeholder="export (optional)" bind:value={controller.npmExport} onkeydown={(e) => { if (e.key === "Enter") controller.addNpm(); }} />
      <button class="primary small app-btn-primary" onclick={controller.addNpm} disabled={controller.busy !== null}>{controller.busy !== null && controller.busy === controller.npmName.trim() ? "Installing..." : "Install"}</button>
    </div>
    <p class="hint">Downloads from npm, verifies the registry hash, stores the package under <code>extensions/npm</code>, and pins the exact version in the manifest. For packages such as <code>markdown-it-emoji</code> that expose named plugin functions, enter the export name (for example <code>full</code>). Package install scripts are never run.</p>
    <p class="hint">Only install packages you trust. Extensions and their dependencies run with the app's full filesystem and network privileges.</p>

    <h4 class="subhead">From your computer or the web</h4>
    <div class="row">
      <button class="ghost small" onclick={controller.addLocal} disabled={controller.busy !== null} title="Add a folder or plugin file on disk — it is used where it is, not copied">
        <Icon name="folder" size={13} /> Add a folder or plugin file...
      </button>
      <button class="ghost small" onclick={controller.importFile} disabled={controller.busy !== null} title="Import an extension package (.zip) or a stylesheet (.css) into this book">
        <Icon name="cloud-upload" size={13} /> Import a .zip or .css...
      </button>
    </div>
    <p class="hint">A folder or file you pick is used where it is — nothing is copied into the book. An imported <code>.zip</code> or <code>.css</code> is copied into <code>extensions/</code>.</p>
    <div class="add-row">
      <input class="input" type="text" aria-label="Extension URL" placeholder="URL (.css or an extension folder)" bind:value={controller.url} onkeydown={(e) => { if (e.key === "Enter") controller.importUrl(); }} />
      <button class="ghost small" onclick={controller.importUrl} disabled={controller.busy !== null}>Import</button>
    </div>
  {/if}
  </div>
</section>

<style>
  @import "../../styles/config-section-shared.css";

  /* The list: one row per entry, top-to-bottom = cascade order. */
  .ext-list, .rec-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
  .ext-list li, .rec-list li { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-surface-sunken); }
  .ext-list li.disabled { opacity: 0.6; }
  .ext-main, .rec-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .ext-label, .rec-label { font-size: 12px; font-weight: 600; color: var(--app-text); }
  .ext-author { font-size: 10px; color: var(--app-text-muted); }
  .ext-name { font-size: 10px; color: var(--app-text-muted); font-family: var(--app-font-mono); word-break: break-all; }
  .ext-meta { display: flex; align-items: center; gap: 6px; font-size: 11px; flex-wrap: wrap; }
  .ext-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
  /* The "what to type" spans in a built-in's one-liner (describeSegments) and in the Built in hint. */
  .rec-desc code, .hint code { font-family: var(--app-font-mono); font-size: 11px; color: var(--app-text); }
  .search-status { font-size: 12px; }
  .head-actions { display: flex; align-items: center; gap: 6px; }
  .prerelease-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--app-text); }
  .version-pick { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--app-text-muted); margin-top: 4px; }
  .version-pick select { max-width: 190px; font-size: 11px; padding: 2px 4px; }
  .update-badge { color: var(--app-accent); }
  /* Distinct from `.status.checking` — a stalled/failed check, not one in
     flight — so it reads as its own state rather than reusing the error color. */
  .stale-status { color: var(--app-warning-text); }
  /* Opens via api.shell.openExternal (never a bare `<a target="_blank">` in
     the Electron shell — see ConnectionsSettings.svelte for the pattern). */
  button.inline-link {
    background: transparent;
    border: none;
    padding: 0;
    color: var(--app-text-muted);
    font-size: 10px;
    text-decoration: underline;
    text-underline-offset: 2px;
    word-break: break-all;
    cursor: pointer;
    text-align: left;
  }

  /* The Add tab panel: its sections stack on the same 8px rhythm as the block. */
  .tab-body { display: flex; flex-direction: column; gap: 8px; }
  .export-input { max-width: 130px; }

  /* Sample thumbnails on the rows that carry styles. */
  .thumb { flex: 0 0 96px; width: 96px; aspect-ratio: 4 / 3; border-radius: 4px; overflow: hidden; background: var(--app-control-bg); border: 1px solid var(--app-border-subtle); }
  .thumb iframe { border: 0; transform: scale(0.6); transform-origin: top left; width: 167%; height: 167%; }
  .thumb-placeholder {
    width: 100%; height: 100%; display: grid; place-content: center;
    gap: 5px; padding: 12px; background:
      linear-gradient(135deg, var(--app-surface), var(--app-control-bg));
  }
  .fallback-title { font-size: 22px; font-weight: 700; color: var(--app-text); line-height: 1; }
  .fallback-line { display: block; width: 68px; height: 4px; border-radius: 999px; background: var(--app-border-strong); }
  .fallback-line.short { width: 46px; }

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
