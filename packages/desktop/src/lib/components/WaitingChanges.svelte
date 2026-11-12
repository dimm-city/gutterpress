<script lang="ts">
  /**
   * WaitingChanges — the Online tab's "Waiting" card: two compact columns,
   * Going up (versions on this computer not online yet) and Coming down
   * (versions online not on this computer yet). Each row is a version, or a run
   * of automatic versions by one author, with the files it changed and its
   * time; a row opens Version history on that version. The tab reads the data
   * (one history page, shared) and the status card above carries the actions,
   * so this only presents.
   *
   * PWA-clean (§8): no reads of its own.
   */
  import Icon from "#lib/components/Icon.svelte";
  import { agoFull } from "#lib/routes/backup-card.ts";
  import { whenRange, type WaitingRow } from "#lib/routes/version-timeline.ts";

  let {
    up,
    upCount,
    upAtLeast = false,
    edits = null,
    draftOnlyHere = false,
    down,
    downCount,
    reason,
    incomingAt = null,
    checking = false,
    now,
    onOpen,
  }: {
    /** Rows going up, newest first. */
    up: WaitingRow[];
    /** Versions going up (the column's count: versions, not rows). */
    upCount: number;
    /** The first page of history ends before the first online version: there are more than `upCount`. */
    upAtLeast?: boolean;
    /** Files edited since the last version (not in the count: they go up as a version); null = not known. */
    edits?: number | null;
    /** The open draft has never been sent online, so all of it goes up. */
    draftOnlyHere?: boolean;
    /** Rows coming down; null = not known yet. */
    down: WaitingRow[] | null;
    downCount: number;
    /** Why the online side couldn't be read just now. */
    reason?: string;
    incomingAt?: number | null;
    checking?: boolean;
    now: number;
    /** Open Version history on a version. */
    onOpen?: (id: string) => void;
  } = $props();

  /** Rows per column; one more than this is shown rather than "1 more". */
  const ROWS = 4;
  const shown = (rows: WaitingRow[]) => (rows.length <= ROWS + 1 ? rows : rows.slice(0, ROWS));
  const versions = (n: number) => `${n} ${n === 1 ? "version" : "versions"}`;
  const hidden = (rows: WaitingRow[]) => shown(rows).length < rows.length ? rows.slice(ROWS).reduce((n, r) => n + r.count, 0) : 0;
</script>

{#snippet rows(list: WaitingRow[], label: string, showAuthor: boolean)}
  <ul class="wc-list" aria-label={label}>
    {#each shown(list) as r (r.id)}
      <li>
        <button class="wc-row" onclick={() => onOpen?.(r.id)} disabled={!onOpen}>
          <span class="wc-title">{#if r.named}<span class="wc-star"><Icon name="star" size={12} /></span>{/if}{r.title}</span>
          <span class="wc-when">{#if showAuthor && r.author}{r.author}{" · "}{/if}{whenRange(r.from, r.to, now)}</span>
          {#if r.files.length}<span class="wc-files">{r.files.join(", ")}{#if r.hint}{" · "}{r.hint}{/if}{#if r.more > 0}{" "}and {r.more} more{:else if r.partial}, …{/if}</span>{/if}
          <span class="wc-chev"><Icon name="chevron-right" size={14} /></span>
        </button>
      </li>
    {/each}
  </ul>
  {#if hidden(list) > 0}<p class="wc-note">and {versions(hidden(list))} more in Version history.</p>{/if}
{/snippet}

<section class="wc section-card" aria-labelledby="waiting-title">
  <header class="section-head">
    <div>
      <h3 id="waiting-title">Waiting</h3>
      <p class="section-sub">Click a version to see exactly what changed.</p>
    </div>
  </header>

  <div class="wc-grid">
    <div class="wc-side">
      <h4 class="wc-head" id="wc-up"><span class="wc-arrow up"><Icon name="cloud-upload" size={15} /></span> Going up <span class="wc-count" aria-label="{upCount}{upAtLeast ? ' or more' : ''} versions">{upCount}{upAtLeast ? "+" : ""}</span></h4>
      {#if draftOnlyHere}<p class="wc-note">This draft isn't online yet, so all of it goes up.</p>{/if}
      {#if edits}<p class="wc-note">Also {edits} {edits === 1 ? "file" : "files"} edited since the last version, saved as a version when it goes up.</p>{/if}
      {#if up.length}
        {@render rows(up, "Going up", false)}
      {:else if !draftOnlyHere && !edits}
        <p class="wc-note">Nothing. Everything saved here is online.</p>
      {/if}
    </div>

    <div class="wc-side">
      <h4 class="wc-head" id="wc-down"><span class="wc-arrow down"><Icon name="cloud-download" size={15} /></span> Coming down <span class="wc-count">{downCount}</span></h4>
      {#if reason}
        <p class="wc-note">Couldn't check online just now{incomingAt ? `, so this is what was known ${agoFull(incomingAt, now)}` : ""}.</p>
      {/if}
      {#if down === null}
        <p class="wc-note">{checking || !reason ? "Checking online…" : "Not checked yet."}</p>
      {:else if down.length === 0}
        <p class="wc-note">Nothing new from anyone else.{incomingAt ? ` Checked ${agoFull(incomingAt, now)}.` : ""}</p>
      {:else}
        {@render rows(down, "Coming down", true)}
      {/if}
    </div>
  </div>
</section>

<style>
  .section-card.wc .section-head { border-bottom: 0; padding-bottom: 10px; }
  .wc-grid { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid var(--app-border-subtle); }
  .wc-side { min-width: 0; padding-bottom: 6px; }
  .wc-side + .wc-side { border-left: 1px solid var(--app-border-subtle); }
  .wc-head { display: flex; align-items: center; gap: 8px; margin: 0; padding: 10px 16px 8px; font-size: 13px; font-weight: 600; color: var(--app-text); }
  .wc-arrow { display: inline-flex; }
  .wc-arrow.up { color: var(--app-warning-text); }
  .wc-arrow.down { color: var(--app-info-text); }
  .wc-count {
    padding: 0 8px; border: 1px solid var(--app-border); border-radius: 999px;
    background: var(--app-surface-sunken); color: var(--app-text-secondary);
    font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums;
  }
  .wc-list { list-style: none; margin: 0; padding: 0; }
  .wc-list li { border-top: 1px solid var(--app-border-subtle); }
  .wc-row {
    display: grid; grid-template-columns: minmax(0, 1fr) auto 14px; align-items: baseline; gap: 2px 10px;
    width: 100%; padding: 8px 12px 8px 16px; border: 0; border-radius: 0; background: none; text-align: left;
  }
  .wc-row:hover:not(:disabled) { background: var(--app-surface-hover); }
  .wc-title { display: inline-flex; align-items: center; gap: 5px; min-width: 0; font-size: 13px; font-weight: 600; color: var(--app-text); overflow-wrap: anywhere; }
  .wc-star { display: inline-flex; color: var(--app-warning-text); }
  .wc-star :global(svg) { fill: currentColor; }
  .wc-when { font-size: 12px; color: var(--app-text-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .wc-files { grid-column: 1 / 3; font-size: 12px; color: var(--app-text-secondary); overflow-wrap: anywhere; }
  .wc-chev { grid-column: 3; grid-row: 1 / 3; align-self: center; display: inline-flex; color: var(--app-text-muted); }
  .wc-note { margin: 0; padding: 4px 16px 8px; font-size: 12px; color: var(--app-text-muted); }
  @media (max-width: 720px) {
    .wc-grid { grid-template-columns: 1fr; }
    .wc-side + .wc-side { border-left: 0; border-top: 1px solid var(--app-border-subtle); }
  }
</style>
