<script lang="ts">
  /**
   * NormalizeDialog — consent to the one-time reformat rich editing needs.
   *
   * Rich editing writes markdown back CANONICALLY. That means the first save
   * on a project that has never been normalized reformats that one file, and
   * doing it file by file scatters formatting churn through every later diff.
   * Normalizing the whole project once, deliberately, is the alternative — but
   * it rewrites the author's book, so it is asked for rather than assumed.
   *
   * Modelled on `CrashRecoveryDialog`: the same `dialogBehavior` action, the
   * same per-item "compare versions" disclosure, and the same "Decide later"
   * exit. The comparison matters more here than there — measured on the
   * first-party corpus, 27 of 32 files change, and the dominant edit is
   * paragraphs being unwrapped onto one line. An author who hand-wraps their
   * prose needs to SEE that before agreeing, not discover it in a diff later.
   *
   * Nothing here writes. The caller applies the plan only after `onApply`.
   */
  import Icon from "$lib/components/Icon.svelte";
  import { dialogBehavior } from "$lib/dialog";
  import type { NormalizePlan } from "$lib/api";

  let {
    plan,
    applying = false,
    onApply,
    onDismiss,
  }: {
    plan: NormalizePlan | null;
    /** True while the write is in flight, so the button can't be double-fired. */
    applying?: boolean;
    onApply: () => void;
    onDismiss: () => void;
  } = $props();

  let expanded = $state<Record<string, boolean>>({});

  function toggle(path: string): void {
    expanded = { ...expanded, [path]: !expanded[path] };
  }

  /**
   * The first differing line, with a little context.
   *
   * A full diff view is more than this decision needs — the author is judging
   * a FORMATTING change, and the first difference is representative of it.
   */
  function firstDifference(before: string, after: string): { before: string; after: string } {
    const a = before.split("\n");
    const b = after.split("\n");
    const at = a.findIndex((line, i) => line !== b[i]);
    if (at === -1) return { before: "", after: "" };
    return { before: a.slice(at, at + 3).join("\n"), after: b.slice(at, at + 3).join("\n") };
  }
</script>

{#if plan}
  <div class="nz-backdrop" onclick={onDismiss} role="presentation"></div>

  <div class="nz-dialog" use:dialogBehavior={{ onClose: onDismiss, labelledBy: "nz-title" }}>
    <header class="nz-head">
      <span class="nz-icon"><Icon name="file-text" size={18} /></span>
      <h2 id="nz-title">Tidy this book's markdown?</h2>
    </header>

    <p class="nz-lede">
      Rich editing writes markdown in one consistent style. Tidying the whole
      book now means that happens once, in a single change you can review —
      instead of a little at a time, every time you save a different chapter.
      Your words are not changed, only their formatting.
    </p>

    {#if plan.changed.length === 0}
      <p class="nz-clean">
        Nothing to tidy — this book's markdown is already in that style.
      </p>
    {:else}
      <p class="nz-count">
        {plan.changed.length}
        {plan.changed.length === 1 ? "file" : "files"} would be reformatted{plan.unchanged
          .length
          ? `, ${plan.unchanged.length} already fine`
          : ""}.
      </p>

      <ul class="nz-list">
        {#each plan.changed as file (file.path)}
          {@const open = expanded[file.path] ?? false}
          {@const diff = firstDifference(file.before, file.after)}
          <li class="nz-item">
            <div class="nz-row">
              <span class="nz-path">{file.path}</span>
              <button type="button" class="nz-link" onclick={() => toggle(file.path)}>
                {open ? "Hide changes" : "Show changes"}
              </button>
            </div>
            {#if open}
              <div class="nz-compare">
                <div>
                  <span class="nz-label">Now</span>
                  <pre>{diff.before}</pre>
                </div>
                <div>
                  <span class="nz-label">After tidying</span>
                  <pre>{diff.after}</pre>
                </div>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if plan.refused.length}
      <!-- Fail-closed, and said out loud. These files use markdown the rich
           editor cannot represent, so they are left exactly as written and
           will open as markdown. -->
      <div class="nz-refused">
        <p>
          {plan.refused.length}
          {plan.refused.length === 1 ? "file is" : "files are"} left untouched and will
          open as markdown:
        </p>
        <ul>
          {#each plan.refused as r (r.path)}
            <li><span class="nz-path">{r.path}</span> — {r.reason}</li>
          {/each}
        </ul>
      </div>
    {/if}

    <footer class="nz-actions">
      <button type="button" class="ghost" onclick={onDismiss}>Decide later</button>
      <button
        type="button"
        class="primary app-btn-primary"
        disabled={applying || plan.changed.length === 0}
        onclick={onApply}
      >
        {applying ? "Tidying…" : "Tidy the markdown"}
      </button>
    </footer>
  </div>
{/if}

<style>
  @import "$lib/styles/dialog-shell.css";

  .nz-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 60;
  }
  .nz-dialog {
    position: fixed;
    inset-block-start: 50%;
    inset-inline-start: 50%;
    transform: translate(-50%, -50%);
    z-index: 61;
    width: min(680px, 92vw);
    max-height: 84vh;
    overflow: auto;
    padding: 20px;
    border-radius: 10px;
    background: var(--panel-bg, #1e1e22);
    border: 1px solid var(--border, #333);
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
  }
  .nz-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .nz-head h2 {
    margin: 0;
    font-size: 16px;
  }
  .nz-lede,
  .nz-count,
  .nz-clean {
    margin: 0 0 12px;
    font-size: 13px;
    color: var(--text-dim, #aaa);
    line-height: 1.5;
  }
  .nz-list {
    list-style: none;
    margin: 0 0 12px;
    padding: 0;
    max-height: 34vh;
    overflow: auto;
    border: 1px solid var(--border, #333);
    border-radius: 6px;
  }
  .nz-item + .nz-item {
    border-top: 1px solid var(--border, #2c2c31);
  }
  .nz-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 7px 10px;
  }
  .nz-path {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    color: var(--text, #ddd);
    overflow-wrap: anywhere;
  }
  .nz-link {
    background: none;
    border: none;
    color: var(--accent, #7aa2f7);
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .nz-compare {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    padding: 0 10px 10px;
  }
  .nz-label {
    display: block;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim, #888);
    margin-bottom: 3px;
  }
  .nz-compare pre {
    margin: 0;
    padding: 7px;
    font-size: 11px;
    line-height: 1.45;
    background: var(--code-bg, #141417);
    border-radius: 4px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 130px;
    overflow: auto;
  }
  .nz-refused {
    font-size: 12px;
    color: var(--text-dim, #aaa);
    border-left: 2px solid var(--border, #444);
    padding-left: 10px;
    margin-bottom: 12px;
  }
  .nz-refused p {
    margin: 0 0 4px;
  }
  .nz-refused ul {
    margin: 0;
    padding-left: 16px;
  }
  .nz-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  /* Two columns of code are unreadable on a phone. */
  @media (max-width: 560px) {
    .nz-compare {
      grid-template-columns: 1fr;
    }
  }
</style>
