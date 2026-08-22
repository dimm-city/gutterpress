<script lang="ts">
  /**
   * ImageClashPicker — the ONE chooser that survives the 2026-08-14
   * convergence simplification, because visual content genuinely can't be
   * judged as text. Shown AFTER a sync already converged: when both sides
   * changed the same image, the NEWER version is already committed (the safe
   * default if this is dismissed), and this non-blocking picker shows both
   * versions side by side with one action — keep the other one instead.
   *
   * Both blob oids are pinned by the merge commit's parents, so this picker
   * can never go stale; images render via the host's read-only
   * `/api/sync/image-version` route. PWA-clean (§8 / ADR 0004).
   */
  import Icon from "$lib/components/Icon.svelte";
  import { api } from "$lib/api";
  import { basenameOf } from "$lib/platform/paths";
  import type { ImageClash } from "$lib/platform/contract";
  import { dialogBehavior } from "$lib/dialog";

  let {
    open = $bindable(false),
    projectDir,
    clashes = [],
    /** Called when the picker closes (choices applied or dismissed). */
    onDone,
    triggerEl,
  }: {
    open?: boolean;
    projectDir: string | null;
    clashes?: ImageClash[];
    onDone?: () => void;
    triggerEl?: HTMLButtonElement | undefined;
  } = $props();

  /** Per-path: which side is on disk right now (starts at the kept side). */
  let current = $state<Record<string, "local" | "online">>({});
  /** Per-path: a swap request is in flight. */
  let busy = $state<Record<string, boolean>>({});
  let errorMessage = $state<string | null>(null);

  function onDialogMount(_el: HTMLElement) {
    errorMessage = null;
    busy = {};
    current = Object.fromEntries(clashes.map((c) => [c.path, c.kept]));
  }

  function versionUrl(clash: ImageClash, side: "local" | "online"): string {
    const oid = side === "local" ? clash.localOid : clash.remoteOid;
    return (
      `/api/sync/image-version?projectDir=${encodeURIComponent(projectDir ?? "")}` +
      `&path=${encodeURIComponent(clash.path)}&oid=${encodeURIComponent(oid)}`
    );
  }

  async function keep(clash: ImageClash, side: "local" | "online") {
    if (!projectDir || busy[clash.path] || current[clash.path] === side) return;
    busy = { ...busy, [clash.path]: true };
    errorMessage = null;
    try {
      const oid = side === "local" ? clash.localOid : clash.remoteOid;
      await api.sync.keepImageVersion(projectDir, clash.path, oid);
      current = { ...current, [clash.path]: side };
    } catch {
      errorMessage =
        "That version couldn't be applied right now. Nothing was changed — you can try again.";
    } finally {
      busy = { ...busy, [clash.path]: false };
    }
  }

  function close() {
    open = false;
    onDone?.();
    triggerEl?.focus();
  }
</script>

{#if open && clashes.length > 0}
  <div class="dlg-backdrop" onclick={close} role="presentation"></div>

  <div
    class="dlg-shell"
    use:dialogBehavior={{ onClose: close, triggerEl, labelledBy: "image-clash-title", focusContainer: true }}
    use:onDialogMount
  >
    <header class="dlg-header">
      <h2 id="image-clash-title">
        <Icon name="image" />
        The same picture changed in two places
      </h2>
      <button class="dlg-close" onclick={close} title="Close (Esc)" aria-label="Close">
        <Icon name="x" size={16} />
      </button>
    </header>

    <div class="dialog-body">
      <p class="lede">
        The newest version was kept automatically — nothing is lost, and the
        other version stays in Previous versions. Pick the one you prefer for
        each picture.
      </p>

      {#if errorMessage}
        <p class="error-msg" role="alert">{errorMessage}</p>
      {/if}

      <!-- svelte-ignore a11y_no_redundant_roles -->
      <ul class="clash-list" role="list" aria-label="Pictures with two versions">
        {#each clashes as clash (clash.path)}
          <li class="clash-item">
            <div class="clash-path">{basenameOf(clash.path)}</div>
            <div class="pane-row">
              {#each ["local", "online"] as const as side (side)}
                <div class="version-pane" class:kept={current[clash.path] === side}>
                  <div class="pane-label">
                    {side === "local" ? "Your version" : "Online version"}
                    {#if current[clash.path] === side}
                      <span class="kept-badge">Kept</span>
                    {/if}
                  </div>
                  <img
                    class="version-img"
                    src={versionUrl(clash, side)}
                    alt={`${side === "local" ? "Your" : "Online"} version of ${basenameOf(clash.path)}`}
                  />
                  <button
                    class="keep-btn"
                    onclick={() => keep(clash, side)}
                    disabled={busy[clash.path] || current[clash.path] === side}
                  >
                    {current[clash.path] === side ? "This one is kept" : "Keep this one"}
                  </button>
                </div>
              {/each}
            </div>
          </li>
        {/each}
      </ul>
    </div>

    <footer class="dlg-actions">
      <button class="dlg-primary app-btn-primary" onclick={close}>Done</button>
    </footer>
  </div>
{/if}

<style>
  @import "$lib/styles/dialog-shell.css";

  .dlg-shell {
    width: min(680px, 94vw);
    max-height: 84vh;
  }

  .dialog-body {
    padding: 16px 18px;
    overflow-y: auto;
    flex: 1;
  }

  .lede {
    margin: 0 0 14px;
    font-size: 13px;
    line-height: 1.55;
    color: var(--app-text-secondary);
  }

  .clash-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .clash-item {
    border: 1px solid var(--app-border);
    border-radius: 8px;
    padding: 12px 14px;
  }

  .clash-path {
    font-size: 12px;
    font-family: var(--app-font-mono);
    color: var(--app-text-secondary);
    margin-bottom: 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pane-row {
    display: flex;
    gap: 10px;
  }

  .version-pane {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border: 1px solid var(--app-border-subtle);
    border-radius: 6px;
    padding: 8px;
  }
  .version-pane.kept {
    border-color: var(--app-focus-ring);
  }

  .pane-label {
    font-size: 10px;
    font-weight: 600;
    color: var(--app-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .kept-badge {
    background: var(--app-accent-subtle);
    color: var(--app-text);
    border-radius: 4px;
    padding: 1px 6px;
    text-transform: none;
    letter-spacing: normal;
    font-size: 10px;
  }

  .version-img {
    width: 100%;
    max-height: 220px;
    object-fit: contain;
    background: var(--app-surface-sunken);
    border-radius: 4px;
  }

  .keep-btn {
    padding: 6px 10px;
    font-size: 12px;
    border-radius: 6px;
    border: 1px solid var(--app-border);
    background: var(--app-surface-sunken);
    color: var(--app-text);
    cursor: pointer;
  }
  .keep-btn:hover:not(:disabled) {
    background: var(--app-surface-hover);
  }
  .keep-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .keep-btn:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }

  .error-msg {
    margin: 0 0 12px;
    padding: 8px 12px;
    border-radius: 6px;
    background: var(--app-error-bg);
    border: 1px solid var(--app-error-border);
    color: var(--app-error-text);
    font-size: 12px;
    line-height: 1.5;
  }
</style>
