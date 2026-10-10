<script lang="ts">
  /**
   * Features view of the Extensions surface (#243, #265): the extensions that
   * carry MARKDOWN — plus any entry that carries nothing recognizable (a
   * missing folder, an unparseable specifier), so nothing configured is ever
   * invisible — as one view over the ONE `extensions:` list the shared
   * `ExtensionsSectionController` owns; `LookSection` is the other view, over
   * the same list and the same verbs (an extension that carries both styles
   * and markdown is the same row in both). Toggle, remove, validate; turn on
   * a bundled feature; install from npm; add a plugin file or folder on disk
   * (referenced in place, never copied). `extensionStatus` /
   * `extensionSourceLabel` are pure helpers.
   *
   * #309: a writer sees the bundled "Formatting extras" in plain language —
   * a name, one line, what to type — with the package name only as a
   * tooltip. Everything developer-shaped (the npm search, install by name, a
   * plugin file or folder) sits behind one collapsed "Advanced" disclosure.
   *
   * #246: the "Find more on npm" box — the npm registry, filtered to packages
   * tagged `gutterpress` or `markdown-it-plugin` — searches the first time
   * Advanced is opened (see `onAdvancedToggle`), never at project load and
   * never while it stays closed.
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
  import Icon from "$lib/components/Icon.svelte";
  import { api } from "$lib/api";
  import { extensionStatus, extensionSourceLabel, describeSegments } from "./config-helpers";
  import type { ProjectExtensionEntry } from "$lib/platform/dtos";
  import type { ExtensionsSectionController } from "$lib/routes/extensions-section-controller.svelte";

  let { controller }: { controller: ExtensionsSectionController } = $props();

  // #246: npm is searched ON DEMAND, only once Advanced is first opened —
  // never at project load (ProjectSettingsView's loadAll never touches it).
  // The empty query is "what is out there", the same list `gutterpress ext
  // search` prints with no argument.
  function onAdvancedToggle(e: Event & { currentTarget: HTMLDetailsElement }) {
    if (e.currentTarget.open && controller.search.status === "idle") {
      void controller.runSearch("");
    }
  }

  onMount(() => {
    if (controller.updates.status === "idle" && controller.entries.some((e) => e.kind === "npm")) {
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
</script>

<!-- A built-in feature's one line, its "what to type" spans set in code type —
     under the card that turns it on AND under the row once it is on. -->
{#snippet oneLiner(description: string)}
  <p class="rec-desc">{#each describeSegments(description) as seg}{#if seg.code}<code>{seg.text}</code>{:else}{seg.text}{/if}{/each}</p>
{/snippet}

<section class="block">
  <div class="block-head">
    <h3>Features</h3>
    <span class="head-actions">
      <button class="ghost small" onclick={() => controller.checkUpdates()} disabled={controller.updates.status === "loading"} title="Ask npm whether a newer version of any installed package exists">
        <Icon name="refresh-cw" size={13} /> {controller.updates.status === "loading" ? "Checking npm…" : "Check for updates"}
      </button>
      <button class="ghost small" onclick={controller.validateExtensions} disabled={controller.validating} title="Re-check that each feature loads">
        <Icon name="refresh-cw" size={13} /> Re-check
      </button>
    </span>
  </div>
  {#if controller.error}
    <p class="error" role="alert">{controller.error}</p>
  {/if}
  {#if controller.notice}
    <p class="notice" role="status">{controller.notice}</p>
  {/if}
  {#if controller.features.some((e) => e.kind === "npm")}
    <div class="prerelease-row">
      <span id="prerelease-label">Include pre-release versions</span>
      <button class="toggle" class:on={controller.includePrerelease} role="switch" aria-checked={controller.includePrerelease} aria-labelledby="prerelease-label" title="Also offer alpha, beta and release-candidate versions in the version lists, and count them as updates" onclick={() => controller.setIncludePrerelease(!controller.includePrerelease)}>
        <span class="knob"></span>
      </button>
    </div>
  {/if}
  {#if controller.features.length === 0}
    <p class="muted">No features turned on yet. Pick one below.</p>
  {:else}
    <ul class="plugin-list">
      {#each controller.features as e (e.use)}
        {@const st = extensionStatus(e, controller.validation, controller.validating)}
        <li class:disabled={!e.enabled}>
          <div class="plugin-main">
            <span class="plugin-label" title={e.use}>{e.label}</span>
            {#if e.kind === "bundled"}
              {#if e.description}{@render oneLiner(e.description)}{/if}
            {:else if e.label !== e.use}
              <span class="plugin-name">{e.use}</span>
            {/if}
            <span class="plugin-meta">
              <span class="kind">{extensionSourceLabel(e)}</span>
              {#if e.carries.styles}
                <span class="badge" title="This extension also carries a look — see the Look tab.">+ look</span>
              {/if}
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
          <button class="toggle" class:on={e.enabled} role="switch" aria-checked={e.enabled} aria-label={`${e.enabled ? "Disable" : "Enable"} ${e.label}`} disabled={controller.busy !== null} onclick={() => controller.toggle(e)}>
            <span class="knob"></span>
          </button>
          <button class="ghost icononly" onclick={() => controller.remove(e)} disabled={controller.busy !== null} title={e.kind === "npm" ? "Remove (deletes its downloaded copy)" : "Remove from this book"} aria-label={`Remove ${e.label}`}>
            <Icon name="trash" size={13} />
          </button>
        </li>
      {/each}
    </ul>
    {#if controller.updates.status === "error"}
      <p class="muted search-status">Couldn't check npm for updates: {controller.updates.message}</p>
    {:else if controller.updates.status === "ready" && controller.updates.checks.length > 0 && !controller.updates.checks.some((c) => c.outdated)}
      <p class="muted search-status">Every installed package is at its latest version.</p>
    {/if}
  {/if}

  {#if controller.availableRecommended.length > 0}
    <h4 class="subhead">Formatting extras</h4>
    <p class="hint">Turn a feature on and it works instantly — these are built in, nothing to install.</p>
    <ul class="rec-list">
      {#each controller.availableRecommended as rec (rec.use)}
        <li>
          <div class="rec-main">
            <span class="rec-label" title={rec.use}>{rec.label}</span>
            {@render oneLiner(rec.description)}
          </div>
          <button class="primary small app-btn-primary" aria-label={`Turn on ${rec.label}`} onclick={() => controller.addRecommended(rec)} disabled={controller.busy !== null}>Turn on</button>
        </li>
      {/each}
    </ul>
  {/if}

  <!-- #309: everything developer-shaped — the npm search (#246), install by
       name, a plugin file or folder — behind one disclosure, collapsed until
       the author opens it. -->
  <details class="advanced" ontoggle={onAdvancedToggle}>
    <summary><span class="summary-marker" aria-hidden="true"><Icon name="chevron-right" size={11} /></span>Advanced<span class="summary-hint">— npm packages and your own plugin files</span></summary>
    <div class="advanced-body">
      <p class="hint">Extra plugins for developers. Most books never need these.</p>

      <!-- #246: npm search — beyond the bundled/built-in set. Loading/error is
           one quiet line; it never blocks the sections above. -->
      <h4 class="subhead">Find more on npm</h4>
      <p class="hint">Packages tagged <code>gutterpress</code> or <code>markdown-it-plugin</code>. Only install packages you trust.</p>
      <div class="add-row">
        <input class="input" type="text" aria-label="search npm for extensions" placeholder="footnote, callout, table..." bind:value={controller.searchQuery} onkeydown={(e) => { if (e.key === "Enter") controller.runSearch(); }} />
        <button class="ghost small" onclick={() => controller.runSearch()} disabled={controller.search.status === "loading"}>Search</button>
      </div>
      {#if controller.search.status === "loading"}
        <p class="muted search-status">Searching npm…</p>
      {:else if controller.search.status === "error"}
        <p class="muted search-status">Couldn't search npm: {controller.search.message}</p>
      {:else if controller.search.status === "ready" && controller.availableSearch.length === 0}
        <p class="muted search-status">No extensions on npm match that.</p>
      {:else if controller.availableSearch.length > 0}
        <p class="muted search-status">Showing {controller.availableSearch.length} of {controller.search.total}.</p>
        <ul class="rec-list">
          {#each controller.availableSearch as match (match.name)}
            <li>
              <div class="rec-main">
                <span class="rec-label">{match.name}</span>
                <p class="rec-desc">{match.description ?? ""}</p>
                <span class="rec-pkg">{match.name}@{match.version}</span>
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

      <h4 class="subhead">Install from npm</h4>
      <div class="add-row">
        <input class="input" type="text" aria-label="npm package name or exact version" placeholder="markdown-it-highlightjs or markdown-it-highlightjs@4.3.0" bind:value={controller.npmName} onkeydown={(e) => { if (e.key === "Enter") controller.addNpm(); }} />
        <input class="input export-input" type="text" aria-label="named plugin export (optional)" placeholder="export (optional)" bind:value={controller.npmExport} onkeydown={(e) => { if (e.key === "Enter") controller.addNpm(); }} />
        <button class="primary small app-btn-primary" onclick={controller.addNpm} disabled={controller.busy !== null}>{controller.busy !== null && controller.busy === controller.npmName.trim() ? "Installing..." : "Install"}</button>
      </div>
      <p class="hint">Downloads from npm, verifies the registry hash, stores the package under <code>plugins/npm</code>, and pins the exact version in the manifest. For packages such as <code>markdown-it-emoji</code> that expose named plugin functions, enter the export name (for example <code>full</code>). Package install scripts are never run.</p>
      <p class="hint">Only install packages you trust. Features and their dependencies run with the app's full filesystem and network privileges.</p>
      <button class="ghost small full" onclick={controller.addLocal} disabled={controller.busy !== null}>
        <Icon name="folder" size={14} /> Add a plugin file or folder...
      </button>
      <p class="hint">A file or folder you pick is used where it is — nothing is copied into the book.</p>
    </div>
  </details>
</section>

<style>
  @import "$lib/styles/config-section-shared.css";

  .plugin-list, .rec-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
  .plugin-list li, .rec-list li { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-surface-sunken); }
  .plugin-list li.disabled { opacity: 0.6; }
  .plugin-main, .rec-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .plugin-name, .rec-pkg { font-size: 10px; color: var(--app-text-muted); font-family: var(--app-font-mono); word-break: break-all; }
  .plugin-meta { display: flex; align-items: center; gap: 8px; font-size: 11px; flex-wrap: wrap; }
  .rec-label { font-size: 12px; font-weight: 600; color: var(--app-text); }
  /* The "what to type" spans in a feature's one-liner (describeSegments). */
  .rec-desc code { font-family: var(--app-font-mono); font-size: 11px; color: var(--app-text); }
  .search-status { font-size: 12px; }
  .head-actions { display: flex; align-items: center; gap: 6px; }
  .prerelease-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--app-text); margin-bottom: 6px; }
  .version-pick { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--app-text-muted); margin-top: 4px; }
  .version-pick select { max-width: 190px; font-size: 11px; padding: 2px 4px; }
  .update-badge { color: var(--app-accent, var(--app-text)); }
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

  /* The Advanced disclosure (#309): a native <details> whose marker is an
     inline SVG chevron that rotates when open (content glyphs are banned, see
     no-glyph-chrome.test.ts). */
  .advanced { border-top: 1px solid var(--app-border-subtle); padding-top: 4px; }
  .advanced > summary { cursor: pointer; font-size: 12px; color: var(--app-text-muted); user-select: none; padding: 6px 0; list-style: none; }
  .advanced > summary::-webkit-details-marker { display: none; }
  .advanced > summary:hover { color: var(--app-text); }
  .advanced > summary:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  .summary-marker { display: inline-flex; margin-right: 4px; vertical-align: -1px; transition: transform 0.12s ease-out; }
  .advanced[open] > summary .summary-marker { transform: rotate(90deg); }
  .summary-hint { margin-left: 6px; font-size: 11px; }
  .advanced-body { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; }
  .export-input { max-width: 130px; }
  button.full { width: 100%; justify-content: center; }

  /* Friendly label — the lib's `label` (the recommended list's
     plain-language name for a bundled feature, an extension's declared name
     otherwise). The raw `use` (`.plugin-name`, muted) only renders as a
     secondary line for a package or folder; a bundled feature shows its
     one-liner instead and keeps the name as a tooltip on the label. */
  .plugin-label { font-size: 12px; font-weight: 600; color: var(--app-text); }
  /* Distinct from `.status.checking` — a stalled/failed check, not one
     in flight. A new class (not an override of `.status.error`) so it reads
     as its own state rather than reusing the error color. */
  .stale-status { color: var(--app-warning-text); }
</style>
