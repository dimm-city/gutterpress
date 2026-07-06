<script lang="ts">
  /**
   * WelcomeLanding — the start screen.
   *
   * A full-window layer shown at launch (and whenever nothing is open). The
   * previous book keeps PRE-RENDERING in the workspace underneath — visible
   * through the frosted scrim — so "Open your book" lands on an already-
   * rendered (or visibly rendering) preview. The continue card mirrors that
   * live progress.
   *
   * Layer rules (hard constraints, see LoadingOverlay/PreviewFrame):
   * - The scrim is TRANSLUCENT, never opaque — the preview iframe underneath
   *   is cross-origin and Chromium throttles it to ~1fps when it has no
   *   visible pixels (the 0.4.1 slow-render regression).
   * - z-index sits above the toolbar (100) and the app loading overlay (50),
   *   below dialogs (1000+) and toasts. Native <dialog>s render in the top
   *   layer regardless, so the New book / GitHub dialogs open above this.
   *
   * The host page owns all state; this component is presentational + focus
   * management. Recents/favorites/discovered reuse ProjectsListBody — the
   * exact list the left panel's Projects tab shows, so there is ONE browsing
   * surface to maintain.
   */
  import { fade } from "svelte/transition";
  import { tick } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import ProjectsListBody from "$lib/components/ProjectsListBody.svelte";
  import type { ContinueStatusKind } from "$lib/routes/startup-landing";

  let {
    visible = false,
    /** Title for the continue card; null = no previous book (first run). */
    continueTitle = null,
    /** Secondary line under the title (repo · N books, or the folder path). */
    continueDetail = null,
    statusKind = "opening",
    statusLabel = "",
    /** Sibling books in the same project (multi-book repos). */
    otherBooks = [],
    /** Disable book chips while an open is in flight. */
    booksDisabled = false,
    /** Error card (replaces the continue card / hero when set). */
    errorTitle = null,
    errorBody = null,
    canAdopt = false,
    adopting = false,
    version = null,
    showAtStartup = true,
    showGitHub = false,
    onContinue,
    onOpenPath,
    onSwitchBook,
    onOpenUrl,
    onBrowse,
    onNewProject,
    onOpenGitHub,
    onOpenGuide,
    onOpenSettings,
    onOpenHelp,
    onWhatsNew,
    onAdopt,
    onToggleShowAtStartup,
  }: {
    visible?: boolean;
    continueTitle?: string | null;
    continueDetail?: string | null;
    statusKind?: ContinueStatusKind;
    statusLabel?: string;
    otherBooks?: Array<{ path: string; title: string }>;
    booksDisabled?: boolean;
    errorTitle?: string | null;
    errorBody?: string | null;
    canAdopt?: boolean;
    adopting?: boolean;
    version?: string | null;
    showAtStartup?: boolean;
    showGitHub?: boolean;
    onContinue?: () => void;
    onOpenPath?: (path: string) => void;
    onSwitchBook?: (path: string) => void;
    onOpenUrl?: (url: string) => void;
    onBrowse?: () => void;
    onNewProject?: () => void;
    onOpenGitHub?: () => void;
    onOpenGuide?: () => void;
    onOpenSettings?: () => void;
    onOpenHelp?: () => void;
    onWhatsNew?: () => void;
    onAdopt?: () => void;
    onToggleShowAtStartup?: (show: boolean) => void;
  } = $props();

  let rootEl = $state<HTMLElement | undefined>(undefined);
  let continueBtn = $state<HTMLButtonElement | undefined>(undefined);

  /** Reclaim focus for the layer (e.g. after a dialog opened from it closes). */
  export function focusLayer() {
    (continueBtn ?? rootEl)?.focus();
  }

  // Move focus into the layer whenever it appears (the {#if visible} block
  // recreates the section each show), landing on the primary action so Enter
  // "just works". The workspace behind is inert (host page). A use: action —
  // not $effect (banned) — since this is pure DOM setup on element mount.
  function focusOnShow(node: HTMLElement) {
    void tick().then(() => (continueBtn ?? node).focus());
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    // Esc inside a field means "cancel my typing", not "leave the start
    // screen" — never hijack it from form controls (e.g. the books search).
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName ?? "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
    // Esc = "get out of my way": same as Continue, but only when there is a
    // book behind the layer to land on.
    if (continueTitle && !errorTitle) {
      e.preventDefault();
      onContinue?.();
    }
  }
</script>

{#if visible}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- The layer is the focus root while shown (tabindex=-1 + programmatic
       focus); keydown only adds an Esc convenience, no semantics change. -->
  <section
    class="landing"
    bind:this={rootEl}
    use:focusOnShow
    tabindex="-1"
    aria-label="Start screen"
    onkeydown={onKeydown}
    transition:fade={{ duration: 180 }}
  >
    <div class="landing-col">
      <header class="brand-row">
        <div class="brand-left">
          <span class="brand-icon" aria-hidden="true">📖</span>
          <span class="brand-name">print-md</span>
          {#if version}<span class="brand-version">v{version}</span>{/if}
        </div>
        <div class="brand-right">
          {#if onWhatsNew}
            <button type="button" class="landing-link" onclick={onWhatsNew}>
              What's new <Icon name="external-link" size={12} />
            </button>
          {/if}
          {#if onOpenHelp}
            <button type="button" class="brand-icon-btn" onclick={onOpenHelp} title="Help & about" aria-label="Help and about">
              <Icon name="circle-help" size={16} />
            </button>
          {/if}
          {#if onOpenSettings}
            <button type="button" class="brand-icon-btn" onclick={onOpenSettings} title="Settings (Ctrl+,)" aria-label="Settings">
              <Icon name="settings" size={16} />
            </button>
          {/if}
        </div>
      </header>

      {#if errorTitle}
        <section class="error-card" role="alert" aria-label="Problem opening your book">
          <div class="error-head">
            <Icon name="triangle-alert" size={18} />
            <h1 class="landing-h1">{errorTitle}</h1>
          </div>
          {#if errorBody}<p class="error-body">{errorBody}</p>{/if}
          {#if canAdopt && onAdopt}
            <p class="error-hint">
              It's a regular folder — want to turn it into a print-md book? We'll use any
              Markdown already inside it.
            </p>
            <button type="button" class="btn-primary" onclick={onAdopt} disabled={adopting}>
              {adopting ? "Setting up…" : "Set up this folder as a book"}
            </button>
          {:else}
            <p class="error-hint">Pick a book below, or open it from its new location.</p>
          {/if}
        </section>
      {:else if continueTitle}
        <section class="continue-sec" aria-label="Continue where you left off">
          <h1 class="landing-h1">Welcome back</h1>
          <div class="continue-card">
            <span class="cc-icon" aria-hidden="true">📖</span>
            <div class="cc-info">
              <span class="cc-title" title={continueTitle}>{continueTitle}</span>
              {#if continueDetail}
                <span class="cc-detail" title={continueDetail}>{continueDetail}</span>
              {/if}
              <span class="cc-status" role="status" aria-live="polite" data-kind={statusKind}>
                {#if statusKind === "ready"}
                  <span class="cc-ready-icon"><Icon name="circle-check" size={14} /></span>
                {:else}
                  <span class="cc-spinner" aria-hidden="true"></span>
                {/if}
                {statusLabel}
              </span>
            </div>
            <button type="button" class="btn-primary cc-open" bind:this={continueBtn} onclick={onContinue}>
              Open your book
            </button>
          </div>
          {#if otherBooks.length > 0}
            <div class="cc-books">
              <span class="cc-books-label">Other books in this project:</span>
              {#each otherBooks as book (book.path)}
                <button
                  type="button"
                  class="book-chip"
                  disabled={booksDisabled}
                  onclick={() => onSwitchBook?.(book.path)}
                  title={book.path}
                >{book.title}</button>
              {/each}
            </div>
          {/if}
        </section>
      {:else}
        <section class="hero">
          <h1 class="landing-h1 hero-title">Welcome to print-md</h1>
          <p class="hero-tagline">Turn your markdown writing into a print-ready book.</p>
        </section>
      {/if}

      <section class="quick-actions" aria-label="Quick actions">
        <button type="button" class="action-card" class:featured={!continueTitle && !errorTitle} onclick={onNewProject}>
          <span class="ac-icon"><Icon name="plus" size={18} /></span>
          <span class="ac-title">Create a new book</span>
          <span class="ac-sub">Start from a ready-made template</span>
        </button>
        <button type="button" class="action-card" onclick={onBrowse}>
          <span class="ac-icon"><Icon name="folder-open" size={18} /></span>
          <span class="ac-title">Open a folder</span>
          <span class="ac-sub">A book saved on this computer</span>
        </button>
        {#if showGitHub && onOpenGitHub}
          <button type="button" class="action-card" onclick={onOpenGitHub}>
            <span class="ac-icon"><Icon name="github" size={18} /></span>
            <span class="ac-title">Open from GitHub</span>
            <span class="ac-sub">Get a book from your online copy</span>
          </button>
        {/if}
      </section>

      <section class="your-books" aria-label="Your books">
        <h2 class="landing-h2">Your books</h2>
        <div class="books-panel">
          <ProjectsListBody
            compact
            placeholder="Search your books, or paste a folder path…"
            onChosen={onOpenPath}
            onOpenUrl={onOpenUrl}
            onBrowse={onBrowse}
          />
        </div>
      </section>

      <footer class="landing-foot">
        <button type="button" class="landing-link" onclick={onOpenGuide}>
          New to print-md? Read the getting-started guide →
        </button>
        <label class="startup-toggle">
          <input
            type="checkbox"
            checked={showAtStartup}
            onchange={(e) => onToggleShowAtStartup?.(e.currentTarget.checked)}
          />
          Show this screen when print-md starts
        </label>
      </footer>
    </div>
  </section>
{/if}

<style>
  .landing {
    position: fixed;
    inset: 0;
    z-index: 900; /* above toolbar (100) + app overlay (50); below dialogs (1000+) */
    /* TRANSLUCENT frosted scrim — never fully opaque over the preview area
       (cross-origin iframe throttling; see PreviewFrame.svelte). Near-opaque
       only across the top band so the workspace toolbar doesn't bleed through
       crisply; the book ghosts through the glass below it. */
    background: linear-gradient(
      to bottom,
      color-mix(in srgb, var(--app-bg) 97%, transparent) 0,
      color-mix(in srgb, var(--app-bg) 88%, transparent) 140px,
      color-mix(in srgb, var(--app-bg) 88%, transparent) 100%
    );
    backdrop-filter: blur(12px) saturate(1.05);
    overflow-y: auto;
    display: flex;
    justify-content: center;
    outline: none;
    /* Self-contained font stack: the layer sits outside the workspace shell,
       so it must not inherit the browser's default serif. */
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    color: var(--app-text);
  }

  .landing-col {
    width: min(660px, calc(100vw - 32px));
    display: flex;
    flex-direction: column;
    gap: 22px;
    /* Top-biased, not dead-centered — the standard start-page rhythm. */
    padding: clamp(28px, 10vh, 110px) 0 32px;
  }

  /* ── Brand row ─────────────────────────────────────────────────────── */
  .brand-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .brand-left { display: flex; align-items: baseline; gap: 8px; }
  .brand-right { display: flex; align-items: center; gap: 10px; }
  .brand-icon-btn {
    background: none;
    border: 0;
    padding: 4px;
    border-radius: 6px;
    color: var(--app-text-secondary);
    cursor: pointer;
    display: inline-flex;
  }
  .brand-icon-btn:hover { color: var(--app-text); background: var(--app-control-hover-bg); }
  .brand-icon-btn:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }
  .brand-icon { font-size: 18px; }
  .brand-name { font-size: 15px; font-weight: 700; color: var(--app-text); letter-spacing: -0.2px; }
  .brand-version { font-size: 11px; color: var(--app-text-faint); }

  .landing-link {
    background: none;
    border: 0;
    padding: 0;
    color: var(--app-link, var(--app-accent));
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .landing-link:hover { color: var(--app-link-hover, var(--app-accent-bright)); text-decoration: underline; }

  .landing-h1 { margin: 0; font-size: 20px; font-weight: 700; color: var(--app-text); letter-spacing: -0.3px; }
  .landing-h2 { margin: 0 0 8px; font-size: 12px; font-weight: 600; color: var(--app-text-secondary); text-transform: uppercase; letter-spacing: 0.6px; }

  /* ── Continue card ─────────────────────────────────────────────────── */
  .continue-sec { display: flex; flex-direction: column; gap: 10px; }
  .continue-card {
    display: flex;
    align-items: center;
    gap: 14px;
    background: var(--app-surface-raised, var(--app-surface));
    border: 1px solid var(--app-border);
    border-radius: 12px;
    padding: 16px 18px;
    box-shadow: var(--app-shadow-md);
  }
  .cc-icon { font-size: 30px; line-height: 1; flex-shrink: 0; }
  .cc-info { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .cc-title {
    font-size: 16px;
    font-weight: 700;
    color: var(--app-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cc-detail {
    font-size: 12px;
    color: var(--app-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cc-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--app-text-secondary);
    margin-top: 2px;
  }
  .cc-status[data-kind="ready"] { color: var(--app-success-text, var(--app-text-secondary)); }
  .cc-ready-icon { display: inline-flex; color: var(--app-success-strong, currentColor); }
  .cc-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--app-spinner-track);
    border-top-color: var(--app-spinner-head);
    border-radius: 50%;
    animation: landing-spin 0.75s linear infinite;
    flex-shrink: 0;
  }
  @keyframes landing-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .cc-spinner { animation-duration: 1.6s; }
  }

  .btn-primary {
    background: var(--app-accent);
    color: var(--app-accent-text);
    border: 1px solid var(--app-accent-border);
    border-radius: 8px;
    padding: 10px 20px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
  }
  .btn-primary:hover:not(:disabled) { background: var(--app-accent-hover); }
  .btn-primary:disabled { opacity: 0.6; cursor: default; }
  .btn-primary:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }

  .cc-books { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .cc-books-label { font-size: 12px; color: var(--app-text-muted); margin-right: 2px; }
  .book-chip {
    background: var(--app-control-bg);
    border: 1px solid var(--app-control-border);
    color: var(--app-control-text, var(--app-text));
    border-radius: 999px;
    padding: 4px 12px;
    font-size: 12px;
    cursor: pointer;
    max-width: 220px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .book-chip:hover:not(:disabled) {
    background: var(--app-control-hover-bg);
    border-color: var(--app-control-hover-border);
  }
  .book-chip:disabled { opacity: 0.55; cursor: default; }

  /* ── First-run hero ────────────────────────────────────────────────── */
  .hero { text-align: center; padding: 18px 0 4px; }
  .hero-title { font-size: 28px; }
  .hero-tagline { margin: 8px 0 0; font-size: 14px; color: var(--app-text-muted); }

  /* ── Error card ────────────────────────────────────────────────────── */
  .error-card {
    background: var(--app-error-bg);
    border: 1px solid var(--app-error-border);
    border-radius: 12px;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .error-head { display: flex; align-items: center; gap: 10px; color: var(--app-error-strong, var(--app-error-text)); }
  .error-head .landing-h1 { font-size: 16px; color: var(--app-error-text); }
  .error-body { margin: 0; font-size: 13px; color: var(--app-error-text); line-height: 1.5; }
  .error-hint { margin: 0; font-size: 12px; color: var(--app-text-secondary); line-height: 1.5; }
  .error-card .btn-primary { align-self: flex-start; }

  /* ── Quick actions ─────────────────────────────────────────────────── */
  .quick-actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 10px;
  }
  .action-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    background: var(--app-surface);
    border: 1px solid var(--app-border);
    border-radius: 10px;
    padding: 14px 16px;
    cursor: pointer;
    text-align: left;
    color: var(--app-text);
  }
  .action-card:hover { background: var(--app-surface-hover); border-color: var(--app-border-strong); }
  .action-card:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  .action-card.featured { border-color: var(--app-accent-border); }
  .ac-icon { color: var(--app-accent); display: inline-flex; margin-bottom: 2px; }
  .ac-title { font-size: 13px; font-weight: 600; }
  .ac-sub { font-size: 11px; color: var(--app-text-muted); line-height: 1.4; }

  /* ── Your books (ProjectsListBody host) ────────────────────────────── */
  .your-books { display: flex; flex-direction: column; min-height: 0; }
  .books-panel {
    background: var(--app-surface);
    border: 1px solid var(--app-border);
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    /* The list scrolls inside the panel; the landing column scrolls as a whole
       only on very short windows. */
    max-height: min(42vh, 380px);
  }

  /* ── Footer ────────────────────────────────────────────────────────── */
  .landing-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    flex-wrap: wrap;
  }
  .startup-toggle {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    color: var(--app-text-secondary);
    cursor: pointer;
    user-select: none;
  }
  .startup-toggle input { accent-color: var(--app-accent); cursor: pointer; }

  @media (max-width: 560px) {
    .landing-col { padding-top: 18px; gap: 16px; }
    .continue-card { flex-wrap: wrap; }
    .cc-open { width: 100%; }
  }
</style>
