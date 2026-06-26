<script lang="ts">
  /**
   * StylePicker (CSS-editing audit G1/G2) — choose which project stylesheet to
   * edit. The "Styles" affordance (editor toolbar + Document menu) opens this on
   * ALL screen sizes. Manifest-aware: the active stylesheet(s) (manifest
   * `styles:`) are sorted first and badged "Active"; other project `.css` files
   * (root, `styles/`, and each theme's `theme.css`) follow.
   *
   * Architecture: the host resolves the list (`getPlatform().listProjectStyles`,
   * a thin pass-through to the shared lib's `listProjectStyles`). This component
   * owns no editor knowledge — it calls `onChoose(absPath)` with the chosen
   * file's absolute path; the parent opens it in the shared editor. Desktop-only
   * in v1 (file IO host gate); on web `listProjectStyles` returns [] and the
   * dialog shows an empty state.
   *
   * The parent normally calls `show()` only when there is MORE than one style
   * (single-style projects open directly without a dialog); `show()` still
   * handles the 0/1 cases gracefully if called directly.
   */
  import Icon from "$lib/components/Icon.svelte";
  import { api } from "$lib/api";
  import type { ProjectStyle } from "$lib/api";

  let {
    open = $bindable(false),
    projectDir,
    /** Open the chosen stylesheet (absolute path) in the editor. */
    onChoose,
  }: {
    open?: boolean;
    projectDir: string | null;
    onChoose: (absPath: string) => void;
  } = $props();

  // The button that opened the picker — focus is restored to it on close.
  let triggerEl = $state<HTMLButtonElement | undefined>(undefined);

  let styles = $state<ProjectStyle[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  let dialogEl = $state<HTMLDivElement | undefined>(undefined);

  /**
   * Open the picker and load the project's stylesheets. Called directly from a
   * user gesture — no `$effect` reaction on `open`, per the runes-mode rule.
   * Records the trigger element for focus restoration on close.
   */
  export async function show(
    trigger?: HTMLButtonElement,
    preloaded?: ProjectStyle[],
  ): Promise<void> {
    if (trigger) triggerEl = trigger;
    open = true;
    // The opener (openStyles) usually already resolved the list to decide
    // single-vs-many; reuse it to avoid a second IPC + fs resolve per open.
    if (preloaded) {
      styles = preloaded;
      error = null;
    } else {
      await refresh();
    }
    queueMicrotask(() =>
      dialogEl?.querySelector<HTMLElement>("button.style-row, button.close")?.focus(),
    );
  }

  async function refresh() {
    if (!projectDir) {
      styles = [];
      return;
    }
    error = null;
    loading = true;
    try {
      styles = await api.project.listStyles(projectDir);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      styles = [];
    } finally {
      loading = false;
    }
  }

  function close() {
    open = false;
    triggerEl?.focus();
  }

  function choose(entry: ProjectStyle) {
    onChoose(entry.path);
    close();
  }

  /**
   * Keep Tab focus inside the modal (WCAG 2.1.2). The dialog is aria-modal, but
   * the browser doesn't enforce containment for keyboard-only users, so cycle
   * focus across the dialog's focusable elements on Tab / Shift+Tab.
   */
  function trapFocus(e: KeyboardEvent) {
    if (e.key !== "Tab" || !dialogEl) return;
    const items = Array.from(
      dialogEl.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = dialogEl.ownerDocument.activeElement as HTMLElement | null;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }
</script>

{#if open}
  <div class="backdrop" onclick={close} role="presentation"></div>

  <div
    bind:this={dialogEl}
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="style-picker-title"
    tabindex="-1"
    onkeydown={trapFocus}
  >
    <header class="dialog-header">
      <h2 id="style-picker-title">Edit styles</h2>
      <button class="close" onclick={close} title="Close (Esc)" aria-label="Close">
        <Icon name="x" size={16} />
      </button>
    </header>

    <div class="dialog-body">
      {#if error}
        <p class="error" role="alert">{error}</p>
      {/if}

      {#if loading}
        <p class="muted">Loading…</p>
      {:else if styles.length === 0}
        <p class="muted">
          This project has no stylesheet yet. Apply a theme from the Themes
          manager, or add a <code>.css</code> file to the project folder.
        </p>
      {:else}
        <p class="muted">Choose a stylesheet to edit. Active styles are applied to your book.</p>
        <ul class="style-list">
          {#each styles as entry (entry.path)}
            <li>
              <button
                class="style-row"
                onclick={() => choose(entry)}
                title={`Edit ${entry.displayName}`}
              >
                <span class="style-icon"><Icon name="palette" size={14} /></span>
                <span class="style-name">
                  {entry.displayName}
                  {#if entry.path}
                    <span class="style-path">{entry.path.replace(/\\/g, "/").split("/").pop()}</span>
                  {/if}
                </span>
                <span class="style-row-end">
                  {#if entry.active}
                    <span class="style-active">Active</span>
                  {/if}
                  <span class="style-edit">Edit</span>
                  <Icon name="chevron-right" size={14} />
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      <footer class="actions">
        <button class="ghost" onclick={close}>Close</button>
      </footer>
    </div>
  </div>
{/if}

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape" && open) close();
  }}
/>

<style>
  .backdrop { position: fixed; inset: 0; background: var(--app-backdrop); z-index: 1000; }
  .dialog {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: min(480px, 94vw); max-height: 80vh;
    background: var(--app-surface); color: var(--app-text-secondary);
    border-radius: 8px; box-shadow: 0 14px 40px var(--app-shadow-lg);
    z-index: 1001; display: flex; flex-direction: column; overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  .dialog-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 18px; border-bottom: 1px solid var(--app-border-subtle); flex-shrink: 0;
  }
  .dialog-header h2 { margin: 0; font-size: 16px; font-weight: 600; }
  .close {
    background: transparent; border: 1px solid transparent; border-radius: 5px;
    color: var(--app-text-muted); cursor: pointer; padding: 4px;
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 28px; min-height: 28px;
  }
  .close:hover { color: var(--app-text); background: var(--app-surface-hover); }
  .close:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  .dialog-body { padding: 18px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto; flex: 1; }
  .muted { margin: 0; font-size: 13px; color: var(--app-text-muted); }
  .error { color: var(--app-error-text); font-size: 12px; margin: 0; }
  .style-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .style-list li { display: flex; align-items: stretch; gap: 4px; }
  .style-row {
    flex: 1; display: flex; align-items: center; gap: 10px;
    text-align: left; padding: 8px 10px; border-radius: 6px;
    background: var(--app-surface); border: 1px solid var(--app-border);
    color: var(--app-text); cursor: pointer; font-size: 13px; font-weight: 500;
  }
  .style-row:hover {
    background: var(--app-accent-soft, var(--app-surface-hover));
    border-color: var(--app-accent, var(--app-focus-ring));
  }
  .style-row:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }
  .style-icon { display: inline-flex; color: var(--app-text-muted); }
  .style-name {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    display: flex; flex-direction: column; gap: 1px;
  }
  .style-path {
    font-size: 10px; font-weight: 400; color: var(--app-text-faint);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  /* Never let the trailing group shrink — the name ellipsizes instead, so the
     Active badge + chevron stay visible even for long nested paths at 390px. */
  .style-row-end { display: flex; align-items: center; gap: 8px; color: var(--app-text-muted); flex-shrink: 0; }
  .style-active {
    font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
    color: var(--app-text-on-accent); background: var(--app-accent, var(--app-focus-ring));
    border-radius: 4px; padding: 2px 6px;
  }
  /* display (not opacity) so the hint reserves NO width at rest — otherwise it
     pushes the chevron off the edge on the widest (active) row at narrow widths. */
  .style-edit { font-size: 11px; font-weight: 600; display: none; color: var(--app-accent, var(--app-text)); }
  .style-row:hover .style-edit,
  .style-row:focus-visible .style-edit { display: inline; }
  .actions {
    display: flex; gap: 8px; justify-content: flex-end; padding-top: 14px;
    margin-top: 4px; border-top: 1px solid var(--app-border-subtle); flex-shrink: 0;
  }
  .actions button { padding: 7px 16px; font-size: 13px; border-radius: 4px; cursor: pointer; border: 1px solid transparent; }
  .actions .ghost { background: transparent; color: var(--app-text-muted); border-color: var(--app-border); }
  .actions .ghost:hover { background: var(--app-surface-hover); color: var(--app-text); }
</style>
