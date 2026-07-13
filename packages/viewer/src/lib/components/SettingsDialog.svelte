<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { useSettings } from "$lib/settings.svelte";
  import { setThemeMode } from "$lib/theme.svelte";
  import { getPlatform, isDesktop } from "$lib/platform";
  import { dialogBehavior } from "$lib/dialog";

  let {
    open = $bindable(false),
    onClose,
    triggerEl,
    onViewModeChange,
    onCrashRecoveryChange,
  }: {
    open?: boolean;
    onClose?: () => void;
    triggerEl?: HTMLButtonElement | undefined;
    /** Called immediately when the user changes the view mode setting. */
    onViewModeChange?: (mode: "single" | "two-column") => void;
    /** Called immediately when the user toggles crash recovery. */
    onCrashRecoveryChange?: (enabled: boolean) => void;
  } = $props();

  const settings = useSettings();

  function close() {
    // Focus restoration to `triggerEl` is handled by the dialogBehavior action.
    open = false;
    onClose?.();
  }

  // ── Typed setters (one line per control, per the "one-line setting" goal) ──
  const s = $derived(settings.current);
</script>

{#if open}
  <div class="dlg-backdrop" onclick={close} role="presentation"></div>

  <div
    class="dlg-shell"
    use:dialogBehavior={{ onClose: close, triggerEl, labelledBy: "settings-title" }}
  >
    <header class="dlg-header">
      <h2 id="settings-title">Settings</h2>
      <button class="dlg-close" onclick={close} title="Close (Esc)" aria-label="Close"><Icon name="x" size={16} /></button>
    </header>

    <div class="dialog-body">
      <!-- App appearance (light/dark chrome) --------------------------------
           UX review M38: named "Appearance" here, but the config panel also
           used to have its OWN "Appearance" section for the print theme —
           two different concepts, same word. That panel section is now
           merged into "Look & style" (M35), so this is the only surviving
           "Appearance" in the app; the heading is qualified as "App
           appearance" anyway so the two can never collide again even if a
           future panel section reintroduces the word. -->
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

      <footer class="dlg-actions">
        <button class="dlg-primary" onclick={close}>Done</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  @import "$lib/styles/dialog-shell.css";

  /* Settings is the tallest dialog in normal use (many rows); wider + a
     slightly taller cap than the shared default. */
  .dlg-shell {
    width: min(560px, 92vw);
    max-height: 88vh;
  }
  /* Unlike the "pinned bar" dialogs (ConflictChoicesDialog, OperationLogDialog,
     …), Settings' footer is the last item INSIDE the scrolling body, not a
     sibling of it — restore its original in-flow spacing (no side padding,
     it inherits dialog-body's own 16/18 padding; no flex-shrink, dialog-body
     here isn't a flex container). */
  .dlg-actions {
    padding: 16px 0 0;
    margin-top: 8px;
  }
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
</style>
