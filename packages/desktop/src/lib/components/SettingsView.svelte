<script lang="ts">
  /**
   * SettingsView — the app's Settings: one page in the shared AppView layer,
   * the same from the start screen and over a book (it never reads the open
   * book). Every control applies at once. The first group, Reader or Author,
   * decides how much of the app shows; Appearance, Preview, Editor and Saving
   * each show one settings section and have a Reset that puts that section
   * back to its defaults. Your name and email and every account have their
   * own page (AccountsView), which the last group opens.
   *
   * The controls and keys are the ones 0.11.22 had (#481): a saved
   * app-settings.json reads the same.
   */
  import AppView from "#lib/components/AppView.svelte";
  import { useSettings } from "#lib/settings.svelte.ts";
  import { setThemeMode, syncThemeFromSettings, type ThemeMode } from "#lib/theme.svelte.ts";
  import { getPlatform } from "#lib/platform/index.ts";
  import type { WorkspaceRole } from "#lib/platform/shared-types.ts";
  import { MARGIN_OVERLAY_STRENGTHS, OVERLAY_LAYERS, overlayStyleFrom } from "#lib/margin-overlay.ts";
  import { ZOOM_LEVELS } from "#lib/editor/preview-layout.ts";

  let {
    onClose,
    onOpenAccounts,
  }: {
    onClose: () => void;
    /** Open the Accounts page in place of this one. */
    onOpenAccounts: () => void;
  } = $props();

  const settings = useSettings();
  const s = $derived(settings.current);
  const overlayStyle = $derived(overlayStyleFrom(s.preview.overlayColors, s.preview.marginOverlayStrength));
  // A zoom the + and - keys stepped to (175%) is not one of the levels: it is listed as it is.
  const zoomLevels = $derived.by(() => {
    const zoom = s.preview.defaultZoom;
    const pct = Math.round(parseFloat(zoom) * 100);
    return ZOOM_LEVELS.some(([value]) => value === zoom) || !Number.isFinite(pct) ? ZOOM_LEVELS : [...ZOOM_LEVELS, [zoom, `${pct}%`] as const];
  });

  const ROLES: Array<{ value: WorkspaceRole; label: string; hint: string }> = [
    { value: "reader", label: "Reader", hint: "Just the pages. Edit, Setup and Publish stay out of the way. Creating a book switches you to Author." },
    { value: "author", label: "Author", hint: "Write and set up your book, then publish it." },
  ];
  const THEMES: Array<{ value: ThemeMode; label: string }> = [
    { value: "system", label: "Match system" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];
  const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

  function setAutoSync(on: boolean) {
    settings.set({ versionHistory: { autoSync: on } });
    // Tell the host now, so the change applies without a settings reload.
    getPlatform().setAutoSync(on).catch(() => {});
  }

  // The theme and automatic backing up take effect through the theme
  // controller and the host, not the store alone, so their Reset tells them too.
  function resetAppearance() {
    settings.resetSection("appearance");
    syncThemeFromSettings();
  }
  function resetSaving() {
    settings.resetSection("versionHistory");
    getPlatform().setAutoSync(settings.current.versionHistory.autoSync).catch(() => {});
  }
</script>

{#snippet toggle(id: string, label: string, hint: string, checked: boolean, set: (on: boolean) => void, disabled = false)}
  <div class="row">
    <div class="row-text">
      <label for={id}>{label}</label>
      <span class="hint" id="{id}-hint">{hint}</span>
    </div>
    <input
      {id}
      type="checkbox"
      role="switch"
      aria-describedby="{id}-hint"
      {checked}
      {disabled}
      onchange={(e) => set(e.currentTarget.checked)}
    />
  </div>
{/snippet}

<!-- A group's Reset, beside its heading: puts that group's settings back to the defaults. -->
{#snippet reset(group: string, run: () => void)}
  <button type="button" class="app-btn app-btn-ghost reset" onclick={run} aria-label="Reset {group}" title="Reset {group} to the defaults">Reset</button>
{/snippet}

<AppView title="Settings" icon="settings" measure={640} {onClose} closeLabel="Close settings" closeTitle="Close (Esc)">
  <!-- The one choice that decides how much of the app shows. Reader is the
       default; creating a book switches to Author; it is remembered. -->
  <section class="group" aria-labelledby="settings-role">
    <h2 id="settings-role">How you use Gutterpress</h2>
    <div class="radios roles" role="radiogroup" aria-labelledby="settings-role">
      {#each ROLES as r (r.value)}
        <label>
          <input type="radio" name="settings-role" value={r.value} checked={s.workspace.role === r.value} onchange={() => settings.set({ workspace: { role: r.value } })} />
          <span class="row-text">
            <span class="role-title">{r.label}</span>
            <span class="hint">{r.hint}</span>
          </span>
        </label>
      {/each}
    </div>
  </section>

  <section class="group" aria-labelledby="settings-appearance">
    <div class="group-head">
      <h2 id="settings-appearance">Appearance</h2>
      {@render reset("Appearance", resetAppearance)}
    </div>
    <fieldset class="row">
      <legend>Theme</legend>
      <div class="radios">
        {#each THEMES as t (t.value)}
          <label>
            <input type="radio" name="settings-theme" value={t.value} checked={s.appearance.theme === t.value} onchange={() => setThemeMode(t.value)} />
            {t.label}
          </label>
        {/each}
      </div>
    </fieldset>
    <div class="row">
      <div class="row-text">
        <label for="settings-preview-bg">Preview background</label>
        <span class="hint" id="settings-preview-bg-hint">The colour around the pages.</span>
      </div>
      <input id="settings-preview-bg" type="color" aria-describedby="settings-preview-bg-hint" value={s.appearance.previewBg} oninput={(e) => settings.set({ appearance: { previewBg: e.currentTarget.value } })} />
    </div>
  </section>

  <section class="group" aria-labelledby="settings-preview">
    <div class="group-head">
      <h2 id="settings-preview">Preview</h2>
      {@render reset("Preview", () => settings.resetSection("preview"))}
    </div>
    <div class="row">
      <div class="row-text">
        <label for="settings-zoom">Default zoom</label>
        <span class="hint" id="settings-zoom-hint">The zoom a book opens at. Choosing a zoom in the preview changes it too.</span>
      </div>
      <select id="settings-zoom" aria-describedby="settings-zoom-hint" value={s.preview.defaultZoom} onchange={(e) => settings.set({ preview: { defaultZoom: e.currentTarget.value } })}>
        {#each zoomLevels as [value, label] (value)}
          <option {value}>{label}</option>
        {/each}
      </select>
    </div>
    {@render toggle("settings-context-menu", "Right-click menu in the preview", "Right-click (or Shift+F10) an image, link, or block in the preview for quick edit actions.", s.preview.contextMenu, (on) => settings.set({ preview: { contextMenu: on } }))}
    <div class="row wrap">
      <div class="row-text">
        <span id="settings-overlay-strength">Print overlay strength</span>
        <span class="hint" id="settings-overlay-strength-hint">How strongly the print overlays (the preview's toolbar button) are drawn. The bleed and safe areas come from the book's print settings; the page margins are its stylesheet's own.</span>
      </div>
      <div class="radios" role="radiogroup" aria-labelledby="settings-overlay-strength" aria-describedby="settings-overlay-strength-hint">
        {#each MARGIN_OVERLAY_STRENGTHS as o (o.value)}
          <label>
            <input type="radio" name="settings-overlay-strength" value={o.value} checked={overlayStyle.strength === o.value} onchange={() => settings.set({ preview: { marginOverlayStrength: o.value } })} />
            {o.label}
          </label>
        {/each}
      </div>
    </div>
    {#each OVERLAY_LAYERS as layer (layer.id)}
      <div class="row">
        <label for="settings-overlay-color-{layer.id}">{layer.label} overlay colour</label>
        <input
          id="settings-overlay-color-{layer.id}"
          type="color"
          value={overlayStyle.colors[layer.id]}
          oninput={(e) => settings.set({ preview: { overlayColors: { ...overlayStyle.colors, [layer.id]: e.currentTarget.value } } })}
        />
      </div>
    {/each}
  </section>

  <section class="group" aria-labelledby="settings-editor">
    <div class="group-head">
      <h2 id="settings-editor">Editor</h2>
      {@render reset("Editor", () => settings.resetSection("editor"))}
    </div>
    {@render toggle("settings-problems", "Mark problems in the editor", "Underlines lines the Problems list mentions.", s.editor.highlightProblems, (on) => settings.set({ editor: { highlightProblems: on } }))}
  </section>

  <section class="group" aria-labelledby="settings-saving">
    <div class="group-head">
      <h2 id="settings-saving">Saving</h2>
      {@render reset("Saving", resetSaving)}
    </div>
    {@render toggle("settings-autosave", "Save changes automatically", `When off, press ${isMac ? "⌘S" : "Ctrl+S"} to save.`, s.versionHistory.autoSave, (on) => settings.set({ versionHistory: { autoSave: on } }))}
    {@render toggle("settings-versions", "Keep version history", "So you can go back to an earlier version of a book.", s.versionHistory.autoSnapshot, (on) => settings.set({ versionHistory: { autoSnapshot: on } }))}
    <!-- Backing up sends the versions, so it needs them on. -->
    {@render toggle("settings-autosync", "Back up online automatically", s.versionHistory.autoSnapshot ? "For books with an online copy." : "Turn on Keep version history first.", s.versionHistory.autoSync, setAutoSync, !s.versionHistory.autoSnapshot)}
  </section>

  <section class="group" aria-labelledby="settings-accounts">
    <h2 id="settings-accounts">Accounts</h2>
    <div class="row">
      <span class="hint">Your name and email, GitHub, Git servers and publishing accounts, used by every book.</span>
      <button class="app-btn" onclick={onOpenAccounts}>Accounts…</button>
    </div>
  </section>
</AppView>

<style>
  .group { display: flex; flex-direction: column; gap: 8px; }
  h2 { margin: 0 0 2px; font-size: 15px; font-weight: 600; color: var(--app-text); }
  .group-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .group-head h2 { margin: 0; }
  .reset { padding: 3px 10px; font-size: 12px; }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
    font-size: 13px;
    color: var(--app-text-secondary);
  }
  .row-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .hint { margin: 0; font-size: 12px; line-height: 1.4; color: var(--app-text-muted); }
  /* A legend is not a flex item; floated, it sits on the row like a label. */
  legend { float: left; padding: 0; }
  .radios { display: flex; gap: 16px; }
  .row > .radios { flex-shrink: 0; }
  /* A row whose control is wide (three choices) puts it under its words when the page is narrow. */
  .row.wrap { flex-wrap: wrap; }
  .row.wrap .row-text { flex: 1 1 260px; }
  .radios label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .radios input { margin: 0; accent-color: var(--app-accent); }
  /* Reader / Author: stacked, each with its description under the name. */
  .radios.roles { flex-direction: column; gap: 10px; }
  .radios.roles label { align-items: flex-start; }
  .radios.roles input { margin-top: 2px; }
  .role-title { font-size: 13px; color: var(--app-text); }
  select { flex-shrink: 0; min-width: 140px; padding: 5px 8px; font: inherit; font-size: 13px; }
  input[type="color"] {
    flex-shrink: 0;
    width: 40px;
    height: 26px;
    padding: 0 2px;
    border: 1px solid var(--app-field-border);
    border-radius: 6px;
    background: var(--app-surface-sunken);
    cursor: pointer;
  }
  input[type="color"]:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }

  /* The switch: a native checkbox, so it keeps the keyboard and the
     accessibility of one; the thumb's side says on or off, not colour alone.
     Off is an outline and a muted thumb (as in Fluent), so the control keeps
     3:1 against the page in both themes (WCAG 1.4.11); on is a filled track. */
  input[role="switch"] {
    appearance: none;
    flex-shrink: 0;
    position: relative;
    width: 36px;
    height: 20px;
    margin: 0;
    border: 1px solid var(--app-text-muted);
    border-radius: 10px;
    background: transparent;
    cursor: pointer;
  }
  input[role="switch"]::before {
    content: "";
    position: absolute;
    top: 3px;
    left: 3px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--app-text-muted);
    transition: transform 0.15s;
  }
  input[role="switch"]:checked { background: var(--app-focus-ring); border-color: var(--app-focus-ring); }
  input[role="switch"]:checked::before { top: 1px; left: 1px; width: 16px; height: 16px; background: var(--app-text-on-accent); transform: translateX(16px); }
  input[role="switch"]:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  input[role="switch"]:disabled { opacity: 0.45; cursor: default; }
</style>
