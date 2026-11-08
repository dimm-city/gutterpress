<script lang="ts">
  /**
   * WaitingChanges — the Online tab's "what is waiting" lists: changes on this
   * computer that are not online yet, and changes online that are not on this
   * computer yet, each with one button. It only presents data the app already
   * reads (the version list's online/not-online marks, the files a version
   * changed, the online copy's new versions) and runs the page's own send and
   * get passes. It paints from the last read at once and swaps in new data
   * quietly when it arrives.
   *
   * PWA-clean (§8): api.* routes only.
   */
  import { onMount } from "svelte";
  import { api } from "#lib/api.ts";
  import Icon from "#lib/components/Icon.svelte";
  import { agoFull } from "#lib/routes/backup-card.ts";
  import { versionTitle, versionKind, whenShort } from "#lib/routes/version-timeline.ts";
  import * as view from "#lib/routes/online-view-cache.ts";
  import type { WaitingChange } from "#lib/routes/online-view-cache.ts";

  let {
    projectDir,
    refreshKey = 0,
    busy = false,
    running = null,
    checking = false,
    onSend,
    onGet,
  }: {
    projectDir: string;
    /** Bumped by the parent after anything that can change what is waiting (a send, a get, a saved version). */
    refreshKey?: number;
    busy?: boolean;
    running?: "back-up" | "get-latest" | "repair" | "start-over" | null;
    /** The online copy is being checked right now. */
    checking?: boolean;
    onSend: () => void;
    onGet: () => void;
  } = $props();

  /** At most this many changes are listed per side (the rest are counted). */
  const SHOW = 5;
  /** Files named per change. */
  const FILES = 3;

  const have = view.peek(projectDir);
  let local = $state<WaitingChange[]>(have?.local ?? []);
  let incoming = $state<WaitingChange[] | null>(have?.incoming ?? null);
  let reason = $state<string | undefined>(have?.incomingReason);
  let incomingAt = $state<number | null>(have?.incomingAt ?? null);
  let unsaved = $state<number | null>(have?.facts?.changedFiles ?? null);
  let now = $state(Date.now());

  const note = (message: string): string | null => (versionKind(message) === "manual" ? versionTitle(message) : null);

  async function withFiles(entries: { id: string; message: string; timestamp: number; author?: string }[]): Promise<WaitingChange[]> {
    return Promise.all(
      entries.slice(0, SHOW).map(async (e) => {
        const c = await api.vcs.versionChanges(projectDir, e.id).catch(() => null);
        return {
          id: e.id,
          at: e.timestamp,
          note: note(e.message),
          author: e.author,
          files: (c?.files ?? []).slice(0, FILES).map((f) => view.plainFileName(f.path) + (f.kind === "added" ? " (new)" : f.kind === "removed" ? " (removed)" : "")),
          more: Math.max(0, (c?.files.length ?? 0) - FILES) + (c?.more ?? 0),
        };
      }),
    );
  }

  let localTotal = $state(have?.local.length ?? 0);

  async function load(): Promise<void> {
    const dir = projectDir;
    // Both sides read behind what is already showing; each lands on its own.
    const mine = (async () => {
      try {
        const page = await api.vcs.listSnapshotsPage(dir, { limit: 40 });
        const waiting = page.entries.filter((e) => e.backedUp === false);
        localTotal = waiting.length;
        const list = await withFiles(waiting);
        local = list;
        view.update(dir, { local: list });
      } catch {
        // Keep what is showing.
      }
    })();
    const theirs = (async () => {
      try {
        const r = await api.vcs.onlineVersions(dir);
        reason = r.reason;
        if (r.reason) {
          view.update(dir, { incomingReason: r.reason });
          return;
        }
        const list: WaitingChange[] = r.entries.slice(0, SHOW).map((e) => ({
          id: e.id,
          at: e.timestamp,
          note: note(e.message),
          author: e.author,
          files: e.changes.slice(0, FILES).map((f) => view.plainFileName(f.path) + (f.kind === "added" ? " (new)" : f.kind === "removed" ? " (removed)" : "")),
          more: Math.max(0, e.changes.length - FILES) + e.moreChanges,
        }));
        incoming = list;
        incomingTotal = r.entries.length;
        incomingAt = r.checkedAt ? Date.parse(r.checkedAt) || Date.now() : Date.now();
        view.update(dir, { incoming: list, incomingReason: undefined, incomingAt });
      } catch {
        // Keep what is showing.
      }
    })();
    await Promise.all([mine, theirs]);
    try {
      const p = await api.vcs.unversionedChanges(dir);
      unsaved = p.changedFiles;
    } catch {
      // Keep what is showing.
    }
  }
  let incomingTotal = $state(have?.incoming?.length ?? 0);

  onMount(() => {
    const t = setInterval(() => (now = Date.now()), 15_000);
    return () => clearInterval(t);
  });

  $effect(() => {
    void refreshKey;
    void load();
  });

  const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
  const waitingHere = $derived(localTotal + (unsaved && unsaved > 0 ? 1 : 0));
</script>

{#snippet rows(list: WaitingChange[], showAuthor: boolean)}
  <ul class="wc-list">
    {#each list as c (c.id)}
      <li>
        <span class="wc-when">{whenShort(c.at, now)} · {agoFull(c.at, now)}</span>
        <span class="wc-what">
          <strong>{c.note ?? "Changes"}</strong>{#if showAuthor && c.author}<span class="wc-who">{" "}by {c.author}</span>{/if}
        </span>
        {#if c.files.length}<span class="wc-files">{c.files.join(", ")}{#if c.more > 0} and {count(c.more, "more file", "more files")}{/if}</span>{/if}
      </li>
    {/each}
  </ul>
{/snippet}

<section class="wc section-card" aria-labelledby="waiting-title">
  <header class="section-head">
    <div>
      <h3 id="waiting-title">Changes waiting</h3>
      <p class="section-sub">What is different between this computer and the online copy.</p>
    </div>
  </header>

  <div class="wc-grid">
    <div class="wc-side" aria-labelledby="wc-here">
      <div class="wc-head">
        <Icon name="laptop" size={15} />
        <h4 id="wc-here">On this computer, not online yet</h4>
        <span class="wc-count">{waitingHere}</span>
      </div>
      {#if localTotal === 0 && !(unsaved && unsaved > 0)}
        <p class="wc-empty">Nothing waiting. Everything saved here is online.</p>
      {:else}
        {#if unsaved && unsaved > 0}
          <p class="wc-extra">{count(unsaved, "file", "files")} edited since your last saved version.</p>
        {/if}
        {@render rows(local, false)}
        {#if localTotal > local.length}<p class="wc-extra">and {localTotal - local.length} older {localTotal - local.length === 1 ? "change" : "changes"}.</p>{/if}
      {/if}
      {#if waitingHere > 0 || running === "back-up"}
        <button class="app-btn-primary wc-send" onclick={onSend} disabled={busy}>
          {running === "back-up" ? "Sending…" : "Send now"}
        </button>
      {/if}
    </div>

    <div class="wc-side" aria-labelledby="wc-online">
      <div class="wc-head">
        <Icon name="cloud-download" size={15} />
        <h4 id="wc-online">Online, not on this computer yet</h4>
        <span class="wc-count">{incoming?.length ? incomingTotal : 0}</span>
      </div>
      {#if reason}
        <p class="wc-empty">Couldn't check online just now{incomingAt ? `, so this is what was known ${agoFull(incomingAt, now)}` : ""}.</p>
      {/if}
      {#if incoming === null}
        <p class="wc-empty">{checking || !reason ? "Checking online…" : "Not checked yet."}</p>
      {:else if incoming.length === 0}
        <p class="wc-empty">Nothing new from collaborators.{incomingAt ? ` Checked ${agoFull(incomingAt, now)}.` : ""}</p>
      {:else}
        {@render rows(incoming, true)}
        {#if incomingTotal > incoming.length}<p class="wc-extra">and {incomingTotal - incoming.length} more.</p>{/if}
      {/if}
      {#if incoming?.length || running === "get-latest"}
        <button class="app-btn-primary wc-get" onclick={onGet} disabled={busy}>
          {running === "get-latest" ? "Getting them…" : "Get them now"}
        </button>
      {/if}
    </div>
  </div>
</section>

<style>
  .wc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; padding: 14px 16px 16px; }
  .wc-side { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; min-width: 0; }
  .wc-head { display: flex; align-items: center; gap: 8px; }
  .wc-head h4 { margin: 0; font-size: 0.95rem; }
  .wc-count { background: var(--app-surface-2, rgba(128, 128, 128, 0.18)); border-radius: 999px; padding: 0 8px; font-size: 0.8rem; font-variant-numeric: tabular-nums; }
  .wc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; width: 100%; }
  .wc-list li { display: flex; flex-direction: column; gap: 2px; font-size: 0.9rem; }
  .wc-when { font-size: 0.8rem; opacity: 0.7; }
  .wc-who { opacity: 0.75; }
  .wc-what strong { font-weight: 600; }
  .wc-files { opacity: 0.85; }
  .wc-empty, .wc-extra { margin: 0; font-size: 0.9rem; opacity: 0.75; }
</style>
