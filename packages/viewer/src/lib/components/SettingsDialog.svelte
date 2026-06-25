<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { useSettings } from "$lib/settings.svelte";
  import { setThemeMode } from "$lib/theme.svelte";
  import { getPlatform, isDesktop } from "$lib/platform";

  let {
    open = $bindable(false),
    onClose,
    triggerEl,
  }: {
    open?: boolean;
    onClose?: () => void;
    triggerEl?: HTMLButtonElement | undefined;
  } = $props();

  const settings = useSettings();
  let dialogEl = $state<HTMLDivElement | undefined>(undefined);

  function focusableElements() {
    return Array.from(
      dialogEl?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
      ) ?? []
    );
  }

  function focusFirstElement() {
    focusableElements()[0]?.focus();
  }

  function trapFocus(e: KeyboardEvent) {
    if (e.key !== "Tab") return;
    const focusable = focusableElements();
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // Focus the first control when the dialog opens. A `use:` action on the
  // {#if open} dialog node runs on mount (= on open) — no $effect.
  function autofocusOnOpen(_node: HTMLElement) {
    queueMicrotask(focusFirstElement);
  }

  function close() {
    open = false;
    onClose?.();
    triggerEl?.focus();
  }

  // ── Typed setters (one line per control, per the "one-line setting" goal) ──
  const s = $derived(settings.current);
</script>

{#if open}
  <div class="backdrop" onclick={close} role="presentation"></div>

  <div
    bind:this={dialogEl}
    use:autofocusOnOpen
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="settings-title"
    tabindex="-1"
    onkeydown={trapFocus}
  >
    <header class="dialog-header">
      <h2 id="settings-title">Settings</h2>
      <button class="close" onclick={close} title="Close (Esc)" aria-label="Close"><Icon name="x" size={16} /></button>
    </header>

    <div class="dialog-body">
      <!-- Appearance ------------------------------------------------------- -->
      <section class="group">
        <div class="group-head">
          <h3>Appearance</h3>
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
            onchange={(e) => settings.set({ preview: { viewMode: (e.currentTarget as HTMLSelectElement).value as "single" | "two-column" } })}
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
        <div class="row">
          <label for="set-autosave">Auto-save delay (seconds)</label>
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
        <div class="row row-toggle">
          <div class="row-label">
            <label for="set-crash-recovery">Crash recovery</label>
            <span class="row-hint">Restore your work if the app closes unexpectedly</span>
          </div>
          <input
            id="set-crash-recovery"
            type="checkbox"
            checked={s.editor.crashRecovery}
            onchange={(e) => settings.set({ editor: { crashRecovery: (e.currentTarget as HTMLInputElement).checked } })}
          />
        </div>
      </section>

      <!-- Version history (RC1-3) ------------------------------------------ -->
      <section class="group">
        <div class="group-head">
          <h3>Version history</h3>
          <button class="reset" onclick={() => settings.resetSection("versionHistory")} title="Reset version history settings to defaults">Reset</button>
        </div>
        <div class="row row-toggle">
          <div class="row-label">
            <label for="set-auto-snapshot">Automatic snapshots</label>
            <span class="row-hint">Save a snapshot of your work after you pause editing (only for projects with version history turned on)</span>
          </div>
          <input
            id="set-auto-snapshot"
            type="checkbox"
            checked={s.versionHistory.autoSnapshot}
            onchange={(e) => settings.set({ versionHistory: { autoSnapshot: (e.currentTarget as HTMLInputElement).checked } })}
          />
        </div>
        <div class="row">
          <label for="set-auto-snapshot-minutes">Save after this many quiet minutes</label>
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
        <!-- Auto-sync toggle (transparent-sync plan §6 / §8 step 7). Default ON
             for projects with a remote; local-only projects never auto-sync
             regardless of this toggle (the host enforces the canSync gate). -->
        <div class="row row-toggle">
          <div class="row-label">
            <label for="set-auto-sync">Automatically keep changes in sync</label>
            <span class="row-hint">When a repository is connected, changes are saved to it in the background — you see only a small status indicator and are asked only when two copies conflict</span>
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
      </section>

      <!-- Advanced (collapsed by default) --------------------------------- -->
      <!-- Developer-oriented knobs (file-watch polling, log verbosity). Hidden
           behind a disclosure so a non-technical writer never has to reason
           about milliseconds or log levels to use the app. -->
      <details class="group advanced">
        <summary class="group-head advanced-summary">
          <h3>Advanced <span class="advanced-hint">— for developers</span></h3>
        </summary>
        <div class="advanced-body">
        <div class="group-head advanced-reset-row">
          <span></span>
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
        </div>
      </details>

      <footer class="actions">
        <button class="primary" onclick={close}>Done</button>
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
  .backdrop {
    position: fixed;
    inset: 0;
    background: var(--app-backdrop);
    z-index: 1000;
  }
  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(560px, 92vw);
    max-height: 88vh;
    background: var(--app-surface);
    color: var(--app-text-secondary);
    border-radius: 8px;
    box-shadow: 0 14px 40px var(--app-shadow-lg);
    z-index: 1001;
    display: flex;
    flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--app-border-subtle);
  }
  .dialog-header h2 { margin: 0; font-size: 16px; font-weight: 600; }
  .close {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 5px;
    color: var(--app-text-muted);
    line-height: 1;
    cursor: pointer;
    padding: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* WCAG 2.5.8: minimum target size 24x24px */
    min-width: 28px;
    min-height: 28px;
  }
  .close:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  .close:hover { color: var(--app-text); background: var(--app-surface-hover); }
  .dialog-body {
    padding: 16px 18px;
    overflow-y: auto;
  }
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
    color: var(--app-text-faint);
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
  .row-hint { font-size: 11px; line-height: 1.3; color: var(--app-text-faint); }
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
     so the dropdowns rendered as light OS widgets against the dark dialog) and
     draw a consistent custom chevron. */
  .row select {
    appearance: none;
    -webkit-appearance: none;
    padding-right: 28px;
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
  /* Advanced disclosure: collapsed by default; summary reads as a section head. */
  .advanced > .advanced-summary { cursor: pointer; list-style: none; }
  .advanced > .advanced-summary::-webkit-details-marker { display: none; }
  .advanced > .advanced-summary::after {
    content: "▸";
    margin-left: auto;
    color: var(--app-text-muted);
    font-size: 11px;
  }
  .advanced[open] > .advanced-summary::after { content: "▾"; }
  .advanced-hint {
    text-transform: none;
    letter-spacing: 0;
    color: var(--app-text-faint);
    font-weight: 400;
  }
  .advanced-reset-row { border-bottom: none; margin-top: 4px; padding-bottom: 0; }
  .advanced-body { padding-top: 4px; }
  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding-top: 16px;
    margin-top: 8px;
    border-top: 1px solid var(--app-border-subtle);
  }
  .actions button {
    padding: 6px 14px;
    font-size: 13px;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .actions .primary { background: var(--app-focus-ring); color: var(--app-text-on-accent); }
  .actions .primary:hover { background: var(--app-accent-hover); }
</style>
