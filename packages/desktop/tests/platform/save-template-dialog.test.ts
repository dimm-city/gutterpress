/**
 * Source-level tests for SaveTemplateDialog.svelte — "Save as template…" in
 * Book setup → Details. It used to be a format of the toolbar's Export
 * dialog; that dialog was folded into the Publish wizard, and a template is
 * a book-setup action rather than a destination, so it moved here.
 *
 * Same source-assertion convention as the other component tests (no Svelte
 * mount harness in this repo's bun:test setup).
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf-8");
const dialog = () => read("src/lib/components/SaveTemplateDialog.svelte");

describe("SaveTemplateDialog", () => {
  test("uses the shared dialog shell + behavior action", () => {
    const src = dialog();
    expect(src).toContain('class="dlg-backdrop"');
    expect(src).toMatch(/use:dialogBehavior=\{\{\s*onClose:\s*close/);
    expect(src).toMatch(/import\s*\{[^}]*dialogBehavior[^}]*\}\s*from\s*["']\$lib\/dialog["']/);
  });

  test("saves via api.tpl.saveAsTemplate with a validated name", () => {
    const src = dialog();
    expect(src).toContain("api.tpl.saveAsTemplate");
    expect(src).toContain("Give your template a name.");
  });

  test("offers a shared-refs opt-out wired to sharedRefs (vendor by default)", () => {
    const src = dialog();
    expect(src).toContain("Include shared styles");
    expect(src).toMatch(/sharedRefs:\s*includeShared\s*\?\s*"vendor"\s*:\s*"exclude"/);
    expect(src).toMatch(/let includeShared = \$state\(true\)/);
  });

  test("opens from Book setup → Details, mounted fresh per open with focus restore", () => {
    const view = read("src/lib/components/ProjectSettingsView.svelte");
    expect(view).toContain('import SaveTemplateDialog from "$lib/components/SaveTemplateDialog.svelte"');
    expect(view).toMatch(/\{#if templateDialogTrigger && projectDir\}[\s\S]{0,200}?<SaveTemplateDialog/);
    expect(view).toContain("triggerEl={templateDialogTrigger}");
    const details = read("src/lib/components/config/DetailsSection.svelte");
    expect(details).toContain("Save as template…");
    expect(details).toMatch(/onSaveAsTemplate\?\.\(e\.currentTarget as HTMLButtonElement\)/);
    // No export dialog, no toolbar entry point remain.
    expect(fs.existsSync(path.join(root, "src/lib/components/ExportDialog.svelte"))).toBe(false);
    const page = read("src/routes/+page.svelte");
    expect(page).not.toContain("ExportDialog");
    expect(page).not.toContain("exportOpen");
  });

  test("PWA-clean (§8): no host/Node value imports", () => {
    const src = dialog();
    expect(src).not.toMatch(/from\s+["']node:/);
    expect(src).not.toMatch(/import\s+\{[^}]*\}\s+from\s+["']@dimm-city\/gutterpress["']/);
    expect(src).not.toContain("window.electron");
  });
});
