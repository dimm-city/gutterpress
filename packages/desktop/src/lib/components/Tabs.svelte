<script lang="ts" generics="T extends string">
  /**
   * The underline tab strip + WAI-ARIA keyboard pattern (roving tabindex;
   * ArrowLeft/Right wrap, Home/End jump) first written for the start screen.
   * Strip only: the consumer owns the panel and renders it as
   * `<div role="tabpanel" id="{idPrefix}-panel" aria-labelledby="{idPrefix}-tab-{active}">`,
   * which is what each tab's `aria-controls` / id point at. `onselect` fires
   * for a click and for a key move alike, so the consumer's one switch
   * function stays the only place that changes the active tab.
   */
  let {
    tabs,
    active,
    label,
    idPrefix,
    onselect,
  }: {
    tabs: ReadonlyArray<{ id: T; label: string }>;
    active: T;
    /** The tablist's accessible name. */
    label: string;
    idPrefix: string;
    onselect: (id: T) => void;
  } = $props();

  let tabEls = $state<Record<string, HTMLButtonElement | undefined>>({});

  function onTablistKeydown(e: KeyboardEvent) {
    const ids = tabs.map((tab) => tab.id);
    const current = ids.indexOf(active);
    let next: number | undefined;
    if (e.key === "ArrowRight") next = (current + 1) % ids.length;
    else if (e.key === "ArrowLeft") next = (current - 1 + ids.length) % ids.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = ids.length - 1;
    if (next === undefined) return;
    e.preventDefault();
    onselect(ids[next]!);
    tabEls[ids[next]!]?.focus();
  }
</script>

<div class="tab-bar" role="tablist" aria-label={label} onkeydown={onTablistKeydown} tabindex="-1">
  {#each tabs as tab (tab.id)}
    <button
      id="{idPrefix}-tab-{tab.id}"
      type="button"
      role="tab"
      class="tab"
      class:active={active === tab.id}
      aria-selected={active === tab.id}
      aria-controls="{idPrefix}-panel"
      tabindex={active === tab.id ? 0 : -1}
      bind:this={tabEls[tab.id]}
      onclick={() => onselect(tab.id)}
    >{tab.label}</button>
  {/each}
</div>

<style>
  .tab-bar {
    display: flex;
    gap: 2px;
    border-bottom: 1px solid var(--app-border-subtle);
    flex-shrink: 0;
    overflow-x: auto;
  }
  .tab {
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--app-text-muted);
    font-size: 13px;
    padding: 8px 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .tab:hover { color: var(--app-text); }
  .tab.active {
    color: var(--app-text);
    border-bottom-color: var(--app-accent);
    font-weight: 600;
  }
  .tab:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: -2px; }
</style>
