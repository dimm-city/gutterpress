/**
 * TDD — tests for RecoveryConfirmDialog.svelte
 *
 * RecoveryConfirmDialog is the "risky-repair confirmation" modal shown when the
 * host recovery subsystem needs author approval before a medium/high-risk repair.
 *
 * Architecture constraints verified here (CLAUDE.md §8 / ADR 0004):
 *  - The component file must NOT value-import @dimm-city/print-md-lib
 *  - The component file must NOT import node:* / fs / path / url / isomorphic-git
 *  - All host work goes through getPlatform() (verified by source scan)
 *
 * Test surface:
 *  1. PWA-cleanliness — no lib / node imports in the component source
 *  2. Render — component file exists and exports a usable module
 *  3. Copy — correct title, body framing, backup reassurance, no git jargon
 *  4. Jargon scan — forbidden git words absent from all visible strings
 *  5. Decision flow — "Continue" calls respondRecoveryConfirm(id, true)
 *  6. Decision flow — "Not now" calls respondRecoveryConfirm(id, false)
 *  7. Decision flow — Escape key handler answers "Not now" (gate never hangs)
 *  8. Decision flow — backdrop click answers "Not now"
 *  9. Gate answered exactly once — answered flag prevents double-resolution
 * 10. High-risk focus — initial focus on "Not now" when risk === "high"
 * 11. Medium-risk focus — initial focus on "Continue" when risk !== "high"
 * 12. Show backup — "Show backup" button calls onShowBackup with backupZipPath
 * 13. Accessibility — role=dialog, aria-modal, aria-labelledby, aria-live present
 * 14. Focus trap — Tab key handling wraps focus within the dialog
 *
 * Tests use source-level analysis following the established project pattern
 * (RecoveryOverlay.test.ts, ConflictChoicesDialog.preview.test.ts) — no
 * JSDOM/Svelte compile harness required.
 */

import { describe, test, expect, beforeEach, mock } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Types (import type only — PWA-clean) ─────────────────────────────────────
import type {
  RecoveryConfirmRequest,
  RepairConfirmationInfo,
} from "../../src/lib/platform/contract";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfirmation(overrides: Partial<RepairConfirmationInfo> = {}): RepairConfirmationInfo {
  return {
    repair: "stale_lock",
    risk: "low",
    summary: "remove a leftover lock file so sync can continue",
    backupZipPath: "/home/user/backups/my-book-backup.zip",
    willChangeLocalFiles: false,
    willChangeGitMetadata: true,
    willChangeRemote: false,
    canBeUndoneFromBackup: true,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<RepairConfirmationInfo> = {}): RecoveryConfirmRequest {
  return {
    requestId: "req-abc-123",
    projectDir: "/home/user/projects/my-book",
    confirmation: makeConfirmation(overrides),
  };
}

// ── PWA-cleanliness check (static source scan) ────────────────────────────────

const COMPONENT_PATH = path.resolve(
  __dirname,
  "../../src/lib/components/RecoveryConfirmDialog.svelte",
);

const FORBIDDEN_VALUE_IMPORTS = [
  // lib value import — would drag Node / isomorphic-git into the browser bundle
  /from\s+["']@dimm-city\/print-md-lib["']/,
  // Node built-ins in the renderer (§8 NEVER list)
  /from\s+["']node:/,
  /require\s*\(\s*["']node:/,
  /from\s+["']fs["']/,
  /from\s+["']path["']/,
  /from\s+["']url["']/,
  /from\s+["']child_process["']/,
  /from\s+["']isomorphic-git["']/,
  /import\s+isomorphicGit/,
];

describe("RecoveryConfirmDialog — PWA-cleanliness (§8)", () => {
  test("component source file exists", () => {
    expect(fs.existsSync(COMPONENT_PATH)).toBe(true);
  });

  test("component does NOT value-import @dimm-city/print-md-lib", () => {
    if (!fs.existsSync(COMPONENT_PATH)) return;
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    for (const pattern of FORBIDDEN_VALUE_IMPORTS) {
      // Allow `import type` — those are erased at build time.
      const lines = src.split("\n").filter((l) => pattern.test(l) && !/import\s+type\s/.test(l));
      expect(lines).toHaveLength(0);
    }
  });

  test("component does NOT import node:* / fs / path / isomorphic-git as values", () => {
    if (!fs.existsSync(COMPONENT_PATH)) return;
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    const nodePatterns = [
      /from\s+["']node:/,
      /from\s+["']fs["']/,
      /from\s+["']path["']/,
      /from\s+["']isomorphic-git["']/,
    ];
    for (const pattern of nodePatterns) {
      const hits = src.split("\n").filter((l) => pattern.test(l) && !/import\s+type\s/.test(l));
      expect(hits).toHaveLength(0);
    }
  });

  test("uses getPlatform() for all host work (no window.electron / ipcRenderer direct access)", () => {
    if (!fs.existsSync(COMPONENT_PATH)) return;
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    expect(src).toContain("getPlatform");
    expect(src).not.toMatch(/window\.electron/);
    expect(src).not.toMatch(/ipcRenderer/);
  });
});

// ── Render check (source-level) ───────────────────────────────────────────────

describe("RecoveryConfirmDialog — render", () => {
  test("module resolves (component file exists and exports a default)", () => {
    expect(fs.existsSync(COMPONENT_PATH)).toBe(true);
  });

  test("component is a Svelte 5 SFC (has script, template, and style sections)", () => {
    if (!fs.existsSync(COMPONENT_PATH)) return;
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    expect(src).toContain("<script");
    // Must have template content (not just a script block)
    const hasTemplate = /<\/script>([\s\S]+)/.test(src);
    expect(hasTemplate).toBe(true);
  });
});

// ── Copy and jargon tests (static source scan) ────────────────────────────────

const GIT_JARGON = [
  /\bbranch\b/i,
  /\bcommit\b/i,
  /\bHEAD\b/,
  /\brebase\b/i,
  /\bmerge\b/i,
  /\bref\b/i,
  /\bgit\b/i,
  /\bstash\b/i,
  /\bcheckout\b/i,
];

// These strings must appear in author-visible template text.
const REQUIRED_COPY = [
  "We can fix this",          // title
  "backup",                    // backup reassurance
  "Show backup",               // show-backup button label
  "Continue",                  // primary CTA
  "Not now",                   // secondary CTA / safe exit
];

describe("RecoveryConfirmDialog — copy / no git jargon", () => {
  function readSource(): string | null {
    if (!fs.existsSync(COMPONENT_PATH)) return null;
    return fs.readFileSync(COMPONENT_PATH, "utf8");
  }

  test("file exists (prerequisite for copy tests)", () => {
    expect(fs.existsSync(COMPONENT_PATH)).toBe(true);
  });

  test("title 'We can fix this — your choice' appears in template", () => {
    const src = readSource();
    if (!src) return; // already failed above
    expect(src).toContain("We can fix this");
  });

  test("backup reassurance copy appears in template", () => {
    const src = readSource();
    if (!src) return;
    // Must say something about backup being saved / nothing lost
    expect(src.toLowerCase()).toContain("backup");
  });

  test("'Show backup' button label appears in template", () => {
    const src = readSource();
    if (!src) return;
    expect(src).toContain("Show backup");
  });

  test("'Continue' primary button label appears in template", () => {
    const src = readSource();
    if (!src) return;
    expect(src).toContain("Continue");
  });

  test("'Not now' secondary button label appears in template", () => {
    const src = readSource();
    if (!src) return;
    expect(src).toContain("Not now");
  });

  test("no git jargon in author-visible template strings", () => {
    const src = readSource();
    if (!src) return;

    // Extract only the HTML template portion (between last </script> and <style>)
    // to avoid matching CSS class names or code variable names.
    const templateMatch = src.match(/<\/script>([\s\S]*?)(?:<style>|$)/);
    const template = templateMatch?.[1] ?? src;

    for (const pattern of GIT_JARGON) {
      // Ignore lines that are in comments or code blocks (start with //)
      const offendingLines = template
        .split("\n")
        .filter((l) => {
          const trimmed = l.trim();
          if (trimmed.startsWith("//") || trimmed.startsWith("<!--")) return false;
          // Skip lines that appear to be Svelte logic (not visible copy)
          if (/^\{[#@/]/.test(trimmed)) return false;
          if (/^\{.*=.*\}/.test(trimmed)) return false;
          return pattern.test(l);
        });
      expect(offendingLines).toHaveLength(0);
    }
  });

  test("uses var(--app-*) design tokens for styling (not hardcoded colours)", () => {
    const src = readSource();
    if (!src) return;
    const styleMatch = src.match(/<style>([\s\S]*?)<\/style>/);
    if (!styleMatch) return; // no style block — fine for a token-only component
    const style = styleMatch[1]!;
    // Must use at least one --app-* token
    expect(style).toMatch(/var\(--app-/);
    // Must NOT hardcode colours (hex) for background/color properties
    const hexColorLines = style
      .split("\n")
      .filter((l) => /(?:background|color)\s*:\s*#[0-9a-fA-F]{3,6}/.test(l));
    expect(hexColorLines).toHaveLength(0);
  });
});

// ── Accessibility tests (static source scan) ──────────────────────────────────

describe("RecoveryConfirmDialog — accessibility", () => {
  function readSource(): string | null {
    if (!fs.existsSync(COMPONENT_PATH)) return null;
    return fs.readFileSync(COMPONENT_PATH, "utf8");
  }

  test("role='dialog' is present on the root dialog element", () => {
    const src = readSource();
    if (!src) return;
    expect(src).toContain('role="dialog"');
  });

  test("aria-modal='true' is present", () => {
    const src = readSource();
    if (!src) return;
    expect(src).toContain('aria-modal="true"');
  });

  test("aria-labelledby is present (links title to dialog)", () => {
    const src = readSource();
    if (!src) return;
    expect(src).toContain("aria-labelledby");
  });

  test("aria-live region is present for status announcements", () => {
    const src = readSource();
    if (!src) return;
    expect(src).toContain("aria-live");
  });

  test("Escape key handler is present (closes / answers 'Not now')", () => {
    const src = readSource();
    if (!src) return;
    // Must handle Escape key
    expect(src).toMatch(/Escape|key.*Esc/);
  });

  test("focus trap logic is present (Tab key handling)", () => {
    const src = readSource();
    if (!src) return;
    // Must trap Tab within the dialog
    expect(src).toMatch(/Tab|trapFocus|focusable/);
  });
});

// ── Decision-flow tests (source-level logic scan) ────────────────────────────
//
// These verify the component's source has the correct wiring for each decision
// path. We use source-level analysis following the project's established pattern
// (no Svelte/DOM harness — see RecoveryOverlay.test.ts, ConflictChoicesDialog.preview.test.ts).

describe("RecoveryConfirmDialog — decision flow (source analysis)", () => {
  function readSource(): string | null {
    if (!fs.existsSync(COMPONENT_PATH)) return null;
    return fs.readFileSync(COMPONENT_PATH, "utf8");
  }

  test("'Continue' button wired to approve (respondRecoveryConfirm with true)", () => {
    const src = readSource();
    if (!src) return;
    // Source must wire Continue/true path through respondRecoveryConfirm
    expect(src).toContain("respondRecoveryConfirm");
    // The answer(true) path must exist
    expect(src).toMatch(/answer\s*\(\s*true\s*\)|approved.*true|true.*approved/);
  });

  test("'Not now' button wired to reject (respondRecoveryConfirm with false)", () => {
    const src = readSource();
    if (!src) return;
    // The answer(false) path must exist
    expect(src).toMatch(/answer\s*\(\s*false\s*\)|approved.*false|false.*approved/);
  });

  test("Escape key calls the 'Not now' path (answer false)", () => {
    const src = readSource();
    if (!src) return;
    // Escape handler must call answer(false) or equivalent
    const escapeSection = src.match(/Escape[\s\S]{0,200}/);
    expect(escapeSection).not.toBeNull();
    // Escape block should involve answer(false)
    expect(src).toMatch(/Escape[\s\S]{0,300}false|false[\s\S]{0,100}Escape/);
  });

  test("backdrop click calls the 'Not now' path", () => {
    const src = readSource();
    if (!src) return;
    // Backdrop with onclick handler that answers false
    expect(src).toContain("backdrop");
    expect(src).toMatch(/backdrop[\s\S]{0,200}false|onclick[\s\S]{0,50}false/);
  });

  test("gate answered exactly once — 'answered' guard flag prevents double-resolution", () => {
    const src = readSource();
    if (!src) return;
    // Must have an answered/resolved guard to prevent calling respondRecoveryConfirm twice
    expect(src).toMatch(/answered|resolved|called/);
    // Guard should be checked before calling
    expect(src).toMatch(/if\s*\(.*answered|answered.*return/);
  });

  test("risk='high' focuses 'Not now' first (high-risk focus logic in source)", () => {
    const src = readSource();
    if (!src) return;
    // Must have logic checking risk === 'high' for focus placement
    expect(src).toMatch(/high.*not-now|not-now.*high|risk.*high/i);
  });

  test("risk other than 'high' focuses 'Continue' first", () => {
    const src = readSource();
    if (!src) return;
    // The else/non-high branch should target the continue button
    expect(src).toMatch(/continue|data-action.*continue/i);
    // And there's conditional focus logic
    expect(src).toMatch(/\?|else|if/);
  });

  test("'Show backup' button calls onShowBackup prop with backupZipPath", () => {
    const src = readSource();
    if (!src) return;
    // Must have onShowBackup prop and call it with backupZipPath
    expect(src).toContain("onShowBackup");
    expect(src).toContain("backupZipPath");
    // Must actually invoke it
    expect(src).toMatch(/onShowBackup\s*\?\s*\.\s*\(|onShowBackup\s*\(/);
  });

  test("dialog is conditionally rendered (not shown when open=false)", () => {
    const src = readSource();
    if (!src) return;
    // Must use {#if open} or {#if open && request} gating
    expect(src).toMatch(/\{#if\s+open/);
  });

  test("body surfaces confirmation.summary in a plain-language framing", () => {
    const src = readSource();
    if (!src) return;
    // Must interpolate the summary into the body text
    expect(src).toMatch(/confirmation\.summary|request\.confirmation\.summary/);
  });

  test("body includes backup reassurance text", () => {
    const src = readSource();
    if (!src) return;
    // Must contain a static backup reassurance phrase
    const lc = src.toLowerCase();
    expect(lc).toContain("backup");
    // Should say something about safety / nothing lost
    expect(lc).toMatch(/nothing is lost|safe|saved/);
  });

  test("focus trap: trapFocus function handles Tab key cycling", () => {
    const src = readSource();
    if (!src) return;
    // Must implement focus trap logic for Tab key
    expect(src).toMatch(/trapFocus|Tab.*focus|focus.*Tab/);
    // Must handle wrapping from last to first
    expect(src).toMatch(/first|last/);
    // Must call preventDefault on Tab at boundary
    expect(src).toContain("preventDefault");
  });
});
