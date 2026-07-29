<script lang="ts">
  /**
   * ExportDialog — the toolbar Export button's modal. One place to choose the
   * export format and adjust its settings before running:
   *
   *   - PDF (desktop only): print-ready PDF via the host build pipeline, with
   *     an optional print-safety validation pass. The destination is chosen in
   *     the native save dialog after confirming.
   *   - HTML: a standalone book.html (the only format on the web target).
   *   - Template: capture this project as a reusable starter template
   *     (formerly the toolbar overflow menu's "Save as template…").
   *
   * Mounted fresh per open ({#if exportOpen} in +page.svelte) so state resets;
   * dialogBehavior owns ARIA/Escape/focus-trap/restore. PWA-clean (§8):
   * api.* + platform predicates only.
   */
  import Icon from "$lib/components/Icon.svelte";
  import { api } from "$lib/api";
  import { isDesktop } from "$lib/platform";
  import { dialogBehavior } from "$lib/dialog";
  import type { ToastController } from "$lib/components/Toast.svelte";

  let {
    projectDir,
    canSavePdf,
    toast = null,
    triggerEl,
    onExportPdf,
    onExportHtml,
    onClose,
  }: {
    projectDir: string | null;
    /** PDF export is host-side (printToPDF); false on the web target. */
    canSavePdf: boolean;
    toast?: ToastController | null;
    /** The toolbar Export button, for focus restore on close. */
    triggerEl?: HTMLButtonElement | undefined;
    /** Run the PDF export (the native save dialog picks the destination). */
    onExportPdf: (opts: { validate: boolean }) => void;
    /** Run the standalone-HTML export. */
    onExportHtml: () => void;
    onClose: () => void;
  } = $props();

  type ExportFormat = "pdf" | "html" | "template";
  // Mounted fresh per open ({#if exportOpen}) — capturing the props' INITIAL
  // values here is the point: availability can't change while the dialog is up.
  // svelte-ignore state_referenced_locally
  const showTemplate = isDesktop() && !!projectDir;
  // svelte-ignore state_referenced_locally
  let format = $state<ExportFormat>(canSavePdf ? "pdf" : "html");
  let validate = $state(false);
  let templateName = $state("");
  let templateBusy = $state(false);
  let templateError = $state<string | null>(null);

  function close() {
    if (templateBusy) return;
    onClose();
  }

  const confirmLabel = $derived(
    format === "pdf" ? "Export PDF…" : format === "html" ? "Export HTML" : templateBusy ? "Saving…" : "Save template",
  );

  async function confirm() {
    if (format === "pdf") {
      onExportPdf({ validate });
      onClose();
      return;
    }
    if (format === "html") {
      onExportHtml();
      onClose();
      return;
    }
    // Template
    if (!projectDir) return;
    if (!templateName.trim()) {
      templateError = "Give your template a name.";
      return;
    }
    templateBusy = true;
    templateError = null;
    try {
      const tpl = await api.tpl.saveAsTemplate({ projectDir, name: templateName.trim() });
      toast?.success(`Saved “${tpl.label}” as a template.`);
      onClose();
    } catch (e) {
      templateError = e instanceof Error ? e.message : String(e);
    } finally {
      templateBusy = false;
    }
  }
</script>

<div class="dlg-backdrop" onclick={close} role="presentation"></div>
<div
  class="dlg-shell export-dialog"
  use:dialogBehavior={{ onClose: close, triggerEl, labelledBy: "export-dialog-title" }}
>
  <header class="dlg-header">
    <h2 id="export-dialog-title"><Icon name="file-down" size={15} /> Export</h2>
    <button class="dlg-close" onclick={close} title="Close (Esc)" aria-label="Close"><Icon name="x" size={14} /></button>
  </header>

  <div class="dlg-body">
    <fieldset class="formats">
      <legend class="formats-legend">Format</legend>
      {#if canSavePdf}
        <label class="format" class:selected={format === "pdf"}>
          <input type="radio" name="export-format" value="pdf" bind:group={format} />
          <span class="format-info">
            <span class="format-title">PDF</span>
            <span class="format-desc">Print-ready PDF using your project's page settings. You'll choose where to save it next. (Ctrl+Shift+E exports directly.)</span>
          </span>
        </label>
      {/if}
      <label class="format" class:selected={format === "html"}>
        <input type="radio" name="export-format" value="html" bind:group={format} />
        <span class="format-info">
          <span class="format-title">HTML</span>
          <span class="format-desc">A single standalone book.html you can share or host anywhere.</span>
        </span>
      </label>
      {#if showTemplate}
        <label class="format" class:selected={format === "template"}>
          <input type="radio" name="export-format" value="template" bind:group={format} />
          <span class="format-info">
            <span class="format-title">Template</span>
            <span class="format-desc">Save this project as a reusable starter for new books.</span>
          </span>
        </label>
      {/if}
      {#if !canSavePdf}
        <p class="format-note" role="note">PDF export requires the desktop app.</p>
      {/if}
    </fieldset>

    {#if format === "pdf"}
      <label class="setting">
        <input type="checkbox" bind:checked={validate} />
        <span class="setting-info">
          <span class="setting-title">Run print-safety validation</span>
          <span class="setting-desc">Checks the output before and after the build. Slower, but catches print problems early.</span>
        </span>
      </label>
    {/if}

    {#if format === "template"}
      <label class="setting setting-col">
        <span class="setting-title">Template name</span>
        <input class="tpl-name" type="text" bind:value={templateName} placeholder="My starter book" disabled={templateBusy} />
      </label>
      {#if templateError}
        <p class="tpl-error" role="alert">{templateError}</p>
      {/if}
    {/if}
  </div>

  <footer class="dlg-actions">
    <button class="dlg-ghost" onclick={close} disabled={templateBusy}>Cancel</button>
    <button class="dlg-primary app-btn-primary" onclick={confirm} disabled={templateBusy}>{confirmLabel}</button>
  </footer>
</div>

<style>
  @import "$lib/styles/dialog-shell.css";

  .export-dialog { width: min(460px, 94vw); }
  .dlg-body { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; }

  .formats { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .formats-legend {
    padding: 0 0 4px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--app-text-muted);
  }
  .format {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 9px 11px;
    border: 1px solid var(--app-border);
    border-radius: 7px;
    cursor: pointer;
  }
  .format:hover { background: var(--app-surface-hover); }
  .format.selected { border-color: var(--app-accent-border); background: var(--app-accent-subtle); }
  .format input { margin-top: 2px; flex-shrink: 0; }
  .format-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .format-title { font-size: 13px; font-weight: 600; color: var(--app-text); }
  .format-desc { font-size: 11.5px; line-height: 1.4; color: var(--app-text-muted); }
  .format-note { margin: 2px 0 0; font-size: 11px; color: var(--app-text-muted); }

  .setting { display: flex; align-items: flex-start; gap: 10px; padding: 2px 1px; cursor: pointer; }
  .setting input[type="checkbox"] { margin-top: 2px; flex-shrink: 0; }
  .setting-info { display: flex; flex-direction: column; gap: 2px; }
  .setting-title { font-size: 12.5px; font-weight: 500; color: var(--app-text-secondary); }
  .setting-desc { font-size: 11px; line-height: 1.4; color: var(--app-text-muted); }
  .setting-col { flex-direction: column; gap: 6px; cursor: default; }
  .tpl-name {
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-border);
    color: var(--app-text-secondary);
    padding: 7px 10px;
    border-radius: 6px;
    font-size: 13px;
    width: 100%;
    box-sizing: border-box;
  }
  .tpl-name:focus { outline: none; border-color: var(--app-focus-ring); }
  .tpl-error { margin: 0; color: var(--app-error-text); font-size: 12px; }
</style>
