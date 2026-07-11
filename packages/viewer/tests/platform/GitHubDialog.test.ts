/**
 * Source-level tests for GitHubDialog.svelte (L11 / M1 fixes).
 *
 * See NewProjectWizard.test.ts for why this is source-level analysis rather
 * than a mounted-component test.
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const COMPONENT_PATH = path.resolve(
  __dirname,
  "../../src/lib/components/GitHubDialog.svelte",
);

function readSource(): string {
  return fs.readFileSync(COMPONENT_PATH, "utf-8");
}

describe("GitHubDialog — M1/#42 dialog-system migration", () => {
  test("imports and wires the shared dialogBehavior action", () => {
    const src = readSource();
    expect(src).toMatch(/import\s*\{[^}]*dialogBehavior[^}]*\}\s*from\s*["']\$lib\/dialog["']/);
    expect(src).toMatch(/use:dialogBehavior=\{\{[^}]*onClose:\s*close/);
    expect(src).toMatch(/labelledBy:\s*["']github-dialog-title["']/);
  });

  test("role='dialog'/aria-modal/trapFocus are NOT hand-declared (owned by the action)", () => {
    const src = readSource();
    expect(src).not.toContain('role="dialog"');
    expect(src).not.toContain('aria-modal="true"');
    expect(src).not.toContain("trapFocus");
    expect(src).not.toMatch(/svelte:window/);
  });

  test("the existing closeBlocked mid-clone guard survives the migration unchanged", () => {
    const src = readSource();
    expect(src).toMatch(/if\s*\(step === "cloning"\)\s*\{\s*closeBlocked = true;\s*return;\s*\}/);
  });

  test("uses the shared dlg-* shell classes", () => {
    const src = readSource();
    expect(src).toContain('class="dlg-backdrop"');
    expect(src).toContain('class="dlg-shell"');
    expect(src).toContain('@import "$lib/styles/dialog-shell.css"');
  });
});

describe("GitHubDialog — L11 scrub the IPC transport prefix on both bridged paths", () => {
  test("imports friendlyHostError from $lib/errors", () => {
    const src = readSource();
    expect(src).toMatch(/import\s*\{\s*friendlyHostError\s*\}\s*from\s*["']\$lib\/errors["']/);
  });

  test("connect()'s catch scrubs the error through friendlyHostError before setting `error`", () => {
    const src = readSource();
    const fn = src.slice(src.indexOf("async function connect("), src.indexOf("async function loadRepos("));
    expect(fn).toMatch(/error = friendlyHostError\(/);
    // Must not fall back to the raw, unscrubbed message on this path.
    expect(fn).not.toMatch(/error = e instanceof Error \? e\.message : String\(e\);/);
  });

  test("startClone()'s catch scrubs the error through friendlyHostError before setting `error`", () => {
    const src = readSource();
    const fn = src.slice(src.indexOf("async function startClone("), src.indexOf("async function disconnect("));
    expect(fn).toMatch(/error = friendlyHostError\(/);
    expect(fn).not.toMatch(/error = e instanceof Error \? e\.message : String\(e\);/);
  });
});
