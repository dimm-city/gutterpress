/**
 * Source-level tests for ExportDialog.svelte — the toolbar Export button's
 * modal (choose PDF / HTML / template + adjust settings), which absorbed the
 * old More-menu "Save as template…" prompt.
 *
 * Same source-assertion convention as the other component tests (no Svelte
 * mount harness in this repo's bun:test setup).
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf-8");
const dialog = () => read("src/lib/components/ExportDialog.svelte");
const page = () => read("src/routes/+page.svelte");

describe("ExportDialog — formats and settings", () => {
  test("uses the shared dialog shell + behavior action", () => {
    const src = dialog();
    expect(src).toContain('class="dlg-backdrop"');
    expect(src).toMatch(/use:dialogBehavior=\{\{\s*onClose:\s*close/);
    expect(src).toMatch(/import\s*\{[^}]*dialogBehavior[^}]*\}\s*from\s*["']\$lib\/dialog["']/);
  });

  test("offers PDF (desktop only), HTML, and template formats", () => {
    const src = dialog();
    expect(src).toMatch(/\{#if canSavePdf\}[\s\S]{0,400}?value="pdf"/);
    expect(src).toMatch(/value="html"/);
    expect(src).toMatch(/value="template"/);
    // The web target explains the missing PDF option.
    expect(src).toContain("PDF export requires the desktop app");
  });

  test("PDF exposes the print-safety validation setting and threads it into the export", () => {
    const src = dialog();
    expect(src).toMatch(/bind:checked=\{validate\}/);
    expect(src).toMatch(/onExportPdf\(\{ validate \}\)/);
    // The controller accepts and forwards the option to the host build.
    const ctrl = read("src/lib/export/export-controller.svelte.ts");
    expect(ctrl).toMatch(/savePdf\(opts\?: \{ validate\?: boolean \}\)/);
    expect(ctrl).toMatch(/\{ validate: opts\?\.validate \?\? false \}/);
    expect(page()).toMatch(/skipPreValidate: !opts\?\.validate/);
  });

  test("the template format saves via api.tpl.saveAsTemplate with a validated name", () => {
    const src = dialog();
    expect(src).toContain("api.tpl.saveAsTemplate");
    expect(src).toContain("Give your template a name.");
  });

  test("+page mounts it fresh per open, wired to the toolbar Export button", () => {
    const src = page();
    expect(src).toContain('import ExportDialog from "$lib/components/ExportDialog.svelte"');
    expect(src).toMatch(/\{#if exportOpen\}[\s\S]{0,600}?<ExportDialog/);
    expect(src).toMatch(/onOpenExport=\{\(\) => \(exportOpen = true\)\}/);
    expect(src).toMatch(/triggerEl=\{exportBtnEl\}/);
    // The old standalone save-as-template prompt is gone.
    expect(src).not.toContain("saveTemplateOpen");
    expect(src).not.toContain("save-tpl-dialog");
  });

  test("PWA-clean (§8): no host/Node value imports", () => {
    const src = dialog();
    expect(src).not.toMatch(/from\s+["']node:/);
    expect(src).not.toMatch(/import\s+\{[^}]*\}\s+from\s+["']@dimm-city\/print-md["']/);
    expect(src).not.toContain("window.electron");
  });
});

describe("relocations around the export dialog", () => {
  test("advanced setup is consolidated into Settings → Connections and every old opener routes there", () => {
    const settings = read("src/lib/components/SettingsView.svelte");
    expect(settings).toMatch(/initialTab\?:/);
    // The former AdvancedSetupDialog content lives inside ConnectionsSettings
    // now (see settings-connections.test.ts for the consolidation contract).
    expect(settings).toContain("<ConnectionsSettings {projectDir} />");
    const p = page();
    expect(p).not.toContain("advancedSetupOpen");
    expect(p).toMatch(/openSettings\("connections"\)/);
  });

  test("the Electron window title mirrors the toolbar document identity", () => {
    const p = page();
    const headIdx = p.indexOf("<svelte:head>");
    expect(headIdx).toBeGreaterThan(-1);
    const head = p.slice(headIdx, p.indexOf("</svelte:head>"));
    expect(head).toContain("<title>");
    expect(head).toContain("displayTitle");
    expect(head).toContain("lifecycle.docTitle");
  });
});
