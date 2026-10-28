<script lang="ts">
  /**
   * Advanced › "All design settings": the guided `:root` custom-property
   * editor (theme-curated groups, then fonts + colors + sizes/numbers +
   * other). It shows the tokens of every enabled look as the book's own
   * stylesheet overrides them, and saves each change to that stylesheet
   * (`controller.cssName`) — never to a look's files. It names the look(s) it
   * edits. The Look tab shows six of these same tokens as brand settings. All
   * token state, the debounced read-modify-write token machinery, and the
   * host calls live in `DesignSectionController` (passed as the single
   * `controller` prop). A color is typed into `ColorField`, which saves only
   * a color; a number is saved on change, never mid-number.
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
  import ColorField from "./ColorField.svelte";
  import type { StyleToken } from "#lib/platform/dtos.ts";
  import { firstFontFamily, PRINT_SAFE_FONT_STACKS } from "#lib/style-tokens.ts";
  import type { DesignSectionController } from "#lib/routes/design-section-controller.svelte.ts";

  let { controller }: { controller: DesignSectionController } = $props();

  /** "look (Clean book)" / "looks (Clean book, House)" — the hint and the
   *  empty state each put their own "your" / "Your" in front. */
  const lookWord = $derived(controller.lookLabels.length > 1 ? "looks" : "look");
  const lookNames = $derived(controller.lookLabels.join(", "));

  /** The curated dropdown's selected option: the matching preset value, or
   * the "custom" sentinel when the current value isn't one of the presets
   * (the text input beside it is always the real, uncapped editor). */
  const fontPreset = (value: string): string =>
    PRINT_SAFE_FONT_STACKS.some((f) => f.value === value) ? value : "__custom__";
</script>

<section class="block" aria-labelledby="all-design-settings">
  <div class="block-head">
    <!-- Focusable so "All settings in Advanced →" can land here. -->
    <h3 id="all-design-settings" tabindex="-1">All design settings</h3>
    {#if controller.anyDirty}
      <button class="ghost small" onclick={controller.revertAllTokens} title="Undo the changes made since Book setup opened">Undo changes</button>
    {/if}
  </div>
  {#if controller.designSaveError}
    <p class="error" role="alert">{controller.designSaveError}</p>
  {/if}
  {#if controller.designLoading}
    <p class="muted">Loading…</p>
  {:else if controller.designError}
    <p class="error" role="alert">{controller.designError}</p>
  {:else if controller.tokens.length === 0}
    {#if controller.lookLabels.length === 0}
      <p class="muted">No look is on. Choose one on the Look tab.</p>
    {:else}
      <p class="muted">Your {lookWord} ({lookNames}) and your stylesheet have no settings yet. Open the stylesheet (Files, above) to add <code>:root</code> custom properties.</p>
    {/if}
  {:else}
    {#if controller.lookLabels.length > 0}
      <p class="hint">Settings from your {lookWord} ({lookNames}) and your own stylesheet ({controller.cssName || "styles/book.css"}). Changes are saved to the stylesheet as you go.</p>
    {:else}
      <p class="hint">Settings from your own stylesheet ({controller.cssName}). Changes are saved as you go.</p>
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
  {/if}
</section>

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
            <option value="__custom__">{fontPreset(t.value) === "__custom__" ? `${firstFontFamily(t.value)} (this book's font)` : "Custom…"}</option>
          </select>
          <input class="input sharp" type="text" value={t.value} oninput={(e) => controller.setToken(t, e.currentTarget.value)} title={t.value} aria-label={`${t.label} value`} />
        </div>
      {:else if t.kind === "color"}
        <div class="control color">
          <ColorField id={`cfg-${t.name}`} value={t.value} label={t.label} onCommit={(value) => controller.setToken(t, value)} />
        </div>
      {:else if t.kind === "length" || t.kind === "number"}
        <div class="control size">
          <input id={`cfg-${t.name}`} type="number" value={parseFloat(t.value)} onchange={(e) => controller.setLength(t, e.currentTarget.value)} step="0.1" aria-label={`${t.label} (${t.unit ?? "number"})`} />
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
      {:else}
        <!-- The control's slot stays reserved, so the inputs of rows with
             and without the undo control end on the same edge. -->
        <span class="undo-slot" aria-hidden="true"></span>
      {/if}
    </div>
  </div>
{/snippet}

<style>
  @import "../../styles/config-section-shared.css";

  #all-design-settings:focus { outline: none; }
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
  .control.font select:focus-visible, .control.size input:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }
  .control.color { width: 258px; }
  .control.size { gap: 4px; }
  .control.size input[type="number"] { width: 64px; padding: 5px 6px; background: var(--app-surface-sunken); border: 1px solid var(--app-border); color: var(--app-text-secondary); border-radius: 4px; font-size: 12px; }
  .unit { font-size: 11px; color: var(--app-text-muted); }
  /* The icon-only undo button's box: 12px icon + 5px padding + 1px border a side. */
  .undo-slot { flex: 0 0 24px; height: 24px; }
</style>
