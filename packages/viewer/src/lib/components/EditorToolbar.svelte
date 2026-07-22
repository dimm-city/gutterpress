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
   *   api.media.importImage — the ONE host-side import-policy route, UX
   *   review M10), so the toolbar accepts `projectDir` to keep it testable
   *   without a full Electron environment. The toolbar does no path/fs math
   *   of its own; the route returns the project-relative `src` to insert.
   * - At narrow editor-pane widths (~350px) the toolbar uses @container to overflow
   *   secondary actions into a "More" popover so nothing clips or wraps.
   */
  import Icon from "$lib/components/Icon.svelte";
  import type { ComponentProps } from "svelte";
  import { getPlatform, isDesktop } from "$lib/platform";
  import { basenameOf } from "$lib/platform/paths";
  import { api } from "$lib/api";
  import { dialogBehavior, FOCUSABLE } from "$lib/dialog";
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
    /** Absolute path to the open project, used to compute assets/ destination. */
    projectDir = null,
  }: {
    filePath?: string | null;
    onAction: (action: ToolbarAction, payload?: ToolbarPayload) => void;
    onSave?: () => void;
    projectDir?: string | null;
  } = $props();

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
    | "page-break"
    | "table"
    | "image"
    | "snippet"
    | "focus-mode"
    | "layout-block";

  export type ToolbarPayload =
    | { level: 1 | 2 | 3 | 4 }           // heading
    | { cols: number }                    // table
    | { src: string; alt: string; width?: string; position?: string } // image
    | { kind: LayoutBlockKind };          // layout-block

  // The toolbar is only meaningful for markdown files.
  let isMarkdown = $derived(
    filePath !== null && /\.(md|markdown)$/i.test(filePath),
  );

  // ── M23: single declarative item array drives BOTH the grouped toolbar
  // buttons and the flat More menu — see toolbar-actions.ts for rationale. ──
  let visibleItems = $derived(
    visibleToolbarItems({ hasSave: !!onSave, desktop: isDesktop() }),
  );
  let saveItems = $derived(visibleItems.filter((i) => i.group === "save"));
  let primaryItems = $derived(visibleItems.filter((i) => i.group === "primary"));
  let blockItems = $derived(visibleItems.filter((i) => i.group === "block"));
  let insertItems = $derived(visibleItems.filter((i) => i.group === "insert"));

  function fireAction(item: ToolbarItemDef) {
    if (item.action) onAction(item.action as ToolbarAction);
  }

  // ── Focus-first-child helper for the heading/layout/More popups below ──────
  // These are plain disclosures, not modal dialogs (see the "not role=listbox"
  // comments on their markup), so they don't go through `dialogBehavior` — they
  // only need "focus the first focusable child on open," not a full ARIA/
  // Escape/Tab-trap/restore contract. The table and image dialogs below ARE
  // modal and use `dialogBehavior` directly (ARCH #42), which owns the trap
  // itself; this helper reuses the same shared `FOCUSABLE` selector from
  // dialog.ts rather than hand-rolling its own copy.
  function focusableElementsIn(container: HTMLElement | undefined): HTMLElement[] {
    return Array.from(container?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
  }

  // ── Heading level picker ──────────────────────────────────────────────────────
  let headingOpen = $state(false);
  /** The toolbar button that opened the heading popup — Escape restores focus here. */
  let headingTriggerEl = $state<HTMLButtonElement | undefined>(undefined);
  /** The popup <div> itself — focused into on open so Escape is reachable immediately. */
  let headingPopupEl = $state<HTMLDivElement | undefined>(undefined);

  function openHeadingPopup(e: MouseEvent) {
    headingTriggerEl = e.currentTarget as HTMLButtonElement;
    openPopup(() => { headingOpen = !headingOpen; });
    // M24 fix round 1: the popup <div> is a SIBLING of this trigger button,
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

  // ── Insert layout block picker (UX M26) ──────────────────────────────────
  // Same plain-disclosure pattern as the heading popup above: Chapter /
  // Section / Two columns / Page break / Spread, inserting the core
  // `@marker` skeleton for the picked kind via toolbar-actions.ts helpers.
  let layoutOpen = $state(false);
  let layoutTriggerEl = $state<HTMLButtonElement | undefined>(undefined);
  let layoutPopupEl = $state<HTMLDivElement | undefined>(undefined);

  function openLayoutPopup(e: MouseEvent) {
    layoutTriggerEl = e.currentTarget as HTMLButtonElement;
    openPopup(() => { layoutOpen = !layoutOpen; });
    if (layoutOpen) {
      queueMicrotask(() => focusableElementsIn(layoutPopupEl)[0]?.focus());
    }
  }

  function closeLayoutPopup() {
    layoutOpen = false;
    layoutTriggerEl?.focus();
  }

  function onLayoutPopupKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") closeLayoutPopup();
  }

  function pickLayoutBlock(kind: LayoutBlockKind) {
    onAction("layout-block", { kind });
    layoutOpen = false;
  }

  // ── Table column picker (M11: a fixed-position dialog, like the image
  // dialog below, so it works regardless of which trigger opened it — the
  // always-visible toolbar button OR the More menu item — and is never
  // nested inside a container that can be `display: none` at the exact
  // widths where the More menu exists). ──────────────────────────────────────
  let tableOpen = $state(false);
  let tableCols = $state(3);
  let tableDialogEl = $state<HTMLDivElement | undefined>(undefined);
  /** The toolbar/More-menu button that opened the table dialog — focus is restored on close. */
  let tableDialogTriggerEl = $state<HTMLButtonElement | undefined>(undefined);

  function openTableDialog(e: MouseEvent) {
    tableDialogTriggerEl = e.currentTarget as HTMLButtonElement;
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
  let imageOpen = $state(false);
  let imageAlt = $state("");
  let imageWidth = $state("");
  let imagePosition = $state<
    "" | "float-left" | "float-right" | "center" | "full-width" | "full-bleed"
  >("");
  let imageSrc = $state("");        // picked absolute path from host
  let imageBusy = $state(false);
  let imageError = $state("");
  let imageDialogEl = $state<HTMLDivElement | undefined>(undefined);
  /** The toolbar button that opened the image dialog — focus is restored on close. */
  let imageDialogTriggerEl = $state<HTMLButtonElement | undefined>(undefined);

  async function pickImage() {
    if (!isDesktop()) return;
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
      // ONE route (UX review M10) — the toolbar just hands it the picked
      // absolute path and gets back a project-relative `src`.
      if (projectDir && isDesktop()) {
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
    });
    // Reset dialog state.
    imageSrc = "";
    imageAlt = "";
    imageWidth = "";
    imagePosition = "";
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
    imageError = "";
    imageOpen = false;
    imageBusy = false;
    // Focus restoration to `imageDialogTriggerEl` is handled by the
    // dialogBehavior action.
  }

  function openImageDialog(e: MouseEvent) {
    imageDialogTriggerEl = e.currentTarget as HTMLButtonElement;
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
    openPopup(() => { moreOpen = !moreOpen; });
    // M24 fix round 1: same rationale as openHeadingPopup above — move focus
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
      layoutOpen = false;
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
       Both this group AND the More menu below render from `visibleItems`
       (toolbar-actions.ts) so Save/Snippet can never be listed in one place
       and silently dropped from the other (M23). -->
  <div class="tb-group primary-group">
    {#each saveItems as item (item.id)}
      <button
        class="tb-btn save-btn"
        onclick={onSave}
        title={item.title}
        aria-label={item.ariaLabel}
      >
        <Icon name={item.icon as IconName} size={14} />
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

  <span class="tb-sep" aria-hidden="true"></span>

  <!-- Block formatting group -->
  <div class="tb-group block-group">
    {#each blockItems as item (item.id)}
      {#if item.kind === "heading"}
        <!-- Heading picker: a plain disclosure, not role=listbox — this
             widget implements neither arrow-key roving focus nor
             aria-selected, so the listbox contract would be a lie (M24;
             BookSwitcher.svelte:40-43 documents the same call). Escape closes
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

  <span class="tb-sep" aria-hidden="true"></span>

  <!-- Insert group: layout block, HR, page break, table, image, snippet -->
  <div class="tb-group insert-group">
    {#each insertItems as item (item.id)}
      {#if item.kind === "layout-block"}
        <!-- Insert layout block picker (UX M26) — Chapter / Section / Two
             columns / Page break / Spread, same split-button + popup
             pattern as the heading picker below. -->
        <div class="tb-popup-wrap">
          <button
            class="tb-btn tb-btn-split"
            onclick={openLayoutPopup}
            aria-expanded={layoutOpen}
            title={item.title}
            aria-label={item.ariaLabel}
          >
            <Icon name={item.icon as IconName} size={14} />
            <Icon name="chevron-down" size={10} />
          </button>
          {#if layoutOpen}
            <div
              bind:this={layoutPopupEl}
              class="toolbar-popup layout-popup"
              aria-label="Insert layout block"
            >
              {#each LAYOUT_BLOCK_ITEMS as block (block.kind)}
                <button
                  class="popup-item"
                  title={block.detail}
                  onclick={() => pickLayoutBlock(block.kind)}
                  onkeydown={onLayoutPopupKeydown}
                >
                  {block.label}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {:else if item.kind === "table"}
        <!-- Opens the fixed-position table dialog below — NOT nested inside
             this group, so it keeps working from the More menu even when
             `.insert-group` is `display: none` at narrow widths (M11). -->
        <button
          class="tb-btn"
          onclick={openTableDialog}
          title={item.title}
          aria-label={item.ariaLabel}
        >
          <Icon name={item.icon as IconName} size={14} />
        </button>
      {:else if item.kind === "image"}
        <button
          class="tb-btn"
          onclick={openImageDialog}
          title={item.title}
          aria-label={item.ariaLabel}
        >
          <Icon name={item.icon as IconName} size={14} />
        </button>
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

  <!-- "More" overflow button — CSS @container shows this at narrow widths only.
       Renders EVERY item in `visibleItems` (unfiltered by group) so nothing
       reachable in the full-width toolbar goes missing here (M23). Plain
       disclosure, not role=menu — see the heading picker comment above; same
       rationale (M24). -->
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
        {#each visibleItems as item, i (item.id)}
          {#if i > 0 && visibleItems[i - 1].group !== item.group}
            <hr class="popup-hr" />
          {/if}
          {#if item.kind === "save"}
            <button class="popup-item" onclick={() => { onSave?.(); moreOpen = false; }} onkeydown={onMorePopupKeydown}>{item.label}</button>
          {:else if item.kind === "heading"}
            {#each [1, 2, 3, 4] as level (level)}
              <button class="popup-item" onclick={() => { pickHeading(level as 1 | 2 | 3 | 4); moreOpen = false; }} onkeydown={onMorePopupKeydown}>
                Heading {level}
              </button>
            {/each}
          {:else if item.kind === "layout-block"}
            {#each LAYOUT_BLOCK_ITEMS as block (block.kind)}
              <button class="popup-item" title={block.detail} onclick={() => { pickLayoutBlock(block.kind); moreOpen = false; }} onkeydown={onMorePopupKeydown}>
                {block.label}
              </button>
            {/each}
          {:else if item.kind === "table"}
            <button class="popup-item" onclick={(e) => { openTableDialog(e); moreOpen = false; }} onkeydown={onMorePopupKeydown}>{item.label}</button>
          {:else if item.kind === "image"}
            <button class="popup-item" onclick={(e) => { openImageDialog(e); moreOpen = false; }} onkeydown={onMorePopupKeydown}>{item.label}</button>
          {:else}
            <button class="popup-item" onclick={() => { fireAction(item); moreOpen = false; }} onkeydown={onMorePopupKeydown}>{item.label}</button>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
</div>
{/if}

<!-- Table insert dialog (fixed-position overlay, rendered outside the
     toolbar — same pattern as the image dialog below, and for the same
     reason: M11 found this popup dead at every width where the More menu
     exists because it used to live inside `.insert-group`, which
     `display: none`s at exactly those widths.) -->
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
        value={imageSrc ? imageSrc.split(/[\\/]/).pop() : ""}
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
      <option value="center">Center</option>
      <option value="float-left">Float left</option>
      <option value="float-right">Float right</option>
      <option value="full-width">Full width</option>
      <option value="full-bleed">Full bleed (own page, edge-to-edge)</option>
    </select>
    <p class="image-hint">
      These are standard print-md image classes documented in the user guide.
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

  /* ── Popup wrappers (heading, table, more) ───────────────────────────────── */
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

  /* ── More overflow button ─────────────────────────────────────────────────── */
  .tb-more-wrap {
    position: relative;
    margin-left: auto;
    /* Hidden by default; shown at narrow container widths via @container */
    display: none;
  }
  .more-popup {
    right: 0;
    left: auto;
    min-width: 180px;
    max-height: 320px;
    overflow-y: auto;
  }

  /*
   * @container rule: at editor-pane widths below ~380px, hide the
   * primary/block/insert groups and show only the "More" button.
   * Between 380px and 520px hide the insert group and show the "More" button
   * alongside primary+block groups.
   */
  @container editor-toolbar (max-width: 379px) {
    .primary-group,
    .block-group,
    .insert-group,
    .tb-sep {
      display: none;
    }
    .tb-more-wrap {
      display: flex;
      margin-left: 0;
    }
  }
  @container editor-toolbar (min-width: 380px) and (max-width: 519px) {
    .insert-group {
      display: none;
    }
    .tb-more-wrap {
      display: flex;
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

  /* Theme tokens already handle light/dark via :root and :root[data-theme="dark"].
     The hand-rolled [data-theme="light"] override block was removed because all
     colour rules now reference app tokens — no hardcoded hex overrides needed. */
</style>
