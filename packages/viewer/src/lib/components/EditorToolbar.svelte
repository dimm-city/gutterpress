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
   * - The Insert Image flow involves host IPCs (pickImageFile + copyFile), so the
   *   toolbar accepts `projectDir` and `platform` to keep it testable without a
   *   full Electron environment.
   * - At narrow editor-pane widths (~350px) the toolbar uses @container to overflow
   *   secondary actions into a "More" popover so nothing clips or wraps.
   */
  import Icon from "$lib/components/Icon.svelte";
  import { getPlatform, isDesktop } from "$lib/platform";

  let {
    /** Current file path — toolbar is only active for .md files. */
    filePath = null,
    /** Called by the parent to route an edit action into the CodeMirror view. */
    onAction,
    /** Absolute path to the open project, used to compute assets/ destination. */
    projectDir = null,
  }: {
    filePath?: string | null;
    onAction: (action: ToolbarAction, payload?: ToolbarPayload) => void;
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
    | "image";

  export type ToolbarPayload =
    | { level: 1 | 2 | 3 | 4 }           // heading
    | { cols: number }                    // table
    | { src: string; alt: string; width?: string; position?: string }; // image

  // The toolbar is only meaningful for markdown files.
  let isMarkdown = $derived(
    filePath !== null && /\.(md|markdown)$/i.test(filePath),
  );

  // ── Heading level picker ──────────────────────────────────────────────────────
  let headingOpen = $state(false);

  function pickHeading(level: 1 | 2 | 3 | 4) {
    onAction("heading", { level });
    headingOpen = false;
  }

  // ── Table column picker ──────────────────────────────────────────────────────
  let tableOpen = $state(false);
  let tableCols = $state(3);

  function insertTable() {
    onAction("table", { cols: tableCols });
    tableOpen = false;
  }

  // ── Image insert dialog ──────────────────────────────────────────────────────
  let imageOpen = $state(false);
  let imageAlt = $state("");
  let imageWidth = $state("");
  let imagePosition = $state<"" | "float-left" | "float-right" | "center" | "full-width">("");
  let imageSrc = $state("");        // picked absolute path from host
  let imageBusy = $state(false);
  let imageError = $state("");
  let imageDialogEl = $state<HTMLDivElement | undefined>(undefined);
  /** The toolbar button that opened the image dialog — focus is restored on close. */
  let imageDialogTriggerEl = $state<HTMLButtonElement | undefined>(undefined);

  function imageDialogFocusableElements() {
    return Array.from(
      imageDialogEl?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []
    );
  }

  function imageTrapFocus(e: KeyboardEvent) {
    if (e.key !== "Tab") return;
    const focusable = imageDialogFocusableElements();
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  async function pickImage() {
    if (!isDesktop()) return;
    imageError = "";
    imageBusy = true;
    try {
      const picked = await getPlatform().pickImageFile();
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
      // If the image is outside the project folder, copy it to assets/ first.
      if (
        projectDir &&
        isDesktop() &&
        !imageSrc.startsWith(projectDir.replace(/[\\/]+$/, ""))
      ) {
        const sep = projectDir.includes("\\") ? "\\" : "/";
        const assetsDir = projectDir.replace(/[\\/]+$/, "") + sep + "assets";
        const copied = await getPlatform().copyFile(imageSrc, assetsDir);
        // Build a relative path from the project root (assets/filename).
        const filename = copied.split(/[\\/]/).pop() ?? copied;
        finalSrc = "assets/" + filename;
      } else if (projectDir) {
        // Image is inside the project: compute project-relative path.
        const norm = (s: string) => s.replace(/\\/g, "/");
        const projNorm = norm(projectDir).replace(/\/+$/, "");
        const srcNorm = norm(imageSrc);
        finalSrc = srcNorm.startsWith(projNorm + "/")
          ? srcNorm.slice(projNorm.length + 1)
          : srcNorm.split("/").pop() ?? srcNorm;
      }
    } catch (e) {
      imageError =
        e instanceof Error ? e.message : "Could not copy the image file.";
      imageBusy = false;
      return;
    }
    onAction("image", {
      src: finalSrc,
      alt: imageAlt || finalSrc.split(/[\\/]/).pop() || "image",
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
    imageDialogTriggerEl?.focus();
    imageDialogTriggerEl = undefined;
  }

  function cancelImage() {
    imageSrc = "";
    imageAlt = "";
    imageWidth = "";
    imagePosition = "";
    imageError = "";
    imageOpen = false;
    imageBusy = false;
    imageDialogTriggerEl?.focus();
    imageDialogTriggerEl = undefined;
  }

  function openImageDialog(e: MouseEvent) {
    imageDialogTriggerEl = e.currentTarget as HTMLButtonElement;
    imageOpen = true;
    // Focus the first focusable element inside the dialog after it mounts.
    queueMicrotask(() => imageDialogFocusableElements()[0]?.focus());
  }

  // ── "More" overflow menu (shown at narrow toolbar widths via @container) ────
  let moreOpen = $state(false);

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
      tableOpen = false;
      moreOpen = false;
    }
    // Don't close imageOpen on outside click (it's a modal-style dialog).
  }
</script>

<svelte:window onclick={onWindowClick} />

{#if isMarkdown}
<div class="editor-toolbar" role="toolbar" aria-label="Markdown formatting toolbar">
  <!-- Primary group: always-visible inline formatting -->
  <div class="tb-group primary-group">
    <button
      class="tb-btn"
      onclick={() => onAction("bold")}
      title="Bold (Ctrl+B)"
      aria-label="Bold"
    >
      <Icon name="bold" size={14} />
    </button>
    <button
      class="tb-btn"
      onclick={() => onAction("italic")}
      title="Italic (Ctrl+I)"
      aria-label="Italic"
    >
      <Icon name="italic" size={14} />
    </button>
    <button
      class="tb-btn"
      onclick={() => onAction("strikethrough")}
      title="Strikethrough"
      aria-label="Strikethrough"
    >
      <Icon name="strikethrough" size={14} />
    </button>
    <button
      class="tb-btn"
      onclick={() => onAction("code")}
      title="Inline code"
      aria-label="Inline code"
    >
      <Icon name="code" size={14} />
    </button>
    <button
      class="tb-btn"
      onclick={() => onAction("link")}
      title="Link (Ctrl+K)"
      aria-label="Insert link"
    >
      <Icon name="link-2" size={14} />
    </button>
  </div>

  <span class="tb-sep" aria-hidden="true"></span>

  <!-- Block formatting group -->
  <div class="tb-group block-group">
    <button
      class="tb-btn"
      onclick={() => onAction("blockquote")}
      title="Blockquote"
      aria-label="Blockquote"
    >
      <Icon name="quote" size={14} />
    </button>
    <button
      class="tb-btn"
      onclick={() => onAction("ul")}
      title="Bullet list"
      aria-label="Unordered list"
    >
      <Icon name="list" size={14} />
    </button>
    <button
      class="tb-btn"
      onclick={() => onAction("ol")}
      title="Numbered list"
      aria-label="Ordered list"
    >
      <Icon name="list-ordered" size={14} />
    </button>

    <!-- Heading picker -->
    <div class="tb-popup-wrap">
      <button
        class="tb-btn tb-btn-split"
        onclick={() => openPopup(() => { headingOpen = !headingOpen; })}
        aria-haspopup="listbox"
        aria-expanded={headingOpen}
        title="Insert heading"
        aria-label="Insert heading"
      >
        <Icon name="heading" size={14} />
        <Icon name="chevron-down" size={10} />
      </button>
      {#if headingOpen}
        <div class="toolbar-popup heading-popup" role="listbox" aria-label="Heading level">
          {#each [1, 2, 3, 4] as level (level)}
            <button
              class="popup-item"
              role="option"
              aria-selected="false"
              onclick={() => pickHeading(level as 1 | 2 | 3 | 4)}
            >
              H{level}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <span class="tb-sep" aria-hidden="true"></span>

  <!-- Insert group: HR, page break, table, image -->
  <div class="tb-group insert-group">
    <button
      class="tb-btn"
      onclick={() => onAction("hr")}
      title="Horizontal rule"
      aria-label="Insert horizontal rule"
    >
      <Icon name="minus" size={14} />
    </button>
    <button
      class="tb-btn"
      onclick={() => onAction("page-break")}
      title="Page break (@page-break)"
      aria-label="Insert page break"
    >
      <Icon name="file-separator" size={14} />
    </button>

    <!-- Table column picker -->
    <div class="tb-popup-wrap">
      <button
        class="tb-btn tb-btn-split"
        onclick={() => openPopup(() => { tableOpen = !tableOpen; })}
        aria-haspopup="dialog"
        aria-expanded={tableOpen}
        title="Insert table"
        aria-label="Insert table"
      >
        <Icon name="table" size={14} />
        <Icon name="chevron-down" size={10} />
      </button>
      {#if tableOpen}
        <div class="toolbar-popup table-popup">
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
          <button class="popup-action" onclick={insertTable}>Insert table</button>
        </div>
      {/if}
    </div>

    <!-- Image insert (desktop only) -->
    {#if isDesktop()}
      <button
        class="tb-btn"
        onclick={openImageDialog}
        title="Insert image"
        aria-label="Insert image"
      >
        <Icon name="image" size={14} />
      </button>
    {/if}
  </div>

  <!-- "More" overflow button — CSS @container shows this at narrow widths only -->
  <div class="tb-more-wrap">
    <button
      class="tb-btn tb-more-btn"
      onclick={() => openPopup(() => { moreOpen = !moreOpen; })}
      aria-haspopup="menu"
      aria-expanded={moreOpen}
      title="More formatting options"
      aria-label="More formatting options"
    >
      <Icon name="more-horizontal" size={14} />
    </button>
    {#if moreOpen}
      <div class="toolbar-popup more-popup" role="menu">
        <button class="popup-item" role="menuitem" onclick={() => { onAction("bold"); moreOpen = false; }}>Bold</button>
        <button class="popup-item" role="menuitem" onclick={() => { onAction("italic"); moreOpen = false; }}>Italic</button>
        <button class="popup-item" role="menuitem" onclick={() => { onAction("strikethrough"); moreOpen = false; }}>Strikethrough</button>
        <button class="popup-item" role="menuitem" onclick={() => { onAction("code"); moreOpen = false; }}>Inline code</button>
        <button class="popup-item" role="menuitem" onclick={() => { onAction("link"); moreOpen = false; }}>Link</button>
        <hr class="popup-hr" />
        <button class="popup-item" role="menuitem" onclick={() => { onAction("blockquote"); moreOpen = false; }}>Blockquote</button>
        <button class="popup-item" role="menuitem" onclick={() => { onAction("ul"); moreOpen = false; }}>Bullet list</button>
        <button class="popup-item" role="menuitem" onclick={() => { onAction("ol"); moreOpen = false; }}>Numbered list</button>
        <button class="popup-item" role="menuitem" onclick={() => { pickHeading(1); moreOpen = false; }}>Heading 1</button>
        <button class="popup-item" role="menuitem" onclick={() => { pickHeading(2); moreOpen = false; }}>Heading 2</button>
        <button class="popup-item" role="menuitem" onclick={() => { pickHeading(3); moreOpen = false; }}>Heading 3</button>
        <button class="popup-item" role="menuitem" onclick={() => { pickHeading(4); moreOpen = false; }}>Heading 4</button>
        <hr class="popup-hr" />
        <button class="popup-item" role="menuitem" onclick={() => { onAction("hr"); moreOpen = false; }}>Horizontal rule</button>
        <button class="popup-item" role="menuitem" onclick={() => { onAction("page-break"); moreOpen = false; }}>Page break</button>
        <button class="popup-item" role="menuitem" onclick={() => { tableOpen = true; moreOpen = false; }}>Insert table…</button>
        {#if isDesktop()}
          <button class="popup-item" role="menuitem" onclick={(e) => { openImageDialog(e); moreOpen = false; }}>Insert image…</button>
        {/if}
      </div>
    {/if}
  </div>
</div>
{/if}

<!-- Image insert dialog (modal-style overlay, rendered outside the toolbar) -->
{#if imageOpen}
<div class="image-dialog-backdrop" role="none" onclick={cancelImage}></div>
<div
  bind:this={imageDialogEl}
  class="image-dialog"
  role="dialog"
  aria-modal="true"
  aria-label="Insert image"
  tabindex="-1"
  onkeydown={(e) => {
    if (e.key === "Escape") { cancelImage(); return; }
    imageTrapFocus(e);
  }}
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
      class="image-insert primary"
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
    background: var(--app-surface, #252526);
    border-bottom: 1px solid var(--app-border, rgba(255,255,255,0.08));
    flex-shrink: 0;
    /* width: 100% is required because container-type:inline-size prevents the
       default flex-child stretch from working — the container containment
       blocks the normal BFC width inheritance from the flex parent. */
    width: 100%;
    min-height: 32px;
    overflow: hidden;
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
    background: var(--app-border, rgba(255,255,255,0.12));
    margin: 0 3px;
    flex-shrink: 0;
  }

  /* ── Toolbar buttons ─────────────────────────────────────────────────────── */
  .tb-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    border: none;
    background: transparent;
    color: var(--app-text, #d8dee9);
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
    background: var(--app-control-hover-bg, rgba(255,255,255,0.1));
    color: var(--app-text, #d8dee9);
  }
  .tb-btn:focus-visible {
    outline: 2px solid var(--app-focus-ring, #3a6fb5);
    outline-offset: 2px;
  }
  .tb-btn:active {
    background: var(--app-control-active-bg, rgba(255,255,255,0.16));
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
    background: var(--app-surface, #2d2d2d);
    border: 1px solid var(--app-border, rgba(255,255,255,0.15));
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    z-index: 200;
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
    color: var(--app-text, #d8dee9);
    cursor: pointer;
  }
  .popup-item:hover {
    background: var(--app-control-hover-bg, rgba(255,255,255,0.1));
  }
  .popup-item:focus-visible {
    outline: 2px solid var(--app-focus-ring, #3a6fb5);
    outline-offset: 2px;
  }

  .popup-hr {
    border: none;
    border-top: 1px solid var(--app-border, rgba(255,255,255,0.1));
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

  .table-popup {
    min-width: 160px;
    padding: 8px;
    gap: 6px;
  }
  .popup-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    color: var(--app-text, #d8dee9);
    gap: 8px;
  }
  .popup-input {
    width: 56px;
    padding: 3px 6px;
    border: 1px solid var(--app-border, rgba(255,255,255,0.15));
    border-radius: 3px;
    background: var(--app-bg, #1e1e1e);
    color: var(--app-text, #d8dee9);
    font-size: 12px;
    text-align: right;
  }
  .popup-action {
    display: block;
    width: 100%;
    padding: 5px 8px;
    background: var(--app-accent, #4ea1ff);
    color: var(--app-accent-text, #ffffff);
    border: none;
    border-radius: 3px;
    font-size: 12px;
    cursor: pointer;
    text-align: center;
  }
  .popup-action:hover {
    opacity: 0.9;
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
    background: rgba(0, 0, 0, 0.45);
    z-index: 500;
  }

  .image-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 501;
    background: var(--app-surface, #252526);
    border: 1px solid var(--app-border, rgba(255,255,255,0.15));
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.6);
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
    color: var(--app-text, #d8dee9);
  }

  .image-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .image-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--app-text-faint, #9aa5b1);
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
    border: 1px solid var(--app-border, rgba(255,255,255,0.15));
    border-radius: 4px;
    background: var(--app-bg, #1e1e1e);
    color: var(--app-text, #d8dee9);
    font-size: 12px;
  }
  .image-input:focus {
    outline: 2px solid var(--app-accent, #4ea1ff);
    outline-offset: 1px;
  }
  .image-input[readonly] {
    cursor: default;
    color: var(--app-text-faint, #9aa5b1);
  }

  .image-pick-btn {
    padding: 6px 12px;
    border: 1px solid var(--app-border, rgba(255,255,255,0.15));
    border-radius: 4px;
    background: var(--app-control-bg, rgba(255,255,255,0.07));
    color: var(--app-text, #d8dee9);
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .image-pick-btn:hover {
    background: var(--app-control-hover-bg, rgba(255,255,255,0.13));
  }
  .image-pick-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .image-path-hint {
    margin: 0;
    font-size: 10px;
    color: var(--app-text-faint, #9aa5b1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .image-hint {
    margin: 0;
    font-size: 10px;
    color: var(--app-text-faint, #9aa5b1);
    line-height: 1.4;
  }

  .image-select {
    padding: 6px 8px;
    border: 1px solid var(--app-border, rgba(255,255,255,0.15));
    border-radius: 4px;
    background: var(--app-bg, #1e1e1e);
    color: var(--app-text, #d8dee9);
    font-size: 12px;
  }
  .image-select:focus {
    outline: 2px solid var(--app-accent, #4ea1ff);
  }

  .image-error {
    margin: 0;
    font-size: 12px;
    color: var(--app-error-text, #b42318);
  }

  .image-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }

  .image-cancel {
    padding: 7px 14px;
    border: 1px solid var(--app-border, rgba(255,255,255,0.15));
    border-radius: 4px;
    background: transparent;
    color: var(--app-text, #d8dee9);
    font-size: 12px;
    cursor: pointer;
  }
  .image-cancel:hover {
    background: var(--app-control-hover-bg, rgba(255,255,255,0.08));
  }

  .image-insert {
    padding: 7px 14px;
    border: none;
    border-radius: 4px;
    background: var(--app-accent, #4ea1ff);
    color: var(--app-accent-text, #ffffff);
    font-size: 12px;
    cursor: pointer;
    font-weight: 600;
  }
  .image-insert:hover:not(:disabled) {
    opacity: 0.9;
  }
  .image-insert:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  /* Theme tokens already handle light/dark via :root and :root[data-theme="dark"].
     The hand-rolled [data-theme="light"] override block was removed because all
     colour rules now reference app tokens — no hardcoded hex overrides needed. */
</style>
