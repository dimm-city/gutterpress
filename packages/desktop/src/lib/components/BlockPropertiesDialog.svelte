<script lang="ts">
  import { dialogBehavior } from "#lib/dialog.ts";
  import { untrack } from "svelte";
  import { COLUMN_COUNTS } from "#lib/editor/block-attrs.ts";
  import type { BlockPropertiesModel, BlockPropertiesValue } from "#lib/editor/block-properties.ts";

  let { model, initialValue, onDone }: {
    model: BlockPropertiesModel;
    initialValue: BlockPropertiesValue;
    onDone: (value: BlockPropertiesValue | null) => void;
  } = $props();

  let value = $state<BlockPropertiesValue>(untrack(() => ({ ...initialValue, classes: { ...initialValue.classes } })));
  let finished = false;

  function finish(result: BlockPropertiesValue | null): void {
    if (finished) return;
    finished = true;
    onDone(result);
  }

  // One heading per plugin, in the order the options arrive (core first).
  const groups = untrack(() => {
    const out: Array<{ name: string; options: BlockPropertiesModel["options"] }> = [];
    for (const option of model.options) {
      const group = out.find((g) => g.name === option.group);
      if (group) group.options.push(option);
      else out.push({ name: option.group, options: [option] });
    }
    return out;
  });

  const columnsReason = $derived(
    model.columns.kind === "unavailable"
      ? model.columns.reason
      : model.columns.kind === "partial"
        ? "This block has its own @columns run. Change it in the source."
        : "",
  );
</script>

<div class="dlg-backdrop" role="presentation" onclick={() => finish(null)}></div>
<form
  class="dlg-shell block-properties"
  use:dialogBehavior={{ onClose: () => finish(null), labelledBy: "block-properties-title", initialFocus: "input" }}
  onsubmit={(event) => { event.preventDefault(); finish({ ...value, classes: { ...value.classes } }); }}
>
  <header class="dlg-header">
    <h2 id="block-properties-title">Block properties <code class="marker">@{model.marker}</code></h2>
  </header>

  <div class="fields">
    {#each groups as group (group.name)}
      <fieldset class="group">
        <legend>{group.name}</legend>
        {#each group.options as option (option.class)}
          <label class="check">
            <input type="checkbox" name={`class-${option.class}`} bind:checked={value.classes[option.class]} />
            <span class="check-text">
              <span class="check-label">{option.label} <code>.{option.class}</code></span>
              {#if option.description}<span class="check-note">{option.description}</span>{/if}
              {#if option.hint}<span class="check-note hint">{option.hint}</span>{/if}
            </span>
          </label>
        {/each}
      </fieldset>
    {/each}

    <fieldset class="group">
      <legend>Layout</legend>
      <label class="check">
        <input type="checkbox" name="break-before" bind:checked={value.breakBefore} />
        <span class="check-text">
          <span class="check-label">Break before <code>@page-break</code></span>
          <span class="check-note">Start this block on a new page: a break line goes directly above it.</span>
        </span>
      </label>
      <label class="select">
        <span class="check-label">Columns <code>@columns</code></span>
        <select name="columns" bind:value={value.columns} disabled={columnsReason !== ""}>
          <option value="">None</option>
          {#each COLUMN_COUNTS as n}
            <option value={String(n)}>{n} {n === 1 ? "column" : "columns"}</option>
          {/each}
          {#if initialValue.columns === "custom"}<option value="custom">Custom (as written)</option>{/if}
        </select>
        <span class="check-note">{columnsReason || "Wraps the block's content in @columns … @end-columns."}</span>
      </label>
    </fieldset>
  </div>

  <p class="class-note">Everything else on the marker line (variant, id, label, other classes) is kept as written.</p>
  <footer class="dlg-actions">
    <button type="button" class="dlg-ghost" onclick={() => finish(null)}>Cancel</button>
    <button type="submit" class="dlg-primary app-btn-primary">Apply changes</button>
  </footer>
</form>

<style>
  @import "../styles/dialog-shell.css";
  .block-properties { width: min(560px, 94vw); }
  .marker { margin-left: 6px; font-size: 13px; font-weight: 500; color: var(--app-text-secondary); }
  .fields { display: grid; gap: 14px; padding: 18px 18px 10px; overflow: auto; }
  .group { display: grid; gap: 10px; margin: 0; padding: 12px 14px; border: 1px solid var(--app-border); border-radius: 6px; min-width: 0; }
  legend { padding: 0 6px; color: var(--app-text-secondary); font-size: 12px; font-weight: 600; }
  label { display: grid; gap: 4px; color: var(--app-text-secondary); font-size: 13px; min-width: 0; }
  label.check { display: flex; align-items: flex-start; gap: 10px; }
  label.check input { width: auto; margin-top: 3px; }
  .check-text { display: grid; gap: 2px; min-width: 0; }
  .check-label { color: var(--app-text); }
  .check-note { color: var(--app-text-muted); font-size: 12px; }
  .check-note.hint { font-style: italic; }
  select { box-sizing: border-box; width: 100%; min-width: 0; padding: 8px 10px; color: var(--app-text); background: var(--app-control-bg); border: 1px solid var(--app-border); border-radius: 5px; font: inherit; }
  input:focus-visible, select:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }
  select:disabled { opacity: 0.55; }
  .class-note { margin: 0; padding: 4px 18px 14px; color: var(--app-text-muted); font-size: 12px; }
  code { color: var(--app-text-secondary); font-size: 12px; }
</style>
