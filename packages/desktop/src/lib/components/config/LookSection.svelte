<script lang="ts">
  /**
   * Book setup › Look: how the book looks, top to bottom — *Choose a look*
   * (a single-choice gallery of thumbnails), *Adjust the look* (six brand
   * settings beside a live sample page) and *Extras* (the built-in things an
   * author can type, ticked on or off). Developer-shaped controls are on the
   * Advanced tab only; this tab links there.
   *
   * It reads two controllers: `ExtensionsSectionController` for the looks,
   * the extras and the thumbnails, and `DesignSectionController` for the
   * brand settings and the sample. Both write as they go; the Book setup
   * header says Saving… / Saved.
   *
   * Choosing: the gallery is a radio group, so arrowing through it selects
   * each card in turn. The choice is written once the selection has rested
   * for 400 ms (WCAG 3.2.2), and the card order is fixed while the tab is
   * open, so nothing moves under the pointer.
   */
  import { onDestroy, tick } from "svelte";
  import Icon from "#lib/components/Icon.svelte";
  import ColorField from "./ColorField.svelte";
  import { describeSegments, extensionProblem } from "./config-helpers";
  import { firstFontFamily, PRINT_SAFE_FONT_STACKS, SHARED_TOKEN_LABELS } from "#lib/style-tokens.ts";
  import type { StyleToken } from "#lib/platform/dtos.ts";
  import type { ExtensionsSectionController, LookCard } from "#lib/routes/extensions-section-controller.svelte.ts";
  import type { DesignSectionController } from "#lib/routes/design-section-controller.svelte.ts";

  let {
    extensions,
    design,
    onOpenAdvanced,
  }: {
    extensions: ExtensionsSectionController;
    design: DesignSectionController;
    /** Show the Advanced tab — at "All design settings" for `"design"`. */
    onOpenAdvanced: (at?: "design") => void;
  } = $props();

  // Once, as the tab opens: the cards keep this order while it is open.
  // svelte-ignore state_referenced_locally
  extensions.freezeGalleryOrder();

  const cards = $derived(extensions.galleryLooks);
  const looks = $derived(extensions.enabledLooks);
  const current = $derived(looks.length === 1 ? looks[0]!.use : null);

  // The card the author picked, until its write has finished.
  let pending = $state<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const selected = $derived(pending ?? current);
  const selectedCard = $derived(cards.find((c) => c.use === selected));

  function pick(use: string) {
    pending = use;
    if (timer) clearTimeout(timer);
    timer = setTimeout(commit, 400);
  }

  function commit() {
    timer = null;
    const card = cards.find((c) => c.use === pending);
    if (!card) return;
    // One write at a time: a pick made while the last one saves waits for it.
    if (extensions.busy) {
      timer = setTimeout(commit, 400);
      return;
    }
    void extensions.chooseLook(card).finally(() => {
      if (pending === card.use) pending = null;
      refreshSample();
    });
  }

  // Leaving the tab (or closing Book setup) writes a pick still waiting.
  onDestroy(() => {
    if (sampleTimer) clearTimeout(sampleTimer);
    if (!timer) return;
    clearTimeout(timer);
    commit();
  });

  const thumbOf = (use: string): string | null => {
    const t = extensions.thumbs[use];
    return t && t !== "__fallback__" ? t : null;
  };

  const broken = (card: LookCard): boolean => {
    const entry = extensions.entries.find((e) => e.use === card.use);
    return !!entry && extensionProblem(entry, extensions.validation, extensions.validating) !== null;
  };

  // The live sample follows the settings 150 ms after the last change.
  // svelte-ignore state_referenced_locally
  let sample = $state(design.sampleDoc);
  let sampleTimer: ReturnType<typeof setTimeout> | null = null;
  function refreshSample() {
    if (sampleTimer) clearTimeout(sampleTimer);
    sampleTimer = setTimeout(() => (sample = design.sampleDoc), 150);
  }
  function setToken(t: StyleToken, value: string) {
    design.setToken(t, value);
    refreshSample();
  }
  function setLength(t: StyleToken, value: string) {
    design.setLength(t, value);
    refreshSample();
  }

  // "Reset to the look's settings" asks first (Replace / Keep mine); the
  // focus stays on the question, then returns to the row.
  let actionsEl = $state<HTMLElement | null>(null);
  const lookName = $derived(design.lookLabels.length === 1 ? `${design.lookLabels[0]}'s` : "the look's");
  async function askReset() {
    design.askBrandReset();
    await tick();
    actionsEl?.querySelector<HTMLButtonElement>(".keep")?.focus();
  }
  async function answerReset(replace: boolean) {
    if (replace) {
      design.resetBrand();
      refreshSample();
    } else design.keepBrand();
    await tick();
    const reset = actionsEl?.querySelector<HTMLButtonElement>(".reset");
    (reset && !reset.disabled ? reset : actionsEl)?.focus();
  }

  const fontPreset = (value: string): string =>
    PRINT_SAFE_FONT_STACKS.some((f) => f.value === value) ? value : "__custom__";

</script>

{#snippet brandRow(t: StyleToken)}
  {@const label = SHARED_TOKEN_LABELS[t.name] ?? t.label}
  <div class="brand-row">
    <label for={`look-${t.name}`}>{label}</label>
    <div class="brand-control">
      {#if t.kind === "font"}
        <select
          id={`look-${t.name}`}
          class="input"
          value={fontPreset(t.value)}
          onchange={(e) => {
            if (e.currentTarget.value !== "__custom__") setToken(t, e.currentTarget.value);
          }}
        >
          {#each PRINT_SAFE_FONT_STACKS as f (f.value)}
            <option value={f.value}>{f.label}</option>
          {/each}
          {#if fontPreset(t.value) === "__custom__"}
            <option value="__custom__">{firstFontFamily(t.value)} (this book's font)</option>
          {/if}
        </select>
      {:else if t.kind === "color"}
        <div class="hex">
          <ColorField id={`look-${t.name}`} value={t.value} {label} onCommit={(value) => setToken(t, value)} />
        </div>
        {#if t.name === "--color-accent"}<span class="hint">Headings and links</span>{/if}
      {:else if t.kind === "length" || t.kind === "number"}
        <!-- Saved on change (blur, Enter or the arrows), never mid-number. -->
        <span class="size">
          <input id={`look-${t.name}`} class="input" type="number" value={parseFloat(t.value)} step={t.name === "--fs-body" ? 0.5 : 0.05} onchange={(e) => setLength(t, e.currentTarget.value)} />
          {#if t.unit}<span class="unit">{t.unit}</span>{/if}
        </span>
      {:else}
        <input id={`look-${t.name}`} class="input" type="text" value={t.value} oninput={(e) => setToken(t, e.currentTarget.value)} />
      {/if}
    </div>
  </div>
{/snippet}

{#if extensions.error}
  <p class="error" role="alert">{extensions.error}</p>
{/if}

<section class="block">
  <fieldset class="group">
    <legend><h3>Choose a look</h3></legend>
    {#if looks.length > 1}
      <div class="notice-box">
        <p>This book combines {looks.length} looks: {looks.map((e) => e.label).join(", ")}. Change them in Advanced.</p>
        <button class="ghost small" onclick={() => onOpenAdvanced()}>Open Advanced</button>
      </div>
    {:else if looks.length === 0 && !pending}
      <p class="hint">Choose a look for your book.</p>
    {/if}
    <div class="gallery">
      {#each cards as card (card.use)}
        {@const src = thumbOf(card.use)}
        {@const isSelected = selected === card.use}
        <label class="card" class:selected={isSelected}>
          <span class="thumb" aria-hidden="true">
            {#if src}
              <iframe title={`Sample of ${card.label}`} srcdoc={src} sandbox="allow-same-origin" tabindex="-1" loading="lazy"></iframe>
            {:else}
              <span class="thumb-placeholder"><span class="fallback-title">Aa</span><span class="fallback-line"></span><span class="fallback-line short"></span></span>
            {/if}
          </span>
          <span class="card-foot">
            <input type="radio" name="book-look" value={card.use} checked={isSelected} disabled={looks.length > 1} onchange={() => pick(card.use)} />
            <span class="card-name">{card.label}</span>
            {#if isSelected}<span class="card-check"><Icon name="check" size={15} /></span>{/if}
          </span>
          {#if card.from}<span class="card-note">{card.from}</span>{/if}
          {#if broken(card)}<span class="card-note warn">Couldn't load. See Advanced.</span>{/if}
        </label>
      {/each}
    </div>
    {#if selectedCard?.description}
      <p class="look-desc">{selectedCard.label}: {selectedCard.description}</p>
    {/if}
  </fieldset>
</section>

{#if looks.length > 0 || design.brandTokens.length > 0}
  <section class="block" aria-labelledby="look-adjust">
    <h3 id="look-adjust">Adjust the look</h3>
    <p class="hint">Your changes stay if you change looks.</p>
    {#if design.designSaveError}
      <p class="error" role="alert">{design.designSaveError}</p>
    {/if}
    {#if design.designLoading}
      <p class="muted">Loading…</p>
    {:else if design.brandTokens.length === 0}
      <div class="notice-box">
        <p>This look has no quick settings. You'll find all of its settings in Advanced.</p>
        <button class="ghost small" onclick={() => onOpenAdvanced("design")}>Open Advanced</button>
      </div>
    {:else}
      <div class="adjust">
        <div class="brand">
          {#each design.brandTokens as t (t.name)}{@render brandRow(t)}{/each}
          <div class="row brand-actions" bind:this={actionsEl} tabindex="-1">
            {#if design.brandResetAsked}
              <span class="confirm">Replace your settings with {lookName}?</span>
              <button class="ghost small danger" onclick={() => answerReset(true)}>Replace</button>
              <button class="ghost small keep" onclick={() => answerReset(false)}>Keep mine</button>
            {:else}
              <button class="ghost small reset" onclick={askReset} disabled={!design.brandOverridden}>Reset to the look's settings</button>
              <button class="link" onclick={() => onOpenAdvanced("design")}>All settings in Advanced <Icon name="arrow-right" size={12} /></button>
            {/if}
          </div>
        </div>
        <figure class="sample">
          <div class="sample-frame">
            <iframe title="Sample page" srcdoc={sample} sandbox="allow-same-origin" tabindex="-1"></iframe>
          </div>
          <figcaption>Sample page</figcaption>
        </figure>
      </div>
    {/if}
  </section>
{/if}

<section class="block">
  <fieldset class="group">
    <legend><h3>Extras</h3></legend>
    <p class="hint">Extra things you can type. Footnotes, tables and definition lists are always on.</p>
    <ul class="extras">
      {#each extensions.extras as x (x.use)}
        <li>
          <label>
            <input type="checkbox" checked={x.on} disabled={extensions.busy !== null} onchange={(e) => extensions.setExtra(x, e.currentTarget.checked)} />
            <span class="extra-name">{x.label}</span>
            <!-- What it does and what to type, the "what to type" set in code type. -->
            <span class="extra-desc">{#each describeSegments(x.description) as seg}{#if seg.code}<code>{seg.text}</code>{:else}{seg.text}{/if}{/each}</span>
          </label>
        </li>
      {/each}
    </ul>
    {#if extensions.otherExtensionsCount > 0}
      <p class="hint">
        This book also uses {extensions.otherExtensionsCount} {extensions.otherExtensionsCount === 1 ? "extension" : "extensions"} set up in
        <button class="link" onclick={() => onOpenAdvanced()}>Advanced <Icon name="arrow-right" size={12} /></button>
      </p>
    {/if}
  </fieldset>
</section>

<style>
  @import "../../styles/config-section-shared.css";

  .group { margin: 0; padding: 0; border: 0; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
  .group legend { padding: 0; margin-bottom: 8px; }
  .notice-box { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; padding: 8px 10px; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-surface-sunken); }
  .notice-box p { margin: 0; font-size: 12.5px; color: var(--app-text-secondary); }

  /* ── Choose a look: cards of 176 × 132 thumbnails ── */
  .gallery { display: flex; flex-wrap: wrap; gap: 12px; }
  .card {
    width: 180px; display: flex; flex-direction: column; gap: 4px; padding: 0 0 8px;
    border: 2px solid var(--app-border); border-radius: 8px; background: var(--app-surface-sunken);
    overflow: hidden; cursor: pointer;
  }
  .card:hover { border-color: var(--app-border-strong); }
  .card.selected { border-color: var(--app-accent); }
  .card:has(input:focus-visible) { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  .card:has(input:disabled) { cursor: default; }
  .thumb { display: block; width: 176px; height: 132px; overflow: hidden; background: var(--app-control-bg); border-bottom: 1px solid var(--app-border-subtle); }
  /* The sample renders at full size and is scaled down; it never takes a click
     (the card's radio does) or the focus. */
  .thumb iframe { border: 0; width: 320px; height: 240px; transform: scale(0.55); transform-origin: top left; pointer-events: none; background: #fff; }
  .thumb-placeholder { width: 100%; height: 100%; display: grid; place-content: center; gap: 5px; background: linear-gradient(135deg, var(--app-surface), var(--app-control-bg)); }
  .fallback-title { font-size: 22px; font-weight: 700; color: var(--app-text); line-height: 1; }
  .fallback-line { display: block; width: 68px; height: 4px; border-radius: 999px; background: var(--app-border-strong); }
  .fallback-line.short { width: 46px; }
  .card-foot { display: flex; align-items: center; gap: 6px; padding: 4px 8px 0; }
  .card-foot input { margin: 0; flex-shrink: 0; }
  .card-name { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; color: var(--app-text); }
  .card-check { display: inline-flex; color: var(--app-accent); }
  .card-note { padding: 0 8px 0 28px; font-size: 11.5px; color: var(--app-text-muted); }
  .card-note.warn { color: var(--app-warning-text); }
  .look-desc { margin: 0; font-size: 12.5px; color: var(--app-text-secondary); }

  /* ── Adjust the look: six settings beside the sample ── */
  .adjust { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 20px; align-items: start; }
  .brand { display: flex; flex-direction: column; gap: 8px; }
  /* The label lines up with its field, whatever hint or message is under the field. */
  .brand-row { display: grid; grid-template-columns: 120px minmax(0, 1fr); align-items: start; gap: 4px 10px; }
  .brand-row label { min-height: 34px; display: flex; align-items: center; font-size: 12.5px; color: var(--app-text-secondary); }
  .brand-control { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .hex { width: 172px; }
  .size { display: flex; align-items: center; gap: 6px; }
  .size .input { width: 84px; }
  .unit { font-size: 12px; color: var(--app-text-muted); }
  .brand-actions { margin-top: 4px; flex-wrap: wrap; outline: none; }
  .confirm { font-size: 12.5px; color: var(--app-text-secondary); }
  /* Settings' Remove confirm: the replacing button in the error color. */
  .brand-actions .danger { color: var(--app-error-text); border-color: var(--app-error-text); }
  .sample { margin: 0; display: flex; flex-direction: column; gap: 4px; }
  .sample-frame { height: 300px; overflow: hidden; border: 1px solid var(--app-border); border-radius: 6px; background: #fff; }
  .sample-frame iframe { border: 0; width: 400px; height: 375px; transform: scale(0.8); transform-origin: top left; }
  .sample figcaption { font-size: 11.5px; color: var(--app-text-muted); }

  /* ── Extras ── */
  .extras { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .extras label { display: grid; grid-template-columns: auto 120px minmax(0, 1fr); align-items: baseline; gap: 8px; cursor: pointer; }
  .extras input { margin: 0; align-self: center; }
  .extra-name { font-size: 13px; color: var(--app-text); }
  .extra-desc { font-size: 12px; color: var(--app-text-muted); line-height: 1.4; }
  .extra-desc code { font-family: var(--app-font-mono); font-size: 12px; color: var(--app-text); }

  @media (max-width: 760px) {
    .adjust { grid-template-columns: minmax(0, 1fr); }
  }
</style>
