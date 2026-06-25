<script lang="ts">
  /**
   * DesignPanel — the GUIDED styling surface (print-md's headline goal: "style
   * by setting CSS custom properties" without hand-editing raw CSS). Reads the
   * active stylesheet's `:root` custom properties via the platform seam and
   * exposes them as color pickers + size controls; each change writes the one
   * property back through `writeStyleToken`, and the preview hot-swaps the CSS.
   *
   * Raw-CSS editing remains available as an escape hatch ("Edit raw CSS"). No
   * `$effect`: tokens load in `show()` (a user gesture), writes happen in input
   * handlers (debounced).
   */
  import { isDesktop } from "$lib/platform";
  import { api } from "$lib/api";
  import type { StyleToken } from "$lib/platform/contract";
  import type { ProjectStyle } from "$lib/api";
  import type { ToastController } from "$lib/components/Toast.svelte";
  import Icon from "$lib/components/Icon.svelte";

  // ── Style-token helpers (client-side, no IPC needed) ─────────────────────

  function makeStyleToken(name: string, raw: string): StyleToken {
    const label = name.replace(/^--/, "").replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
    if (/^#[0-9a-fA-F]{3,8}$|^rgba?\s*\(|^hsla?\s*\(|^oklch\s*\(|^color\s*\(/.test(raw)) {
      return { name, value: raw, kind: "color", label };
    }
    const len = raw.match(/^(-?[\d.]+)\s*(px|rem|em|vh|vw|vmin|vmax|%|pt|cm|mm|in|ex|ch)\b/i);
    if (len) {
      return { name, value: raw, kind: "length", label, number: parseFloat(len[1]), unit: len[2] };
    }
    return { name, value: raw, kind: "text", label };
  }

  function parseStyleTokens(cssText: string): StyleToken[] {
    const tokens: StyleToken[] = [];
    const rootRe = /:root\s*\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = rootRe.exec(cssText)) !== null) {
      for (const line of m[1].split("\n")) {
        const pair = line.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*;/);
        if (pair) tokens.push(makeStyleToken(pair[1], pair[2]));
      }
    }
    return tokens;
  }

  function updateRootToken(cssText: string, name: string, value: string): string {
    const escaped = name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
    const existing = new RegExp(`(${escaped}\\s*:)[^;]*(;)`, "g");
    if (existing.test(cssText)) {
      return cssText.replace(new RegExp(`(${escaped}\\s*:)[^;]*(;)`, "g"), `$1 ${value}$2`);
    }
    return cssText.replace(/(:root\s*\{)/, `$1\n  ${name}: ${value};`);
  }

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

  // Resolve ANY opaque CSS color (named like `red`, `rgb(...)`, `hsl(...)`, or a
  // short hex) to a canonical #rrggbb so every Colors row shows consistently and
  // gets a color picker (UX review: `Color paper: red` looked inconsistent /
  // had no picker). The canvas `fillStyle` setter normalises any valid color the
  // browser understands; it returns `rgba(...)` for colors with alpha — those we
  // leave as-is (text-only). Browser API only (canvas) — stays PWA-clean.
  let _hexCtx: CanvasRenderingContext2D | null | undefined;
  function toHex(value: string): string | null {
    try {
      if (_hexCtx === undefined) _hexCtx = document.createElement("canvas").getContext("2d");
      if (!_hexCtx) return null;
      _hexCtx.fillStyle = "#000000";
      _hexCtx.fillStyle = value;
      const out = _hexCtx.fillStyle;
      return typeof out === "string" && /^#[0-9a-f]{6}$/i.test(out) ? out : null;
    } catch {
      return null;
    }
  }
  /** Hex form of a color token for display (falls back to the raw value). */
  const colorHex = (v: string) => toHex(v) ?? v;

  const colorTokens = $derived(tokens.filter((t) => t.kind === "color"));
  const sizeTokens = $derived(tokens.filter((t) => t.kind === "length"));
  const otherTokens = $derived(tokens.filter((t) => t.kind === "text"));

  /**
   * Open the panel for a project's ACTIVE stylesheet (the manifest's first
   * `styles:` entry, else the first discovered sheet). `show()` is a user
   * gesture from the trigger button.
   */
  export async function show(trigger?: HTMLButtonElement): Promise<void> {
    if (trigger) triggerEl = trigger;
    if (!isDesktop() || !projectDir) {
      toast?.info?.("Design controls are available in the desktop app for now.");
      return;
    }
    open = true;
    loading = true;
    error = null;
    tokens = [];
    try {
      const styles: ProjectStyle[] = await api.project.listStyles(projectDir);
      const active = styles.find((s) => s.active) ?? styles[0];
      if (!active) {
        cssPath = null;
        cssName = "";
        return;
      }
      cssPath = active.path;
      cssName = active.displayName;
      const css = await api.fs.readFile(active.path);
      tokens = parseStyleTokens(css);
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

  function close() {
    // Drain any debounced write BEFORE closing — otherwise an edit made within
    // the debounce window is silently lost (UX review D-2, data-loss bug).
    flushPending();
    open = false;
    triggerEl?.focus();
  }

  // Per-token debounced write so dragging a color/slider doesn't thrash the
  // filesystem (and the preview hot-swap) on every input event. `pending` holds
  // the latest unsaved value per token so close() can flush it.
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, string>();
  function scheduleWrite(name: string, value: string) {
    pending.set(name, value);
    saveStatus = "saving";
    const existing = timers.get(name);
    if (existing) clearTimeout(existing);
    timers.set(
      name,
      setTimeout(() => {
        timers.delete(name);
        void commit(name, value);
      }, 250),
    );
  }

  /** Fire every pending write immediately (used on close). */
  function flushPending() {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    for (const [name, value] of [...pending.entries()]) void commit(name, value);
  }

  async function commit(name: string, value: string) {
    if (!cssPath) return;
    try {
      const css = await api.fs.readFile(cssPath);
      await api.fs.writeFile(cssPath, updateRootToken(css, name, value));
      pending.delete(name);
      if (pending.size === 0 && timers.size === 0) saveStatus = "saved";
    } catch (e) {
      saveStatus = "idle";
      toast?.error?.(`Couldn't save ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Update a token's value locally (optimistic) + schedule the write. */
  function setValue(t: StyleToken, value: string) {
    t.value = value;
    tokens = tokens; // nudge reactivity (mutated element)
    scheduleWrite(t.name, value);
  }

  /** Revert one token to its value when the panel opened. */
  function resetToken(t: StyleToken) {
    const o = originals.get(t.name);
    if (o !== undefined && o !== t.value) setValue(t, o);
  }

  /** Revert every changed token to its opening value. */
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
