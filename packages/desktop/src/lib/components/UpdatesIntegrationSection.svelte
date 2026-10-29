<script lang="ts">
  /**
   * UpdatesIntegrationSection — the app-level controls that live under
   * Troubleshooting → Diagnostics: the manual update check, the update
   * channel, and (Linux AppImage only) the application-menu integration.
   * They moved out of Settings → App and the old About tab; the settings
   * keys and behaviour are unchanged. The host passes only the update-check
   * wiring.
   */
  import { onMount } from "svelte";
  import { api, type AppImageIntegrationStatus } from "#lib/api.ts";
  import Icon from "#lib/components/Icon.svelte";
  import { useSettings } from "#lib/settings.svelte.ts";
  import type { UpdaterAvailableAction } from "#lib/platform/index.ts";

  let {
    onCheckForUpdates,
    checkingUpdates = false,
    updateReadyVersion = null,
    updateAvailableVersion = null,
    updateAvailableAction = null,
  }: {
    onCheckForUpdates?: () => void;
    checkingUpdates?: boolean;
    updateReadyVersion?: string | null;
    updateAvailableVersion?: string | null;
    updateAvailableAction?: UpdaterAvailableAction | null;
  } = $props();

  const settings = useSettings();
  const s = $derived(settings.current);

  // ── Linux AppImage application-menu integration (#119) ────────────────────
  // Opt-in: an AppImage is portable by design, so nothing is copied or
  // installed until the user presses the button here. The status query is
  // harmless everywhere (it reports `supported: false` off-Linux, in dev, and
  // outside an AppImage) — the whole section stays hidden unless supported, so
  // Windows/macOS users never see a Linux-only control.
  let appImage = $state<AppImageIntegrationStatus | null>(null);
  let appImageBusy = $state(false);
  let appImageNotice = $state("");
  let appImageError = $state("");

  onMount(() => {
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
</script>

<section class="group">
  <div class="group-head">
    <h3>Updates</h3>
    <button class="reset" onclick={() => settings.resetSection("updates")} title="Reset update settings to defaults">Reset</button>
  </div>
  {#if onCheckForUpdates}
    <div class="row">
      <div class="row-label">
        <span class="row-title">Check for updates</span>
        <span class="row-hint">
          {#if updateReadyVersion}
            An update (v{updateReadyVersion}) is ready to apply — use the update button at the top of this screen.
          {:else if updateAvailableVersion}
            An update (v{updateAvailableVersion}) is available — use the update button at the top of this screen to {updateAvailableAction === "open-release" ? "download it from GitHub" : "download it"}.
          {:else}
            Gutterpress checks for updates automatically. You can also check now.
          {/if}
        </span>
      </div>
      <button class="action" onclick={() => onCheckForUpdates?.()} disabled={checkingUpdates}>
        <span class="update-check-icon" class:spinning={checkingUpdates}><Icon name="refresh-cw" size={12} /></span>
        {checkingUpdates ? "Checking…" : "Check now"}
      </button>
    </div>
  {/if}
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
         AccountsView.svelte's precedent). -->
    <p class="row-notice" role="status">{appImageNotice}</p>
  {/if}
  {#if appImageError}
    <p class="row-error" role="alert">{appImageError}</p>
  {/if}
</section>
{/if}

<style>
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
  .row-label { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .row-hint { font-size: 11px; line-height: 1.3; color: var(--app-text-muted); }
  .row select {
    padding: 5px 8px;
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
  .update-check-icon { display: inline-flex; vertical-align: -2px; }
  .update-check-icon.spinning :global(svg) { animation: update-spin 1s linear infinite; }
  @keyframes update-spin { to { transform: rotate(360deg); } }
</style>
