<script lang="ts">
  /**
   * EditorToolbar (#31) — a compact formatting bar attached above the editor pane.
   *
   * Visible ONLY when the editor pane is open and a markdown file is active.
   * The toolbar is a sibling of MarkdownEditor in the editor-pane section; it is
   * NOT part of the main app toolbar, which must not grow.
   *
   * Architecture:
   * - All actions operate through `onAction(action, payload?)` — a callback prop
   *   that the parent (+page.svelte) routes into the EditorView transaction. The
   *   toolbar has zero direct knowledge of CodeMirror; it just fires named events.
   * - The Insert Image flow involves host calls (dialog.pickImageFile +
   *   api.media.importImage — the ONE host-side import-policy route), so the
   *   toolbar accepts `projectDir` to keep it testable
   *   without a full Electron environment. The toolbar does no path/fs math
   *   of its own; the route returns the project-relative `src` to insert.
   * - The shape is stable: every insert action lives in ONE Insert menu, so
   *   opening the left panel (which narrows this pane) does not swap buttons in
   *   and out. Only when the pane is too narrow for a group does @container move
   *   it into the "More" popover, and that popover lists exactly the groups
   *   that are hidden (see the tier comment in the style block) — never a repeat
   *   of what shows.
   */
  import Icon from "$lib/components/Icon.svelte";
  import type { ProblemEntry } from "$lib/platform/dtos";
  import { canExpandProblems, problemCounts, problemsSummary } from "$lib/problems";
  import type { ComponentProps } from "svelte";
  import { basenameOf } from "$lib/platform/paths";
  import { api } from "$lib/api";
  import { dialogBehavior, FOCUSABLE } from "$lib/dialog";
  import {
    IMAGE_POSITION_OPTIONS,
    IMAGE_SIZE_OPTIONS,
    type ImagePositionClass,
    type ImageSizeClass,
  } from "$lib/editor/image-classes";
  import {
    visibleToolbarItems,
    LAYOUT_BLOCK_ITEMS,
    type ToolbarItemDef,
    type LayoutBlockKind,
  } from "$lib/editor/toolbar-actions";

  // toolbar-actions.ts declares item icons as plain strings (it stays
  // Svelte-import-free by design). Narrow to Icon's actual prop type here,
  // at the render boundary, the same way LeftPanel.svelte derives IconName.
  type IconName = ComponentProps<typeof Icon>["name"];

  let {
    /** Current file path — toolbar is only active for .md files. */
    filePath = null,
    /** Called by the parent to route an edit action into the CodeMirror view. */
    onAction,
    onSave,
    /** Unsaved changes exist: Save is emphasized (primary); otherwise a calm "Saved". */
    savePending = false,
    /** A save is in flight. */
    saving = false,
    /** Absolute path to the open project, used to compute assets/ destination. */
    projectDir = null,
    problems = [],
    problemsLoading = false,
    problemsError = null,
    problemsOpen = false,
    onToggleProblems,
  }: {
    filePath?: string | null;
    onAction: (action: ToolbarAction, payload?: ToolbarPayload) => void;
    onSave?: () => void;
    savePending?: boolean;
    saving?: boolean;
    projectDir?: string | null;
    // ── Status cluster (right end): the Problems badge. It is about the text
    //    being edited, so it lives here; its list/view is the page's. (The save
    //    state is on the status bar.) ──
    problems?: ProblemEntry[];
    problemsLoading?: boolean;
    problemsError?: string | null;
    problemsOpen?: boolean;
    /** Toggles the Problems list (rendered by the page at the bottom of the
     *  editor pane); the badge renders only when set. */
    onToggleProblems?: (trigger: HTMLButtonElement) => void;
  } = $props();

  let counts = $derived(problemCounts(problems));
  let canExpand = $derived(canExpandProblems(problems, problemsError, problemsOpen));
  let stripLabel = $derived(
    problemsLoading
      ? "Problems: checking"
      : problemsError
        ? "Problems: couldn't check"
        : counts.badge > 0
          ? `Problems: ${problemsSummary(counts)}`
          : "No problems",
  );
  let problemsToggleEl = $state<HTMLButtonElement | null>(null);

  /** The set of named edit actions the toolbar can fire. */
  export type ToolbarAction =
    | "bold"
    | "italic"
    | "strikethrough"
    | "code"
    | "link"
    | "blockquote"
    | "ul"
    | "ol"
    | "heading"
    | "hr"
    | "table"
    | "image"
    | "snippet"
    | "layout-block";

  export type ToolbarPayload =
    | { level: 1 | 2 | 3 | 4 }           // heading
    | { cols: number }                    // table
    | { src: string; alt: string; width?: string; position?: string; size?: string; shape?: boolean } // image
    | { kind: LayoutBlockKind };          // layout-block

  // The toolbar is only meaningful for markdown files.
  let isMarkdown = $derived(
    filePath !== null && /\.(md|markdown)$/i.test(filePath),
  );

  // ── A single declarative item array drives the grouped toolbar buttons,
  // the Insert menu AND the More menu — see toolbar-actions.ts for rationale. ──
  let visibleItems = $derived(
    visibleToolbarItems({ hasSave: !!onSave }),
  );
  let saveItems = $derived(visibleItems.filter((i) => i.group === "save"));
  let primaryItems = $derived(visibleItems.filter((i) => i.group === "primary"));
  let blockItems = $derived(visibleItems.filter((i) => i.group === "block"));
  let insertItems = $derived(visibleItems.filter((i) => i.group === "insert"));

  function fireAction(item: ToolbarItemDef) {
    if (item.action) onAction(item.action as ToolbarAction);
  }

  // ── Focus-first-child helper for the heading/insert/More popups below ──────
  // These are plain disclosures, not modal dialogs (see the "not role=listbox"
  // comments on their markup), so they don't go through `dialogBehavior` — they
  // only need "focus the first focusable child on open," not a full ARIA/
  // Escape/Tab-trap/restore contract. The table and image dialogs below ARE
  // modal and use `dialogBehavior` directly, which owns the trap
  // itself; this helper reuses the same shared `FOCUSABLE` selector from
  // dialog.ts rather than hand-rolling its own copy. Hidden elements are
  // skipped: the More popup keeps the sections for groups that are currently
  // showing in the toolbar `display: none`, and focusing those does nothing.
  function focusableElementsIn(container: HTMLElement | undefined): HTMLElement[] {
    return Array.from(container?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
      (el) => el.offsetParent !== null,
    );
  }

  // ── Heading level picker ──────────────────────────────────────────────────────
  let headingOpen = $state(false);
  /** The toolbar button that opened the heading popup — Escape restores focus here. */
  let headingTriggerEl = $state<HTMLButtonElement | undefined>(undefined);
  /** The popup <div> itself — focused into on open so Escape is reachable immediately. */
  let headingPopupEl = $state<HTMLDivElement | undefined>(undefined);

  function openHeadingPopup(e: MouseEvent) {
    headingTriggerEl = e.currentTarget as HTMLButtonElement;
    openPopup(() => { headingOpen = !headingOpen; insertOpen = moreOpen = false; });
    // The popup <div> is a SIBLING of this trigger button,
    // not an ancestor, so an Escape keydown whose target is still the
    // trigger (focus left where it was) never bubbles to the popup's own
    // onkeydown handler. Move focus into the popup on open — the same
    // pattern the table/image dialogs already use — so Escape works right
    // away instead of only after the user Tabs into the popup.
    if (headingOpen) {
      queueMicrotask(() => focusableElementsIn(headingPopupEl)[0]?.focus());
    }
  }

  function closeHeadingPopup() {
    headingOpen = false;
    headingTriggerEl?.focus();
  }

  /** Escape-to-close for the heading popup. Attached to each `.popup-item`
   *  button rather than the wrapping `<div>` — the popup is a plain
   *  disclosure (see the "not role=listbox" comment on its markup below),
   *  so its container has no legitimate interactive ARIA role to carry a
   *  keydown handler; the buttons inside it are already interactive
   *  elements and can own it directly, with no role invented to justify it. */
  function onHeadingPopupKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") closeHeadingPopup();
  }

  function pickHeading(level: 1 | 2 | 3 | 4) {
    onAction("heading", { level });
    headingOpen = false;
  }

  // ── Insert menu ──────────────────────────────────────────────────────────
  // Every insert action (layout blocks, rule, table, image, snippet)
  // behind ONE button, so the toolbar keeps its shape whether or not the left
  // panel is open. Same plain-disclosure pattern as the heading popup above;
  // its rows are rendered by `menuRows`, the same rows the More menu lists when
  // this group is hidden.
  let insertOpen = $state(false);
  let insertTriggerEl = $state<HTMLButtonElement | undefined>(undefined);
  let insertPopupEl = $state<HTMLDivElement | undefined>(undefined);

  function openInsertPopup(e: MouseEvent) {
    insertTriggerEl = e.currentTarget as HTMLButtonElement;
    openPopup(() => { insertOpen = !insertOpen; headingOpen = moreOpen = false; });
    if (insertOpen) {
      queueMicrotask(() => focusableElementsIn(insertPopupEl)[0]?.focus());
    }
  }

  function closeInsertPopup() {
    insertOpen = false;
    insertTriggerEl?.focus();
  }

  function onInsertPopupKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") closeInsertPopup();
  }

  // ── Table column picker (a fixed-position dialog, like the image
  // dialog below, so it works regardless of which trigger opened it — the
  // Insert menu row OR the More menu row — and is never nested inside a
  // container that can be `display: none` at the widths where the More menu
  // takes over from the Insert menu). ────────────────────────────────────────
  let tableOpen = $state(false);
  let tableCols = $state(3);
  let tableDialogEl = $state<HTMLDivElement | undefined>(undefined);
  /** The Insert/More-menu button that opened the table dialog — focus is restored on close. */
  let tableDialogTriggerEl = $state<HTMLButtonElement | undefined>(undefined);

  function openTableDialog(trigger: HTMLButtonElement | undefined) {
    tableDialogTriggerEl = trigger;
    tableOpen = true;
    // Initial focus placement is handled by the dialogBehavior action.
  }

  function insertTable() {
    onAction("table", { cols: tableCols });
    closeTableDialog();
  }

  function cancelTable() {
    closeTableDialog();
  }

  function closeTableDialog() {
    // Focus restoration to `tableDialogTriggerEl` is handled by the
    // dialogBehavior action.
    tableOpen = false;
  }

  // ── Image insert dialog ──────────────────────────────────────────────────────
  // Position/size options come from the shared class table
  // ($lib/editor/image-classes) — the same table the context menu and the
  // attrs round-trip helpers read, so the lists cannot drift apart.
  let imageOpen = $state(false);
  let imageAlt = $state("");
  let imageWidth = $state("");
  let imagePosition = $state<"" | ImagePositionClass>("");
  let imageSize = $state<"" | ImageSizeClass>("");
  let imageShape = $state(false);
  let imageSrc = $state("");        // picked absolute path from host
  let imageBusy = $state(false);
  let imageError = $state("");
  let imageDialogEl = $state<HTMLDivElement | undefined>(undefined);
  /** The Insert/More-menu button that opened the image dialog — focus is restored on close. */
  let imageDialogTriggerEl = $state<HTMLButtonElement | undefined>(undefined);

  async function pickImage() {
    imageError = "";
    imageBusy = true;
    try {
      const picked = await api.dialog.pickImageFile();
      if (!picked) return;
      imageSrc = picked;
      imageError = "";
    } catch {
      imageError = "Could not open the image picker.";
    } finally {
      imageBusy = false;
    }
  }

  async function insertImage() {
    if (!imageSrc) {
      imageError = "Please pick an image file.";
      return;
    }
    imageError = "";
    imageBusy = true;
    let finalSrc = imageSrc;
    try {
      // All import policy (inside-project vs. copy-to-images/assets,
      // separator-aware containment, name collisions) lives host-side in
      // ONE route — the toolbar just hands it the picked
      // absolute path and gets back a project-relative `src`.
      if (projectDir) {
        const result = await api.media.importImage(projectDir, imageSrc);
        finalSrc = result.src;
      }
    } catch (e) {
      imageError =
        e instanceof Error ? e.message : "Could not copy the image file.";
      imageBusy = false;
      return;
    }
    onAction("image", {
      src: finalSrc,
      alt: imageAlt || basenameOf(finalSrc) || "image",
      width: imageWidth || undefined,
      position: imagePosition || undefined,
      size: imageSize || undefined,
      shape: imageShape || undefined,
    });
    // Reset dialog state.
    imageSrc = "";
    imageAlt = "";
    imageWidth = "";
    imagePosition = "";
    imageSize = "";
    imageShape = false;
    imageOpen = false;
    imageBusy = false;
    // Focus restoration to `imageDialogTriggerEl` is handled by the
    // dialogBehavior action.
  }

  function cancelImage() {
    imageSrc = "";
    imageAlt = "";
    imageWidth = "";
    imagePosition = "";
    imageSize = "";
    imageShape = false;
    imageError = "";
    imageOpen = false;
    imageBusy = false;
    // Focus restoration to `imageDialogTriggerEl` is handled by the
    // dialogBehavior action.
  }

  function openImageDialog(trigger: HTMLButtonElement | undefined) {
    imageDialogTriggerEl = trigger;
    imageOpen = true;
    // Initial focus placement is handled by the dialogBehavior action.
  }

  // ── "More" overflow menu (shown at narrow toolbar widths via @container) ────
  let moreOpen = $state(false);
  /** The button that opened the More menu — Escape restores focus here. */
  let moreTriggerEl = $state<HTMLButtonElement | undefined>(undefined);
  /** The popup <div> itself — focused into on open so Escape is reachable immediately. */
  let morePopupEl = $state<HTMLDivElement | undefined>(undefined);

  function openMorePopup(e: MouseEvent) {
    moreTriggerEl = e.currentTarget as HTMLButtonElement;
    openPopup(() => { moreOpen = !moreOpen; headingOpen = insertOpen = false; });
    // Same rationale as openHeadingPopup above — move focus
    // into the popup on open so Escape closes it immediately, not only after
    // the user manually Tabs in.
    if (moreOpen) {
      queueMicrotask(() => focusableElementsIn(morePopupEl)[0]?.focus());
    }
  }

  function closeMorePopup() {
    moreOpen = false;
    moreTriggerEl?.focus();
  }

  /** Escape-to-close for the More popup — same rationale as
   *  `onHeadingPopupKeydown` above (plain disclosure, handler lives on the
   *  interactive `.popup-item` buttons, not the non-interactive wrapper). */
  function onMorePopupKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") closeMorePopup();
  }

  // ── Rows shared by the Insert and More menus ─────────────────────────────
  // `pick` closes the popup and moves focus to its trigger BEFORE running the
  // row's action. The row itself unmounts with the popup, so a dialog opened
  // from it (table, image, snippet picker) would otherwise try to hand focus
  // back to a detached button; the trigger is still on screen.
  type PopupMenu = {
    pick: (run: (trigger: HTMLButtonElement | undefined) => void) => void;
    onKey: (e: KeyboardEvent) => void;
  };
  const insertMenu: PopupMenu = {
    pick(run) { closeInsertPopup(); run(insertTriggerEl); },
    onKey: onInsertPopupKeydown,
  };
  const moreMenu: PopupMenu = {
    pick(run) { closeMorePopup(); run(moreTriggerEl); },
    onKey: onMorePopupKeydown,
  };

  // Close all open pickers when clicking outside.
  // Uses a "just opened" flag so the same click that opens a popup doesn't
  // immediately close it via event bubbling to the window handler.
  let justOpened = false;

  function openPopup(setter: () => void) {
    setter();
    justOpened = true;
    // Clear the flag after the current event loop turn so it only suppresses
    // the window click handler for the opening click.
    requestAnimationFrame(() => { justOpened = false; });
  }

  function onWindowClick(e: MouseEvent) {
    if (justOpened) return;
    const target = e.target as HTMLElement | null;
    if (!target?.closest?.(".toolbar-popup, .tb-popup-wrap")) {
      headingOpen = false;
      insertOpen = false;
      moreOpen = false;
    }
    // Don't close imageOpen/tableOpen on outside click — both are
    // modal-style fixed dialogs with their own backdrop click-to-close.
  }
</script>

<svelte:window onclick={onWindowClick} />

{#if isMarkdown}
<div class="editor-toolbar" role="toolbar" aria-label="Markdown formatting toolbar">
  <!-- Primary group: Save (when wired) + always-visible inline formatting.
       Every group here AND the Insert/More menus below render from
       `visibleItems` (toolbar-actions.ts) so an item can never be listed in
       one place and silently dropped from another. -->
  <div class="tb-group primary-group">
    {#each saveItems as item (item.id)}
      <!-- Save: primary while there is something to save, a calm disabled
           "Saved" otherwise. The text label yields to the icon in the
           narrow tiers (see the style block); title/aria-label stay. -->
      <button
        class="tb-btn save-btn"
        class:app-btn-primary={savePending}
        onclick={onSave}
        disabled={!savePending || saving}
        title={savePending ? `${item.title} (Ctrl+S)` : "All changes saved"}
        aria-label={savePending ? item.ariaLabel : "All changes saved"}
      >
        <Icon name={savePending ? (item.icon as IconName) : "circle-check"} size={14} />
        <span class="save-label">{saving ? "Saving…" : savePending ? "Save" : "Saved"}</span>
      </button>
      <span class="tb-sep save-sep" aria-hidden="true"></span>
    {/each}
    {#each primaryItems as item (item.id)}
      <button
        class="tb-btn"
        onclick={() => fireAction(item)}
        title={item.title}
        aria-label={item.ariaLabel}
      >
        <Icon name={item.icon as IconName} size={14} />
      </button>
    {/each}
  </div>

  <span class="tb-sep sep-block" aria-hidden="true"></span>

  <!-- Block formatting group -->
  <div class="tb-group block-group">
    {#each blockItems as item (item.id)}
      {#if item.kind === "heading"}
        <!-- Heading picker: a plain disclosure, not role=listbox — this
             widget implements neither arrow-key roving focus nor
             aria-selected, so the listbox contract would be a lie
             (BookSwitcher.svelte documents the same call). Escape closes
             and returns focus to the trigger. -->
        <div class="tb-popup-wrap">
          <button
            class="tb-btn tb-btn-split"
            onclick={openHeadingPopup}
            aria-expanded={headingOpen}
            title={item.title}
            aria-label={item.ariaLabel}
          >
            <Icon name={item.icon as IconName} size={14} />
            <Icon name="chevron-down" size={10} />
          </button>
          {#if headingOpen}
            <div
              bind:this={headingPopupEl}
              class="toolbar-popup heading-popup"
              aria-label="Heading level"
            >
              {#each [1, 2, 3, 4] as level (level)}
                <button
                  class="popup-item"
                  onclick={() => pickHeading(level as 1 | 2 | 3 | 4)}
                  onkeydown={onHeadingPopupKeydown}
                >
                  H{level}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {:else}
        <button
          class="tb-btn"
          onclick={() => fireAction(item)}
          title={item.title}
          aria-label={item.ariaLabel}
        >
          <Icon name={item.icon as IconName} size={14} />
        </button>
      {/if}
    {/each}
  </div>

  <span class="tb-sep sep-tail" aria-hidden="true"></span>

  <!-- Insert group: ONE menu button for every insert action (layout blocks,
       rule, table, image, snippet). The table/image rows open the fixed-position
       dialogs below — NOT nested inside this group, so they keep working from
       the More menu even when `.insert-group` is `display: none` at narrow
       widths. Plain disclosure like the heading picker above. -->
  <div class="tb-group insert-group">
    <div class="tb-popup-wrap">
      <button
        class="tb-btn tb-btn-split tb-insert-btn"
        onclick={openInsertPopup}
        aria-expanded={insertOpen}
        title="Insert a layout block, table, image, snippet or rule"
        aria-label="Insert"
      >
        <Icon name="plus" size={14} />
        <span class="tb-insert-label">Insert</span>
        <Icon name="chevron-down" size={10} />
      </button>
      {#if insertOpen}
        <div
          bind:this={insertPopupEl}
          class="toolbar-popup insert-popup"
          aria-label="Insert"
        >
          {@render menuRows(insertItems, insertMenu)}
        </div>
      {/if}
    </div>
  </div>

  <!-- "More" overflow button — CSS @container shows it only while a group is
       hidden, and each section below only while ITS group is hidden, so the
       popup lists what the toolbar cannot show and never repeats what it does
       (tier comment in the style block). Sections render from the same item
       arrays as the groups. Plain disclosure, not role=menu — see the
       heading picker comment above; same rationale. -->
  <div class="tb-more-wrap">
    <button
      class="tb-btn tb-more-btn"
      onclick={openMorePopup}
      aria-expanded={moreOpen}
      title="More formatting options"
      aria-label="More formatting options"
    >
      <Icon name="more-horizontal" size={14} />
    </button>
    {#if moreOpen}
      <div
        bind:this={morePopupEl}
        class="toolbar-popup more-popup"
        aria-label="More formatting options"
      >
        <div class="more-block">
          {@render menuRows(blockItems, moreMenu)}
        </div>
        <div class="more-tail">
          {@render menuRows(insertItems, moreMenu)}
        </div>
      </div>
    {/if}
  </div>

  <div class="tb-group status-group">
    {#if onToggleProblems}
      <!-- Problems: a compact badge — status icon + count. A button only while
           there is something to list; otherwise the same badge, inert. The
           accessible name carries what the badge only shows as icons. -->
      {#if canExpand}
        <button
          bind:this={problemsToggleEl}
          class="toggle-strip"
          onclick={() => problemsToggleEl && onToggleProblems(problemsToggleEl)}
          aria-expanded={problemsOpen}
          aria-controls="problems-body"
          aria-label={stripLabel}
          title={`${stripLabel} — ${problemsOpen ? "click to collapse" : "click to expand"}`}
        >
          {#if counts.badge > 0}
            {#if counts.errors > 0}
              <span class="strip-count error-count"><Icon name="circle-x" size={13} />{counts.errors}</span>
            {/if}
            {#if counts.warnings > 0}
              <span class="strip-count warning-count"><Icon name="triangle-alert" size={13} />{counts.warnings}</span>
            {/if}
          {:else}
            <span class="strip-count" class:ok={!problemsError && !problemsLoading}>
              <Icon name={problemsError ? "info" : problemsLoading ? "refresh-cw" : "circle-check"} size={13} />
              {#if !problemsError && !problemsLoading}0{/if}
            </span>
          {/if}
        </button>
      {:else}
        <span class="strip-idle" role="img" aria-label={stripLabel} title={stripLabel}>
          <span class="strip-count" class:ok={!problemsLoading}>
            <Icon name={problemsLoading ? "refresh-cw" : "circle-check"} size={13} />
            {#if !problemsLoading}0{/if}
          </span>
        </span>
      {/if}
    {/if}
  </div>
</div>
{/if}

<!-- One row per action, for the Insert popup and the More popup alike. -->
{#snippet menuRows(items: ToolbarItemDef[], menu: PopupMenu)}
  {#each items as item, i (item.id)}
    {#if item.kind === "heading"}
      {#each [1, 2, 3, 4] as level (level)}
        <button class="popup-item" onclick={() => menu.pick(() => pickHeading(level as 1 | 2 | 3 | 4))} onkeydown={menu.onKey}>
          Heading {level}
        </button>
      {/each}
    {:else if item.kind === "layout-block"}
      {#if i > 0}<hr class="popup-hr" />{/if}
      {#each LAYOUT_BLOCK_ITEMS as block (block.kind)}
        <button class="popup-item" title={block.detail} onclick={() => menu.pick(() => onAction("layout-block", { kind: block.kind }))} onkeydown={menu.onKey}>
          {block.label}
        </button>
      {/each}
      {#if i < items.length - 1}<hr class="popup-hr" />{/if}
    {:else if item.kind === "table"}
      <button class="popup-item" onclick={() => menu.pick(openTableDialog)} onkeydown={menu.onKey}>{item.label}</button>
    {:else if item.kind === "image"}
      <button class="popup-item" onclick={() => menu.pick(openImageDialog)} onkeydown={menu.onKey}>{item.label}</button>
    {:else}
      <button class="popup-item" title={item.title} onclick={() => menu.pick(() => fireAction(item))} onkeydown={menu.onKey}>{item.label}</button>
    {/if}
  {/each}
{/snippet}

<!-- Table insert dialog (fixed-position overlay, rendered outside the
     toolbar — same pattern as the image dialog below, and for the same
     reason: inside `.insert-group` it would be dead at every width where the
     More menu exists, since that group is `display: none` at exactly those
     widths.) -->
{#if tableOpen}
<div class="image-dialog-backdrop" role="none" onclick={cancelTable}></div>
<div
  bind:this={tableDialogEl}
  class="image-dialog table-dialog"
  aria-label="Insert table"
  use:dialogBehavior={{ onClose: cancelTable, triggerEl: tableDialogTriggerEl }}
>
  <h3 class="image-dialog-title">Insert table</h3>
  <label class="popup-label">
    Columns
    <input
      type="number"
      min="1"
      max="10"
      bind:value={tableCols}
      class="popup-input"
      aria-label="Number of columns"
    />
  </label>
  <div class="image-actions">
    <button class="image-cancel" onclick={cancelTable}>Cancel</button>
    <button class="image-insert primary app-btn-primary" onclick={insertTable}>Insert table</button>
  </div>
</div>
{/if}

<!-- Image insert dialog (modal-style overlay, rendered outside the toolbar) -->
{#if imageOpen}
<div class="image-dialog-backdrop" role="none" onclick={cancelImage}></div>
<div
  bind:this={imageDialogEl}
  class="image-dialog"
  aria-label="Insert image"
  use:dialogBehavior={{ onClose: cancelImage, triggerEl: imageDialogTriggerEl }}
>
  <h3 class="image-dialog-title">Insert image</h3>

  <div class="image-field">
    <label class="image-label" for="img-src-path">Image file</label>
    <div class="image-pick-row">
      <input
        id="img-src-path"
        class="image-input"
        type="text"
        readonly
        value={imageSrc ? basenameOf(imageSrc) : ""}
        placeholder="No file selected"
        aria-label="Selected image file"
      />
      <button class="image-pick-btn" onclick={pickImage} disabled={imageBusy}>
        {imageBusy ? "Picking…" : "Choose…"}
      </button>
    </div>
    {#if imageSrc}
      <p class="image-path-hint" title={imageSrc}>{imageSrc}</p>
    {/if}
  </div>

  <div class="image-field">
    <label class="image-label" for="img-alt">Alt text</label>
    <input
      id="img-alt"
      class="image-input"
      type="text"
      bind:value={imageAlt}
      placeholder="Describe the image for screen readers"
      aria-label="Image alt text"
    />
  </div>

  <div class="image-field">
    <label class="image-label" for="img-width">Width (optional)</label>
    <input
      id="img-width"
      class="image-input"
      type="text"
      bind:value={imageWidth}
      placeholder='e.g. 300px or 80%'
      aria-label="Image width"
    />
  </div>

  <div class="image-field">
    <label class="image-label" for="img-position">Position (optional)</label>
    <select
      id="img-position"
      class="image-select"
      bind:value={imagePosition}
      aria-label="Image position"
    >
      <option value="">None (inline)</option>
      {#each IMAGE_POSITION_OPTIONS as opt (opt.class)}
        <option value={opt.class}>{opt.label}</option>
      {/each}
    </select>
  </div>

  <div class="image-field">
    <label class="image-label" for="img-size">Size (optional)</label>
    <select
      id="img-size"
      class="image-select"
      bind:value={imageSize}
      aria-label="Image size"
    >
      <option value="">Natural (fit the column)</option>
      {#each IMAGE_SIZE_OPTIONS as opt (opt.class)}
        <option value={opt.class}>{opt.label}</option>
      {/each}
    </select>
    <p class="image-hint">
      These are the standard gp-* image classes documented in the user guide;
      position and size compose (e.g. a small right float).
    </p>
  </div>

  <div class="image-field">
    <label class="image-check-row">
      <input type="checkbox" bind:checked={imageShape} aria-label="Wrap text to image shape" />
      Wrap text to the image's shape
    </label>
    <p class="image-hint">
      For floated images with transparency (cut-out PNGs): text follows the
      visible silhouette instead of the rectangular box. Has no effect
      without a float position.
    </p>
  </div>

  {#if imageError}
    <p class="image-error" role="alert">{imageError}</p>
  {/if}

  <div class="image-actions">
    <button class="image-cancel" onclick={cancelImage}>Cancel</button>
    <button
      class="image-insert primary app-btn-primary"
      onclick={insertImage}
      disabled={imageBusy || !imageSrc}
    >
      {imageBusy ? "Inserting…" : "Insert"}
    </button>
  </div>
</div>
{/if}

<style>
  /* ── Toolbar container ──────────────────────────────────────────────────── */
  .editor-toolbar {
    container-type: inline-size;
    container-name: editor-toolbar;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px 6px;
    background: var(--app-surface-raised);
    border-bottom: 1px solid var(--app-border);
    flex-shrink: 0;
    /* width: 100% is required because container-type:inline-size prevents the
       default flex-child stretch from working — the container containment
       blocks the normal BFC width inheritance from the flex parent. */
    width: 100%;
    min-height: 32px;
    overflow: visible;
    box-sizing: border-box;
  }

  /* ── Groups and separators ───────────────────────────────────────────────── */
  .tb-group {
    display: flex;
    align-items: center;
    gap: 1px;
  }

  .tb-sep {
    display: block;
    width: 1px;
    height: 16px;
    background: var(--app-border);
    margin: 0 3px;
    flex-shrink: 0;
  }
  .save-sep { margin-right: 5px; }

  /* Save: a labelled button. Pending = .app-btn-primary (theme.css owns the
     colour); clean = quiet muted text, no fill. */
  .save-btn {
    gap: 5px;
    padding: 3px 9px;
    border: 1px solid transparent;
    font-size: 12px;
  }
  .save-btn:disabled {
    color: var(--app-text-muted);
    cursor: default;
  }
  .save-btn:disabled:hover {
    background: transparent;
  }
  /* .tb-btn's own (more specific) colours would beat the global
     .app-btn-primary recipe, so the pending state restates its tokens. */
  .save-btn.app-btn-primary {
    background: linear-gradient(to bottom, var(--app-accent-hover), var(--app-accent));
    color: var(--app-accent-text);
    border-color: var(--app-accent-border);
    font-weight: 600;
  }
  .save-btn.app-btn-primary:hover:not(:disabled) {
    background: linear-gradient(to bottom, var(--app-accent-bright), var(--app-accent-hover));
    color: var(--app-accent-text);
  }
  .save-btn.app-btn-primary:disabled {
    opacity: 0.7;
  }

  /* ── Toolbar buttons ─────────────────────────────────────────────────────── */
  .tb-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    border: none;
    background: transparent;
    color: var(--app-text);
    border-radius: 3px;
    padding: 3px 5px;
    cursor: pointer;
    font-size: 11px;
    line-height: 1;
    transition: background 0.1s, color 0.1s;
    /* WCAG 2.5.8: minimum target size 24×24px */
    min-width: 26px;
    min-height: 26px;
  }
  .tb-btn:hover {
    background: var(--app-control-hover-bg);
    color: var(--app-text);
  }
  .tb-btn:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }
  .tb-btn:active {
    background: var(--app-control-active-bg);
  }
  .tb-btn-split {
    gap: 1px;
  }
  .tb-insert-label {
    padding: 0 2px;
  }

  /* ── Popup wrappers (heading, insert, more) ──────────────────────────────── */
  .tb-popup-wrap {
    position: relative;
  }

  .toolbar-popup {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    min-width: 120px;
    background: var(--app-surface);
    border: 1px solid var(--app-border);
    border-radius: 4px;
    box-shadow: 0 4px 12px var(--app-shadow-md);
    z-index: var(--app-z-menu);
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .popup-item {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    border-radius: 3px;
    padding: 5px 8px;
    font-size: 12px;
    color: var(--app-text);
    cursor: pointer;
  }
  .popup-item:hover {
    background: var(--app-control-hover-bg);
  }
  .popup-item:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }

  .popup-hr {
    border: none;
    border-top: 1px solid var(--app-border);
    margin: 3px 0;
  }

  .heading-popup {
    flex-direction: row;
    min-width: unset;
    gap: 2px;
    padding: 4px;
  }
  .heading-popup .popup-item {
    font-weight: 700;
    padding: 4px 8px;
    min-width: 32px;
    text-align: center;
  }

  .popup-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    color: var(--app-text);
    gap: 8px;
  }
  .popup-input {
    width: 56px;
    padding: 3px 6px;
    border: 1px solid var(--app-border);
    border-radius: 3px;
    background: var(--app-bg);
    color: var(--app-text);
    font-size: 12px;
    text-align: right;
  }

  /* Table insert dialog reuses .image-dialog's fixed/modal chrome, just
     narrower — its only content is a column-count field. Compound selector
     so it wins over .image-dialog's width regardless of source order. */
  .image-dialog.table-dialog {
    width: clamp(220px, 60vw, 300px);
  }

  /* ── Heading, Insert and More popups ──────────────────────────────────────── */
  /* Right-aligned to their trigger so they open back over the pane instead of
     off its right edge (the pane clips overflow). */
  .heading-popup,
  .insert-popup,
  .more-popup {
    right: 0;
    left: auto;
  }
  .insert-popup,
  .more-popup {
    min-width: 180px;
  }
  .more-popup {
    max-height: 320px;
    overflow-y: auto;
  }

  /* ── More overflow button ─────────────────────────────────────────────────── */
  .tb-more-wrap {
    position: relative;
    /* Hidden by default; shown only while a group is hidden (tiers below). */
    display: none;
  }
  /* One section per hideable group; listed only while that group is hidden. */
  .more-block,
  .more-tail {
    display: none;
    flex-direction: column;
    gap: 1px;
  }

  /* ── Status cluster (right end): Problems badge ────────── */
  .status-group {
    margin-left: auto;
    gap: 2px;
  }
  .toggle-strip,
  .strip-idle {
    display: inline-flex;
    box-sizing: border-box;
    align-items: center;
    gap: 6px;
    padding: 3px 6px;
    border: none;
    border-radius: 4px;
    background: transparent;
    font-size: 11px;
    color: var(--app-text-secondary);
  }
  .toggle-strip { cursor: pointer; }
  .toggle-strip:hover { background: var(--app-control-hover-bg); }
  .toggle-strip:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: -2px; }
  .strip-count {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-variant-numeric: tabular-nums;
  }
  .error-count { color: var(--app-error-text); }
  .warning-count { color: var(--app-warning-text); }
  .strip-count.ok { color: var(--app-success-text); }

  /*
   * Overflow tiers, by the toolbar's own width (a container query: the pane
   * narrows when the left panel opens or the window shrinks, so this — not the
   * panel state — is what "fits" means). Thresholds are what the groups need
   * (measured) plus a little slack; re-measure if a group gains a button.
   *   >= 480px  everything, Save and Insert labelled
   *   >= 420px  everything, Insert labelled, Save icon-only
   *   >= 385px  everything, Insert as an icon
   *   >= 340px  Insert moves into "…"
   *   below     the block group (quote, lists, heading) moves in as well
   * "…" and each of its sections appear only in the tiers that hide the
   * matching group, so the popup never repeats a visible button.
   */
  @container editor-toolbar (max-width: 479px) {
    /* The Save label (the widest always-on control) yields first. */
    .save-label {
      display: none;
    }
    .save-btn {
      padding: 3px 5px;
    }
  }
  @container editor-toolbar (max-width: 419px) {
    .tb-insert-label {
      display: none;
    }
  }
  @container editor-toolbar (max-width: 384px) {
    .sep-tail,
    .insert-group {
      display: none;
    }
    .tb-more-wrap {
      display: flex;
    }
    .more-tail {
      display: flex;
    }
  }
  @container editor-toolbar (max-width: 339px) {
    .sep-block,
    .block-group {
      display: none;
    }
    .more-block {
      display: flex;
    }
    .more-tail {
      border-top: 1px solid var(--app-border);
      margin-top: 3px;
      padding-top: 3px;
    }
  }

  /* ── Image insert dialog ──────────────────────────────────────────────────── */
  .image-dialog-backdrop {
    position: fixed;
    inset: 0;
    background: var(--app-backdrop);
    /* Between --app-z-menu and --app-z-sheet: this toolbar-owned mini-dialog
       must stay BELOW --app-z-modal so real app dialogs always cover it. */
    z-index: calc(var(--app-z-menu) + 100);
  }

  .image-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: calc(var(--app-z-menu) + 101);
    background: var(--app-surface);
    border: 1px solid var(--app-border);
    border-radius: 8px;
    box-shadow: 0 8px 32px var(--app-shadow-lg);
    padding: 20px 24px;
    width: clamp(300px, 90vw, 460px);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .image-dialog-title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--app-text);
  }

  .image-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .image-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--app-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .image-pick-row {
    display: flex;
    gap: 6px;
  }

  .image-input {
    flex: 1;
    padding: 6px 8px;
    border: 1px solid var(--app-border);
    border-radius: 4px;
    background: var(--app-bg);
    color: var(--app-text);
    font-size: 12px;
  }
  .image-input:focus {
    outline: none;
    border-color: var(--app-focus-ring);
  }
  .image-input[readonly] {
    cursor: default;
    color: var(--app-text-muted);
  }

  .image-pick-btn {
    padding: 6px 12px;
    border: 1px solid var(--app-border);
    border-radius: 4px;
    background: var(--app-control-bg);
    color: var(--app-text);
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .image-pick-btn:hover {
    background: var(--app-control-hover-bg);
  }
  .image-pick-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .image-path-hint {
    margin: 0;
    font-size: 10px;
    color: var(--app-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .image-hint {
    margin: 0;
    font-size: 10px;
    color: var(--app-text-muted);
    line-height: 1.4;
  }

  .image-check-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--app-text);
    cursor: pointer;
  }

  .image-select {
    padding: 6px 8px;
    border: 1px solid var(--app-border);
    border-radius: 4px;
    background: var(--app-bg);
    color: var(--app-text);
    font-size: 12px;
  }
  .image-select:focus {
    outline: none;
    border-color: var(--app-focus-ring);
  }

  .image-error {
    margin: 0;
    font-size: 12px;
    color: var(--app-error-text);
  }

  .image-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }

  .image-cancel {
    padding: 7px 14px;
    border: 1px solid var(--app-border);
    border-radius: 4px;
    background: transparent;
    color: var(--app-text);
    font-size: 12px;
    cursor: pointer;
  }
  .image-cancel:hover {
    background: var(--app-control-hover-bg);
  }

  /* Colors come from the shared .app-btn-primary recipe (theme.css). */
  .image-insert {
    padding: 7px 14px;
    border-width: 1px;
    border-style: solid;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
  }
  .image-insert:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  /* Theme tokens already handle light/dark via :root and :root[data-theme="dark"];
     all colour rules reference app tokens — no hardcoded hex overrides needed. */
</style>
