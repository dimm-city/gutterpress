<script lang="ts">
  /**
   * Design section of ProjectConfigPanel — the guided `:root` custom-property
   * editor (fonts + colors + sizes/numbers + other). Presentational: token
   * state, the debounced read-modify-write token machinery, and `api.fs.*`
   * calls all live in the composition root; this child renders props and
   * emits changes via callbacks. `toHex` is a pure browser-only helper
   * (§8-clean). The Fonts list is derived locally from the full `tokens`
   * prop (already passed by the composition root for the empty-state check
   * below) rather than requiring a separate `fontTokens` prop — one less
   * prop to keep wired, and it can never silently go stale if a caller
   * forgets to pass it.
   */
  import Icon from "$lib/components/Icon.svelte";
  import type { StyleToken } from "$lib/platform/contract";
  import { toHex, PRINT_SAFE_FONT_STACKS } from "$lib/style-tokens";

  let {
    designSaveStatus,
    anyDirty,
    designLoading,
    designError,
    cssPath,
    cssName,
    tokens,
    colorTokens,
    sizeTokens,
    otherTokens,
    isDirty,
    setToken,
    resetToken,
    setLength,
    revertAllTokens,
    editRawCss,
  }: {
    designSaveStatus: "idle" | "saving" | "saved";
    anyDirty: boolean;
    designLoading: boolean;
    designError: string | null;
    cssPath: string | null;
    cssName: string;
    tokens: StyleToken[];
    colorTokens: StyleToken[];
    sizeTokens: StyleToken[];
    otherTokens: StyleToken[];
    isDirty: (t: StyleToken) => boolean;
    setToken: (t: StyleToken, value: string) => void;
    resetToken: (t: StyleToken) => void;
    setLength: (t: StyleToken, num: string) => void;
    revertAllTokens: () => void;
    editRawCss: () => void;
  } = $props();

  /** The curated dropdown's selected option: the matching preset value, or
   * the "custom" sentinel when the current value isn't one of the presets
   * (the text input beside it is always the real, uncapped editor). */
  const fontPreset = (value: string): string =>
    PRINT_SAFE_FONT_STACKS.some((f) => f.value === value) ? value : "__custom__";

  const colorHex = (v: string) => toHex(v) ?? v;

  /** Derived locally from the full `tokens` prop rather than a separate
   * `fontTokens` prop — see the header note. */
  const fontTokens = $derived(tokens.filter((t) => t.kind === "font"));
</script>

<section class="block">
  <div class="block-head">
    <h3>Design</h3>
    <div class="row">
      {#if designSaveStatus === "saving"}<span class="save-status saving" aria-live="polite">Saving…</span>
      {:else if designSaveStatus === "saved"}<span class="save-status saved" aria-live="polite">Changes saved</span>{/if}
      {#if anyDirty}
        <button class="ghost small" onclick={revertAllTokens} title="Revert all changes">Revert</button>
      {/if}
    </div>
  </div>
  {#if designLoading}
    <p class="muted">Loading…</p>
  {:else if designError}
    <p class="error" role="alert">{designError}</p>
  {:else if !cssPath}
    <p class="muted">No active stylesheet. Apply a theme first, then fine-tune its colors and sizes here.</p>
  {:else if tokens.length === 0}
    <p class="muted">{cssName} doesn't expose any settings yet. Use “Edit raw CSS” to add <code>:root</code> custom properties.</p>
  {:else}
    <p class="hint">Editing {cssName} — changes apply live to the preview.</p>
    {#if fontTokens.length > 0}
      <h4 class="subhead">Fonts</h4>
      {#each fontTokens as t (t.name)}
        <div class="row token-row" class:dirty={isDirty(t)}>
          <label for={`cfg-${t.name}`} class="token-label">{t.label}</label>
          <div class="control font">
            <select
              id={`cfg-${t.name}`}
              value={fontPreset(t.value)}
              onchange={(e) => {
                if (e.currentTarget.value !== "__custom__") setToken(t, e.currentTarget.value);
              }}
              aria-label={`${t.label} preset`}
            >
              {#each PRINT_SAFE_FONT_STACKS as f (f.value)}
                <option value={f.value}>{f.label}</option>
              {/each}
              <option value="__custom__">Custom…</option>
            </select>
            <input class="input sharp" type="text" value={t.value} oninput={(e) => setToken(t, e.currentTarget.value)} title={t.value} aria-label={`${t.label} value`} />
          </div>
          {#if isDirty(t)}
            <button class="ghost icononly" onclick={() => resetToken(t)} title="Reset to original" aria-label={`Reset ${t.label}`}>
              <Icon name="refresh-cw" size={12} />
            </button>
          {/if}
        </div>
      {/each}
    {/if}
    {#if colorTokens.length > 0}
      <h4 class="subhead">Colors</h4>
      {#each colorTokens as t (t.name)}
        <div class="row token-row" class:dirty={isDirty(t)}>
          <label for={`cfg-${t.name}`} class="token-label">{t.label}</label>
          <div class="control color">
            {#if toHex(t.value)}
              <input id={`cfg-${t.name}`} type="color" value={colorHex(t.value)} oninput={(e) => setToken(t, e.currentTarget.value)} title={t.value} />
            {:else}
              <span class="swatch" style="background: {t.value}" title={t.value}></span>
            {/if}
            <input class="input sharp" type="text" value={colorHex(t.value)} oninput={(e) => setToken(t, e.currentTarget.value)} title={t.value} aria-label={`${t.label} value`} />
          </div>
          {#if isDirty(t)}
            <button class="ghost icononly" onclick={() => resetToken(t)} title="Reset to original" aria-label={`Reset ${t.label}`}>
              <Icon name="refresh-cw" size={12} />
            </button>
          {/if}
        </div>
      {/each}
    {/if}
    {#if sizeTokens.length > 0}
      <h4 class="subhead">Sizes &amp; numbers</h4>
      {#each sizeTokens as t (t.name)}
        <div class="row token-row" class:dirty={isDirty(t)}>
          <label for={`cfg-${t.name}`} class="token-label">{t.label}</label>
          <div class="control size">
            <input id={`cfg-${t.name}`} type="number" value={t.number} oninput={(e) => setLength(t, e.currentTarget.value)} step="0.1" aria-label={`${t.label} number`} />
            <span class="unit">{t.unit}</span>
          </div>
          {#if isDirty(t)}
            <button class="ghost icononly" onclick={() => resetToken(t)} title="Reset" aria-label={`Reset ${t.label}`}>
              <Icon name="refresh-cw" size={12} />
            </button>
          {/if}
        </div>
      {/each}
    {/if}
    {#if otherTokens.length > 0}
      <h4 class="subhead">Other</h4>
      {#each otherTokens as t (t.name)}
        <div class="row token-row" class:dirty={isDirty(t)}>
          <label for={`cfg-${t.name}`} class="token-label">{t.label}</label>
          <div class="control">
            <input id={`cfg-${t.name}`} class="input sharp" type="text" value={t.value} oninput={(e) => setToken(t, e.currentTarget.value)} aria-label={`${t.label} value`} />
          </div>
          {#if isDirty(t)}
            <button class="ghost icononly" onclick={() => resetToken(t)} title="Reset" aria-label={`Reset ${t.label}`}>
              <Icon name="refresh-cw" size={12} />
            </button>
          {/if}
        </div>
      {/each}
    {/if}
    <button class="ghost small" onclick={editRawCss} title="Open the active stylesheet in the raw editor">
      <Icon name="file-text" size={13} /> Edit raw CSS
    </button>
  {/if}
</section>
