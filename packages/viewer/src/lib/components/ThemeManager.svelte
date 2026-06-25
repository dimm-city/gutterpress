<script lang="ts">
  /**
   * ThemeManager (#32) — browse, preview, apply, and import print-md themes.
   *
   * Architecture:
   * - All theme list/apply/import + manifest wiring runs node-side in the host
   *   (shared lib `theme-manager.ts`). The renderer reaches it through
   *   `getPlatform()` only (§8 / ADR 0004) — no Node/lib value import here.
   * - APPLY copies the theme folder into the project's `themes/` dir and wires
   *   the manifest `styles:` list; the active theme is shown and switchable.
   * - IMPORT accepts a local folder (native dialog) or a URL (raw CSS / theme
   *   folder), fetched host-side with the global fetch.
   * - THUMBNAIL preview (Occam): the host returns each theme's CSS via
   *   `readThemeCss`; we render a tiny fixed sample (a few headings + a
   *   paragraph + a list) with that CSS INLINED in a scaled, sandboxed
   *   `srcdoc` iframe. No puppeteer/Chromium, no paged.js — just a lightweight
   *   visual cue of the typography + palette.
   * - Desktop-only in v1 (host file IO). The trigger is hidden on web; this
   *   dialog guards with the `projectDir` it is given.
   */
  import Icon from "$lib/components/Icon.svelte";
  import { getPlatform } from "$lib/platform";
  import type { ThemeInfo, ApplyThemeTarget } from "$lib/platform/contract";

  let {
    open = $bindable(false),
    projectDir,
    /**
     * Called after a theme is successfully applied, with the applied theme's id
     * (audit M2). The parent uses it to offer/auto-open the new theme's CSS for
     * editing. Optional — omitting it leaves behavior unchanged.
     */
    onApplied,
  }: {
    open?: boolean;
    projectDir: string | null;
    onApplied?: (themeId: string) => void;
  } = $props();

  let triggerEl = $state<HTMLButtonElement | undefined>(undefined);
  let dialogEl = $state<HTMLDivElement | undefined>(undefined);

  let builtIns = $state<ThemeInfo[]>([]);
  let projectThemes = $state<ThemeInfo[]>([]);
  let activeId = $state<string | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let busyId = $state<string | null>(null);

  /** Per-theme thumbnail srcdoc HTML, keyed by `${kind}:${id}`. */
  let thumbs = $state<Record<string, string>>({});

  // "Import from URL" inline field.
  let url = $state("");

  /** A small fixed sample, themed by the supplied CSS, for the thumbnail. */
  function sampleSrcdoc(css: string): string {
    // Sandboxed (no scripts), CSS inlined. Mirrors the kind of content a
    // print-md book uses so headings/body/links/blockquote all show their style.
    const escaped = css; // CSS goes inside a <style> — safe; iframe is sandboxed.
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
html,body{margin:0;padding:0;}
body{padding:14px 16px;}
*{box-sizing:border-box;}
${escaped}
</style></head><body>
<h1>Chapter Title</h1>
<h2>A Section Heading</h2>
<p>The quick brown fox jumps over the lazy dog. Typography, color, and
spacing preview rendered with this theme&rsquo;s stylesheet.</p>
<blockquote>A short pull quote shows callout and accent styling.</blockquote>
<h3>Subheading</h3>
<ul><li>First list item</li><li>Second list item</li></ul>
<p><a href="#">A themed link</a> with <code>inline code</code>.</p>
</body></html>`;
  }

  function keyOf(t: ThemeInfo): string {
    return `${t.kind}:${t.id}`;
  }

  /** Load (lazily) the thumbnail srcdoc for one theme. */
  async function loadThumb(t: ThemeInfo): Promise<void> {
    const key = keyOf(t);
    if (thumbs[key]) return;
    try {
      const css = await getPlatform().readThemeCss(
        t.kind === "builtin" ? null : projectDir,
        { kind: t.kind, id: t.id },
      );
      thumbs = { ...thumbs, [key]: sampleSrcdoc(css) };
    } catch {
      // A theme whose CSS can't be read just shows no thumbnail (non-fatal).
    }
  }

  async function loadAllThumbs(themes: ThemeInfo[]): Promise<void> {
    await Promise.all(themes.map((t) => loadThumb(t)));
  }

  /**
   * Open the dialog and load themes (a user gesture from the parent trigger —
   * no `$effect` on `open`, per the runes-mode rule).
   */
  export async function show(trigger?: HTMLButtonElement): Promise<void> {
    if (trigger) triggerEl = trigger;
    open = true;
    await refresh();
    queueMicrotask(() =>
      dialogEl?.querySelector<HTMLElement>("button, input")?.focus(),
    );
  }

  async function refresh() {
    error = null;
    loading = true;
    try {
      const [bi, pt, active] = await Promise.all([
        getPlatform().listBuiltInThemes(),
        projectDir ? getPlatform().listProjectThemes(projectDir) : Promise.resolve([]),
        projectDir ? getPlatform().getActiveTheme(projectDir) : Promise.resolve(null),
      ]);
      builtIns = bi;
      projectThemes = pt;
      activeId = active?.id ?? null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
    await loadAllThumbs([...builtIns, ...projectThemes]);
  }

  function close() {
    open = false;
    triggerEl?.focus();
  }

  async function apply(t: ThemeInfo) {
    if (!projectDir) return;
    busyId = t.id;
    error = null;
    try {
      const target: ApplyThemeTarget = { kind: t.kind, id: t.id };
      const applied = await getPlatform().applyTheme(projectDir, target);
      activeId = applied.id;
      await refresh();
      onApplied?.(applied.id);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busyId = null;
    }
  }

  async function importFolder() {
    if (!projectDir) return;
    error = null;
    try {
      const added = await getPlatform().importThemeFromFolder(projectDir);
      if (added) await refresh();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function importUrl() {
    if (!projectDir) return;
    const u = url.trim();
    if (!u) {
      error = "Enter a theme URL (a .css file or a theme folder).";
      return;
    }
    error = null;
    busyId = "__url__";
    try {
      await getPlatform().importThemeFromUrl(projectDir, u);
      url = "";
      await refresh();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busyId = null;
    }
  }

  /** True when this theme (by id) is the project's active theme. */
  function isActive(t: ThemeInfo): boolean {
    // The active theme always lives in the project (apply copies built-ins into
    // themes/<id>). Match the project-kind card only, so a built-in card doesn't
    // also light up when its copy is the active project theme.
    return t.kind === "project" && activeId === t.id;
  }
</script>

{#snippet themeCard(t: ThemeInfo)}
  <li class="theme-card" class:active={isActive(t)}>
    <div class="thumb">
      {#if thumbs[keyOf(t)]}
        <iframe
          title={`Preview of ${t.name}`}
          srcdoc={thumbs[keyOf(t)]}
          sandbox=""
          scrolling="no"
          tabindex="-1"
        ></iframe>
      {:else}
        <div class="thumb-fallback"><Icon name="palette" size={20} /></div>
      {/if}
    </div>
    <div class="theme-meta">
      <div class="theme-name-row">
        <span class="theme-name">{t.name}</span>
        {#if isActive(t)}<span class="badge">Active</span>{/if}
      </div>
      {#if t.description}<p class="theme-desc">{t.description}</p>{/if}
      {#if t.author}<p class="theme-author">by {t.author}</p>{/if}
    </div>
    <div class="theme-actions">
      {#if isActive(t)}
        <span class="applied"><Icon name="circle-check" size={13} /> Applied</span>
      {:else}
        <button
          class="primary small"
          disabled={busyId === t.id || !projectDir}
          onclick={() => apply(t)}
        >
          {busyId === t.id ? "Applying…" : "Apply"}
        </button>
      {/if}
    </div>
  </li>
{/snippet}

{#if open}
  <div class="backdrop" onclick={close} role="presentation"></div>

  <div
    bind:this={dialogEl}
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="theme-manager-title"
    tabindex="-1"
  >
    <header class="dialog-header">
      <h2 id="theme-manager-title">Themes</h2>
      <button class="close" onclick={close} title="Close (Esc)" aria-label="Close">
        <Icon name="x" size={16} />
      </button>
    </header>

    <div class="dialog-body">
      {#if error}
        <p class="error" role="alert">{error}</p>
      {/if}

      {#if loading}
        <p class="muted">Loading themes…</p>
      {/if}

      <!-- Project (imported / applied) themes -->
      {#if projectThemes.length > 0}
        <section class="block">
          <h3>In this project</h3>
          <ul class="theme-grid">
            {#each projectThemes as t (t.id)}
              {@render themeCard(t)}
            {/each}
          </ul>
        </section>
      {/if}

      <!-- Built-in starter themes -->
      <section class="block">
        <h3>Built-in themes</h3>
        <ul class="theme-grid">
          {#each builtIns as t (t.id)}
            {@render themeCard(t)}
          {/each}
        </ul>
      </section>

      <!-- Import -->
      <section class="block">
        <h3>Import a theme</h3>
        <div class="add-row">
          <input
            class="url-input"
            type="text"
            placeholder="https://example.com/theme.css (or a theme folder URL)"
            bind:value={url}
            onkeydown={(e) => { if (e.key === "Enter") importUrl(); }}
            autocomplete="off"
          />
          <button class="primary" onclick={importUrl} disabled={busyId === "__url__" || !projectDir}>
            {busyId === "__url__" ? "Importing…" : "Import"}
          </button>
        </div>
        <button class="ghost full" onclick={importFolder} disabled={!projectDir}>
          <Icon name="folder" size={14} /> Import from a local folder…
        </button>
        <p class="hint">
          A theme is a folder with a <code>theme.css</code> (and optional
          <code>theme.json</code>). Applying a theme copies it into your
          project&rsquo;s <code>themes/</code> folder and sets it as the active
          stylesheet.
        </p>
      </section>
    </div>

    <footer class="actions">
      <button class="ghost" onclick={close}>Close</button>
    </footer>
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
    width: min(640px, 95vw); max-height: 88vh;
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

  .dialog-body { padding: 18px; display: flex; flex-direction: column; gap: 22px; overflow-y: auto; flex: 1; }
  .block { display: flex; flex-direction: column; gap: 12px; }
  .block h3 { margin: 0; font-size: 13px; font-weight: 600; color: var(--app-text); text-transform: uppercase; letter-spacing: 0.04em; }
  .muted { margin: 0; font-size: 13px; color: var(--app-text-muted); }
  .error { color: var(--app-error-text); font-size: 12px; margin: 0; }
  .hint { margin: 0; font-size: 11.5px; color: var(--app-text-faint); line-height: 1.4; }
  .hint code { background: var(--app-surface-sunken); padding: 1px 4px; border-radius: 3px; font-size: 11px; }

  .theme-grid {
    list-style: none; margin: 0; padding: 0;
    display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;
  }
  .theme-card {
    display: flex; flex-direction: column; gap: 8px;
    border: 1px solid var(--app-border); border-radius: 8px;
    background: var(--app-surface-sunken); padding: 10px; overflow: hidden;
  }
  .theme-card.active { border-color: var(--app-focus-ring); box-shadow: 0 0 0 1px var(--app-focus-ring); }

  .thumb {
    position: relative; width: 100%; aspect-ratio: 4 / 3;
    border-radius: 5px; overflow: hidden; background: #fff;
    border: 1px solid var(--app-border-subtle);
  }
  /* Render the sample at a larger logical size, scaled down, so type looks
     like a real page rather than a giant single heading. */
  .thumb iframe {
    border: 0; background: #fff; pointer-events: none;
    width: 300%; height: 300%;
    transform: scale(0.3333); transform-origin: top left;
  }
  .thumb-fallback {
    position: absolute; inset: 0; display: flex; align-items: center;
    justify-content: center; color: var(--app-text-faint);
    background: var(--app-surface);
  }

  .theme-meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .theme-name-row { display: flex; align-items: center; gap: 8px; }
  .theme-name { font-size: 13px; font-weight: 600; color: var(--app-text); }
  .badge {
    font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
    color: var(--app-text-on-accent); background: var(--app-focus-ring);
    padding: 1px 6px; border-radius: 999px;
  }
  .theme-desc { margin: 0; font-size: 11.5px; color: var(--app-text-muted); line-height: 1.4; }
  .theme-author { margin: 0; font-size: 11px; color: var(--app-text-faint); }

  .theme-actions { margin-top: auto; display: flex; justify-content: flex-end; }
  .applied { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--app-success-text, #3fb950); font-weight: 500; }

  .add-row { display: flex; gap: 8px; }
  .url-input {
    flex: 1; background: var(--app-surface-sunken); border: 1px solid var(--app-border);
    color: var(--app-text-secondary); padding: 8px 10px; border-radius: 6px;
    font-size: 13px; font-family: inherit; min-width: 0;
  }
  .url-input:focus { outline: none; border-color: var(--app-focus-ring); }

  button.full { width: 100%; justify-content: center; }
  .actions {
    display: flex; gap: 8px; justify-content: flex-end; padding: 14px 18px;
    border-top: 1px solid var(--app-border-subtle); flex-shrink: 0;
  }
  button { display: inline-flex; align-items: center; gap: 5px; padding: 7px 14px; font-size: 13px; border-radius: 5px; cursor: pointer; border: 1px solid transparent; font-family: inherit; }
  button.small { padding: 5px 12px; font-size: 12px; }
  .primary { background: var(--app-focus-ring); color: var(--app-text-on-accent); }
  .primary:hover:not(:disabled) { background: var(--app-accent-hover); }
  .ghost { background: transparent; color: var(--app-text-muted); border-color: var(--app-border); }
  .ghost:hover:not(:disabled) { background: var(--app-surface-hover); color: var(--app-text); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }

  @media (max-width: 520px) {
    .theme-grid { grid-template-columns: 1fr; }
  }
</style>
