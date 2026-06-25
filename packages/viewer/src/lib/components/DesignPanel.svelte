<script lang="ts">
  /**
   * DesignPanel — the GUIDED styling surface (print-md's headline goal: "style
   * by setting CSS custom properties" without hand-editing raw CSS). It reads the
   * active stylesheet's text with the platform's plain `readFile`, parses its
   * `:root` custom properties (pure strings — no node, no IPC), and exposes them
   * as color pickers + size controls. Each change rewrites the value in the text
   * and `writeFile`s it; the preview hot-swaps. Raw-CSS editing stays as an
   * escape hatch ("Edit raw CSS"). No `$effect`.
   */
  import { getPlatform } from "$lib/platform";
  import type { ProjectStyle } from "$lib/platform/contract";
  import { parseRootTokens, setRootToken, type StyleToken } from "$lib/css-tokens";
  import type { ToastController } from "$lib/components/Toast.svelte";
  import Icon from "$lib/components/Icon.svelte";

  let {
    open = $bindable(false),
    projectDir = null,
    toast = null,
    onEditRawCss,
  }: {
    open?: boolean;
    projectDir?: string | null;
    toast?: ToastController | null;
    /** Open the raw-CSS editor for the resolved stylesheet (escape hatch). */
    onEditRawCss?: (cssPath: string) => void;
  } = $props();

  let cssPath = $state<string | null>(null);
  let cssName = $state<string>("");
  let cssText = $state<string>("");
  let tokens = $state<StyleToken[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let saveStatus = $state<"idle" | "saving" | "saved">("idle");
  let dialogEl = $state<HTMLDivElement | undefined>(undefined);
  let triggerEl: HTMLButtonElement | undefined;

  // Baseline values captured when the panel opens, so changes are reversible
  // (UX review D-1). Plain Map (read during token-driven re-renders).
  const originals = new Map<string, string>();
  const isDirty = (t: StyleToken) =>
    originals.has(t.name) && originals.get(t.name) !== t.value;
  const anyDirty = $derived(tokens.some(isDirty));

  // Resolve any opaque CSS color (named/rgb/hsl/short-hex) to #rrggbb via the
  // browser's own parser, so every color row shows consistently and gets a
  // picker. Returns null for alpha/var()/gradient (those stay text-only).
  function toHex(value: string): string | null {
    try {
      const ctx = document.createElement("canvas").getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#000000";
      ctx.fillStyle = value;
      const out = ctx.fillStyle;
      return typeof out === "string" && /^#[0-9a-f]{6}$/i.test(out) ? out : null;
    } catch {
      return null;
    }
  }
  const colorHex = (v: string) => toHex(v) ?? v;

  // Group by how the value should be edited: a color (picker), a number (stepper),
  // or free text. Colors are detected by the browser, not a hard-coded list.
  const isColor = (t: StyleToken) => toHex(t.value) !== null;
  const colorTokens = $derived(tokens.filter((t) => isColor(t)));
  const sizeTokens = $derived(tokens.filter((t) => !isColor(t) && t.unit !== undefined));
  const otherTokens = $derived(tokens.filter((t) => !isColor(t) && t.unit === undefined));

  /** Open the panel for the project's ACTIVE stylesheet (what the preview links). */
  export async function show(trigger?: HTMLButtonElement): Promise<void> {
    if (trigger) triggerEl = trigger;
    if (!projectDir) return;
    open = true;
    loading = true;
    error = null;
    tokens = [];
    cssPath = null;
    try {
      const styles: ProjectStyle[] = await getPlatform().listProjectStyles(projectDir);
      const active = styles.find((s) => s.active);
      if (!active) {
        cssName = "";
        return;
      }
      cssPath = active.path;
      cssName = active.displayName;
      cssText = await getPlatform().readFile(active.path);
      tokens = parseRootTokens(cssText);
      originals.clear();
      for (const t of tokens) originals.set(t.name, t.value);
      saveStatus = "idle";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
    queueMicrotask(() =>
      dialogEl?.querySelector<HTMLElement>("input, button")?.focus(),
    );
  }

  async function close() {
    // Drain pending debounced writes (and let them settle) BEFORE closing, so an
    // edit made within the debounce window is never lost.
    await flushPending();
    cssPath = null;
    tokens = [];
    open = false;
    triggerEl?.focus();
  }

  // One debounce per token so dragging a slider doesn't thrash the file (and the
  // preview hot-swap). `pending` holds the latest unsaved value so close() flushes.
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, string>();
  function scheduleWrite(name: string, value: string) {
    pending.set(name, value);
    saveStatus = "saving";
    clearTimeout(timers.get(name));
    timers.set(name, setTimeout(() => { timers.delete(name); void commit(name); }, 250));
  }

  /** Fire + await every pending write (used on close). */
  async function flushPending() {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    await Promise.allSettled([...pending.keys()].map((name) => commit(name)));
  }

  /** Write the current stylesheet text (with `name`'s pending value applied). */
  async function commit(name: string) {
    const value = pending.get(name);
    if (!cssPath || value === undefined) return;
    cssText = setRootToken(cssText, name, value);
    try {
      await getPlatform().writeFile(cssPath, cssText);
      pending.delete(name);
      if (pending.size === 0 && timers.size === 0) saveStatus = "saved";
    } catch (e) {
      saveStatus = "idle";
      toast?.error?.(`Couldn't save ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Update a token's value (immutable) + schedule the write. */
  function setValue(t: StyleToken, value: string) {
    tokens = tokens.map((tok) => (tok.name === t.name ? { ...tok, value } : tok));
    scheduleWrite(t.name, value);
  }

  function resetToken(t: StyleToken) {
    const o = originals.get(t.name);
    if (o !== undefined && o !== t.value) setValue(t, o);
  }
  function revertAll() {
    for (const t of tokens) resetToken(t);
  }

  function setLength(t: StyleToken, num: string) {
    const n = num.trim();
    if (n === "") return;
    setValue(t, `${n}${t.unit ?? ""}`);
  }
</script>

{#snippet resetBtn(t: StyleToken)}
  {#if isDirty(t)}
    <button
      class="reset"
      title="Reset to original"
      aria-label={`Reset ${t.label}`}
      onclick={() => resetToken(t)}
    >
      <Icon name="refresh-cw" size={12} />
    </button>
  {:else}
    <span class="reset-spacer" aria-hidden="true"></span>
  {/if}
{/snippet}

{#if open}
  <!-- Non-modal side drawer (NOT a centered modal): the live preview must stay
       visible so the author sees each color/size change take effect — that's the
       whole point of guided editing (design review P1). No backdrop scrim over
       the preview iframe (also avoids throttling it). -->
  <div
    bind:this={dialogEl}
    class="dialog"
    role="dialog"
    aria-labelledby="design-panel-title"
    tabindex="-1"
  >
    <header class="dialog-header">
      <div>
        <h2 id="design-panel-title">Design</h2>
        {#if cssName}<p class="subtitle">Editing {cssName}</p>{/if}
      </div>
      {#if saveStatus !== "idle"}
        <span class="save-status {saveStatus}" aria-live="polite">
          {saveStatus === "saving" ? "Saving…" : "Changes saved"}
        </span>
      {/if}
      <button class="close" onclick={close} title="Close (Esc)" aria-label="Close">
        <Icon name="x" size={16} />
      </button>
    </header>

    <div class="dialog-body">
      {#if loading}
        <p class="muted">Loading…</p>
      {:else if error}
        <p class="error" role="alert">{error}</p>
      {:else if !cssPath}
        <div class="empty">
          <p>This project has no stylesheet yet.</p>
          <p class="muted">Apply a theme first, then come back to fine-tune its colors and sizes.</p>
        </div>
      {:else if tokens.length === 0}
        <div class="empty">
          <p>This stylesheet doesn’t expose any settings yet.</p>
          <p class="muted">
            Settings come from <code>:root</code> custom properties (e.g.
            <code>--heading-color</code>). Use “Edit raw CSS” to add some, or apply a theme that defines them.
          </p>
        </div>
      {:else}
        {#if colorTokens.length > 0}
          <section class="group">
            <h3>Colors</h3>
            {#each colorTokens as t (t.name)}
              <div class="row">
                <label for={`tok-${t.name}`}>{t.label}</label>
                <div class="control color">
                  {#if toHex(t.value)}
                    <!-- The color input IS the swatch; it resolves any opaque
                         color (named/rgb/hsl/hex) to a hex the picker can edit. -->
                    <input
                      id={`tok-${t.name}`}
                      type="color"
                      value={colorHex(t.value)}
                      oninput={(e) => setValue(t, e.currentTarget.value)}
                      title={t.value}
                    />
                  {:else}
                    <!-- Alpha/var()/gradient — show a swatch, edit as text. -->
                    <span class="swatch" style="background: {t.value}" title={t.value}></span>
                  {/if}
                  <input
                    class="text"
                    type="text"
                    value={colorHex(t.value)}
                    title={t.value}
                    oninput={(e) => setValue(t, e.currentTarget.value)}
                    aria-label={`${t.label} value`}
                  />
                </div>
                {@render resetBtn(t)}
              </div>
            {/each}
          </section>
        {/if}

        {#if sizeTokens.length > 0}
          <section class="group">
            <h3>Sizes</h3>
            {#each sizeTokens as t (t.name)}
              <div class="row">
                <label for={`tok-${t.name}`}>{t.label}</label>
                <div class="control size">
                  <input
                    id={`tok-${t.name}`}
                    class="num"
                    type="number"
                    step="any"
                    value={t.number ?? ""}
                    oninput={(e) => setLength(t, e.currentTarget.value)}
                  />
                  <span class="unit">{t.unit}</span>
                </div>
                {@render resetBtn(t)}
              </div>
            {/each}
          </section>
        {/if}

        {#if otherTokens.length > 0}
          <section class="group">
            <h3>Other</h3>
            {#each otherTokens as t (t.name)}
              <div class="row">
                <label for={`tok-${t.name}`}>{t.label}</label>
                <div class="control">
                  <input
                    id={`tok-${t.name}`}
                    class="text wide"
                    type="text"
                    value={t.value}
                    title={t.value}
                    oninput={(e) => setValue(t, e.currentTarget.value)}
                  />
                </div>
                {@render resetBtn(t)}
              </div>
            {/each}
          </section>
        {/if}
      {/if}
    </div>

    <footer class="actions">
      <div class="actions-left">
        {#if cssPath}
          <button class="ghost" onclick={() => { const p = cssPath; close(); if (p) onEditRawCss?.(p); }}>
            <Icon name="code" size={14} /> Edit raw CSS
          </button>
        {/if}
        {#if anyDirty}
          <button class="ghost" onclick={revertAll} title="Undo every change made since you opened Design">
            <Icon name="refresh-cw" size={14} /> Undo changes
          </button>
        {/if}
      </div>
      <button class="primary" onclick={close}>Done</button>
    </footer>
  </div>
{/if}

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape" && open) close();
  }}
/>

<style>
  .dialog {
    position: fixed;
    top: 0;
    right: 0;
    height: 100vh;
    width: min(380px, calc(100vw - 32px));
    display: flex;
    flex-direction: column;
    background: var(--app-bg);
    border-left: 1px solid var(--app-border);
    box-shadow: -16px 0 40px rgba(0, 0, 0, 0.28);
    z-index: 61;
    animation: drawer-in 160ms ease-out;
  }
  @keyframes drawer-in {
    from { transform: translateX(16px); opacity: 0.6; }
    to { transform: translateX(0); opacity: 1; }
  }
  .dialog-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 16px 18px 10px;
    border-bottom: 1px solid var(--app-border);
  }
  .dialog-header h2 { margin: 0; font-size: 16px; color: var(--app-text); }
  .subtitle { margin: 2px 0 0; font-size: 12px; color: var(--app-text-faint); font-family: ui-monospace, monospace; }
  .close { background: transparent; border: none; color: var(--app-text-muted); cursor: pointer; padding: 4px; border-radius: 6px; }
  .close:hover { background: var(--app-control-hover-bg); color: var(--app-text); }

  .dialog-body { padding: 14px 18px; overflow-y: auto; display: flex; flex-direction: column; gap: 18px; }
  .muted { margin: 0; font-size: 13px; color: var(--app-text-muted); }
  .error { margin: 0; font-size: 12px; color: var(--app-error-text); }
  .empty { display: flex; flex-direction: column; gap: 6px; }
  .empty p { margin: 0; font-size: 13px; color: var(--app-text); }
  code { background: var(--app-surface-sunken, var(--app-control-bg)); padding: 1px 4px; border-radius: 3px; font-size: 11px; }

  .group { display: flex; flex-direction: column; gap: 8px; }
  .group h3 {
    margin: 0;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--app-text-faint);
  }
  .row { display: flex; align-items: center; gap: 12px; justify-content: space-between; }
  .row label { font-size: 13px; color: var(--app-text); flex: 1 1 auto; }
  .control { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; }
  .swatch { width: 18px; height: 18px; border-radius: 4px; border: 1px solid var(--app-border); flex: 0 0 auto; }
  input[type="color"] {
    width: 28px; height: 24px; padding: 0; border: 1px solid var(--app-control-border);
    border-radius: 4px; background: var(--app-control-bg); cursor: pointer;
  }
  input.text, input.num {
    background: var(--app-control-bg);
    border: 1px solid var(--app-control-border);
    color: var(--app-text);
    border-radius: 6px;
    padding: 4px 7px;
    font-size: 12px;
    font-family: ui-monospace, monospace;
  }
  input.text { width: 120px; }
  input.text.wide { width: 180px; }
  input.num { width: 72px; text-align: right; }
  .unit { font-size: 12px; color: var(--app-text-faint); min-width: 24px; }
  input:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }

  .reset {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    flex: 0 0 auto;
    background: transparent;
    border: none;
    border-radius: 5px;
    color: var(--app-text-muted);
    cursor: pointer;
  }
  .reset:hover { background: var(--app-control-hover-bg); color: var(--app-text); }
  .reset-spacer { width: 22px; flex: 0 0 auto; }
  .save-status { font-size: 11px; align-self: center; margin-right: 6px; }
  .save-status.saving { color: var(--app-text-faint); }
  .save-status.saved { color: var(--app-success-text, var(--app-text-faint)); }

  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--app-border);
  }
  .actions-left { display: flex; gap: 8px; }
  .actions .primary {
    background: var(--app-accent);
    border: 1px solid var(--app-accent-border);
    color: var(--app-accent-text);
    border-radius: 7px;
    padding: 6px 16px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .actions .ghost {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: 1px solid var(--app-control-border);
    color: var(--app-text-secondary);
    border-radius: 7px;
    padding: 6px 12px;
    font-size: 13px;
    cursor: pointer;
  }
  .actions .ghost:hover { background: var(--app-control-hover-bg); }
</style>
