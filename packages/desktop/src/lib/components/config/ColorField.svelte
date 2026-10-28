<script lang="ts">
  /**
   * One color setting, for the Look tab and Advanced › All design settings:
   * the swatch (the system picker, which saves as it moves) and a text field
   * beside it. What is typed stays in the field until it is committed (blur or
   * Enter), and only a color is saved — with or without its `#`
   * (`typedColor`). Anything else keeps the last good color and says what to
   * type. A value the swatch can't show (`rgba(…)`) gets a plain swatch.
   */
  import { toHex, typedColor } from "#lib/style-tokens.ts";

  let {
    id,
    value,
    label,
    onCommit,
  }: {
    /** The text field's id (its `<label for>`). */
    id: string;
    /** The saved value. */
    value: string;
    /** The setting's name, for the swatch's accessible name. */
    label: string;
    onCommit: (value: string) => void;
  } = $props();

  // What the author is typing, until it is committed; null shows the saved value.
  let draft = $state<string | null>(null);
  let invalid = $state(false);
  const hex = $derived(toHex(value));

  function commit() {
    if (draft === null) return;
    const color = typedColor(draft);
    invalid = color === null;
    if (!color) return;
    draft = null;
    if (color !== value) onCommit(color);
  }

  function pick(color: string) {
    draft = null;
    invalid = false;
    onCommit(color);
  }
</script>

<div class="color-field">
  <span class="color">
    {#if hex}
      <input type="color" value={hex} oninput={(e) => pick(e.currentTarget.value)} aria-label={`${label} swatch`} />
    {:else}
      <span class="swatch" style:background={value} title={value}></span>
    {/if}
    <input
      {id}
      class="input"
      type="text"
      value={draft ?? hex ?? value}
      oninput={(e) => (draft = e.currentTarget.value)}
      onchange={commit}
      aria-invalid={invalid}
      aria-describedby={invalid ? `${id}-error` : undefined}
      spellcheck="false"
      autocomplete="off"
    />
  </span>
  {#if invalid}
    <span class="color-error" id={`${id}-error`} role="alert">Enter a color like #2b6cb0</span>
  {/if}
</div>

<style>
  /* `.input` is the config panel's shared field style. */
  .color-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; width: 100%; }
  .color { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .color .input { flex: 1; min-width: 0; }
  input[type="color"], .swatch { flex-shrink: 0; width: 30px; height: 30px; padding: 0; border: 1px solid var(--app-border); border-radius: 4px; background: var(--app-control-bg); }
  input[type="color"] { cursor: pointer; }
  input[type="color"]:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }
  .color-error { font-size: 12px; color: var(--app-error-text); }
</style>
