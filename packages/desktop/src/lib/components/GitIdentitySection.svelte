<script lang="ts">
  /**
   * GitIdentitySection — the author's name + email, recorded on every saved
   * version (git author identity). One shared section, rendered in BOTH
   * places an author manages accounts: Settings → Accounts (first section)
   * and the welcome screen's Accounts tab. Reads/writes the same persisted
   * `gitIdentity` settings section either way.
   */
  import { useSettings } from "$lib/settings.svelte";

  const settings = useSettings();
  const s = $derived(settings.current);
</script>

<section class="group">
  <div class="group-head">
    <h3>Your name &amp; email</h3>
    <button class="reset" onclick={() => settings.resetSection("gitIdentity")} title="Reset your name and email to defaults">Reset</button>
  </div>
  <p class="hint">Recorded on every version you save, so your project's history shows who made each change.</p>
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

<style>
  /* Mirrors SettingsView's group/row chrome (scoped styles don't cross the
     component boundary) so the section reads identically in either host. */
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
  .hint { font-size: 11px; line-height: 1.4; color: var(--app-text-muted); margin: 4px 0 8px; }
  .row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    font-size: 13px;
  }
  .row label { color: var(--app-text-secondary); }
  .row input {
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-control-border);
    color: var(--app-text-secondary);
    padding: 5px 8px;
    border-radius: 6px;
    font-size: 13px;
    min-width: 160px;
  }
</style>
