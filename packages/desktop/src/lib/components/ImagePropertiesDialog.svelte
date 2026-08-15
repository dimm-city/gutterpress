<script lang="ts">
  import { dialogBehavior } from "$lib/dialog";
  import { untrack } from "svelte";
  import {
    IMAGE_PIN_ALIGNMENT_OPTIONS,
    IMAGE_PIN_CLASS,
    IMAGE_LAYER_OPTIONS,
    IMAGE_POSITION_OPTIONS,
    IMAGE_SIZE_OPTIONS,
    IMAGE_SPACING_OPTIONS,
    type ImagePropertiesValue,
  } from "$lib/editor/image-classes";

  let { initialValue, onDone }: {
    initialValue: ImagePropertiesValue;
    onDone: (value: ImagePropertiesValue | null) => void;
  } = $props();

  let value = $state<ImagePropertiesValue>(untrack(() => ({ ...initialValue })));
  let finished = false;

  function finish(result: ImagePropertiesValue | null): void {
    if (finished) return;
    finished = true;
    onDone(result);
  }

  function changedWidth(event: Event): void {
    const width = (event.currentTarget as HTMLInputElement).value;
    value.width = width;
    if (width.trim()) value.size = "";
  }

  function changedSize(event: Event): void {
    const size = (event.currentTarget as HTMLSelectElement).value;
    value.size = size;
    if (size) value.width = "";
  }

  const isFloat = () => value.position === "gp-left" || value.position === "gp-right";
</script>

<div class="dlg-backdrop" role="presentation" onclick={() => finish(null)}></div>
<form
  class="dlg-shell image-properties"
  use:dialogBehavior={{ onClose: () => finish(null), labelledBy: "image-properties-title", initialFocus: "input" }}
  onsubmit={(event) => { event.preventDefault(); finish({ ...value }); }}
>
  <header class="dlg-header"><h2 id="image-properties-title">Image properties</h2></header>

  <div class="fields">
    <label class="wide">
      <span>Image path or URL</span>
      <input name="src" bind:value={value.src} autocomplete="off" />
    </label>
    <label class="wide">
      <span>Alt text</span>
      <input name="alt" bind:value={value.alt} autocomplete="off" />
    </label>
    <label>
      <span>Custom width</span>
      <input name="width" bind:value={value.width} oninput={changedWidth} placeholder="For example 50% or 300px" autocomplete="off" />
    </label>
    <label>
      <span>Position</span>
      <select name="position" bind:value={value.position}>
        <option value="">None</option>
        {#each IMAGE_POSITION_OPTIONS as option}
          <option value={option.class}>{option.label} — .{option.class}</option>
        {/each}
      </select>
    </label>
    <label>
      <span>Pin alignment</span>
      <select name="pinAlignment" bind:value={value.pinAlignment} disabled={value.position !== IMAGE_PIN_CLASS}>
        {#each IMAGE_PIN_ALIGNMENT_OPTIONS as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </label>
    <label>
      <span>Preset size</span>
      <select name="size" bind:value={value.size} onchange={changedSize}>
        <option value="">None</option>
        {#each IMAGE_SIZE_OPTIONS as option}
          <option value={option.class}>{option.label} — .{option.class}</option>
        {/each}
      </select>
    </label>
    <label>
      <span>Float spacing</span>
      <select name="spacing" bind:value={value.spacing} disabled={!isFloat()}>
        <option value="">Default (1em)</option>
        {#each IMAGE_SPACING_OPTIONS as option}
          <option value={option.class}>{option.label} — .{option.class}</option>
        {/each}
      </select>
    </label>
    <label class="check">
      <input name="shape" type="checkbox" bind:checked={value.shape} disabled={!isFloat()} />
      <span>Wrap text to image shape (floats only)</span>
    </label>
    <label>
      <span>Layer</span>
      <select name="layer" bind:value={value.layer} disabled={value.position !== IMAGE_PIN_CLASS}>
        <option value="">Default</option>
        {#each IMAGE_LAYER_OPTIONS as option}
          <option value={option.class}>{option.label} — .{option.class}</option>
        {/each}
      </select>
    </label>
  </div>

  <p class="class-note">The listed <code>.gp-*</code> classes are the supported image options. Unrecognized custom attributes are preserved.</p>
  <footer class="dlg-actions">
    <button type="button" class="dlg-ghost" onclick={() => finish(null)}>Cancel</button>
    <button type="submit" class="dlg-primary app-btn-primary">Apply changes</button>
  </footer>
</form>

<style>
  @import "$lib/styles/dialog-shell.css";
  .image-properties { width: min(680px, 94vw); }
  .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 18px 18px 10px; overflow: auto; }
  label { display: grid; gap: 6px; color: var(--app-text-secondary); font-size: 13px; min-width: 0; }
  label.wide { grid-column: 1 / -1; }
  label.check { display: flex; align-items: center; gap: 8px; align-self: end; padding: 8px 0; }
  label.check input { width: auto; }
  input, select { box-sizing: border-box; width: 100%; min-width: 0; padding: 8px 10px; color: var(--app-text); background: var(--app-control-bg); border: 1px solid var(--app-border); border-radius: 5px; font: inherit; }
  input:focus, select:focus { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }
  select:disabled { opacity: 0.55; }
  .class-note { margin: 0; padding: 4px 18px 14px; color: var(--app-text-muted); font-size: 12px; }
  code { color: var(--app-text-secondary); }
  @media (max-width: 560px) {
    .fields { grid-template-columns: 1fr; }
    label.wide { grid-column: auto; }
  }
</style>
