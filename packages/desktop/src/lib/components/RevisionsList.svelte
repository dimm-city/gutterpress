<script lang="ts">
  /**
   * RevisionsList — Book setup → Online copy's Revisions (#448): separate
   * lines of work in the same book ("Second edition", "Editor's pass") that
   * the author can start, switch, rename and delete, each saying where it is
   * kept.
   *
   *   Online                       — on this computer and in the online copy
   *   Online · not backed up yet   — this computer has versions the online copy hasn't
   *   Only on this computer        — never backed up
   *   Only online                  — in the online copy, not on this computer yet (Switch only)
   *
   * Rename and Delete are inline and say what they do before they do it: an
   * online revision is renamed or deleted in the online copy too, now, and
   * deleting one that holds versions found nowhere else asks a second time,
   * naming how many would be lost. The open revision is never deleted. The
   * list refreshes from the online copy when it can ("Couldn't check…" when
   * it can't). Vocabulary: docs/ux-design-contract.md.
   *
   * PWA-clean (§8): api.* routes only.
   */
  import { onMount } from "svelte";
  import { api, type Revision, type RevisionList } from "#lib/api.ts";
  import { friendlyHostError, unwrapRouteError } from "#lib/errors.ts";
  import { revisionNameFrom } from "#lib/revision-name.ts";

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

  /** The one open inline form: a new revision, a rename, or a delete (two steps for an online one, a second when versions would be lost). */
  type Pending =
    | { kind: "new" }
    | { kind: "rename"; revision: Revision }
    | { kind: "delete"; revision: Revision; everywhere: boolean; lost: number | null };
  let pending = $state<Pending | null>(null);
  let typed = $state("");

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

  /** Run one revision action (resolving `false` keeps its form open): `error` on failure; on success the list reloads and `onChanged` tells the page. */
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

  const open = (p: Pending, text = "") => {
    pending = p;
    typed = text;
    error = null;
  };

  const switchTo = (name: string) => run(() => api.vcs.switchBranch(projectDir, name));
  const create = () => run(() => api.vcs.createRevision(projectDir, typed));
  const rename = (from: string) => run(() => api.vcs.renameRevision(projectDir, from, typed));

  /** Delete; a revision holding versions found nowhere else comes back with how many, and asks again. */
  const remove = (p: Extract<Pending, { kind: "delete" }>, discard: boolean) =>
    run(async () => {
      const result = await api.vcs.deleteRevision(projectDir, p.revision.name, { everywhere: p.everywhere, discard });
      if (result.deleted) return true;
      pending = { ...p, lost: result.versionsOnlyHere };
      return false;
    });

  /** The name as it will be kept, when it differs from what was typed. */
  const kept = $derived(revisionNameFrom(typed));
</script>

{#snippet nameField(label: string, action: string, submit: () => void, note = "")}
  <form class="name-form" onsubmit={(e) => { e.preventDefault(); submit(); }}>
    <label class="field">
      <span class="lbl">{label}</span>
      <!-- Escape cancels the form; it does not close Book setup under it. -->
      <input
        class="input"
        bind:value={typed}
        spellcheck="false"
        autocomplete="off"
        disabled={working}
        onkeydown={(e) => { if (e.key === "Escape") { e.stopPropagation(); pending = null; } }}
      />
    </label>
    {#if kept && kept !== typed}<p class="hint">It will be called "{kept}".</p>{/if}
    {#if note}<p class="hint">{note}</p>{/if}
    <div class="row">
      <button type="submit" class="app-btn-primary" disabled={working || !kept}>{working ? "Working…" : action}</button>
      <button type="button" class="ghost" onclick={() => (pending = null)} disabled={working}>Cancel</button>
    </div>
  </form>
{/snippet}

{#if list}
  <div class="revisions">
    <h3>Revisions</h3>
    <ul class="item-list" aria-label="Revisions">
      {#each list.revisions as r (r.name)}
        <li>
          <div class="item-row">
            <span class="item-label">{r.name}</span>
            {#if r.current}<span class="mine">You're working on this</span>{/if}
            <span class="item-caption">{whereLabel(r)}</span>
            <span class="item-actions">
              {#if !r.current}
                <button class="ghost small" aria-label="Switch to {r.name}" onclick={() => void switchTo(r.name)} disabled={working || disabled}>Switch</button>
              {/if}
              {#if r.where !== "online-only"}
                <button class="ghost small" aria-label="Rename {r.name}" onclick={() => open({ kind: "rename", revision: r }, r.name)} disabled={working || disabled}>Rename…</button>
                {#if !r.current}
                  <button class="ghost small" aria-label="Delete {r.name}" onclick={() => open({ kind: "delete", revision: r, everywhere: false, lost: null })} disabled={working || disabled}>Delete…</button>
                {/if}
              {/if}
            </span>
          </div>
          {#if pending?.kind === "rename" && pending.revision.name === r.name}
            <div class="inline-form">
              {@render nameField(
                "New name",
                "Rename",
                () => void rename(r.name),
                r.where === "online"
                  ? `This also renames it in the online copy. Anyone else working on "${r.name}" keeps the old name until they switch to "${kept || "…"}".`
                  : "",
              )}
            </div>
          {:else if pending?.kind === "delete" && pending.revision.name === r.name}
            {@const p = pending}
            <div class="inline-form">
              {#if p.lost !== null}
                <p class="warn" role="alert">
                  "{r.name}" holds {p.lost} {p.lost === 1 ? "version" : "versions"} that {p.lost === 1 ? "isn't" : "aren't"} in any other
                  revision or in the online copy. Deleting it loses {p.lost === 1 ? "that version" : "them"} for good.
                </p>
                <div class="row">
                  <button class="ghost danger" onclick={() => void remove(p, true)} disabled={working}>Delete anyway</button>
                  <button class="ghost" onclick={() => (pending = null)} disabled={working}>Keep it</button>
                </div>
              {:else if r.where === "online"}
                <p class="hint">"{r.name}" is on this computer and in the online copy. Delete it from this computer only, or from the online copy too?</p>
                <div class="row">
                  <button class="ghost danger" onclick={() => void remove({ ...p, everywhere: false }, false)} disabled={working}>Delete on this computer only</button>
                  <button class="ghost danger" onclick={() => void remove({ ...p, everywhere: true }, false)} disabled={working}>Delete everywhere</button>
                  <button class="ghost" onclick={() => (pending = null)} disabled={working}>Cancel</button>
                </div>
              {:else}
                <p class="hint">Delete "{r.name}" from this computer? It isn't in the online copy.</p>
                <div class="row">
                  <button class="ghost danger" onclick={() => void remove(p, false)} disabled={working}>Delete</button>
                  <button class="ghost" onclick={() => (pending = null)} disabled={working}>Cancel</button>
                </div>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
    {#if hasOnlineCopy && !checking && !list.checkedOnline}
      <p class="hint">Couldn't check the online copy for other revisions. This list shows the revisions on this computer.</p>
    {/if}
    {#if pending?.kind === "new"}
      <div class="inline-form">
        {@render nameField(
          "Name of the new revision",
          "Create revision",
          () => void create(),
          `It starts from your book as it is now (any unsaved work is saved as a version first) and opens it.${hasOnlineCopy ? " It goes online the next time you back up." : ""}`,
        )}
      </div>
    {:else}
      <button class="ghost self-start" onclick={() => open({ kind: "new" })} disabled={working || disabled}>New revision…</button>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </div>
{/if}

<style>
  @import "../styles/config-section-shared.css";

  .revisions { display: flex; flex-direction: column; gap: 8px; align-self: stretch; }
  h3 { margin: 6px 0 0; font-size: 13px; font-weight: 600; color: var(--app-text); }
  .mine { flex-shrink: 0; font-size: 11px; font-weight: 600; color: var(--app-success-text); }
  .item-caption { white-space: normal; }
  .revisions .item-actions { gap: 4px; }
  .item-row { flex-wrap: wrap; }
  .inline-form, .name-form { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .inline-form { padding: 4px 0 2px; }
  .name-form .field { align-self: stretch; max-width: 420px; }
  .inline-form .row { flex-wrap: wrap; }
  .warn { margin: 0; font-size: 12px; color: var(--app-warning-text); }
  .revisions .danger { color: var(--app-error-text); border-color: var(--app-error-text); }
  .self-start { align-self: flex-start; }
</style>
