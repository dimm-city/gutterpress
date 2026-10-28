<script lang="ts">
  /**
   * SettingsView — the app's Settings: one page in the shared AppView layer,
   * the same from the start screen and over a book (it never reads the open
   * book). Four groups; every control applies at once. Accounts are listed
   * here and added where they are needed (ConnectionsSettings).
   */
  import AppView from "#lib/components/AppView.svelte";
  import ConnectionsSettings from "#lib/components/ConnectionsSettings.svelte";
  import { useSettings } from "#lib/settings.svelte.ts";
  import { setThemeMode, type ThemeMode } from "#lib/theme.svelte.ts";
  import { getPlatform } from "#lib/platform/index.ts";

  let {
    onClose,
    focus,
  }: {
    onClose: () => void;
    /** Open with the cursor in this field (the "Add your name & email" banner). */
    focus?: "name";
  } = $props();

  const settings = useSettings();
  const s = $derived(settings.current);

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

<AppView
  title="Settings"
  icon="settings"
  measure={640}
  {onClose}
  closeLabel="Close settings"
  closeTitle="Close (Esc)"
  initialFocus={focus === "name" ? "#settings-name" : undefined}
>
  <section class="group" aria-labelledby="settings-appearance">
    <h2 id="settings-appearance">Appearance</h2>
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
    {@render toggle("settings-problems", "Mark problems in the editor", "Underlines lines the Problems list mentions.", s.editor.highlightProblems, (on) => settings.set({ editor: { highlightProblems: on } }))}
  </section>

  <section class="group" aria-labelledby="settings-saving">
    <h2 id="settings-saving">Saving</h2>
    {@render toggle("settings-autosave", "Save changes automatically", `When off, press ${isMac ? "⌘S" : "Ctrl+S"} to save.`, s.versionHistory.autoSave, (on) => settings.set({ versionHistory: { autoSave: on } }))}
    {@render toggle("settings-versions", "Keep previous versions", "So you can go back to an earlier version of a book.", s.versionHistory.autoSnapshot, (on) => settings.set({ versionHistory: { autoSnapshot: on } }))}
    <!-- A backup is made of the versions, so it needs them on. -->
    {@render toggle("settings-autosync", "Back up online automatically", s.versionHistory.autoSnapshot ? "For books with an online backup." : "Turn on Keep previous versions first.", s.versionHistory.autoSync, setAutoSync, !s.versionHistory.autoSnapshot)}
  </section>

  <section class="group" aria-labelledby="settings-identity">
    <h2 id="settings-identity">Your name and email</h2>
    <p class="hint">Saved with each version, so a book's history shows who changed what.</p>
    <div class="field">
      <label for="settings-name">Name</label>
      <input id="settings-name" type="text" autocomplete="name" value={s.gitIdentity.authorName} onchange={(e) => settings.set({ gitIdentity: { authorName: e.currentTarget.value } })} />
    </div>
    <div class="field">
      <label for="settings-email">Email</label>
      <input id="settings-email" type="email" autocomplete="email" value={s.gitIdentity.authorEmail} onchange={(e) => settings.set({ gitIdentity: { authorEmail: e.currentTarget.value } })} />
    </div>
  </section>

  <section class="group" aria-labelledby="settings-accounts">
    <h2 id="settings-accounts">Accounts</h2>
    <ConnectionsSettings />
  </section>
</AppView>

<style>
  .group { display: flex; flex-direction: column; gap: 8px; }
  h2 { margin: 0 0 2px; font-size: 15px; font-weight: 600; color: var(--app-text); }
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
  .radios label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .radios input { margin: 0; accent-color: var(--app-accent); }

  /* The switch: a native checkbox, so it keeps the keyboard and the
     accessibility of one; the thumb's side says on or off, not colour alone. */
  input[role="switch"] {
    appearance: none;
    flex-shrink: 0;
    position: relative;
    width: 36px;
    height: 20px;
    margin: 0;
    border: 1px solid var(--app-border);
    border-radius: 10px;
    background: var(--app-border);
    cursor: pointer;
  }
  input[role="switch"]::before {
    content: "";
    position: absolute;
    top: 1px;
    left: 1px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--app-text-on-accent);
    transition: transform 0.15s;
  }
  input[role="switch"]:checked { background: var(--app-focus-ring); border-color: var(--app-focus-ring); }
  input[role="switch"]:checked::before { transform: translateX(16px); }
  input[role="switch"]:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  input[role="switch"]:disabled { opacity: 0.45; cursor: default; }

  .field { display: grid; grid-template-columns: 120px minmax(0, 320px); align-items: center; gap: 16px; font-size: 13px; color: var(--app-text-secondary); }
  .field input {
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-control-border);
    color: var(--app-text);
    padding: 6px 8px;
    border-radius: 6px;
    font: inherit;
  }
  .field input:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }
</style>
