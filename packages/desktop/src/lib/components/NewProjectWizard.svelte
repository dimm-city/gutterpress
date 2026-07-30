<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { isDesktop } from "$lib/platform";
  import { api } from "$lib/api";
  import type { TemplateInfo } from "$lib/api";
  import { dialogBehavior, guardedClose } from "$lib/dialog";

  // L4: `open` used to also be an external `$bindable` prop (`bind:open`),
  // but the host never reads it — the ONLY open protocol is the imperative
  // `show()` below (reset + template-load + focus work the write-only
  // binding would silently skip if flipped directly). Purely internal state.
  let open = $state(false);

  let {
    onCreated,
    onClosed,
    triggerEl,
  }: {
    /** Called with the created project folder so the host can open it. */
    onCreated?: (projectDir: string) => void;
    /**
     * Called after the dialog closes and focus was (attempted to be) returned
     * to `triggerEl`. Hosts whose opener isn't focusable at close time — e.g.
     * the start screen, whose workspace is inert — refocus their own surface.
     */
    onClosed?: () => void;
    triggerEl?: HTMLButtonElement | undefined;
  } = $props();

  // Single screen (UX audit P3#10): name, author, template, folder and history
  // are one short form — no Continue/Back step split.
  let name = $state("");
  let author = $state("");
  let parentDir = $state<string | null>(null);
  let useVersionHistory = $state(true);

  // Template selection (#29). Built-in + custom templates, loaded on open.
  let templates = $state<TemplateInfo[]>([]);
  let selectedTemplate = $state<TemplateInfo | null>(null);
  let importing = $state(false);
  // M20: a failed listBuiltIn() call used to catch into `templates = []`,
  // which silently omits the whole "Start from a template" radiogroup — a
  // writer never learns templates exist and creates a bare default book.
  // Tracked separately from `error` (the create-flow error) so a template
  // load failure can render its own Retry without touching the create form.
  let templatesError = $state<string | null>(null);

  const BUILTIN_IDS = ["book", "zine", "technical"];

  async function loadTemplates() {
    templatesError = null;
    try {
      const builtins = await api.tpl.listBuiltIn();
      let customs: TemplateInfo[] = [];
      try {
        customs = await api.tpl.listCustom();
      } catch {
        customs = [];
      }
      templates = [...builtins, ...customs];
      // Default to the "book" built-in (or the first template available).
      selectedTemplate =
        templates.find((t) => t.id === "book") ?? templates[0] ?? null;
    } catch {
      templates = [];
      selectedTemplate = null;
      templatesError = "Templates couldn't be loaded.";
    }
  }

  async function importTemplate() {
    if (!isDesktop()) return;
    importing = true;
    error = null;
    try {
      const imported = await api.tpl.importFromFolder();
      if (imported) {
        await loadTemplates();
        selectedTemplate = templates.find((t) => t.id === imported.id) ?? imported;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      importing = false;
    }
  }

  let creating = $state(false);
  let error = $state<string | null>(null);

  // A friendly preview of the folder name we'll create (slug of the title). Kept
  // purely informational — the writer never types a slug.
  //
  // This is a deliberate inline copy of `packages/cli/src/lib/slug.ts`'s
  // `slugify` (NFKD normalize, strip diacritics, lowercase, collapse
  // non-alphanumerics to hyphens, trim edge hyphens) — CLAUDE.md §8 forbids
  // the SPA from value-importing `gutterpress` (the compiled binary
  // has no `node_modules` for a plugin/renderer to resolve against, and a
  // value import here would drag Node-target lib code into the browser
  // bundle), so this can't just call the real thing. If `slugify` ever
  // changes, mirror the change here too.
  let folderPreview = $derived.by<string>(() => {
    const slug = name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug;
  });

  let nameValid = $derived(name.trim().length > 0 && folderPreview.length > 0);
  let canCreate = $derived(nameValid && !!parentDir && !creating);

  function reset() {
    name = "";
    author = "";
    parentDir = null;
    useVersionHistory = true;
    creating = false;
    error = null;
  }

  /**
   * Parent directory of an absolute path — pure string op, no `node:path`
   * (§8 PWA-clean). Kept local to this component rather than added to
   * `$lib/platform/paths.ts` (owned by a concurrent lane); hoist it there if
   * a second caller needs it.
   */
  function parentDirOf(p: string): string | null {
    const trimmed = p.replace(/[\\/]+$/, "");
    const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
    return idx > 0 ? trimmed.slice(0, idx) : null;
  }

  /**
   * Default `parentDir` to a sensible writable location (M21) instead of
   * leaving Create dead behind a mandatory native folder picker. Priority:
   *
   *   1. the parent folder the writer last chose HERE (persisted in desktop
   *      prefs under `newProjectParentDir` — `api.app.set/getDesktopPrefs`
   *      already exist and merge shallowly, so this needs no new route);
   *   2. the folder containing the most recently opened project
   *      (`lastProjectDir`, already returned — and existence-checked — by
   *      `getDesktopPrefs`) — a writer's existing project folder is a sound
   *      proxy for "where my books live";
   *   3. nothing — "Choose folder…" stays the escape hatch either way.
   *
   * A true first-run default (an OS Documents folder via the host's
   * `defaultProjectSearchRoots()`, already used by discover-projects) needs
   * a renderer-reachable route that does not exist yet — out of scope here
   * (no new `src/routes/api/**` files in this change); (1)/(2) cover every
   * returning writer, which is the common case.
   */
  async function loadDefaultParentDir() {
    if (!isDesktop()) return;
    try {
      const prefs = await api.app.getDesktopPrefs();
      // The writer may have already used "Choose folder…" while this was in
      // flight — never clobber a choice they already made.
      if (parentDir) return;
      const saved = prefs.newProjectParentDir;
      if (typeof saved === "string" && saved) {
        parentDir = saved;
        return;
      }
      const lastProjectDir = prefs.lastProjectDir;
      if (typeof lastProjectDir === "string" && lastProjectDir) {
        parentDir = parentDirOf(lastProjectDir);
      }
    } catch {
      /* non-fatal — Create stays reachable via "Choose folder…" either way */
    }
  }

  /** Open the wizard (a user gesture from the parent) — resets + loads templates.
   *  No `$effect` on `open`, matching the other dialogs' show() pattern. */
  export function show(trigger?: HTMLButtonElement): void {
    if (trigger) triggerEl = trigger;
    reset();
    open = true;
    void loadTemplates();
    void loadDefaultParentDir();
  }

  /**
   * M19 — mid-create dismissal guard: `guardedClose` makes this a no-op
   * while `creating` is true, so the backdrop click, the header close
   * button, AND Escape (routed through `dialogBehavior`'s `onClose`) can no
   * longer dismiss the dialog out from under an in-flight create() — which
   * used to keep running and silently open (or fail to open) a project the
   * writer had visibly dismissed.
   */
  const close = guardedClose(() => {
    open = false;
    // Focus restoration to `triggerEl` is handled by the dialogBehavior action.
    onClosed?.();
  }, () => creating);

  async function chooseLocation() {
    if (!isDesktop()) {
      error = "Creating a project needs the desktop app.";
      return;
    }
    error = null;
    try {
      const pathStr = await api.dialog.openDirectory();
      if (pathStr) parentDir = pathStr;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function create() {
    if (!isDesktop()) {
      error = "Creating a project needs the desktop app.";
      return;
    }
    if (!parentDir) {
      error = "Choose where to save your book first.";
      return;
    }
    creating = true;
    error = null;
    try {
      const tpl = selectedTemplate;
      const result = await api.app.createProject({
        name: name.trim(),
        author: author.trim() || undefined,
        parentDir,
        // Built-in templates pass an id; custom templates pass the directory.
        template:
          tpl && tpl.kind === "builtin" && BUILTIN_IDS.includes(tpl.id)
            ? (tpl.id as "book" | "zine" | "technical")
            : undefined,
        templateDir: tpl && tpl.kind === "custom" ? tpl.dir : undefined,
        versionHistory: useVersionHistory ? "local-git" : "none",
      });
      // Remember this location as the default next time (M21) — best-effort,
      // never blocks the create flow.
      if (parentDir) void api.app.setDesktopPrefs({ newProjectParentDir: parentDir }).catch(() => {});
      // `close` is guarded on `creating` (M19) — clear it BEFORE calling
      // close() here, or the guard would treat this as still-in-flight and
      // no-op the close. Successful create goes through close() like every
      // other dismiss path, so the onClosed/triggerEl focus-restore contract
      // holds on success too.
      creating = false;
      close();
      onCreated?.(result.projectDir);
    } catch (e) {
      error = friendlyCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      creating = false;
    }
  }

  // Turn lib error text into writer-friendly copy (no codes / jargon).
  function friendlyCreateError(msg: string): string {
    if (/already exists/i.test(msg)) {
      return "There's already a book with that name in this folder. Try a different name or location.";
    }
    if (/can't be written|not be written|writable/i.test(msg)) {
      return "That location can't be saved to. Pick a different folder.";
    }
    return msg;
  }
</script>

{#if open}
  <div class="dlg-backdrop" onclick={close} role="presentation"></div>

  <div
    class="dlg-shell"
    use:dialogBehavior={{ onClose: close, triggerEl, labelledBy: "new-project-title", initialFocus: "#np-name" }}
  >
    <header class="dlg-header">
      <h2 id="new-project-title">Create a new book</h2>
      <button class="dlg-close" onclick={close} disabled={creating} title="Close (Esc)" aria-label="Close"><Icon name="x" size={16} /></button>
    </header>

    <div class="dialog-body">
      <p class="lead">Let's set up your book. You can change any of this later.</p>

      <label class="field" for="np-name">
        <span>What's your book called?</span>
        <input
          id="np-name"
          bind:value={name}
          type="text"
          placeholder="My First Book"
          autocomplete="off"
          spellcheck="false"
          onkeydown={(e) => { if (e.key === "Enter" && canCreate) { e.preventDefault(); void create(); } }}
        />
      </label>

      <label class="field" for="np-author">
        <span>Who's writing it? <em class="optional">(optional)</em></span>
        <input
          id="np-author"
          bind:value={author}
          type="text"
          placeholder="Your name"
          autocomplete="off"
          onkeydown={(e) => { if (e.key === "Enter" && canCreate) { e.preventDefault(); void create(); } }}
        />
      </label>

      {#if templates.length > 0}
        <div class="field">
          <span>Start from a template</span>
          <ul class="template-list" role="radiogroup" aria-label="Project template">
            {#each templates as tpl (tpl.kind + ":" + tpl.id)}
              <li>
                <button
                  type="button"
                  class="template-card"
                  class:selected={selectedTemplate?.id === tpl.id && selectedTemplate?.kind === tpl.kind}
                  role="radio"
                  aria-checked={selectedTemplate?.id === tpl.id && selectedTemplate?.kind === tpl.kind}
                  onclick={() => (selectedTemplate = tpl)}
                >
                  <span class="template-label">
                    {tpl.label}
                    {#if tpl.kind === "custom"}<em class="template-tag">custom</em>{/if}
                  </span>
                  <span class="template-desc">{tpl.description}</span>
                </button>
              </li>
            {/each}
          </ul>
          {#if isDesktop()}
            <button type="button" class="import-tpl" onclick={importTemplate} disabled={importing}>
              {importing ? "Importing…" : "Import template from folder…"}
            </button>
          {/if}
        </div>
      {:else if templatesError}
        <div class="field">
          <span>Start from a template</span>
          <div class="load-error" role="alert">
            <span>{templatesError}</span>
            <button type="button" class="retry-btn" onclick={loadTemplates}>Retry</button>
          </div>
        </div>
      {/if}

      <div class="field">
        <span>Where should we save it?</span>
        <div class="location-row">
          <!-- M21: parentDir is prefilled (last-used parent, else the
               folder containing the most recent project) whenever we have
               one, so this reads as "Change…" — the escape hatch, not the
               only way in — rather than a dead Create hiding behind a
               mandatory folder picker. -->
          <button class="dlg-ghost browse" onclick={chooseLocation} disabled={creating}>
            {parentDir ? "Change…" : "Choose folder…"}
          </button>
          {#if parentDir}
            <span class="location-path" title={parentDir}>{parentDir}{folderPreview ? `/${folderPreview}` : ""}</span>
          {:else}
            <span class="location-empty">No folder chosen yet</span>
          {/if}
        </div>
      </div>

      <label class="checkbox">
        <input type="checkbox" bind:checked={useVersionHistory} disabled={creating} />
        <span>
          Keep a history of my changes
          <em class="optional">(lets you go back to earlier versions — recommended)</em>
        </span>
      </label>

      {#if error}
        <p class="error" role="alert">{error}</p>
      {/if}

      <footer class="dlg-actions">
        <button class="dlg-ghost" onclick={close} disabled={creating}>Cancel</button>
        <button class="dlg-primary app-btn-primary" onclick={create} disabled={!canCreate}>
          {creating ? "Creating…" : "Create book"}
        </button>
      </footer>
    </div>
  </div>
{/if}

<style>
  @import "$lib/styles/dialog-shell.css";

  .dlg-shell {
    width: min(520px, 94vw);
    max-height: 80vh;
  }
  .dialog-body {
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    overflow-y: auto;
    flex: 1;
  }
  .lead { margin: 0; font-size: 13px; color: var(--app-text-muted); }
  .field { display: flex; flex-direction: column; gap: 6px; }
  .field > span { font-size: 12px; color: var(--app-text-muted); font-weight: 500; }
  .optional { font-style: italic; color: var(--app-text-muted); font-weight: 400; }
  .field input[type="text"] {
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-border);
    color: var(--app-text-secondary);
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 14px;
  }
  .field input[type="text"]:focus {
    outline: none;
    border-color: var(--app-focus-ring);
  }
  .template-list {
    list-style: none; margin: 0; padding: 0;
    display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
  }
  .template-card {
    display: flex; flex-direction: column; gap: 3px; width: 100%;
    text-align: left; padding: 8px 10px; border-radius: 6px;
    background: var(--app-surface-sunken); border: 1px solid var(--app-border);
    color: var(--app-text-secondary); cursor: pointer;
  }
  .template-card:hover { background: var(--app-surface-hover); }
  .template-card.selected { border-color: var(--app-focus-ring); background: var(--app-surface-hover); }
  .template-card:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }
  .template-label { font-size: 13px; font-weight: 600; color: var(--app-text); display: flex; align-items: center; gap: 6px; }
  .template-tag { font-size: 10px; font-style: normal; text-transform: uppercase; letter-spacing: 0.04em; color: var(--app-text-muted); border: 1px solid var(--app-border); border-radius: 3px; padding: 0 4px; }
  .template-desc { font-size: 11px; color: var(--app-text-muted); line-height: 1.35; }
  .import-tpl {
    align-self: flex-start; margin-top: 2px; background: transparent;
    border: 1px solid var(--app-border); border-radius: 5px; cursor: pointer;
    color: var(--app-text-muted); font-size: 12px; padding: 5px 10px;
  }
  .import-tpl:hover:not(:disabled) { background: var(--app-surface-hover); color: var(--app-text); }
  .import-tpl:disabled { opacity: 0.5; cursor: default; }

  .load-error {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 12px;
    background: var(--app-error-bg);
    border: 1px solid var(--app-error-border);
    color: var(--app-error-text);
  }
  .retry-btn {
    margin-left: auto;
    padding: 4px 10px;
    font-size: 12px;
    border-radius: 5px;
    background: var(--app-surface);
    border: 1px solid var(--app-border);
    color: var(--app-text);
    cursor: pointer;
    white-space: nowrap;
  }
  .retry-btn:hover { background: var(--app-surface-hover); }
  .retry-btn:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }

  .error { color: var(--app-error-text); font-size: 12px; margin: 0; }

  .location-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .browse { flex-shrink: 0; }
  .location-path {
    font-size: 12px;
    color: var(--app-text-secondary);
    font-family: var(--app-font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .location-empty { font-size: 12px; color: var(--app-text-muted); font-style: italic; }

  .checkbox {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 13px;
    color: var(--app-text-secondary);
    cursor: pointer;
  }
  .checkbox input { margin-top: 2px; flex-shrink: 0; }

  /* In-flow footer (last item inside the scrolling body) — restore its
     original spacing + button padding; the shared default assumes a pinned
     bar with slightly tighter buttons. */
  .dlg-actions {
    padding: 14px 0 0;
    margin-top: 4px;
  }
  .dlg-actions button {
    padding: 7px 16px;
  }
</style>
