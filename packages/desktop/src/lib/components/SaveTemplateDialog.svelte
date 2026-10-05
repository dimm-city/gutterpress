<script lang="ts">
  /**
   * SaveTemplateDialog — capture the open book as a reusable starter template
   * (Book setup → Details → "Save as template…"). Formerly a format of the
   * toolbar's Export dialog, which was folded into the Publish wizard; a
   * template is a book-setup action, not a publishing destination, so it
   * lives with the book's details now.
   *
   * Mounted fresh per open ({#if} in ProjectSettingsView) so state resets;
   * dialogBehavior owns ARIA/Escape/focus-trap/restore. PWA-clean (§8):
   * api.* only.
   */
  import Icon from "$lib/components/Icon.svelte";
  import { api } from "$lib/api";
  import { dialogBehavior } from "$lib/dialog";
  import type { ToastController } from "$lib/components/Toast.svelte";

  let {
    projectDir,
    toast = null,
    triggerEl,
    onClose,
  }: {
    projectDir: string;
    toast?: ToastController | null;
    /** The button that opened the dialog, for focus restore on close. */
    triggerEl?: HTMLButtonElement | undefined;
    onClose: () => void;
  } = $props();

  let templateName = $state("");
  let templateBusy = $state(false);
  let templateError = $state<string | null>(null);
  // A book nested in a multi-book repo references shared design with
  // `../../shared/...` paths. Copied verbatim they'd dangle wherever the
  // template is later scaffolded, so by default the save copies those files in
  // (keeps the look). Unchecking leaves them out — a book-local-only template.
  let includeShared = $state(true);

  function close() {
    if (templateBusy) return;
    onClose();
  }

  async function confirm() {
    if (!templateName.trim()) {
      templateError = "Give your template a name.";
      return;
    }
    templateBusy = true;
    templateError = null;
    try {
      const tpl = await api.tpl.saveAsTemplate({
        projectDir,
        name: templateName.trim(),
        sharedRefs: includeShared ? "vendor" : "exclude",
      });
      const vendored = tpl.vendoredRefs?.length ?? 0;
      const excluded = tpl.excludedRefs?.length ?? 0;
      const note =
        vendored > 0
          ? ` Copied in ${vendored} shared file${vendored === 1 ? "" : "s"}.`
          : excluded > 0
            ? ` Left out ${excluded} shared reference${excluded === 1 ? "" : "s"}.`
            : "";
      toast?.success(`Saved “${tpl.label}” as a template.${note}`);
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
  class="dlg-shell template-dialog"
  use:dialogBehavior={{ onClose: close, triggerEl, labelledBy: "save-template-title" }}
>
  <header class="dlg-header">
    <h2 id="save-template-title"><Icon name="files" size={15} /> Save as template</h2>
    <button class="dlg-close" onclick={close} title="Close (Esc)" aria-label="Close"><Icon name="x" size={14} /></button>
  </header>

  <div class="dlg-body">
    <p class="lead">Save this book as a reusable starter for new books.</p>
    <label class="setting setting-col">
      <span class="setting-title">Template name</span>
      <input class="tpl-name" type="text" bind:value={templateName} placeholder="My starter book" disabled={templateBusy} />
    </label>
    <label class="setting">
      <input type="checkbox" bind:checked={includeShared} disabled={templateBusy} />
      <span class="setting-info">
        <span class="setting-title">Include shared styles &amp; plugins</span>
        <span class="setting-desc">Copies any shared design this book references into the template, so it looks the same wherever it's reused. Uncheck for a book-only template.</span>
      </span>
    </label>
    {#if templateError}
      <p class="tpl-error" role="alert">{templateError}</p>
    {/if}
  </div>

  <footer class="dlg-actions">
    <button class="dlg-ghost" onclick={close} disabled={templateBusy}>Cancel</button>
    <button class="dlg-primary app-btn-primary" onclick={confirm} disabled={templateBusy}>{templateBusy ? "Saving…" : "Save template"}</button>
  </footer>
</div>

<style>
  @import "$lib/styles/dialog-shell.css";

  .template-dialog { width: min(460px, 94vw); }
  .dlg-body { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; }
  .lead { margin: 0; font-size: 13px; color: var(--app-text-muted); }

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
