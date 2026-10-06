<script lang="ts">
  /**
   * AboutView — the start screen's About tab: which version you're running
   * (what support asks for) and the manual update check. Loads api.doctor()
   * itself on mount; desktop-only, like Troubleshooting → Diagnostics.
   * The host passes only the update-check wiring.
   */
  import { api } from "$lib/api";
  import type { DoctorDiagnostics } from "$lib/api";
  import Icon from "$lib/components/Icon.svelte";
  import type { UpdaterAvailableAction } from "$lib/platform";

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

  let data = $state<DoctorDiagnostics | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  async function load() {
    loading = true;
    error = null;
    try {
      data = await api.doctor();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  function loadOnMount(_el: HTMLElement) {
    if (!data && !loading) load();
  }
</script>

<div class="about" use:loadOnMount>
  {#if loading}
    <p class="status">Checking system…</p>
  {:else if error}
    <p class="status error">{error}</p>
    <button class="retry app-btn-primary" onclick={load}>Retry</button>
  {:else if data}
    <p class="intro">Which version you're running, and whether an update is available.</p>

    <section class="versions">
      <div><strong>Desktop:</strong> {data.desktopVersion}</div>
      <div><strong>Lib:</strong> {data.libVersion}</div>
    </section>

    {#if onCheckForUpdates}
      <section class="updates">
        <h3>Updates</h3>
        <p class="updates-note">
          {#if updateReadyVersion}
            An update (v{updateReadyVersion}) is ready to apply — use the update button at the top of this screen.
          {:else if updateAvailableVersion}
            An update (v{updateAvailableVersion}) is available — use the update button at the top of this screen to {updateAvailableAction === "open-release" ? "download it from GitHub" : "download it"}.
          {:else}
            Gutterpress checks for updates automatically. You can also check now.
          {/if}
        </p>
        <button
          class="update-check"
          onclick={() => onCheckForUpdates?.()}
          disabled={checkingUpdates}
        >
          <span class="update-check-icon" class:spinning={checkingUpdates}><Icon name="refresh-cw" /></span>
          {checkingUpdates ? "Checking for updates…" : "Check for updates"}
        </button>
      </section>
    {/if}
  {/if}
</div>

<style>
  .about { font-size: 13px; color: var(--app-text-secondary); padding-top: 16px; }
  .intro { margin: 0 0 14px; font-size: 12px; color: var(--app-text-muted); }
  .status { margin: 8px 0; }
  .status.error { color: var(--app-error-text); font-family: var(--app-font-mono); font-size: 12px; }
  .retry {
    padding: 6px 14px; font-size: 13px; border-radius: 4px;
    border-width: 1px; border-style: solid; cursor: pointer;
  }

  .versions { font-size: 13px; line-height: 1.7; margin-bottom: 18px; }
  .versions strong { color: var(--app-text-muted); font-weight: 500; min-width: 80px; display: inline-block; }

  .updates { margin-bottom: 18px; }
  .updates h3 { margin: 0 0 8px; font-size: 13px; text-transform: uppercase; color: var(--app-text-muted); letter-spacing: 0.5px; }
  .updates-note { margin: 0 0 10px; font-size: 12px; color: var(--app-text-muted); line-height: 1.5; }
  .update-check {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    font-size: 13px;
    border-radius: 6px;
    cursor: pointer;
    background: transparent;
    color: var(--app-text-muted);
    border: 1px solid var(--app-border);
  }
  .update-check:hover:not(:disabled) { background: var(--app-surface-hover); color: var(--app-text); }
  .update-check:disabled { opacity: 0.6; cursor: not-allowed; }
  .update-check-icon { display: inline-flex; }
  .update-check-icon.spinning :global(svg) { animation: help-update-spin 1s linear infinite; }
  @keyframes help-update-spin { to { transform: rotate(360deg); } }
</style>
