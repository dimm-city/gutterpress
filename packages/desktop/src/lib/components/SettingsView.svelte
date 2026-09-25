<script lang="ts">
  import { onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import ConnectionsSettings from "$lib/components/ConnectionsSettings.svelte";
  import GitIdentitySection from "$lib/components/GitIdentitySection.svelte";
  import { useSettings } from "$lib/settings.svelte";
  import { setThemeMode } from "$lib/theme.svelte";
  import { getPlatform, isDesktop } from "$lib/platform";
  import { sanitizeSettingsTab, type SettingsTab } from "$lib/settings-tabs";
  import { api, type AppImageIntegrationStatus } from "$lib/api";
  import { friendlyHostError } from "$lib/errors";

  let {
    onClose,
    projectDir = null,
    initialTab = "app",
    embedded = false,
    idPrefix = "settings",
    onProjectFilesChanged,
  }: {
    onClose?: () => void;
    /** The open project dir (Connections tab: adding a publishing key verifies
     *  against the platform, and some checks read the project's settings;
     *  the Saving tab's online-backup switch uses it to check canSync). */
    projectDir?: string | null;
    /** The tab to land on when the view opens (e.g. "connections" from the
     *  reconnect / advanced-setup entry points). */
    initialTab?: SettingsTab;
    /** Rendered INSIDE another surface (the start screen's Settings tab)
     *  rather than as the full-window sheet: drops the title bar and close
     *  button — that surface has its own — and stops owning a scroll region,
     *  so the host scrolls as one page. */
    embedded?: boolean;
    /** Element-id namespace. Two instances can be mounted at once (the
     *  start screen's tab and the full-window sheet opened over it), and
     *  duplicate ids would break the tab/panel aria wiring for both. */
    idPrefix?: string;
    /** Called after the Saving tab's copy switcher (#273) successfully checks
     *  out another local copy — the files under `projectDir` just changed out
     *  from under whatever the workspace has open. The parent reconciles the
     *  open editor buffer/preview the same way it does after a version
     *  restore (`ProjectActivityView`'s `onRestored`); the file tree and
     *  preview pick up the change on their own via the existing folder-
     *  changed push stream, since the checkout's writes are ordinary disk
     *  writes to the watched folder. */
    onProjectFilesChanged?: () => void;
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
  const TABS: Array<{ id: SettingsTab; label: string }> = [
    { id: "app", label: "App" },
    { id: "connections", label: "Accounts" },
    { id: "editor", label: "Editor" },
    { id: "saving", label: "Saving" },
  ];
  // Mounted fresh per open ({#if settingsOpen}) — the initial value is the
  // requested landing tab; navigation from there is user-driven. Sanitized:
  // an unknown value here used to leave NO tab active (empty settings body).
  // svelte-ignore state_referenced_locally
  let activeTab = $state<SettingsTab>(sanitizeSettingsTab(initialTab));
  let tabEls = $state<Record<SettingsTab, HTMLButtonElement | undefined>>({
    app: undefined,
    editor: undefined,
    saving: undefined,
    connections: undefined,
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

  // ── Linux AppImage application-menu integration (#119) ────────────────────
  // Opt-in: an AppImage is portable by design, so nothing is copied or
  // installed until the user presses the button here. The status query is
  // harmless everywhere (it reports `supported: false` off-Linux, in dev, and
  // outside an AppImage) — the whole section stays hidden unless supported, so
  // Windows/macOS/PWA users never see a Linux-only control.
  let appImage = $state<AppImageIntegrationStatus | null>(null);
  let appImageBusy = $state(false);
  let appImageNotice = $state("");
  let appImageError = $state("");

  onMount(() => {
    if (!isDesktop()) return;
    api.app.appImageIntegration
      .getStatus()
      .then((status) => {
        appImage = status;
      })
      .catch(() => {
        // A host that doesn't expose the hooks is simply "not supported here" —
        // never surface a startup error for an optional desktop nicety.
        appImage = null;
      });
  });

  // ── Saving tab — can this project sync? (#274) ────────────────────────────
  // The online-backup switch only makes sense for a project that can sync;
  // otherwise it is a control that would do nothing, per issue #274. Checked
  // once on mount (no `$effect` in this repo — CLAUDE.md §8), same as
  // ConnectionsSettings/ProjectConnectionsSection's own diagnoseProjectRemote
  // load. `projectDir === null` (the start screen) is treated as "cannot
  // sync" without a round-trip.
  let canSyncLoading = $state(true);
  let canSync = $state(false);

  onMount(() => {
    if (!isDesktop() || !projectDir) {
      canSyncLoading = false;
      return;
    }
    api.remote
      .diagnoseProjectRemote(projectDir)
      .then((diag) => {
        canSync = diag.canSync;
      })
      .catch(() => {
        canSync = false;
      })
      .finally(() => {
        canSyncLoading = false;
      });
  });

  // ── Saving tab — the copy this project is on (#273) ───────────────────────
  // Every copy is listed, including ones that so far exist only online;
  // switching to one of those creates it locally first. Hidden entirely — not
  // shown with an error — when there's nothing to switch between: no project
  // open, the browser target (no local git access at all), or `listBranches`
  // reports `null` (a plain local-folder, which has no repository). Loaded
  // once on mount, reloaded after a switch; no `$effect` (CLAUDE.md §8).
  let copies = $state<{ current: string | null; branches: string[]; remoteOnly: string[] } | null>(null);
  let copiesLoading = $state(true);
  /** The online check failed, so the copy list may be missing copies made elsewhere. */
  let copiesStale = $state(false);
  let selectedCopy = $state("");
  let copySwitching = $state(false);
  let copySwitchError = $state<string | null>(null);

  /**
   * `listBranches` reads refs off disk, so a copy pushed from somewhere else
   * is invisible until this clone fetches. Refreshing first is what makes a
   * copy created on another machine — or by a pull request opened for you —
   * show up here without dropping to a terminal. Best-effort: offline or
   * unconnected simply lists what is already on disk.
   */
  async function loadCopies(options: { refresh?: boolean } = {}) {
    if (!isDesktop() || !projectDir) {
      copies = null;
      copiesLoading = false;
      return;
    }
    copiesLoading = true;
    try {
      if (options.refresh) {
        const r = await api.remote
          .refreshCopies(projectDir)
          .catch(() => ({ refreshed: false, reason: "offline" as const }));
        // "no-remote" is not a problem — a project with no online copy has
        // nothing to check for. The other two mean the list may be short.
        copiesStale = !r.refreshed && r.reason !== "no-remote";
      }
      copies = await api.vcs.listBranches(projectDir);
    } catch {
      copies = null;
    } finally {
      copiesLoading = false;
    }
  }

  onMount(() => {
    void loadCopies({ refresh: true });
  });

  async function switchCopy() {
    if (!projectDir || !selectedCopy || copySwitching) return;
    const target = selectedCopy;
    copySwitching = true;
    copySwitchError = null;
    try {
      await api.vcs.switchBranch(projectDir, target);
      selectedCopy = "";
      await loadCopies();
      // The files under projectDir just changed out from under the open
      // workspace — reconcile the open editor buffer the same way a version
      // restore does (the file tree/preview pick up the change on their own
      // via the folder-changed push stream, which the checkout's writes fire
      // just like any other external disk change).
      onProjectFilesChanged?.();
    } catch (e) {
      copySwitchError = friendlyHostError(e instanceof Error ? e.message : String(e));
    } finally {
      copySwitching = false;
    }
  }

  async function runAppImageAction(action: "install" | "remove") {
    // `disabled={appImageBusy}` only takes effect after Svelte flushes, so a
    // fast double-click can land two calls. Each one is independently atomic,
    // so the worst case is redundant work — but one in-flight action at a time
    // keeps the notice/error lines describing the action the user actually sees.
    if (appImageBusy) return;
    appImageBusy = true;
    appImageNotice = "";
    appImageError = "";
    try {
      const result =
        action === "install"
          ? await api.app.appImageIntegration.install()
          : await api.app.appImageIntegration.remove();
      appImage = result.status;
      appImageNotice = result.message;
    } catch (e) {
      appImageError = e instanceof Error ? e.message : String(e);
    } finally {
      appImageBusy = false;
    }
  }

  // ── Typed setters (one line per control, per the "one-line setting" goal) ──
  const s = $derived(settings.current);
</script>

<div class="settings-view" class:embedded>
  {#if !embedded}
    <header class="settings-header">
      <h2 id="{idPrefix}-title">Settings</h2>
      <button class="settings-close" onclick={close} title="Close settings" aria-label="Close settings"><Icon name="x" size={16} /></button>
    </header>
  {/if}

  <div class="tab-bar" role="tablist" aria-label="Settings sections" onkeydown={onTablistKeydown} tabindex="-1">
    {#each TABS as tab (tab.id)}
      <button
        id="{idPrefix}-tab-{tab.id}"
        role="tab"
        class="tab"
        class:active={activeTab === tab.id}
        aria-selected={activeTab === tab.id}
        aria-controls="{idPrefix}-panel"
        tabindex={activeTab === tab.id ? 0 : -1}
        bind:this={tabEls[tab.id]}
        onclick={() => (activeTab = tab.id)}
      >{tab.label}</button>
    {/each}
  </div>

  <div
    id="{idPrefix}-panel"
    class="settings-body"
    role="tabpanel"
    aria-labelledby="{idPrefix}-tab-{activeTab}"
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
        <div class="row">
          <div class="row-label">
            <label for="set-context-menu">Right-click menu in the preview</label>
            <span class="row-hint">Right-click (or Shift+F10) an image, link, or block in the preview for quick edit actions.</span>
          </div>
          <input
            id="set-context-menu"
            type="checkbox"
            checked={s.preview.contextMenu}
            onchange={(e) => settings.set({ preview: { contextMenu: (e.currentTarget as HTMLInputElement).checked } })}
          />
        </div>
      </section>

      {#if isDesktop()}
      <section class="group">
        <div class="group-head">
          <h3>Updates</h3>
          <button class="reset" onclick={() => settings.resetSection("updates")} title="Reset update settings to defaults">Reset</button>
        </div>
        <div class="row">
          <div class="row-label">
            <label for="set-update-channel">Update channel</label>
            <span class="row-hint">Beta also includes stable releases; Alpha includes everything.</span>
          </div>
          <select
            id="set-update-channel"
            value={s.updates.channel}
            onchange={(e) => settings.set({ updates: { channel: (e.currentTarget as HTMLSelectElement).value as "stable" | "beta" | "alpha" } })}
          >
            <option value="stable">Stable — recommended</option>
            <option value="beta">Beta — early releases</option>
            <option value="alpha">Alpha — experimental builds</option>
          </select>
        </div>
      </section>
      {/if}

      <!-- Desktop integration (Linux AppImage only, #119) -------------------
           Rendered ONLY when the host reports the environment as supported:
           packaged Linux AppImage. Windows and macOS installers already create
           their own menu/dock entries, and a dev or browser run has nothing to
           install. -->
      {#if appImage?.supported}
      <section class="group">
        <div class="group-head">
          <h3>Desktop integration</h3>
        </div>
        <div class="row">
          <div class="row-label">
            <!-- A plain span, deliberately NOT a label associated with the
                 action button: a label association click-forwards to its
                 control, so clicking this row title — which reads as a
                 heading, not a control — would silently run the install.
                 That is exactly the surprise this opt-in feature exists to
                 avoid. A button takes its accessible name from its own
                 content anyway, so the association bought nothing; the hint
                 is tied to the button with aria-describedby instead. -->
            <span class="row-title">Application menu</span>
            <span class="row-hint" id="appimage-hint">
              {#if appImage.needsRepair}
                Some of the installed files are missing or out of date — add it again to repair the entry.
              {:else if appImage.staleCopy}
                <!-- The failure this exists to catch: the menu entry is a
                     complete, working install that launches an OLDER app than
                     the one running now. Nothing else in the UI would ever
                     say so — "installed" looked healthy, and the launcher
                     kept opening the previous build after every upgrade. -->
                Your menu entry launches a different copy of the app than the one
                you're running{appImage.staleCopy.kind === "version" && appImage.staleCopy.installedVersion
                  ? ` (version ${appImage.staleCopy.installedVersion}, and you're running ${appImage.staleCopy.runningVersion})`
                  : ""}. Update it to launch this version from your menu.
              {:else if appImage.installed}
                Gutterpress desktop is in your application menu, using the copy at {appImage.paths.appImage}.
              {:else}
                Add Gutterpress desktop to your application menu so you can launch it like any other app. This copies the app to {appImage.paths.appImage} — no administrator access needed.
              {/if}
            </span>
          </div>
          <div class="row-actions">
            <button
              class="action"
              aria-describedby="appimage-hint"
              disabled={appImageBusy}
              onclick={() => runAppImageAction("install")}
            >{appImageBusy
                ? "Working…"
                : appImage.needsRepair
                  ? "Repair menu entry"
                  : appImage.staleCopy
                    ? "Update menu entry"
                    : appImage.installed
                      ? "Reinstall"
                      : "Add to application menu"}</button>
            {#if appImage.installed || appImage.needsRepair}
              <button
                class="action subtle"
                disabled={appImageBusy}
                onclick={() => runAppImageAction("remove")}
              >Remove from menu</button>
            {/if}
          </div>
        </div>
        {#if appImageNotice}
          <!-- role="status" so the confirmation is announced too — the error
               path below was already announced via role="alert" (matches
               ConnectionsSettings.svelte's precedent). -->
          <p class="row-notice" role="status">{appImageNotice}</p>
        {/if}
        {#if appImageError}
          <p class="row-error" role="alert">{appImageError}</p>
        {/if}
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

      <!-- Advanced (for developers) — a section here since the dedicated
           Advanced tab was retired (2026-07-30): two developer knobs did not
           justify a whole tab. -->
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

      {#if activeTab === "saving"}
      <!-- Saving (#274 cut five controls to switches a writer can actually
           decide). Saving automatically is an on/off switch (owner request
           2026-09-25): #274 had dropped its old delay field because 0s was
           never off, but with no way to turn autosave off the Save button did
           nothing. The delay and crash recovery (1s emergency draft) stay
           fixed, not settings. Every switch persists under `versionHistory`,
           so this group's Reset restores the whole group in one call. -->
      <section class="group">
        <div class="group-head">
          <h3>Saving &amp; recovery</h3>
          <button class="reset" onclick={() => settings.resetSection("versionHistory")} title="Reset saving settings to defaults">Reset</button>
        </div>
        <!-- Saving on this computer -->
        <div class="row row-toggle">
          <div class="row-label">
            <label for="set-auto-save">Save edits automatically</label>
            <span class="row-hint">Writes your changes to this computer as you type. When off, they're saved when you press Save or leave the file, and the preview updates then.</span>
          </div>
          <input
            id="set-auto-save"
            type="checkbox"
            checked={s.versionHistory.autoSave}
            onchange={(e) => settings.set({ versionHistory: { autoSave: (e.currentTarget as HTMLInputElement).checked } })}
          />
        </div>
        <!-- Previous versions -->
        <div class="row row-toggle">
          <div class="row-label">
            <label for="set-auto-snapshot">Keep previous versions</label>
            <span class="row-hint">Lets you return to earlier versions of the project.</span>
          </div>
          <input
            id="set-auto-snapshot"
            type="checkbox"
            checked={s.versionHistory.autoSnapshot}
            onchange={(e) => settings.set({ versionHistory: { autoSnapshot: (e.currentTarget as HTMLInputElement).checked } })}
          />
        </div>
        <!-- Online backup (transparent-sync plan §6 / §8 step 7). Shown only
             for a project that can sync — canSyncLoading/canSync are read
             once on mount from diagnoseProjectRemote (no live re-check while
             this view stays open, matching ConnectionsSettings/
             ProjectConnectionsSection); a local-only project or the start
             screen (projectDir === null) gets one status line instead of a
             switch that would do nothing. Disabled when previous versions is
             off: a backup with nothing to push is not a backup. -->
        {#if canSyncLoading}
          <div class="row"><span class="row-hint">Checking this project's online status…</span></div>
        {:else if canSync}
          <div class="row row-toggle">
            <div class="row-label">
              <label for="set-auto-sync">Keep this project backed up online</label>
              <span class="row-hint">
                {#if s.versionHistory.autoSnapshot}
                  Sends your previous versions to your connected online service in the background.
                {:else}
                  Needs "Keep previous versions" turned on — a backup is made of your versions.
                {/if}
              </span>
            </div>
            <input
              id="set-auto-sync"
              type="checkbox"
              checked={s.versionHistory.autoSync}
              disabled={!s.versionHistory.autoSnapshot}
              onchange={(e) => {
                const enabled = (e.currentTarget as HTMLInputElement).checked;
                settings.set({ versionHistory: { autoSync: enabled } });
                // Notify the host orchestrator immediately so the change takes effect
                // without waiting for a settings reload cycle (§4.3).
                if (isDesktop()) getPlatform().setAutoSync(enabled).catch(() => {});
              }}
            />
          </div>
        {:else}
          <div class="row"><span class="row-hint">This project isn't connected to an online service yet. Connect one in Settings &gt; Accounts to back it up.</span></div>
        {/if}
        <!-- Copy switching (#273): which copy (git branch) the project is on,
             and a way to switch to another. Copies that exist only online are
             listed too and marked as such — switching to one creates it
             locally on the way in. Listing local copies alone made this look
             broken: the copy you went looking for was simply missing, with
             nothing to tell that apart from a bug. Hidden entirely, never
             shown as a dead control, when there's nothing to switch between:
             no project open, the browser target, or `copies` is null (a plain
             local-folder has no repository to have copies of). Vocabulary:
             "copy", never "branch", in every string below. -->
        {#if isDesktop() && projectDir && !copiesLoading && copies}
          {@const otherCopies = copies.branches.filter((name) => name !== copies?.current)}
          {@const onlineOnly = new Set(copies.remoteOnly ?? [])}
          <div class="row">
            <div class="row-label">
              <span class="row-title">Copy of this project you're working on</span>
              <span class="row-hint">{copies.current ?? "Unknown — this project's history looks unusual."}</span>
            </div>
            {#if otherCopies.length > 0}
              <div class="row-actions">
                <select
                  aria-label="Switch to another copy"
                  bind:value={selectedCopy}
                  disabled={copySwitching}
                >
                  <option value="" disabled>Switch to…</option>
                  {#each otherCopies as name (name)}
                    <option value={name}
                      >{name}{onlineOnly.has(name) ? " (online only)" : ""}</option
                    >
                  {/each}
                </select>
                <button
                  class="action"
                  disabled={!selectedCopy || copySwitching}
                  onclick={switchCopy}
                >{copySwitching ? "Switching…" : "Switch"}</button>
              </div>
            {/if}
          </div>
          {#if copiesStale}
            <p class="row-hint">
              Couldn't check online for copies made elsewhere, so this list may be
              incomplete. It shows the copies already on this computer.
            </p>
          {/if}
          {#if copySwitchError}
            <p class="row-error" role="alert">{copySwitchError}</p>
          {/if}
        {/if}
      </section>

      {/if}

      {#if activeTab === "connections"}
      <!-- Accounts — who you are (git identity, first) plus the ONE place to
           manage every stored credential AND this project's sync surface:
           publishing accounts, GitHub, other Git servers (incl. the former
           Advanced-setup token flow — consolidated 2026-07-22; the duplicate
           connect form and connected-servers list it carried are gone). -->
      <GitIdentitySection />
      <section class="group">
        <ConnectionsSettings {projectDir} />
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
  /* Embedded in the start screen's Settings tab: the landing column is the
     scroller and owns the horizontal rhythm, so this instance sizes to its
     content and adds no chrome of its own. */
  .settings-view.embedded {
    height: auto;
    background: transparent;
  }
  .settings-view.embedded .settings-body {
    flex: none;
    overflow-y: visible;
    padding: 16px 0 0;
  }
  .settings-view.embedded .tab-bar {
    padding: 0;
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
  /* Desktop integration (#119) — an action row rather than a value row, so it
     gets its own button pair + inline result lines. */
  .row-actions { display: inline-flex; gap: 6px; align-items: center; }
  /* Matches `.row label`'s look — an action row's title is a span, not a
     label, so it must not inherit a different colour by accident. */
  .row-title { color: var(--app-text-secondary); }
  .action {
    background: var(--app-surface-raised);
    border: 1px solid var(--app-control-border);
    color: var(--app-text);
    font-size: 12px;
    padding: 5px 10px;
    border-radius: 6px;
    cursor: pointer;
    white-space: nowrap;
  }
  .action:hover:not(:disabled) { background: var(--app-control-hover-bg); }
  .action:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  .action:disabled { opacity: 0.6; cursor: default; }
  .action.subtle { color: var(--app-text-muted); }
  .row-notice { font-size: 12px; line-height: 1.4; color: var(--app-success-text); margin: 6px 0 0; }
  .row-error { font-size: 12px; line-height: 1.4; color: var(--app-error-text); margin: 6px 0 0; }
  .advanced-hint {
    text-transform: none;
    letter-spacing: 0;
    color: var(--app-text-muted);
    font-weight: 400;
  }
</style>
