/**
 * Regression guard for the M1/#42 dialog-system consolidation.
 *
 * UX review M1 (confirmed) / ARCH #42: 10 dialogs each hand-rolled the same
 * ~100-150 line `.backdrop`/`.dialog`/`.dialog-header`/`.close`/`.sr-only`/
 * `.actions`/`.primary`/`.ghost` CSS block AND (for 6 of them) their own
 * ARIA/focus-trap/Escape wiring instead of the shared `dialogBehavior`
 * action. This test asserts the migration is complete and stays complete:
 * every dialog pulls the shared stylesheet, none hand-declares role/
 * aria-modal, and none imports the (now dialog-migration-obsolete) trapFocus
 * for its own top-level wiring.
 *
 * Source-level analysis — see NewProjectWizard.test.ts for why (no Svelte/
 * DOM mount harness in this repo's bun:test setup).
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const COMPONENTS_DIR = path.resolve(__dirname, "../../src/lib/components");
const SHARED_CSS_PATH = path.resolve(__dirname, "../../src/lib/styles/dialog-shell.css");

const DIALOGS = [
  "NewProjectWizard",
  "GitHubDialog",
  "ImageClashPicker",
  "SnippetPicker",
  "OperationLogDialog",
];

function readDialog(name: string): string {
  return fs.readFileSync(path.join(COMPONENTS_DIR, `${name}.svelte`), "utf-8");
}

describe("dialog-shell.css — shared stylesheet exists and is namespaced", () => {
  test("the shared stylesheet file exists", () => {
    expect(fs.existsSync(SHARED_CSS_PATH)).toBe(true);
  });

  test("every class it defines is dlg-* namespaced (never a bare generic name)", () => {
    const css = fs.readFileSync(SHARED_CSS_PATH, "utf-8");
    // Strip comments so a prose mention of ".primary" in a /* ... */ block
    // (explaining what this replaces) doesn't trip the scan.
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const classNames = [...withoutComments.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]!);
    expect(classNames.length).toBeGreaterThan(0);
    // "small" is a modifier used ONLY compounded onto .dlg-ghost/.dlg-primary
    // (e.g. `.dlg-ghost.small`) — collision-safe by construction, since a
    // rule requiring BOTH classes can't match an unrelated element that only
    // has one of them. Everything else must be dlg-* namespaced.
    const ALLOWED_MODIFIERS = new Set(["small"]);
    const nonNamespaced = classNames.filter(
      (c) => !c.startsWith("dlg-") && !ALLOWED_MODIFIERS.has(c),
    );
    expect(nonNamespaced).toEqual([]);
  });
});

describe.each(DIALOGS)("%s — M1/#42 dialog-system migration", (name) => {
  test("imports the shared shell stylesheet", () => {
    const src = readDialog(name);
    expect(src).toContain('@import "$lib/styles/dialog-shell.css"');
  });

  test("uses the dlg-backdrop / dlg-shell shared classes, not the old bare names", () => {
    const src = readDialog(name);
    expect(src).toContain('class="dlg-backdrop"');
    expect(src).toContain('class="dlg-shell"');
    expect(src).not.toContain('class="backdrop"');
    expect(src).not.toMatch(/class="dialog"(?!\S)/);
  });

  test("does not hand-declare role=\"dialog\" / aria-modal=\"true\" (owned by dialogBehavior)", () => {
    const src = readDialog(name);
    expect(src).not.toContain('role="dialog"');
    expect(src).not.toContain('aria-modal="true"');
  });

  test("wires the shared dialogBehavior action", () => {
    const src = readDialog(name);
    expect(src).toMatch(/import\s*\{[^}]*dialogBehavior[^}]*\}\s*from\s*["']\$lib\/dialog["']/);
    expect(src).toMatch(/use:dialogBehavior=/);
  });

  test("does not import trapFocus for its own top-level dialog wiring", () => {
    const src = readDialog(name);
    expect(src).not.toMatch(/import\s*\{\s*trapFocus\s*\}\s*from\s*["']\$lib\/a11y["']/);
  });

  test("does not hand-roll an Escape svelte:window handler (dialogBehavior owns Escape)", () => {
    const src = readDialog(name);
    expect(src).not.toMatch(/<svelte:window[\s\S]{0,120}Escape/);
  });
});
