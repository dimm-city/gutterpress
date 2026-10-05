<script lang="ts">
  import { tick } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { api } from "$lib/api";
  import type { TemplateInfo } from "$lib/api";
  import { dialogBehavior, guardedClose, FOCUSABLE } from "$lib/dialog";
  import { useSettings } from "$lib/settings.svelte";
  import {
    PUBLISH_TARGET_CHOICES,
    PRINT_TOOL_IDS,
    missingToolsForTargets,
    toolGapMessage,
  } from "$lib/publish-targets";

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

  // Three short steps (#312). UX audit P3#10 made this a single screen, but the
  // template, print target and publish targets (ADR 0008) grew it to seven
  // questions and pushed Create below the fold. The footer stays pinned, and
  // each step owns the validation for its own fields.
  const STEPS = ["Name & author", "Template", "Print & save"];
  const LAST_STEP = STEPS.length - 1;
  let step = $state(0);
  let name = $state("");
  let author = $state("");
  let parentDir = $state<string | null>(null);
  let useVersionHistory = $state(true);

  // Preset choice (ADR 0008): which vendor the book is DESIGNED for. The
  // chosen TEMPLATE seeds this (and the targets below) from the template's
  // own manifest — the template is the first decision, and everything under
  // it starts from what that template is for. The writer can still change
  // any of it before creating.
  // Kept as a local literal (labels are UI copy; the lib's PRESET_IDS is the
  // authoritative id list and scaffoldProject rejects anything unknown).
  type PresetChoice = "dtrpg" | "book" | "custom";
  const PRESET_CHOICES: Array<{ id: PresetChoice; label: string; description: string }> = [
    {
      id: "dtrpg",
      label: "DriveThruRPG print",
      description: "Print-on-demand ready for DriveThruRPG: trim, ink and PDF checks preset.",
    },
    {
      id: "book",
      label: "Trade book",
      description: "A neutral 6×9in book with no print-service rules.",
    },
    {
      id: "custom",
      label: "Custom size",
      description: "You set the page size your book is designed for.",
    },
  ];
  let selectedPreset = $state<PresetChoice | null>(null);

  // Page size for the `custom` preset. Authors think in INCHES, so that is
  // what they type; the manifest stores points (72pt = 1in) and the named
  // sizes below carry exact point values (A4/A5 are not round inch numbers).
  const PT_PER_INCH = 72;
  interface CommonSize {
    id: string;
    label: string;
    /** Exact trim in points, or null for "I'll type my own". */
    points: { width: number; height: number } | null;
  }
  const COMMON_SIZES: CommonSize[] = [
    { id: "letter", label: 'US Letter — 8.5 × 11 in', points: { width: 612, height: 792 } },
    { id: "trade", label: 'Trade paperback — 6 × 9 in', points: { width: 432, height: 648 } },
    { id: "digest", label: 'Digest — 5.5 × 8.5 in', points: { width: 396, height: 612 } },
    { id: "a4", label: "A4 — 210 × 297 mm", points: { width: 595, height: 842 } },
    { id: "a5", label: "A5 — 148 × 210 mm", points: { width: 420, height: 595 } },
    { id: "custom", label: "My own size…", points: null },
  ];
  let sizeChoice = $state<string>("letter");
  // Free-form trim in INCHES — only used when sizeChoice is "custom".
  let widthIn = $state("");
  let heightIn = $state("");

  const namedSize = $derived(COMMON_SIZES.find((s) => s.id === sizeChoice)?.points ?? null);
  const widthInNum = $derived(Number(widthIn));
  const heightInNum = $derived(Number(heightIn));
  const inchesValid = $derived(
    Number.isFinite(widthInNum) && widthInNum > 0 &&
    Number.isFinite(heightInNum) && heightInNum > 0
  );
  /** The trim in points the manifest will record, or null while incomplete. */
  const customPagePoints = $derived(
    namedSize ??
      (inchesValid
        ? {
            // Round to 3dp so 8.27in doesn't land as 595.44000000000005.
            width: Math.round(widthInNum * PT_PER_INCH * 1000) / 1000,
            height: Math.round(heightInNum * PT_PER_INCH * 1000) / 1000,
          }
        : null)
  );

  // Publish targets (ADR 0008): WHERE the book will be published — each one
  // is a destination's validation policy, recorded explicitly in the new
  // manifest (an unchecked-everything selection is written as `targets: []`,
  // a visible opt-out, never an accident of omission). Seeded from the
  // template/preset and freely uncheckable — a writer without qpdf/
  // Ghostscript can opt out of print checks knowingly instead of hitting
  // required-check errors later. Choices + copy are shared with project
  // settings ($lib/publish-targets).
  const TARGET_CHOICES = PUBLISH_TARGET_CHOICES;
  /** Mirrors the lib presets' defaultTargets (dtrpg → [dtrpg]; else []). */
  function defaultTargetsFor(preset: PresetChoice | null): string[] {
    return preset === "dtrpg" ? ["dtrpg"] : [];
  }
  // Defaults follow the template/preset until the writer touches a checkbox;
  // after that their selection is theirs (no $effect — the derived falls
  // back only while untouched).
  let targetsTouched = $state(false);
  let checkedTargets = $state<string[]>([]);
  /** The template's own `targets:`, when it declares one. */
  let templateTargets = $state<string[] | null>(null);
  let effectiveTargets = $derived(
    targetsTouched ? checkedTargets : (templateTargets ?? defaultTargetsFor(selectedPreset))
  );
  function toggleTarget(id: string): void {
    const base = effectiveTargets;
    targetsTouched = true;
    checkedTargets = base.includes(id) ? base.filter((t) => t !== id) : [...base, id];
  }

  // qpdf/Ghostscript availability on this computer (from the same /api/doctor
  // data Troubleshooting → Diagnostics shows), for the can't-build-compliant-PDFs note below.
  // Best-effort: a failed probe just shows no note.
  let missingTools = $state<string[]>([]);
  async function loadToolStatus(): Promise<void> {
    try {
      const doctor = await api.doctor();
      missingTools = (doctor.tools ?? [])
        .filter((t) => !t.found && PRINT_TOOL_IDS.includes(t.id))
        .map((t) => t.id);
    } catch {
      missingTools = [];
    }
  }
  // The explanation for tools a CHECKED destination needs but this computer
  // lacks — shared verbatim with book settings.
  let targetToolGap = $derived(
    toolGapMessage(missingToolsForTargets(effectiveTargets, missingTools))
  );

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
      selectTemplate(templates.find((t) => t.id === "book") ?? templates[0] ?? null);
    } catch {
      templates = [];
      selectTemplate(null);
      templatesError = "Templates couldn't be loaded.";
    }
  }

  /**
   * Choosing a template is the FIRST decision and seeds everything under it:
   * the design preset and the publish targets both start from what that
   * template's own manifest declares (falling back to the preset's defaults
   * when it declares no targets). Any of it can then be changed — this only
   * moves the starting point, so it runs in the click handler, never an
   * `$effect`. A writer-touched target selection is reset so the new
   * template's own choices actually show.
   */
  function selectTemplate(tpl: TemplateInfo | null): void {
    selectedTemplate = tpl;
    const preset = tpl?.preset;
    selectedPreset =
      preset === "dtrpg" || preset === "book" || preset === "custom" ? preset : null;
    templateTargets = tpl?.targets ?? null;
    targetsTouched = false;
    checkedTargets = [];
  }

  async function importTemplate() {
    importing = true;
    error = null;
    try {
      const imported = await api.tpl.importFromFolder();
      if (imported) {
        await loadTemplates();
        selectTemplate(templates.find((t) => t.id === imported.id) ?? imported);
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

  let presetValid = $derived(
    selectedPreset !== null && (selectedPreset !== "custom" || customPagePoints !== null)
  );
  let canCreate = $derived(nameValid && !!parentDir && presetValid && !creating);

  function reset() {
    step = 0;
    name = "";
    // Prefilled from the author's own name setting below (loadAuthorDefault).
    author = "";
    parentDir = null;
    useVersionHistory = true;
    selectedPreset = null;
    sizeChoice = "letter";
    widthIn = "";
    heightIn = "";
    targetsTouched = false;
    checkedTargets = [];
    templateTargets = null;
    creating = false;
    error = null;
  }

  /**
   * Prefill "Who's writing it?" from the author's own name setting — the same
   * `gitIdentity.authorName` recorded on every saved version, so the two can't
   * disagree by default. Read once at open (not a `$derived` binding), so
   * editing it here is a one-off choice for this book and never writes back to
   * the setting.
   */
  const settings = useSettings();
  function loadAuthorDefault(): void {
    const settingName = settings.current?.gitIdentity?.authorName?.trim();
    if (settingName) author = settingName;
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
    loadAuthorDefault();
    open = true;
    void loadTemplates();
    void loadDefaultParentDir();
    void loadToolStatus();
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
    error = null;
    try {
      const pathStr = await api.dialog.openDirectory();
      if (pathStr) parentDir = pathStr;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  let bodyEl: HTMLElement | undefined = $state();

  /**
   * Move to another step. The control that held focus (the title field after
   * Enter, the Back button) unmounts with its step, which would drop focus out
   * of the modal — past its Escape and Tab handling — so focus lands on the
   * new step's selected card, or else its first control.
   */
  async function goTo(target: number): Promise<void> {
    error = null;
    step = target;
    await tick();
    const selected = bodyEl?.querySelector<HTMLElement>("input[type=radio]:checked");
    (selected ?? bodyEl?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
  }

  function next(): void {
    // The title is the one field before the last step with a validity rule
    // (Create checks the rest), so it alone gates step 1 — and says why here.
    if (step === 0 && !nameValid) {
      error = name.trim()
        ? "The title needs at least one letter or number."
        : "Give your book a title to continue.";
      bodyEl?.querySelector<HTMLElement>("#np-name")?.focus();
      return;
    }
    void goTo(step + 1);
  }

  function back(): void {
    void goTo(step - 1);
  }

  /** Enter in a step-1 field means Next — Create lives on the last step. */
  function advanceOnEnter(e: KeyboardEvent): void {
    if (e.key !== "Enter") return;
    e.preventDefault();
    next();
  }

  async function create() {
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
        // ADR 0008: the preset, publish targets, and custom trim shown in the
        // dialog are what gets written — including for a saved custom
        // template, whose own manifest values seeded these fields, so leaving
        // them alone reproduces the captured design exactly.
        preset: selectedPreset ?? undefined,
        targets: [...effectiveTargets],
        customPage:
          selectedPreset === "custom" && customPagePoints ? customPagePoints : undefined,
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

    <ol class="steps" aria-label="New book steps">
      {#each STEPS as label, i (label)}
        <li class:done={step > i} class:current={step === i} aria-current={step === i ? "step" : undefined}>
          <span class="step-dot">{#if step > i}<Icon name="check" size={12} /><span class="dlg-sr-only">Completed:</span>{:else}{i + 1}{/if}</span>
          <span class="step-label">{label}</span>
        </li>
      {/each}
    </ol>

    <div class="dialog-body" bind:this={bodyEl}>
      {#if step === 0}
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
            oninput={() => (error = null)}
            onkeydown={advanceOnEnter}
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
            onkeydown={advanceOnEnter}
          />
        </label>
      {:else if step === 1}
        <!-- The template comes BEFORE the print and publish choices: it is the
             decision they start from (selectTemplate seeds the preset and the
             publish targets from the template's own manifest). -->
        {#if templates.length > 0}
          <div class="field">
            <span>Start from a template</span>
            <div class="template-list" role="radiogroup" aria-label="Book template">
              {#each templates as tpl (tpl.kind + ":" + tpl.id)}
                {@const picked = selectedTemplate?.id === tpl.id && selectedTemplate?.kind === tpl.kind}
                <label class="template-card" class:selected={picked}>
                  <input
                    type="radio"
                    class="dlg-sr-only"
                    name="np-template"
                    checked={picked}
                    onchange={() => selectTemplate(tpl)}
                  />
                  <span class="template-label">
                    {tpl.label}
                    {#if tpl.kind === "custom"}<em class="template-tag">custom</em>{/if}
                  </span>
                  <span class="template-desc">{tpl.description}</span>
                  {#if picked}<span class="template-check"><Icon name="check" size={12} /></span>{/if}
                </label>
              {/each}
            </div>
            <button type="button" class="dlg-ghost body-btn" onclick={importTemplate} disabled={importing}>
              {importing ? "Importing…" : "Import template from folder…"}
            </button>
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
      {:else}
        <div class="field">
          <span>What are you designing it for?</span>
          <div class="template-list preset-list" role="radiogroup" aria-label="Book preset">
            {#each PRESET_CHOICES as choice (choice.id)}
              {@const picked = selectedPreset === choice.id}
              <label class="template-card" class:selected={picked}>
                <input
                  type="radio"
                  class="dlg-sr-only"
                  name="np-preset"
                  checked={picked}
                  onchange={() => (selectedPreset = choice.id)}
                />
                <span class="template-label">{choice.label}</span>
                <span class="template-desc">{choice.description}</span>
                {#if picked}<span class="template-check"><Icon name="check" size={12} /></span>{/if}
              </label>
            {/each}
          </div>
          {#if selectedPreset === "custom"}
            <label class="field size-field" for="np-page-size">
              <span>Page size</span>
              <select id="np-page-size" bind:value={sizeChoice}>
                {#each COMMON_SIZES as size (size.id)}
                  <option value={size.id}>{size.label}</option>
                {/each}
              </select>
            </label>
            {#if sizeChoice === "custom"}
              <div class="custom-page" role="group" aria-label="Page size in inches">
                <label class="page-field" for="np-page-width">
                  <span>Width (in)</span>
                  <input
                    id="np-page-width"
                    bind:value={widthIn}
                    type="number"
                    min="0.1"
                    step="0.25"
                    placeholder="8.5"
                    autocomplete="off"
                  />
                </label>
                <span class="page-times" aria-hidden="true">×</span>
                <label class="page-field" for="np-page-height">
                  <span>Height (in)</span>
                  <input
                    id="np-page-height"
                    bind:value={heightIn}
                    type="number"
                    min="0.1"
                    step="0.25"
                    placeholder="11"
                    autocomplete="off"
                  />
                </label>
              </div>
            {/if}
            <p class="page-hint">
              This is the page size your finished book is checked against; keep it
              matching the <code>@page</code> size in your stylesheet.
            </p>
          {/if}
        </div>

        <div class="field">
          <span>Where will you publish it? <em class="optional">(you can change this later)</em></span>
          <ul class="target-list" aria-label="Publish targets">
            {#each TARGET_CHOICES as choice (choice.id)}
              <li>
                <label class="target-row">
                  <input
                    type="checkbox"
                    checked={effectiveTargets.includes(choice.id)}
                    onchange={() => toggleTarget(choice.id)}
                    disabled={creating}
                  />
                  <span class="target-copy">
                    <span class="target-label">{choice.label}</span>
                    <span class="target-desc">{choice.description}</span>
                  </span>
                </label>
              </li>
            {/each}
          </ul>
          {#if targetToolGap}
            <p class="tool-note" role="note">{targetToolGap}</p>
          {/if}
        </div>

        <div class="field">
          <span>Where should we save it?</span>
          <div class="location-row">
            <!-- M21: parentDir is prefilled (last-used parent, else the
                 folder containing the most recent project) whenever we have
                 one, so this reads as "Change…" — the escape hatch, not the
                 only way in — rather than a dead Create hiding behind a
                 mandatory folder picker. -->
            <button class="dlg-ghost body-btn browse" onclick={chooseLocation} disabled={creating}>
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
      {/if}
    </div>

    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}

    <footer class="dlg-actions">
      {#if step > 0}
        <button class="dlg-ghost" onclick={back} disabled={creating}>Back</button>
      {:else}
        <button class="dlg-ghost" onclick={close} disabled={creating}>Cancel</button>
      {/if}
      <div class="spacer"></div>
      {#if step < LAST_STEP}
        <button class="dlg-primary app-btn-primary" onclick={next}>Next</button>
      {:else}
        <button class="dlg-primary app-btn-primary" onclick={create} disabled={!canCreate}>
          {creating ? "Creating…" : "Create book"}
        </button>
      {/if}
    </footer>
  </div>
{/if}

<style>
  @import "$lib/styles/dialog-shell.css";

  .dlg-shell {
    width: min(520px, 94vw);
    /* The min height (about the tallest default step) keeps the footer, and so
       the Next button, from jumping as the writer steps through; the taller
       custom-size layout still grows the dialog up to max-height. */
    min-height: min(540px, 80vh);
    max-height: 80vh;
  }
  /* Step indicator — same look as PublishWizard's. */
  .steps {
    list-style: none; margin: 0; padding: 10px 18px;
    display: flex; gap: 16px;
    border-bottom: 1px solid var(--app-border-subtle);
  }
  .steps li { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--app-text-muted); white-space: nowrap; }
  .steps li.current { color: var(--app-text); font-weight: 600; }
  .step-dot { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--app-border-strong); font-size: 11px; }
  .steps li.current .step-dot { background: var(--app-accent); color: var(--app-accent-text); border-color: var(--app-accent-border); }
  .steps li.done .step-dot { background: var(--app-surface-hover); }
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
  .template-list { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  /* A card is a <label> around a visually hidden native radio, so the browser
     supplies the radio-group keyboard behaviour (arrows select, one Tab stop).
     user-select keeps a double-click from highlighting the text, as the old
     <button> cards never did. */
  .template-card {
    position: relative; display: flex; flex-direction: column; gap: 3px;
    padding: 8px 10px; border-radius: 6px;
    background: var(--app-surface-sunken); border: 1px solid var(--app-border);
    color: var(--app-text-secondary); cursor: pointer; user-select: none;
  }
  .template-card:hover { background: var(--app-surface-hover); }
  /* Selected = accent border + tinted fill (ExportDialog's format cards use the
     same pair) + a check badge, so it can't be mistaken for hover. */
  .template-card.selected { border-color: var(--app-accent-border); background: var(--app-accent-subtle); }
  .template-card:has(input:focus-visible) { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }
  .template-check {
    position: absolute; top: -6px; right: -6px; width: 16px; height: 16px; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    background: var(--app-accent); color: var(--app-accent-text);
  }
  .preset-list { grid-template-columns: 1fr 1fr 1fr; }
  .target-list {
    list-style: none; margin: 0; padding: 0;
    display: flex; flex-direction: column; gap: 6px;
  }
  .target-row {
    display: flex; align-items: flex-start; gap: 8px;
    font-size: 13px; color: var(--app-text-secondary); cursor: pointer;
  }
  .target-row input { margin-top: 2px; flex-shrink: 0; }
  .target-copy { display: flex; flex-direction: column; gap: 1px; }
  .target-label { font-size: 13px; font-weight: 600; color: var(--app-text); }
  .target-desc { font-size: 11px; color: var(--app-text-muted); line-height: 1.35; }
  .tool-note {
    margin: 4px 0 0;
    font-size: 11px;
    line-height: 1.45;
    color: var(--app-warning-text);
  }
  .custom-page {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    margin-top: 2px;
  }
  .page-field { display: flex; flex-direction: column; gap: 4px; }
  .page-field > span { font-size: 11px; color: var(--app-text-muted); }
  .page-field input {
    width: 90px;
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-border);
    color: var(--app-text-secondary);
    padding: 6px 8px;
    border-radius: 6px;
    font-size: 13px;
  }
  .page-field input:focus { outline: none; border-color: var(--app-focus-ring); }
  .size-field { gap: 4px; margin-top: 2px; }
  .size-field select {
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-border);
    color: var(--app-text-secondary);
    padding: 7px 8px;
    border-radius: 6px;
    font-size: 13px;
  }
  .size-field select:focus { outline: none; border-color: var(--app-focus-ring); }
  .page-times { color: var(--app-text-muted); font-size: 13px; padding-bottom: 8px; }
  .page-hint {
    margin: 4px 0 0;
    font-size: 11px;
    line-height: 1.4;
    color: var(--app-text-muted);
  }
  .page-hint code { font-family: var(--app-font-mono); font-size: 10px; }
  .template-label { font-size: 13px; font-weight: 600; color: var(--app-text); display: flex; align-items: center; gap: 6px; }
  .template-tag { font-size: 10px; font-style: normal; text-transform: uppercase; letter-spacing: 0.04em; color: var(--app-text-muted); border: 1px solid var(--app-border); border-radius: 3px; padding: 0 4px; }
  .template-desc { font-size: 11px; color: var(--app-text-muted); line-height: 1.35; }
  /* In-body ghost buttons (Import…, Change…) sit outside .dlg-actions, so they
     restate its border geometry; colours, hover and focus ring come from
     .dlg-ghost. */
  .body-btn {
    padding: 5px 10px; font-size: 12px; border-width: 1px; border-style: solid;
    border-radius: 5px; cursor: pointer;
  }
  .body-btn:disabled { opacity: 0.5; cursor: default; }
  .field > .body-btn { align-self: flex-start; margin-top: 2px; }

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

  /* Sits between the scrolling body and the pinned footer so it is always in view. */
  .error { color: var(--app-error-text); font-size: 12px; margin: 0; padding: 0 18px 12px; }

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

  /* Back/Cancel on the left, Next/Create on the right of the shared pinned bar. */
  .dlg-actions .spacer { flex: 1; }
</style>
