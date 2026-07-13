/**
 * Source-level tests for AdvancedSetupDialog.svelte (M19 / L2 / M1 fixes).
 *
 * See NewProjectWizard.test.ts for why this is source-level analysis rather
 * than a mounted-component test (no Svelte/DOM harness in this repo's
 * bun:test setup).
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const COMPONENT_PATH = path.resolve(
  __dirname,
  "../../src/lib/components/AdvancedSetupDialog.svelte",
);

function readSource(): string {
  return fs.readFileSync(COMPONENT_PATH, "utf-8");
}

describe("AdvancedSetupDialog — M1/#42 dialog-system migration", () => {
  test("imports and wires the shared dialogBehavior action", () => {
    const src = readSource();
    expect(src).toMatch(/import\s*\{[^}]*dialogBehavior[^}]*\}\s*from\s*["']\$lib\/dialog["']/);
    expect(src).toMatch(/use:dialogBehavior=\{\{[^}]*onClose:\s*close/);
    expect(src).toMatch(/labelledBy:\s*["']advanced-setup-title["']/);
  });

  test("role='dialog'/aria-modal/trapFocus are NOT hand-declared (owned by the action)", () => {
    const src = readSource();
    expect(src).not.toContain('role="dialog"');
    expect(src).not.toContain('aria-modal="true"');
    expect(src).not.toContain("trapFocus");
    expect(src).not.toMatch(/svelte:window/);
  });

  test("uses the shared dlg-* shell classes", () => {
    const src = readSource();
    expect(src).toContain('class="dlg-backdrop"');
    expect(src).toContain('class="dlg-shell"');
    expect(src).toContain('@import "$lib/styles/dialog-shell.css"');
  });
});

describe("AdvancedSetupDialog — M19 mid-connect dismissal guard", () => {
  test("close is built from the shared guardedClose helper, keyed on `connecting`", () => {
    const src = readSource();
    expect(src).toMatch(/import\s*\{[^}]*guardedClose[^}]*\}\s*from\s*["']\$lib\/dialog["']/);
    expect(src).toMatch(/const close = guardedClose\(/);
    expect(src).toMatch(/\(\)\s*=>\s*connecting\)/);
  });

  test("the header close button is disabled while connecting", () => {
    const src = readSource();
    expect(src).toMatch(/class="dlg-close"[^>]*disabled=\{connecting\}/);
  });
});

describe("AdvancedSetupDialog — L2 inline Disconnect confirm", () => {
  test("imports the shared inline-confirm helpers", () => {
    const src = readSource();
    expect(src).toMatch(/import\s*\{[\s\S]*requestInlineConfirm[\s\S]*\}\s*from\s*["']\$lib\/dialog["']/);
    expect(src).toMatch(/import\s*\{[\s\S]*cancelInlineConfirm[\s\S]*\}\s*from\s*["']\$lib\/dialog["']/);
  });

  test("Disconnect click routes through requestDisconnect (arm-then-confirm), not a direct disconnect() call", () => {
    const src = readSource();
    expect(src).toMatch(/onclick=\{\(\)\s*=>\s*requestDisconnect\(conn\.host\)\}/);
    expect(src).toContain("function requestDisconnect(host: string)");
    expect(src).toMatch(/requestInlineConfirm\(confirmDisconnect, host\)/);
    expect(src).toMatch(/if\s*\(confirmed\)\s*void disconnect\(host\)/);
  });

  test("a Cancel button appears only while armed, and disarms via cancelInlineConfirm", () => {
    const src = readSource();
    expect(src).toMatch(/\{#if armed\}[\s\S]{0,200}cancelDisconnect/);
    expect(src).toMatch(/cancelInlineConfirm\(confirmDisconnect, host\)/);
  });

  test("the button label swaps to a 'Really disconnect?' confirm while armed", () => {
    const src = readSource();
    expect(src).toContain("Really disconnect?");
  });

  test("confirm state resets whenever the dialog re-opens", () => {
    const src = readSource();
    // onDialogMount is the per-open reset hook (mirrors diag/testResult/etc.)
    const mountFn = src.slice(
      src.indexOf("function onDialogMount"),
      src.indexOf("function onServerInput"),
    );
    expect(mountFn).toContain("confirmDisconnect = {}");
  });
});

describe("AdvancedSetupDialog — border-color cascade fix (FIX ROUND 1 regression guard)", () => {
  // The local `.dlg-primary, .dlg-ghost { ... }` block (needed because these
  // standalone buttons — Test remote access / Disconnect — live outside a
  // `.dlg-actions` footer) used to restate `border: 1px solid transparent`.
  // Svelte's scope hash raises that selector to two classes (0,2,0), which
  // always outranked the shared sheet's `.dlg-ghost` (0,1,0) AND
  // `.dlg-danger-armed` (0,1,0) border-color — losing the standalone ghosts'
  // visible border AND the armed "Really disconnect?" button's red border.
  test("the local .dlg-primary/.dlg-ghost sizing rule does not restate a color-bearing border", () => {
    const src = readSource();
    const start = src.indexOf(".dlg-primary,\n  .dlg-ghost {");
    expect(start).toBeGreaterThanOrEqual(0);
    const open = src.indexOf("{", start);
    const close = src.indexOf("}", open);
    const body = src.slice(open + 1, close);
    expect(body).not.toMatch(/\bborder\s*:/);
    expect(body).not.toMatch(/\bborder-color\s*:/);
    // Width/style are still expected locally (this rule supplies the base
    // sizing `.dlg-actions button` would otherwise provide).
    expect(body).toMatch(/border-width\s*:\s*1px/);
    expect(body).toMatch(/border-style\s*:\s*solid/);
  });
});
