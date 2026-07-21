<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import ConnectionsSettings from "$lib/components/ConnectionsSettings.svelte";
  import { useSettings } from "$lib/settings.svelte";
  import { setThemeMode } from "$lib/theme.svelte";
  import { getPlatform, isDesktop } from "$lib/platform";

  let {
    onClose,
    projectDir = null,
    onViewModeChange,
    onCrashRecoveryChange,
  }: {
    onClose?: () => void;
    /** The open project dir (Connections tab: adding a publishing key verifies
     *  against the platform, and some checks read the project's settings). */
    projectDir?: string | null;
    /** Called immediately when the user changes the view mode setting. */
    onViewModeChange?: (mode: "single" | "two-column") => void;
    /** Called immediately when the user toggles crash recovery. */
    onCrashRecoveryChange?: (enabled: boolean) => void;
  } = $props();

  const settings = useSettings();

  function close() {
    onClose?.();
  }

  // ── Tabs ────────────────────────────────────────────────────────────────────
  // The stacked-sections layout outgrew one scroll (six groups + the new
  // Connections management), so the panel is tabbed: each tab renders one
  // cohesive slice. The active tab persists across opens within a session —
  // reopening lands where the user last was.
  type SettingsTab = "app" | "editor" | "saving" | "connections" | "advanced";
  const TABS: Array<{ id: SettingsTab; label: string }> = [
    { id: "app", label: "App" },
    { id: "editor", label: "Editor" },
    { id: "saving", label: "Saving" },
    { id: "connections", label: "Connections" },
    { id: "advanced", label: "Advanced" },
  ];
  let activeTab = $state<SettingsTab>("app");
  let tabEls = $state<Record<SettingsTab, HTMLButtonElement | undefined>>({
    app: undefined,
    editor: undefined,
    saving: undefined,
    connections: undefined,
    advanced: undefined,
  });

  function onTablistKeydown(e: KeyboardEvent) {
    const ids = TABS.map((tab) => tab.id);
    const current = ids.indexOf(activeTab);
    let next: number | undefined;
    if (e.key === "ArrowRight") next = (current + 1) % ids.length;
    else if (e.key === "ArrowLeft") next = (current - 1 + ids.length) % ids.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = ids.length - 1;
    if (next === undefined) return;
    e.preventDefault();
    activeTab = ids[next]!;
    tabEls[activeTab]?.focus();
  }

  // ── Typed setters (one line per control, per the "one-line setting" goal) ──
  const s = $derived(settings.current);
</script>

<div class="settings-view">
  <header class="settings-header">
    <h2 id="settings-title">Settings</h2>
    <button class="settings-close" onclick={close} title="Close settings" aria-label="Close settings"><Icon name="x" size={16} /></button>
  </header>

  <div class="tab-bar" role="tablist" aria-label="Settings sections" onkeydown={onTablistKeydown} tabindex="-1">
    {#each TABS as tab (tab.id)}
      <button
        id="settings-tab-{tab.id}"
        role="tab"
        class="tab"
        class:active={activeTab === tab.id}
        aria-selected={activeTab === tab.id}
        aria-controls="settings-panel"
        tabindex={activeTab === tab.id ? 0 : -1}
        bind:this={tabEls[tab.id]}
        onclick={() => (activeTab = tab.id)}
      >{tab.label}</button>
    {/each}
  </div>

  <div
    id="settings-panel"
    class="settings-body"
    role="tabpanel"
    aria-labelledby="settings-tab-{activeTab}"
  >
      <!-- App appearance (light/dark chrome) --------------------------------
           UX review M38: named "Appearance" here, but the config panel also
           used to have its OWN "Appearance" section for the print theme —
           two different concepts, same word. That panel section is now
           merged into "Look & style" (M35), so this is the only surviving
           "Appearance" in the app; the heading is qualified as "App
           appearance" anyway so the two can never collide again even if a
           future panel section reintroduces the word. -->
      {#if activeTab === "app"}
      <section class="group">
        <div class="group-head">
          <h3>App appearance</h3>
          <button class="reset" onclick={() => settings.resetSection("appearance")} title="Reset appearance to defaults">Reset</button>
        </div>
        <div class="row">
          <label for="set-theme">Theme</label>
          <select
            id="set-theme"
            value={s.appearance.theme}
            onchange={(e) => setThemeMode((e.currentTarget as HTMLSelectElement).value as "light" | "dark" | "system")}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        <div class="row">
          <label for="set-bg">Preview background</label>
          <input
            id="set-bg"
            type="color"
            value={s.appearance.previewBg}
            oninput={(e) => settings.set({ appearance: { previewBg: (e.currentTarget as HTMLInputElement).value } })}
          />
        </div>
      </section>

      <!-- Preview ---------------------------------------------------------- -->
      <section class="group">
        <div class="group-head">
          <h3>Preview</h3>
          <button class="reset" onclick={() => settings.resetSection("preview")} title="Reset preview settings to defaults">Reset</button>
        </div>
        <div class="row">
          <label for="set-viewmode">View mode</label>
          <select
            id="set-viewmode"
            value={s.preview.viewMode}
            onchange={(e) => { const mode = (e.currentTarget as HTMLSelectElement).value as "single" | "two-column"; settings.set({ preview: { viewMode: mode } }); onViewModeChange?.(mode); }}
          >
            <option value="single">Single page</option>
            <option value="two-column">Two pages side by side</option>
          </select>
        </div>
        <div class="row">
          <label for="set-zoom">Default zoom</label>
          <select
            id="set-zoom"
            value={s.preview.defaultZoom}
            onchange={(e) => settings.set({ preview: { defaultZoom: (e.currentTarget as HTMLSelectElement).value } })}
          >
            <option value="fit-width">Fit to width</option>
            <option value="0.5">50%</option>
            <option value="0.75">75%</option>
            <option value="1">100%</option>
            <option value="1.25">125%</option>
            <option value="1.5">150%</option>
            <option value="2">200%</option>
          </select>
        </div>
      </section>

      {#if isDesktop()}
      <section class="group">
        <div class="group-head">
          <h3>Updates</h3>
          <button class="reset" onclick={() => settings.resetSection("updates")} title="Reset update settings to defaults">Reset</button>
        </div>
        <div class="row row-toggle">
          <div class="row-label">
            <label for="set-prerelease-updates">Get prerelease updates</label>
            <span class="row-hint">Notify me about release candidates before the stable release.</span>
          </div>
          <input
            id="set-prerelease-updates"
            type="checkbox"
            checked={s.updates.includePrereleases}
            onchange={(e) => settings.set({ updates: { includePrereleases: (e.currentTarget as HTMLInputElement).checked } })}
          />
        </div>
      </section>
      {/if}

      {/if}

      {#if activeTab === "editor"}
      <!-- Editor ----------------------------------------------------------- -->
      <section class="group">
        <div class="group-head">
          <h3>Editor</h3>
          <button class="reset" onclick={() => settings.resetSection("editor")} title="Reset editor settings to defaults">Reset</button>
        </div>
        <div class="row">
          <label for="set-font">Font family</label>
          <input
            id="set-font"
            type="text"
            value={s.editor.fontFamily}
            onchange={(e) => settings.set({ editor: { fontFamily: (e.currentTarget as HTMLInputElement).value } })}
          />
        </div>
        <div class="row">
          <label for="set-fontsize">Font size</label>
          <input
            id="set-fontsize"
            type="number"
            min="8"
            max="32"
            value={s.editor.fontSize}
            onchange={(e) => settings.set({ editor: { fontSize: Number((e.currentTarget as HTMLInputElement).value) } })}
          />
        </div>
        <div class="row">
          <label for="set-lineheight">Line spacing</label>
          <input
            id="set-lineheight"
            type="number"
            min="1"
            max="3"
            step="0.1"
            value={s.editor.lineHeight}
            onchange={(e) => settings.set({ editor: { lineHeight: Number((e.currentTarget as HTMLInputElement).value) } })}
          />
        </div>
        <div class="row">
          <label for="set-spell">Spell-check language</label>
          <input
            id="set-spell"
            type="text"
            value={s.editor.spellCheckLanguage}
            onchange={(e) => settings.set({ editor: { spellCheckLanguage: (e.currentTarget as HTMLInputElement).value } })}
          />
        </div>
      </section>

      {/if}

      {#if activeTab === "saving"}
      <!-- Saving & recovery (UX follow-up: writer-friendly protection model) -
           The three protection layers a writer actually reasons about — saved
           on this computer, previous versions, and the online copy — plus the
           temporary emergency crash-draft, grouped together with plain labels.
           None of the underlying machinery changes; the persisted keys
           (editor.autoSaveDelay / editor.crashRecovery, versionHistory.
           autoSnapshot / autoSnapshotMinutes / autoSync) are internal and
           unchanged (the schema `editor` and `versionHistory` sections still
           own them, so each section's Reset still restores its own keys). -->
      <section class="group">
        <div class="group-head">
          <h3>Saving &amp; recovery</h3>
          <button class="reset" onclick={() => settings.resetSection("versionHistory")} title="Reset previous-version and online-copy settings to defaults">Reset</button>
        </div>
        <!-- On this computer -->
        <div class="row">
          <div class="row-label">
            <label for="set-autosave">Save edits automatically</label>
            <span class="row-hint">Writes your current changes to this computer as you work (delay in seconds)</span>
          </div>
          <input
            id="set-autosave"
            type="number"
            min="0"
            max="10"
            step="0.5"
            value={s.editor.autoSaveDelay / 1000}
            onchange={(e) => settings.set({ editor: { autoSaveDelay: Math.round(Number((e.currentTarget as HTMLInputElement).value) * 1000) } })}
          />
        </div>
        <!-- Previous versions -->
        <div class="row row-toggle">
          <div class="row-label">
            <label for="set-auto-snapshot">Keep previous versions</label>
            <span class="row-hint">Lets you return to earlier versions of the project. Turning this off does not affect saving on this computer.</span>
          </div>
          <input
            id="set-auto-snapshot"
            type="checkbox"
            checked={s.versionHistory.autoSnapshot}
            onchange={(e) => settings.set({ versionHistory: { autoSnapshot: (e.currentTarget as HTMLInputElement).checked } })}
          />
        </div>
        <div class="row">
          <label for="set-auto-snapshot-minutes">Create a version after I stop editing for (minutes)</label>
          <input
            id="set-auto-snapshot-minutes"
            type="number"
            min="5"
            max="1440"
            step="5"
            value={s.versionHistory.autoSnapshotMinutes}
            disabled={!s.versionHistory.autoSnapshot}
            onchange={(e) => settings.set({ versionHistory: { autoSnapshotMinutes: Number((e.currentTarget as HTMLInputElement).value) } })}
          />
        </div>
        <!-- Online copy (transparent-sync plan §6 / §8 step 7). Default ON for
             projects with a remote; local-only projects never sync regardless
             of this toggle (the host enforces the canSync gate). -->
        <div class="row row-toggle">
          <div class="row-label">
            <label for="set-auto-sync">Keep an online copy up to date</label>
            <span class="row-hint">Available when this project is connected to an online service — changes are saved to it in the background. Turning this off does not affect saving on this computer or your previous versions.</span>
          </div>
          <input
            id="set-auto-sync"
            type="checkbox"
            checked={s.versionHistory.autoSync}
            onchange={(e) => {
              const enabled = (e.currentTarget as HTMLInputElement).checked;
              settings.set({ versionHistory: { autoSync: enabled } });
              // Notify the host orchestrator immediately so the change takes effect
              // without waiting for a settings reload cycle (§4.3).
              if (isDesktop()) getPlatform().setAutoSync(enabled).catch(() => {});
            }}
          />
        </div>
        <!-- Emergency copy (crash-draft subsystem — kept distinct from previous
             versions, per UX follow-up + review M38). The persisted key
             `editor.crashRecovery` is internal/unchanged. -->
        <div class="row row-toggle">
          <div class="row-label">
            <label for="set-crash-recovery">Recover edits after an unexpected close</label>
            <span class="row-hint">Keeps a temporary emergency copy of your unsaved edits until they are saved. This is separate from your previous versions.</span>
          </div>
          <input
            id="set-crash-recovery"
            type="checkbox"
            checked={s.editor.crashRecovery}
            onchange={(e) => { const enabled = (e.currentTarget as HTMLInputElement).checked; settings.set({ editor: { crashRecovery: enabled } }); onCrashRecoveryChange?.(enabled); }}
          />
        </div>
      </section>

      <!-- Your name on saved versions -------------------------------------- -->
      <section class="group">
        <div class="group-head">
          <h3>Your name on saved versions</h3>
          <button class="reset" onclick={() => settings.resetSection("gitIdentity")} title="Reset the name on saved versions to defaults">Reset</button>
        </div>
        <div class="row">
          <label for="set-git-author-name">Name</label>
          <input
            id="set-git-author-name"
            type="text"
            value={s.gitIdentity.authorName}
            placeholder="Use your existing name"
            onchange={(e) => settings.set({ gitIdentity: { authorName: (e.currentTarget as HTMLInputElement).value } })}
          />
        </div>
        <div class="row">
          <label for="set-git-author-email">Email</label>
          <input
            id="set-git-author-email"
            type="email"
            value={s.gitIdentity.authorEmail}
            placeholder="Use your existing email"
            onchange={(e) => settings.set({ gitIdentity: { authorEmail: (e.currentTarget as HTMLInputElement).value } })}
          />
        </div>
      </section>

      {/if}

      {#if activeTab === "connections"}
      <!-- Connections — the central place to manage every stored credential:
           GitHub, other Git servers, and publishing accounts (itch.io, Azure,
           Shopify …). Management lives in its own component; this panel only
           hosts it. -->
      <section class="group">
        <ConnectionsSettings {projectDir} />
      </section>
      {/if}

    {#if activeTab === "advanced"}
      <section class="group advanced">
        <div class="group-head">
          <h3>Advanced <span class="advanced-hint">for developers</span></h3>
          <button class="reset" onclick={() => settings.resetSection("advanced")} title="Reset advanced settings to defaults">Reset</button>
        </div>
        <div class="row">
          <label for="set-watcher">File watcher interval (ms)</label>
          <input
            id="set-watcher"
            type="number"
            min="50"
            max="5000"
            step="50"
            value={s.advanced.fileWatcherInterval}
            onchange={(e) => settings.set({ advanced: { fileWatcherInterval: Number((e.currentTarget as HTMLInputElement).value) } })}
          />
        </div>
        <div class="row">
          <label for="set-loglevel">Log level</label>
          <select
            id="set-loglevel"
            value={s.advanced.logLevel}
            onchange={(e) => settings.set({ advanced: { logLevel: (e.currentTarget as HTMLSelectElement).value as "error" | "warn" | "info" | "debug" } })}
          >
            <option value="error">Error</option>
            <option value="warn">Warn</option>
            <option value="info">Info</option>
            <option value="debug">Debug</option>
          </select>
        </div>
      </section>
    {/if}
  </div>
</div>

<style>
  .settings-view {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    background: var(--app-bg);
    color: var(--app-text-secondary);
  }
  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    padding: 12px 16px;
    border-bottom: 1px solid var(--app-border);
    background: var(--app-surface-raised);
  }
  .settings-header h2 {
    margin: 0;
    color: var(--app-text);
    font-size: 15px;
  }
  .settings-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    border: 1px solid var(--app-border);
    border-radius: 5px;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
  }
  .settings-close:hover { background: var(--app-control-hover-bg); color: var(--app-text); }
  .settings-close:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  .settings-body {
    flex: 1;
    min-height: 0;
    padding: 16px 18px;
    overflow-y: auto;
  }
  /* ── Tab bar ── */
  .tab-bar {
    display: flex;
    gap: 2px;
    padding: 0 16px;
    border-bottom: 1px solid var(--app-border-subtle);
    flex-shrink: 0;
    overflow-x: auto;
  }
  .tab {
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--app-text-muted);
    font-size: 12.5px;
    padding: 8px 10px;
    cursor: pointer;
    white-space: nowrap;
  }
  .tab:hover { color: var(--app-text); }
  .tab.active {
    color: var(--app-text);
    border-bottom-color: var(--app-accent);
    font-weight: 600;
  }
  .tab:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: -2px; }
  .group { margin-bottom: 20px; }
  .group-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    border-bottom: 1px solid var(--app-border-subtle);
    padding-bottom: 6px;
  }
  .group-head h3 {
    margin: 0;
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--app-text-muted);
    letter-spacing: 0.09em;
  }
  .reset {
    background: transparent;
    border: 1px solid var(--app-border);
    color: var(--app-text-muted);
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
  }
  .reset:hover { background: var(--app-surface-hover); color: var(--app-text); }
  .row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    font-size: 13px;
  }
  .row label { color: var(--app-text-secondary); }
  .row-toggle { align-items: center; }
  .row-label { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .row-hint { font-size: 11px; line-height: 1.3; color: var(--app-text-muted); }
  .row input[type="text"],
  .row input[type="number"],
  .row select {
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-control-border);
    color: var(--app-text-secondary);
    padding: 5px 8px;
    border-radius: 6px;
    font-size: 13px;
    min-width: 160px;
  }
  /* Reset the native select chrome (Linux GTK ignores `background` otherwise,
     so the dropdowns rendered as light OS widgets against the dark panel) and
     draw a consistent custom chevron. */
  .row select {
    appearance: none;
    -webkit-appearance: none;
    padding-right: 28px;
    /* Chevron stroke #8a8a8a is baked into the data URI (var() can't reach
       inside it) — a mid-grey chosen to stay legible on both themes. */
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238a8a8a' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>");
    background-repeat: no-repeat;
    background-position: right 9px center;
  }
  .row input[type="color"] {
    width: 40px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--app-control-border);
    border-radius: 6px;
    background: none;
    cursor: pointer;
  }
  .advanced-hint {
    text-transform: none;
    letter-spacing: 0;
    color: var(--app-text-muted);
    font-weight: 400;
  }
</style>
