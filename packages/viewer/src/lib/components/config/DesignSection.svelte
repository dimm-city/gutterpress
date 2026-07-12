<script lang="ts">
  /**
   * Design-tokens sub-section of the merged "Look & style" section (UX review
   * M35 — see AppearanceSection's header comment for the merge rationale).
   * The guided `:root` custom-property editor (fonts + colors + sizes/numbers
   * + other) is the SECOND of the three panes ProjectConfigPanel composes
   * under one "Look & style" heading, after the theme grid and before the
   * stylesheet list (now behind Advanced). No section wrapper or `<h3>` of
   * its own anymore; the parent owns the outer `.block`/heading. All token
   * state, the debounced read-modify-write token machinery, and `api.fs.*`
   * calls live in `DesignSectionController` (passed as the single `controller`
   * prop — this was the first section to get the controller extraction; see
   * M14 for the other five). `toHex` is a pure browser-only helper (§8-clean).
   * The Fonts list is derived locally from the controller's full `tokens`
   * field rather than a separate `fontTokens` getter — one less thing to keep
   * wired, and it can never silently go stale.
   */
  import Icon from "$lib/components/Icon.svelte";
  import type { StyleToken } from "$lib/platform/dtos";
  import { toHex, PRINT_SAFE_FONT_STACKS } from "$lib/style-tokens";
  import type { DesignSectionController } from "$lib/routes/design-section-controller.svelte";

  let { controller }: { controller: DesignSectionController } = $props();

  /** The curated dropdown's selected option: the matching preset value, or
   * the "custom" sentinel when the current value isn't one of the presets
   * (the text input beside it is always the real, uncapped editor). */
  const fontPreset = (value: string): string =>
    PRINT_SAFE_FONT_STACKS.some((f) => f.value === value) ? value : "__custom__";

  const colorHex = (v: string) => toHex(v) ?? v;

  /** Derived locally from the controller's full `tokens` field rather than a
   * separate `fontTokens` getter — see the header note. */
  const fontTokens = $derived(controller.tokens.filter((t) => t.kind === "font"));
</script>

<div class="look-subsection design-subsection">
  <div class="block-head">
    <h4 class="tokens-title">Design tokens</h4>
    <div class="row">
      {#if controller.designSaveStatus === "saving"}<span class="save-status saving" aria-live="polite">Saving…</span>
      {:else if controller.designSaveStatus === "saved"}<span class="save-status saved" aria-live="polite">Changes saved</span>{/if}
      {#if controller.anyDirty}
        <button class="ghost small" onclick={controller.revertAllTokens} title="Revert all changes">Revert</button>
      {/if}
    </div>
  </div>
  {#if controller.designLoading}
    <p class="muted">Loading…</p>
  {:else if controller.designError}
    <p class="error" role="alert">{controller.designError}</p>
  {:else if !controller.cssPath}
    <p class="muted">No active stylesheet. Apply a theme first, then fine-tune its colors and sizes here.</p>
  {:else if controller.tokens.length === 0}
    <p class="muted">{controller.cssName} doesn't expose any settings yet. Use “Edit raw CSS” to add <code>:root</code> custom properties.</p>
  {:else}
    <p class="hint">Editing {controller.cssName} — changes apply live to the preview.</p>
    {#if fontTokens.length > 0}
      <h4 class="subhead">Fonts</h4>
      {#each fontTokens as t (t.name)}
        <div class="row token-row" class:dirty={controller.isDirty(t)}>
          <label for={`cfg-${t.name}`} class="token-label">{t.label}</label>
          <div class="control font">
            <select
              id={`cfg-${t.name}`}
              value={fontPreset(t.value)}
              onchange={(e) => {
                if (e.currentTarget.value !== "__custom__") controller.setToken(t, e.currentTarget.value);
              }}
              aria-label={`${t.label} preset`}
            >
              {#each PRINT_SAFE_FONT_STACKS as f (f.value)}
                <option value={f.value}>{f.label}</option>
              {/each}
              <option value="__custom__">Custom…</option>
            </select>
            <input class="input sharp" type="text" value={t.value} oninput={(e) => controller.setToken(t, e.currentTarget.value)} title={t.value} aria-label={`${t.label} value`} />
          </div>
          {#if controller.isDirty(t)}
            <button class="ghost icononly" onclick={() => controller.resetToken(t)} title="Reset to original" aria-label={`Reset ${t.label}`}>
              <Icon name="refresh-cw" size={12} />
            </button>
          {/if}
        </div>
      {/each}
    {/if}
    {#if controller.colorTokens.length > 0}
      <h4 class="subhead">Colors</h4>
      {#each controller.colorTokens as t (t.name)}
        <div class="row token-row" class:dirty={controller.isDirty(t)}>
          <label for={`cfg-${t.name}`} class="token-label">{t.label}</label>
          <div class="control color">
            {#if toHex(t.value)}
              <input id={`cfg-${t.name}`} type="color" value={colorHex(t.value)} oninput={(e) => controller.setToken(t, e.currentTarget.value)} title={t.value} />
            {:else}
              <span class="swatch" style="background: {t.value}" title={t.value}></span>
            {/if}
            <input class="input sharp" type="text" value={colorHex(t.value)} oninput={(e) => controller.setToken(t, e.currentTarget.value)} title={t.value} aria-label={`${t.label} value`} />
          </div>
          {#if controller.isDirty(t)}
            <button class="ghost icononly" onclick={() => controller.resetToken(t)} title="Reset to original" aria-label={`Reset ${t.label}`}>
              <Icon name="refresh-cw" size={12} />
            </button>
          {/if}
        </div>
      {/each}
    {/if}
    {#if controller.sizeTokens.length > 0}
      <h4 class="subhead">Sizes &amp; numbers</h4>
      {#each controller.sizeTokens as t (t.name)}
        <div class="row token-row" class:dirty={controller.isDirty(t)}>
          <label for={`cfg-${t.name}`} class="token-label">{t.label}</label>
          <div class="control size">
            <input id={`cfg-${t.name}`} type="number" value={t.number} oninput={(e) => controller.setLength(t, e.currentTarget.value)} step="0.1" aria-label={`${t.label} number`} />
            <span class="unit">{t.unit}</span>
          </div>
          {#if controller.isDirty(t)}
            <button class="ghost icononly" onclick={() => controller.resetToken(t)} title="Reset" aria-label={`Reset ${t.label}`}>
              <Icon name="refresh-cw" size={12} />
            </button>
          {/if}
        </div>
      {/each}
    {/if}
    {#if controller.otherTokens.length > 0}
      <h4 class="subhead">Other</h4>
      {#each controller.otherTokens as t (t.name)}
        <div class="row token-row" class:dirty={controller.isDirty(t)}>
          <label for={`cfg-${t.name}`} class="token-label">{t.label}</label>
          <div class="control">
            <input id={`cfg-${t.name}`} class="input sharp" type="text" value={t.value} oninput={(e) => controller.setToken(t, e.currentTarget.value)} aria-label={`${t.label} value`} />
          </div>
          {#if controller.isDirty(t)}
            <button class="ghost icononly" onclick={() => controller.resetToken(t)} title="Reset" aria-label={`Reset ${t.label}`}>
              <Icon name="refresh-cw" size={12} />
            </button>
          {/if}
        </div>
      {/each}
    {/if}
    <button class="ghost small" onclick={controller.editRawCss} title="Open the active stylesheet in the raw editor">
      <Icon name="file-text" size={13} /> Edit raw CSS
    </button>
  {/if}
</div>

<style>
  @import "$lib/styles/config-section-shared.css";

  /* This sub-section's own heading sits in a `.block-head` row beside the
     save-status/revert controls (see the template) — a dedicated local class
     (not the shared `.subhead`, which carries a top margin meant for a
     heading stacked directly under a preceding block, not one sharing a flex
     row with other controls). */
  .tokens-title { margin: 0; font-size: 11px; font-weight: 600; color: var(--app-text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .token-row { justify-content: space-between; }
  .token-row.dirty .token-label { color: var(--app-accent, #4ea1ff); }
  .token-label { flex: 1; font-size: 12px; color: var(--app-text-secondary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .control { display: flex; align-items: center; gap: 6px; }
  .control.color input[type="color"] { width: 28px; height: 28px; padding: 0; border: 1px solid var(--app-border); border-radius: 4px; background: var(--app-control-bg); cursor: pointer; }
  .control.color .swatch { width: 28px; height: 28px; border-radius: 4px; border: 1px solid var(--app-border); }
  .control.size { gap: 4px; }
  .control.size input[type="number"] { width: 64px; padding: 5px 6px; background: var(--app-surface-sunken); border: 1px solid var(--app-border); color: var(--app-text-secondary); border-radius: 4px; font-size: 12px; }
  .unit { font-size: 11px; color: var(--app-text-faint); }
  .save-status { font-size: 11px; }
  .save-status.saving { color: var(--app-text-muted); }
  .save-status.saved { color: var(--app-success-text, #3fb950); }
</style>
