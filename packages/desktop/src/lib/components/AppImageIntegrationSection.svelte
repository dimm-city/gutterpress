<script lang="ts">
  /**
   * AppImageIntegrationSection — Troubleshooting → Diagnostics → Desktop
   * integration: the Linux AppImage application-menu entry. Renders nothing
   * unless the host reports a packaged AppImage. (The update check and channel
   * live beside the version line in TroubleshootingView.)
   */
  import { onMount } from "svelte";
  import { api, type AppImageIntegrationStatus } from "#lib/api.ts";

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

<!-- Desktop integration (Linux AppImage only, #119) -------------------
     Rendered ONLY when the host reports the environment as supported:
     packaged Linux AppImage. Windows and macOS installers already create
     their own menu/dock entries, and a dev or browser run has nothing to
     install. -->
{#if appImage?.supported}
<section class="group">
  <h3>Desktop integration</h3>
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
        class="app-btn app-btn-ghost"
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
          class="app-btn app-btn-ghost"
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
  h3 {
    margin: 0 0 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--app-border-subtle);
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--app-text-muted);
    letter-spacing: 0.09em;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    font-size: 13px;
  }
  .row-label { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .row-title { color: var(--app-text-secondary); }
  .row-hint { font-size: 11px; line-height: 1.3; color: var(--app-text-muted); }
  .row-actions { display: inline-flex; gap: 6px; align-items: center; }
  .row-actions button { white-space: nowrap; }
  .row-notice { font-size: 12px; line-height: 1.4; color: var(--app-success-text); margin: 6px 0 0; }
  .row-error { font-size: 12px; line-height: 1.4; color: var(--app-error-text); margin: 6px 0 0; }
</style>
