<script lang="ts">
  /**
   * RevisionsList — Book setup → Online copy's Revisions card (#448): separate
   * lines of work in the same book ("Second edition", "Editor's pass") that
   * the author can start, switch, rename and delete, each saying where it is
   * kept.
   *
   *   Online                       — on this computer and in the online copy
   *   Online · not backed up yet   — this computer has versions the online copy hasn't
   *   Only on this computer        — never backed up
   *   Only online                  — in the online copy, not on this computer yet
   *
   * One row per revision: its name, where it is kept, Switch, and a "more"
   * menu with Rename… (every revision) and Delete… (every one but the open
   * one). New revision, Rename and Delete each open a small dialog that says
   * what will happen before it happens: an online revision is renamed or
   * deleted in the online copy too, now, and deleting one that holds versions
   * found nowhere else asks a second time, naming how many. The open revision
   * comes first; past five a field finds one by name, and the card shows five
   * until "Show all". Vocabulary: docs/ux-design-contract.md.
   *
   * PWA-clean (§8): api.* routes only.
   */
  import { onMount, tick } from "svelte";
  import Icon from "#lib/components/Icon.svelte";
  import { api, type Revision, type RevisionList } from "#lib/api.ts";
  import { dialogBehavior } from "#lib/dialog.ts";
  import { friendlyHostError, unwrapRouteError } from "#lib/errors.ts";
  import { revisionNameFrom, revisionsShown } from "#lib/revision-name.ts";

  let {
    projectDir,
    hasOnlineCopy,
    disabled = false,
    onChanged,
  }: {
    projectDir: string;
    /** The book has an online copy, so the list is refreshed from it. */
    hasOnlineCopy: boolean;
    /** Something else on the tab is running. */
    disabled?: boolean;
    /** Another revision was opened, made or renamed: the files under `projectDir` may have changed under the open editor. */
    onChanged?: () => void;
  } = $props();

  let list = $state<RevisionList | null>(null);
  /** The refresh from the online copy is still running. */
  let checking = $state(false);
  let working = $state(false);
  let error = $state<string | null>(null);

  /** The one open dialog: a new revision, a rename, or a delete (a second step when versions would be lost). */
  type Pending =
    | { kind: "new" }
    | { kind: "rename"; revision: Revision }
    | { kind: "delete"; revision: Revision; everywhere: boolean; lost: number | null };
  let pending = $state<Pending | null>(null);
  let typed = $state("");
  /** The row whose "more" menu is open. */
  let menuFor = $state<string | null>(null);

  /** More revisions than this and the card offers a filter by name, and shows this many until "Show all". */
  const FEW = 5;
  let find = $state("");
  let showAll = $state(false);
  const filtering = $derived((list?.revisions.length ?? 0) > FEW);
  const matching = $derived(revisionsShown(list?.revisions ?? [], filtering ? find : ""));
  const shown = $derived(showAll || find.trim() ? matching : matching.slice(0, FEW));
  const currentName = $derived(list?.current ?? null);

  /** The refreshed list, or the last one when the online copy can't be reached. */
  async function load(): Promise<void> {
    try {
      // What this computer knows shows at once; the online check can take a while offline.
      list = await api.vcs.listRevisions(projectDir);
      if (!hasOnlineCopy) return;
      checking = true;
      list = (await api.vcs.listRevisions(projectDir, { refresh: true })) ?? list;
    } catch {
      // The list stays as it was.
    } finally {
      checking = false;
    }
  }

  /** Reload after something else on the tab (a backup) changed where revisions are kept. */
  export function refresh(): void {
    void load();
  }

  onMount(() => {
    void load();
  });

  const whereLabel = (r: Revision): string =>
    r.where === "online" ? (r.notBackedUp ? "Online · not backed up yet" : "Online") : r.where === "online-only" ? "Only online" : "Only on this computer";
  const whereIcon = (r: Revision): "cloud" | "cloud-upload" | "laptop" =>
    r.where === "this-computer" ? "laptop" : r.where === "online" && r.notBackedUp ? "cloud-upload" : "cloud";
  const whereTone = (r: Revision): string =>
    r.where === "online" ? (r.notBackedUp ? "pending" : "ok") : "plain";

  /** Run one revision action (resolving `false` keeps its dialog open): `error` on failure; on success the list reloads and `onChanged` tells the page. */
  async function run(action: () => Promise<unknown>): Promise<void> {
    if (working) return;
    working = true;
    error = null;
    try {
      if ((await action()) === false) return;
      pending = null;
      await load();
      onChanged?.();
    } catch (e) {
      error = friendlyHostError(unwrapRouteError(e instanceof Error ? e.message : String(e)));
    } finally {
      working = false;
    }
  }

  function open(p: Pending, text = ""): void {
    menuFor = null;
    pending = p;
    typed = text;
    error = null;
  }

  function cancel(): void {
    if (!working) pending = null;
  }

  const switchTo = (name: string) => run(() => api.vcs.switchBranch(projectDir, name));
  const create = () => run(() => api.vcs.createRevision(projectDir, typed));
  const rename = (from: string) => run(() => api.vcs.renameRevision(projectDir, from, typed));

  /** Delete; a revision holding versions found nowhere else comes back with how many, and asks again. */
  const remove = (p: Extract<Pending, { kind: "delete" }>, everywhere: boolean, discard: boolean) =>
    run(async () => {
      try {
        const result = await api.vcs.deleteRevision(projectDir, p.revision.name, { everywhere, discard });
        if (result.deleted) return true;
        pending = { ...p, everywhere, lost: result.versionsOnlyHere };
        return false;
      } catch (e) {
        // An online-only revision is refused when it changed online after the list was checked: show it as it is now.
        if (p.revision.where === "online-only") void load();
        throw e;
      }
    });

  /** The name as it will be kept, when it differs from what was typed. */
  const kept = $derived(revisionNameFrom(typed));

  async function toggleMenu(name: string, trigger: HTMLButtonElement): Promise<void> {
    menuFor = menuFor === name ? null : name;
    if (!menuFor) return;
    await tick();
    trigger.parentElement?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
  }

  /** Escape or Tab out of a row menu closes it, and Escape hands focus back to its button. */
  function menuKeydown(e: KeyboardEvent): void {
    if (e.key !== "Escape" && e.key !== "Tab") return;
    const wrap = (e.currentTarget as HTMLElement).closest(".menu-wrap");
    menuFor = null;
    if (e.key === "Escape") {
      e.stopPropagation();
      wrap?.querySelector<HTMLButtonElement>(".more")?.focus();
    }
  }

  function closeMenuOutside(e: PointerEvent): void {
    if (menuFor && !(e.target as Element | null)?.closest?.(".menu-wrap")) menuFor = null;
  }
</script>

<svelte:window onpointerdown={closeMenuOutside} />

{#if list}
  <section class="section-card revisions" aria-labelledby="revisions-title">
    <header class="section-head">
      <div>
        <h3 id="revisions-title">Revisions</h3>
        <p class="section-sub">
          Separate lines of work in this book, like a second edition.{#if currentName}{" "}You're working on <strong>{currentName}</strong>.{/if}
        </p>
      </div>
      <button class="ghost" onclick={() => open({ kind: "new" })} disabled={working || disabled}>
        <Icon name="plus" size={14} /> New revision
      </button>
    </header>

    {#if filtering}
      <div class="section-tools">
        <input
          class="input find"
          type="search"
          bind:value={find}
          placeholder="Find a revision"
          aria-label="Find a revision"
          spellcheck="false"
          autocomplete="off"
        />
      </div>
    {/if}

    <ul class="rev-list" aria-label="Revisions">
      {#each shown as r (r.name)}
        <li class="rev" class:current={r.current}>
          <div class="rev-main">
            <span class="rev-name">{r.name}</span>
            {#if r.current}<span class="badge">Current</span>{/if}
            <span class="rev-where {whereTone(r)}"><Icon name={whereIcon(r)} size={13} /> {whereLabel(r)}</span>
          </div>
          <div class="rev-actions">
            {#if !r.current}
              <button class="ghost small" aria-label="Switch to {r.name}" onclick={() => void switchTo(r.name)} disabled={working || disabled}>Switch</button>
            {/if}
            <div class="menu-wrap">
              <button
                class="more"
                aria-label="More for {r.name}"
                aria-haspopup="menu"
                aria-expanded={menuFor === r.name}
                onclick={(e) => void toggleMenu(r.name, e.currentTarget)}
                disabled={working || disabled}
              ><Icon name="more-horizontal" size={16} /></button>
              {#if menuFor === r.name}
                <div class="menu" role="menu" aria-label="{r.name}" tabindex="-1" onkeydown={menuKeydown}>
                  <button role="menuitem" onclick={() => open({ kind: "rename", revision: r }, r.name)}>Rename…</button>
                  {#if !r.current}
                    <button role="menuitem" class="danger" onclick={() => open({ kind: "delete", revision: r, everywhere: r.where === "online-only", lost: null })}>Delete…</button>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        </li>
      {:else}
        <li class="none">No revisions match.</li>
      {/each}
    </ul>

    {#if !find.trim() && matching.length > FEW}
      <div class="section-foot">
        <button class="link" onclick={() => (showAll = !showAll)}>
          {showAll ? "Show fewer" : `Show all ${matching.length} revisions`}
        </button>
      </div>
    {/if}
    {#if hasOnlineCopy && !checking && !list.checkedOnline}
      <p class="section-note">Couldn't check the online copy just now, so revisions made elsewhere may be missing.</p>
    {/if}
    {#if error && !pending}<p class="section-note error" role="alert">{error}</p>{/if}
  </section>
{/if}

{#if pending}
  {@const p = pending}
  <div class="dlg-backdrop" role="presentation" onclick={cancel}></div>
  <form
    class="dlg-shell rev-dialog"
    use:dialogBehavior={{ onClose: cancel, labelledBy: "rev-dialog-title", initialFocus: p.kind === "delete" ? ".dlg-actions .dlg-ghost" : "input" }}
    onsubmit={(e) => {
      e.preventDefault();
      if (p.kind === "new") void create();
      else if (p.kind === "rename") void rename(p.revision.name);
    }}
  >
    {#if p.kind === "new"}
      <header class="dlg-header"><h2 id="rev-dialog-title">New revision</h2></header>
      <div class="dlg-body">
        <label class="field">
          <span class="lbl">Name</span>
          <input class="input" bind:value={typed} placeholder="Second edition" spellcheck="false" autocomplete="off" disabled={working} />
        </label>
        {#if kept && kept !== typed}<p class="hint">It will be called "{kept}".</p>{/if}
        <p class="hint">
          It starts from your book as it is now (work not in a version yet is saved as one first), and you switch to it.{hasOnlineCopy ? " It goes online the next time you back up." : ""}
        </p>
      </div>
      {#if error}<p class="dlg-error error" role="alert">{error}</p>{/if}
      <footer class="dlg-actions">
        <button type="button" class="dlg-ghost" onclick={cancel} disabled={working}>Cancel</button>
        <button type="submit" class="dlg-primary app-btn-primary" disabled={working || !kept}>{working ? "Creating…" : "Create revision"}</button>
      </footer>
    {:else if p.kind === "rename"}
      <header class="dlg-header"><h2 id="rev-dialog-title">Rename "{p.revision.name}"</h2></header>
      <div class="dlg-body">
        <label class="field">
          <span class="lbl">New name</span>
          <input class="input" bind:value={typed} spellcheck="false" autocomplete="off" disabled={working} />
        </label>
        {#if kept && kept !== typed}<p class="hint">It will be called "{kept}".</p>{/if}
        {#if p.revision.where === "online"}
          <p class="hint">This also renames it in the online copy. Anyone else working on "{p.revision.name}" keeps the old name until they switch to the new one.</p>
        {:else if p.revision.where === "online-only"}
          <p class="hint">It is renamed in the online copy. It isn't on this computer.</p>
        {/if}
      </div>
      {#if error}<p class="dlg-error error" role="alert">{error}</p>{/if}
      <footer class="dlg-actions">
        <button type="button" class="dlg-ghost" onclick={cancel} disabled={working}>Cancel</button>
        <button type="submit" class="dlg-primary app-btn-primary" disabled={working || !kept || kept === p.revision.name}>{working ? "Renaming…" : "Rename"}</button>
      </footer>
    {:else}
      <header class="dlg-header"><h2 id="rev-dialog-title">Delete "{p.revision.name}"?</h2></header>
      <div class="dlg-body">
        {#if p.lost !== null}
          <p class="warn" role="alert">
            "{p.revision.name}" holds {p.lost} {p.lost === 1 ? "version" : "versions"} that {p.lost === 1 ? "isn't" : "aren't"} in any other
            revision{p.everywhere ? "" : " or in the online copy"}. Deleting it loses {p.lost === 1 ? "that version" : "them"} for good.
          </p>
        {:else if p.revision.where === "online"}
          <p>"{p.revision.name}" is on this computer and in the online copy. Delete it from this computer only, or from the online copy too?</p>
        {:else if p.revision.where === "online-only"}
          <p>It is deleted from the online copy. It isn't on this computer.</p>
        {:else}
          <p>It is deleted from this computer. It isn't in the online copy.</p>
        {/if}
      </div>
      {#if error}<p class="dlg-error error" role="alert">{error}</p>{/if}
      <footer class="dlg-actions">
        <button type="button" class="dlg-ghost" onclick={cancel} disabled={working}>{p.lost !== null ? "Keep it" : "Cancel"}</button>
        {#if p.lost !== null}
          <button type="button" class="dlg-danger" onclick={() => void remove(p, p.everywhere, true)} disabled={working}>Delete anyway</button>
        {:else if p.revision.where === "online"}
          <button type="button" class="dlg-danger-soft" onclick={() => void remove(p, false, false)} disabled={working}>Delete on this computer only</button>
          <button type="button" class="dlg-danger" onclick={() => void remove(p, true, false)} disabled={working}>Delete everywhere</button>
        {:else}
          <button type="button" class="dlg-danger" onclick={() => void remove(p, p.everywhere, false)} disabled={working}>{working ? "Deleting…" : "Delete"}</button>
        {/if}
      </footer>
    {/if}
  </form>
{/if}

<style>
  @import "../styles/config-section-shared.css";
  @import "../styles/dialog-shell.css";

  .find { max-width: 280px; }
  .rev-list { list-style: none; margin: 0; padding: 0; }
  .rev {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 7px 12px 7px 16px; border-bottom: 1px solid var(--app-border-subtle);
  }
  .rev:last-child { border-bottom: 0; }
  .rev.current { background: var(--app-accent-subtle); }
  .rev-main { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; min-width: 0; }
  .rev-name { font-size: 13.5px; font-weight: 600; color: var(--app-text); overflow-wrap: anywhere; }
  .badge {
    padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 600;
    color: var(--app-accent-text); background: var(--app-accent);
  }
  .rev-where { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--app-text-muted); }
  .rev-where.ok :global(svg) { color: var(--app-success-strong); }
  .rev-where.pending { color: var(--app-warning-text); }
  .rev-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; min-height: 28px; }
  .none { padding: 14px 16px; font-size: 12.5px; color: var(--app-text-muted); }

  .menu-wrap { position: relative; }
  .more {
    padding: 4px 6px; border-color: transparent; background: transparent; color: var(--app-text-muted);
  }
  .more:hover:not(:disabled), .more[aria-expanded="true"] { background: var(--app-surface-hover); color: var(--app-text); }
  .menu {
    position: absolute; right: 0; top: calc(100% + 4px); z-index: var(--app-z-popover);
    display: flex; flex-direction: column; min-width: 150px; padding: 4px;
    background: var(--app-surface-raised); border: 1px solid var(--app-border); border-radius: 6px;
    box-shadow: 0 6px 18px var(--app-shadow-md);
  }
  .menu button {
    justify-content: flex-start; padding: 6px 10px; border: 0; border-radius: 4px;
    background: transparent; color: var(--app-text); font-size: 13px; text-align: left;
  }
  .menu button:hover, .menu button:focus-visible { background: var(--app-surface-hover); outline: none; }
  .menu .danger { color: var(--app-error-text); }

  .rev-dialog { width: min(460px, 92vw); }
  .dlg-body { display: flex; flex-direction: column; gap: 10px; padding: 16px 18px 4px; font-size: 13px; color: var(--app-text-secondary); }
  .dlg-body p { margin: 0; line-height: 1.45; }
  .dlg-body .field { gap: 5px; }
  .dlg-body .lbl { font-size: 12.5px; }
  .dlg-body .input { padding: 8px 10px; font-size: 13px; }
  .dlg-error { margin: 8px 18px 0; }
  .warn { color: var(--app-warning-text); }
  .dlg-danger, .dlg-danger-soft {
    padding: 7px 14px; border-radius: 5px; font: inherit; font-size: 13px; cursor: pointer; border: 1px solid var(--app-error-strong);
  }
  .dlg-danger { background: var(--app-error-strong); color: var(--app-text-on-accent); }
  .dlg-danger-soft { background: transparent; color: var(--app-error-text); }
  .dlg-danger:disabled, .dlg-danger-soft:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
