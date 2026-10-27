<script lang="ts">
  /**
   * "Fonts, colors & sizes" sub-section of the Design tab. The guided `:root`
   * custom-property editor (theme-curated groups, then fonts + colors +
   * sizes/numbers + other) shows the tokens of every enabled look as the
   * book's own stylesheet overrides them, and saves each change to that
   * stylesheet (`controller.cssName`) — never to a look's files. It names the
   * look(s) it edits; with no look it hands off to the Looks & features tab
   * (`onChooseLook`). It is the first of the two panes ProjectSettingsView
   * composes under the "Design" heading, before the stylesheet list. No section wrapper or `<h3>` of its
   * own; the parent owns the outer `.block`/heading. All token state, the
   * debounced read-modify-write token machinery, and the host calls live in
   * `DesignSectionController` (passed as the single `controller` prop).
   * `toHex` is a pure browser-only helper (§8-clean).
   *
   * Token annotations (issue #244): `controller.customGroups` (theme-author
   * `@group` headings, rendered first) and the four kind-based getters
   * (`fontTokens`/`colorTokens`/`sizeTokens`/`otherTokens`, each excluding
   * anything already claimed by a custom group) are ALL controller getters,
   * so this template doesn't need to know the grouping rule — it just
   * renders whatever lists it's handed, in order. Every list renders through
   * the one `tokenRow` snippet below, which switches on `t.kind` for the
   * control — needed once a `@group` can mix kinds (a "Colors" group could
   * hold a color token next to a plain text one).
   */
  import Icon from "#lib/components/Icon.svelte";
  import type { StyleToken } from "#lib/platform/dtos.ts";
  import { toHex, firstFontFamily, PRINT_SAFE_FONT_STACKS } from "#lib/style-tokens.ts";
  import type { DesignSectionController } from "#lib/routes/design-section-controller.svelte.ts";

  let {
    controller,
    onChooseLook,
  }: {
    controller: DesignSectionController;
    /** Open the Looks & features tab (the parent owns the tab state); shown
     *  when the book has no look yet, so the empty state hands off there. */
    onChooseLook?: () => void;
  } = $props();

  /** "your look (Clean book)" / "your looks (Clean book, House)" for the hint. */
  const lookPhrase = $derived(
    `your ${controller.lookLabels.length > 1 ? "looks" : "look"} (${controller.lookLabels.join(", ")})`,
  );

  /** The curated dropdown's selected option: the matching preset value, or
   * the "custom" sentinel when the current value isn't one of the presets
   * (the text input beside it is always the real, uncapped editor). */
  const fontPreset = (value: string): string =>
    PRINT_SAFE_FONT_STACKS.some((f) => f.value === value) ? value : "__custom__";

  const colorHex = (v: string) => toHex(v) ?? v;
</script>

<div class="look-subsection design-subsection">
  <div class="block-head">
    <h4 class="tokens-title">Fonts, colors &amp; sizes</h4>
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
    <p class="muted">This book has no stylesheet of its own yet, so there is nowhere to save changes. Add one (for example <code>styles/book.css</code>) to fine-tune your looks here.</p>
  {:else if controller.tokens.length === 0}
    {#if controller.lookLabels.length === 0}
      <p class="muted">This book has no look yet. Add one on the Looks &amp; features tab to see its fonts, colors and sizes here.</p>
      <div class="row">
        {#if onChooseLook}
          <button class="primary small app-btn-primary" onclick={onChooseLook}>Choose a look</button>
        {/if}
        {@render editRaw()}
      </div>
    {:else}
      <p class="muted">{lookPhrase.replace(/^y/, "Y")} and {controller.cssName} don't expose any settings yet. Use “Edit the stylesheet” to add <code>:root</code> custom properties.</p>
      {@render editRaw()}
    {/if}
  {:else}
    {#if controller.lookLabels.length > 0}
      <p class="hint">Settings from {lookPhrase} and your own stylesheet ({controller.cssName}). Changes are saved to the stylesheet as you go and show in the preview when you close this panel.</p>
    {:else}
      <p class="hint">Settings from your own stylesheet ({controller.cssName}). Changes are saved as you go and show in the preview when you close this panel.</p>
    {/if}
    {#each controller.customGroups as g (g.name)}
      <h4 class="subhead">{g.name}</h4>
      {#each g.tokens as t (t.name)}{@render tokenRow(t)}{/each}
    {/each}
    {#if controller.fontTokens.length > 0}
      <h4 class="subhead">Fonts</h4>
      {#each controller.fontTokens as t (t.name)}{@render tokenRow(t)}{/each}
    {/if}
    {#if controller.colorTokens.length > 0}
      <h4 class="subhead">Colors</h4>
      {#each controller.colorTokens as t (t.name)}{@render tokenRow(t)}{/each}
    {/if}
    {#if controller.sizeTokens.length > 0}
      <h4 class="subhead">Sizes &amp; numbers</h4>
      {#each controller.sizeTokens as t (t.name)}{@render tokenRow(t)}{/each}
    {/if}
    {#if controller.otherTokens.length > 0}
      <h4 class="subhead">Other</h4>
      {#each controller.otherTokens as t (t.name)}{@render tokenRow(t)}{/each}
    {/if}
    {@render editRaw()}
  {/if}
</div>

{#snippet editRaw()}
  <button class="ghost small" onclick={controller.editRawCss} title="Open your book's stylesheet in the editor">
    <Icon name="file-text" size={13} /> Edit the stylesheet
  </button>
{/snippet}

{#snippet tokenRow(t: StyleToken)}
  <!-- One editable :root token, control chosen by `t.kind` — shared by the
       custom-group loop above and every heuristic bucket below it, since a
       theme-author `@group` can mix kinds (issue #244: e.g. a "Colors" group
       holding a color token next to a plain text one). -->
  <div class="row token-row" class:dirty={controller.isDirty(t)} class:stacked={t.kind === "font"}>
    <!-- The plain-language label leads; the real CSS variable stays visible
         beneath it (muted) because authors need it to write their own rules.
         aria-hidden keeps it out of the control's accessible name. -->
    <label for={`cfg-${t.name}`} class="token-label" title={t.name}>
      <span class="token-name">{t.label}</span>
      <span class="token-var" aria-hidden="true">{t.name}</span>
    </label>
    <!-- Control + reset travel as one unit (a stacked font row puts them on
         the line under the label). -->
    <div class="token-edit">
      {#if t.kind === "font"}
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
            <option value="__custom__">{fontPreset(t.value) === "__custom__" ? `${firstFontFamily(t.value)} (current)` : "Custom…"}</option>
          </select>
          <input class="input sharp" type="text" value={t.value} oninput={(e) => controller.setToken(t, e.currentTarget.value)} title={t.value} aria-label={`${t.label} value`} />
        </div>
      {:else if t.kind === "color"}
        <div class="control color">
          {#if toHex(t.value)}
            <input id={`cfg-${t.name}`} type="color" value={colorHex(t.value)} oninput={(e) => controller.setToken(t, e.currentTarget.value)} title={t.value} />
          {:else}
            <span class="swatch" style="background: {t.value}" title={t.value}></span>
          {/if}
          <input class="input sharp" type="text" value={colorHex(t.value)} oninput={(e) => controller.setToken(t, e.currentTarget.value)} title={t.value} aria-label={`${t.label} value`} />
        </div>
      {:else if t.kind === "length" || t.kind === "number"}
        <div class="control size">
          <input id={`cfg-${t.name}`} type="number" value={t.number} oninput={(e) => controller.setLength(t, e.currentTarget.value)} step="0.1" aria-label={`${t.label} (${t.unit ?? "number"})`} />
          <span class="unit">{t.unit}</span>
        </div>
      {:else}
        <div class="control">
          <input id={`cfg-${t.name}`} class="input sharp" type="text" value={t.value} oninput={(e) => controller.setToken(t, e.currentTarget.value)} aria-label={`${t.label} value`} />
        </div>
      {/if}
      <!-- One undo control: this session's edit goes back to the loaded
           value; a stored override of a look's value is dropped so the
           look's value shows through (it is never pinned). -->
      {#if controller.isDirty(t)}
        <button class="ghost icononly" onclick={() => controller.resetToken(t)} title={t.kind === "font" || t.kind === "color" ? "Reset to original" : "Reset"} aria-label={`Reset ${t.label}`}>
          <Icon name="refresh-cw" size={12} />
        </button>
      {:else if controller.overridesLook(t)}
        <button class="ghost icononly" onclick={() => controller.resetToken(t)} title={`Use the look's value (${controller.lookValue(t)})`} aria-label={`Use the look's value for ${t.label} (${controller.lookValue(t)})`}>
          <Icon name="refresh-cw" size={12} />
        </button>
      {/if}
    </div>
  </div>
{/snippet}

<style>
  @import "../../styles/config-section-shared.css";

  /* This sub-section's own heading sits in a `.block-head` row beside the
     save-status/revert controls (see the template) — a dedicated local class
     (not the shared `.subhead`, which carries a top margin meant for a
     heading stacked directly under a preceding block, not one sharing a flex
     row with other controls). */
  .tokens-title { margin: 0; font-size: 11px; font-weight: 600; color: var(--app-text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  /* Label beside its control, so the label stays whole in a narrow window
     and the input takes the squeeze instead. A font
     row is too wide for that — select plus text input — so it stacks: label on
     top, controls full width below. A row's shape never depends on its dirty
     state, so the reset button appearing can't make a field jump mid-edit. */
  .token-row { justify-content: space-between; }
  .token-row.stacked { flex-wrap: wrap; row-gap: 4px; }
  .token-row.dirty .token-name { color: var(--app-accent); }
  .token-label { flex: 1 0 auto; max-width: 65%; min-width: 0; display: flex; flex-direction: column; font-size: 12px; color: var(--app-text-secondary); }
  .token-row.stacked .token-label { flex-basis: 100%; max-width: 100%; }
  .token-name, .token-var { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .token-var { font-family: var(--app-font-mono); font-size: 10.5px; color: var(--app-text-muted); }
  .token-edit { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .token-row.stacked .token-edit { flex: 1 1 100%; }
  .control { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .token-row.stacked .control { flex: 1; }
  /* The font select and its text input share one height. */
  .control.font { align-items: stretch; }
  /* Native select chrome ignores the panel's palette (hard black border on a
     sunken-grey form); match the neighbouring .input instead. */
  .control.font select { min-width: 0; padding: 7px 9px; background: var(--app-surface-sunken); border: 1px solid var(--app-border); color: var(--app-text-secondary); border-radius: 5px; font-size: 13px; font-family: inherit; }
  .control.font select:focus { outline: none; border-color: var(--app-focus-ring); }
  .control.color input[type="color"] { width: 28px; height: 28px; padding: 0; border: 1px solid var(--app-border); border-radius: 4px; background: var(--app-control-bg); cursor: pointer; }
  .control.color .swatch { width: 28px; height: 28px; border-radius: 4px; border: 1px solid var(--app-border); }
  .control.size { gap: 4px; }
  .control.size input[type="number"] { width: 64px; padding: 5px 6px; background: var(--app-surface-sunken); border: 1px solid var(--app-border); color: var(--app-text-secondary); border-radius: 4px; font-size: 12px; }
  .unit { font-size: 11px; color: var(--app-text-muted); }
  .save-status { font-size: 11px; }
  .save-status.saving { color: var(--app-text-muted); }
  .save-status.saved { color: var(--app-success-text); }
</style>
