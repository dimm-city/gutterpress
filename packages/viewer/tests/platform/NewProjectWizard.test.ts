/**
 * Source-level tests for NewProjectWizard.svelte (M19 / M21 / M1 fixes).
 *
 * Svelte component templates lack a mount/DOM test harness in this repo's
 * bun:test setup (no JSDOM/Svelte-compile harness is wired up) — these tests
 * follow the established project convention (RecoveryConfirmDialog.test.ts,
 * CrashRecoveryDialog.test.ts, ConflictChoicesDialog.preview.test.ts, …) of
 * asserting the source contains the required wiring, rather than exercising
 * a live component.
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const COMPONENT_PATH = path.resolve(
  __dirname,
  "../../src/lib/components/NewProjectWizard.svelte",
);

function readSource(): string {
  return fs.readFileSync(COMPONENT_PATH, "utf-8");
}

describe("NewProjectWizard — M1/#42 dialog-system migration", () => {
  test("imports and wires the shared dialogBehavior action", () => {
    const src = readSource();
    expect(src).toMatch(/import\s*\{[^}]*dialogBehavior[^}]*\}\s*from\s*["']\$lib\/dialog["']/);
    expect(src).toMatch(/use:dialogBehavior=\{\{[^}]*onClose:\s*close/);
    expect(src).toMatch(/labelledBy:\s*["']new-project-title["']/);
  });

  test("role='dialog'/aria-modal/trapFocus are NOT hand-declared (owned by the action)", () => {
    const src = readSource();
    expect(src).not.toContain('role="dialog"');
    expect(src).not.toContain('aria-modal="true"');
    expect(src).not.toContain("trapFocus");
    expect(src).not.toMatch(/svelte:window/);
  });

  test("uses the shared dlg-* shell classes, not a local backdrop/dialog/actions block", () => {
    const src = readSource();
    expect(src).toContain('class="dlg-backdrop"');
    expect(src).toContain('class="dlg-shell"');
    expect(src).toContain('@import "$lib/styles/dialog-shell.css"');
  });
});

describe("NewProjectWizard — M19 mid-create dismissal guard", () => {
  test("close is built from the shared guardedClose helper, keyed on `creating`", () => {
    const src = readSource();
    expect(src).toMatch(/import\s*\{[^}]*guardedClose[^}]*\}\s*from\s*["']\$lib\/dialog["']/);
    expect(src).toMatch(/const close = guardedClose\(/);
    expect(src).toMatch(/\(\)\s*=>\s*creating\)/);
  });

  test("the header close button and footer Cancel button are disabled while creating", () => {
    const src = readSource();
    expect(src).toMatch(/class="dlg-close"[^>]*disabled=\{creating\}/);
    expect(src).toMatch(/class="dlg-ghost"\s+onclick=\{close\}\s+disabled=\{creating\}/);
  });

  test("create() clears `creating` before calling close() on success, so the guard doesn't swallow it", () => {
    const src = readSource();
    const createFn = src.slice(src.indexOf("async function create("), src.indexOf("friendlyCreateError"));
    // creating = false must appear BEFORE the close() call in the success path.
    const creatingFalseIdx = createFn.indexOf("creating = false;");
    const closeCallIdx = createFn.indexOf("close();");
    expect(creatingFalseIdx).toBeGreaterThan(-1);
    expect(closeCallIdx).toBeGreaterThan(-1);
    expect(creatingFalseIdx).toBeLessThan(closeCallIdx);
  });
});

describe("NewProjectWizard — M21 default parentDir", () => {
  test("show() loads a default parentDir instead of leaving it null", () => {
    const src = readSource();
    expect(src).toMatch(/export function show\([\s\S]{0,300}void loadDefaultParentDir\(\)/);
  });

  test("loadDefaultParentDir prefers the persisted newProjectParentDir pref", () => {
    const src = readSource();
    expect(src).toContain("api.app.getViewerPrefs()");
    expect(src).toContain("newProjectParentDir");
  });

  test("loadDefaultParentDir falls back to the parent of lastProjectDir", () => {
    const src = readSource();
    expect(src).toContain("lastProjectDir");
    expect(src).toMatch(/parentDirOf\(lastProjectDir\)/);
  });

  test("loadDefaultParentDir never clobbers a folder the writer already chose", () => {
    const src = readSource();
    const fn = src.slice(
      src.indexOf("async function loadDefaultParentDir"),
      src.indexOf("/** Open the wizard"),
    );
    expect(fn).toMatch(/if\s*\(parentDir\)\s*return;/);
  });

  test("create() persists the chosen parentDir as the new default for next time", () => {
    const src = readSource();
    expect(src).toMatch(/setViewerPrefs\(\{\s*newProjectParentDir:\s*parentDir\s*\}\)/);
  });

  test("the folder button reads 'Change…' once a default is prefilled, 'Choose folder…' otherwise", () => {
    const src = readSource();
    expect(src).toContain('{parentDir ? "Change…" : "Choose folder…"}');
  });

  test("canCreate still requires only the title once a folder is prefilled (parentDir + name)", () => {
    const src = readSource();
    expect(src).toMatch(/canCreate\s*=\s*\$derived\(nameValid\s*&&\s*!!parentDir\s*&&\s*!creating\)/);
  });
});
