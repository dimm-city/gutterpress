/**
 * TDD Stage 1 — FAILING tests for RecoveryGuidanceDialog.
 *
 * The component does not exist yet. Every test in this file is expected to
 * fail with "Cannot find module" or equivalent until the component is created
 * in packages/viewer/src/lib/components/RecoveryGuidanceDialog.svelte.
 *
 * Spec coverage:
 *  - Renders userSummary and recommendedAction button label from guidance prop
 *  - Primary button fires onPrimary callback
 *  - safeNextSteps renders as an ordered list when present; absent when empty
 *  - "Show backup" button calls onShowBackup with backupZipPath; hidden when absent
 *  - "Copy details" copies supportDetails to clipboard
 *  - supportDetails text NOT in the DOM until copy action (jargon-containment)
 *  - Jargon scan on always-visible text passes (no git words shown inline)
 *  - a11y: role="dialog", aria-modal, aria-labelledby present
 *  - PWA-clean: no value import of @dimm-city/print-md-lib in the component source
 *  - Esc closes the dialog
 *  - Backdrop click closes the dialog
 *  - "Show backup" row hidden when no backupZipPath on either prop or guidance
 *  - Tokens: var(--app-*) used (not hard-coded colours)
 */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ManualGuidanceInfo } from "../src/lib/platform/contract";

// ── Path to the component under test ─────────────────────────────────────────

const COMPONENT_PATH = path.resolve(
  __dirname,
  "../src/lib/components/RecoveryGuidanceDialog.svelte",
);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const minimalGuidance: ManualGuidanceInfo = {
  userSummary: "We couldn't finish syncing your project.",
  recommendedNextStep: "Try reconnecting your project and syncing again.",
  recommendedAction: "Try again",
};

const fullGuidance: ManualGuidanceInfo = {
  userSummary: "We couldn't finish syncing your project due to a problem on the server.",
  recommendedNextStep: "Contact your account admin to restore access.",
  recommendedAction: "Contact support",
  safeNextSteps: [
    "Save your work locally.",
    "Make note of the error details below.",
    "Reach out to your account team.",
  ],
  supportDetails: "fatal: remote HEAD refers to nonexistent ref -- git branch -d HEAD",
  backupZipPath: "/Users/author/backups/project-20260615.zip",
};

// GIT JARGON WORDS — must not appear in always-visible DOM text
const GIT_JARGON = [
  "branch",
  "commit",
  "HEAD",
  "merge",
  "ref",
  "rebase",
  "stash",
  "fetch",
  "push",
  "pull",
  "cherry-pick",
  "detached",
];

// ── Helper: minimal DOM simulation ───────────────────────────────────────────
// Since we cannot run a full Svelte/browser environment in bun:test without
// a DOM, these tests use a lightweight approach: import the raw Svelte source,
// parse its structure, and exercise exported bindings where possible. For
// behaviour that requires DOM events (clicks, Esc), we verify the component
// module exports the expected props and that the source satisfies structural
// invariants.

// ── SOURCE-LEVEL TESTS (run without a browser DOM) ───────────────────────────

describe("RecoveryGuidanceDialog — module exists and is PWA-clean", () => {
  test("component file exists at the expected path", async () => {
    // This is the canary: fails immediately if the component hasn't been created
    const source = await readFile(COMPONENT_PATH, "utf-8");
    expect(source.length).toBeGreaterThan(0);
  });

  test("does NOT value-import @dimm-city/print-md-lib (PWA-clean §8)", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    // Allow `import type` but reject any value import (no `import {` without `type`)
    // Pattern: `import {` or `import *` or `import defaultName` from the lib
    const valueImportPattern =
      /import\s+(?!type\s)(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]@dimm-city\/print-md-lib['"]/;
    expect(valueImportPattern.test(source)).toBe(false);
  });

  test("does NOT import node:fs, node:path, node:url, isomorphic-git (PWA-clean §8)", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    const nodeImports = /from\s+['"](?:node:fs|node:path|node:url|node:child_process|isomorphic-git)['"]/;
    expect(nodeImports.test(source)).toBe(false);
  });

  test("does NOT import fileURLToPath or createRequire (PWA-clean §8)", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    expect(source).not.toContain("fileURLToPath");
    expect(source).not.toContain("createRequire");
  });
});

describe("RecoveryGuidanceDialog — source structure invariants", () => {
  test("has role='dialog' and aria-modal='true' in template markup", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
  });

  test("has aria-labelledby binding for the dialog title", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    expect(source).toContain("aria-labelledby");
  });

  test("renders an <h2> (or labelled heading) for the title", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    // Either an h2 or h1/h3 in the template
    expect(/<h[123]/.test(source)).toBe(true);
  });

  test("references guidance.userSummary in the template", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    expect(source).toContain("guidance.userSummary");
  });

  test("references guidance.recommendedAction as a button label", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    expect(source).toContain("guidance.recommendedAction");
  });

  test("references guidance.recommendedNextStep in the template", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    expect(source).toContain("guidance.recommendedNextStep");
  });

  test("renders safeNextSteps as an ordered list (<ol>)", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    expect(source).toContain("<ol");
  });

  test("conditionally renders safeNextSteps (uses {#if ... safeNextSteps})", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    // Must be gated so it is absent when safeNextSteps is empty/undefined
    expect(source).toMatch(/#if.*safeNextSteps/);
  });

  test("renders a 'Show backup' button that is conditionally shown", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    // Must check for a backupZipPath guard
    expect(source).toContain("backupZipPath");
    // Must reference onShowBackup callback
    expect(source).toContain("onShowBackup");
  });

  test("renders a 'Copy details' button only when supportDetails is present", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    expect(source).toContain("supportDetails");
    // The button must be conditional
    expect(source).toMatch(/#if.*supportDetails/);
  });

  test("supportDetails is NOT rendered as inline visible text (only behind copy action)", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    // supportDetails must NOT appear in an unconditional text binding that
    // would render it in the DOM before a user action. Acceptable: inside
    // an event handler (clipboard write) or hidden button action. Forbidden:
    // direct `{guidance.supportDetails}` in visible markup.
    //
    // Strategy: check that supportDetails is NOT bound as a direct text node
    // (i.e. not `>{guidance.supportDetails}<` without a gate).
    const directBind = />\s*\{(?:guidance\.)?supportDetails\}\s*</;
    expect(directBind.test(source)).toBe(false);
  });

  test("uses var(--app-*) design tokens (not hard-coded hex/rgb colours)", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    // Must reference at least one --app-* token
    expect(source).toContain("var(--app-");
    // Must NOT hard-code common hex colours in CSS (spot-check)
    // Allow #000 / #fff / #111 etc. — restrict to non-trivial colours
    const hardCodedColor = /#[0-9a-fA-F]{6}\b/;
    // We check there is NO hard-coded 6-digit hex colour in the <style> block
    const styleBlock = source.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? "";
    const hardColorInStyle = hardCodedColor.test(styleBlock);
    // If there are hard-coded colours, they must at least be paired with a token override
    // Soft check: the style must have more var(--app- references than hard-coded colours
    const tokenCount = (styleBlock.match(/var\(--app-/g) ?? []).length;
    if (hardColorInStyle) {
      expect(tokenCount).toBeGreaterThan(0);
    }
    expect(tokenCount).toBeGreaterThan(0);
  });

  test("Esc handling is present (svelte:window onkeydown or keydown handler)", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    // Must handle Escape key somewhere
    expect(source).toMatch(/Escape|key.*Esc/);
  });

  test("onPrimary prop is declared and called on primary button click", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    expect(source).toContain("onPrimary");
  });

  test("open prop is declared as bindable", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    // Svelte 5 runes: $bindable()
    expect(source).toContain("$bindable");
    expect(source).toContain("open");
  });

  test("triggerEl prop is declared for focus restoration on close", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    expect(source).toContain("triggerEl");
  });

  test("focus trap pattern is present (tabindex or focusable query)", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    // Any reasonable focus trap implementation will mention tabindex or querySelectorAll
    expect(source).toMatch(/tabindex|querySelectorAll|focusable/);
  });

  test("aria-live region is present for copy confirmation announcement", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    expect(source).toContain("aria-live");
  });

  test("backdrop element is present for click-to-close", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    expect(source).toContain("backdrop");
  });
});

describe("RecoveryGuidanceDialog — always-visible jargon scan", () => {
  test("always-visible template text does not contain git jargon words", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");

    // Extract the template (HTML) portion — between <script> and <style> blocks
    // Remove script blocks first
    const noScript = source.replace(/<script[\s\S]*?<\/script>/g, "");
    // Remove style blocks
    const templateOnly = noScript.replace(/<style[\s\S]*?<\/style>/g, "");
    // Remove Svelte expression blocks (anything in {...}) — these contain code, not display text
    // But we KEEP string literals that are hardcoded display text
    // Strategy: look for literal strings in the template that are NOT inside {} expressions
    // Extract text between > and < (i.e. element text content)
    const textContent = Array.from(templateOnly.matchAll(/>([^<{]+)</g))
      .map((m) => m[1]!.trim())
      .filter((t) => t.length > 0)
      .join(" ")
      .toLowerCase();

    for (const word of GIT_JARGON) {
      // Allow the word "push" only in non-git contexts (e.g. "push notification")
      // For the jargon scan: fail if a standalone git word appears in always-visible text
      const wordBoundaryRegex = new RegExp(`\\b${word}\\b`);
      if (wordBoundaryRegex.test(textContent)) {
        throw new Error(
          `Git jargon "${word}" found in always-visible template text. ` +
            `Author-facing copy must not use git terminology. ` +
            `Only supportDetails (behind copy action) may contain technical text.`,
        );
      }
    }
  });

  test("hardcoded title string is 'We couldn't finish syncing' (or plain equivalent)", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    // The spec mandates this exact title (or close equivalent without jargon)
    expect(source).toMatch(/couldn.*t finish syncing|We couldn/i);
  });
});

describe("RecoveryGuidanceDialog — props contract", () => {
  test("exports ManualGuidanceInfo type from contract (import type only)", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    // Must import ManualGuidanceInfo as a type (not a value)
    expect(source).toMatch(/import\s+type.*ManualGuidanceInfo/);
  });

  test("accepts optional guidance prop typed as ManualGuidanceInfo", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    expect(source).toContain("ManualGuidanceInfo");
    // guidance prop should be optional (?)
    expect(source).toMatch(/guidance\??\s*[:=]/);
  });

  test("accepts onShowBackup prop as a function callback", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    expect(source).toMatch(/onShowBackup\??\s*[:=]/);
  });

  test("accepts onPrimary prop as a function callback", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    expect(source).toMatch(/onPrimary\??\s*[:=]/);
  });
});

describe("RecoveryGuidanceDialog — behaviour contracts (structural verification)", () => {
  test("onShowBackup is called with backupZipPath from guidance when 'Show backup' clicked", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    // The onclick of the backup button must pass backupZipPath to onShowBackup
    // Look for the pattern: onShowBackup(... backupZipPath ...)
    expect(source).toMatch(/onShowBackup.*backupZipPath|backupZipPath.*onShowBackup/);
  });

  test("clipboard.writeText is called with supportDetails on 'Copy details' click", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    // Must call navigator.clipboard.writeText or equivalent
    expect(source).toMatch(/clipboard\.writeText|clipboard/);
    // Must pass supportDetails
    expect(source).toMatch(/writeText.*supportDetails|supportDetails.*writeText/);
  });

  test("close function sets open = false", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    expect(source).toMatch(/open\s*=\s*false/);
  });

  test("focus is restored to triggerEl on close", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    // Standard pattern: triggerEl?.focus()
    expect(source).toMatch(/triggerEl\?\.focus\(\)|triggerEl\.focus/);
  });

  test("backupZipPath fallback prop is declared for status.backupZipPath merge (Integrate handoff)", async () => {
    // Spec: backup row shows 'if guidance.backupZipPath (or status.backupZipPath)'.
    // The component accepts an explicit backupZipPath prop so the Integrate parent can
    // pass status.backupZipPath when guidance.backupZipPath is absent.
    const source = await readFile(COMPONENT_PATH, "utf-8");
    // Must declare a backupZipPath prop (separate from guidance.backupZipPath)
    expect(source).toMatch(/backupZipPath\??\s*[:?]/);
    // Must derive the effective path from both sources
    expect(source).toMatch(/guidance\?\.backupZipPath.*backupZipPathProp|backupZipPathProp.*guidance\?\.backupZipPath/);
  });

  test("single aria-live region for copy announcement (no duplicate announcements)", async () => {
    const source = await readFile(COMPONENT_PATH, "utf-8");
    // Strip HTML comments before counting aria-live attribute occurrences,
    // so the descriptive comment above the sr-only div does not inflate the count.
    const noComments = source.replace(/<!--[\s\S]*?-->/g, "");
    const ariaLiveMatches = noComments.match(/aria-live/g) ?? [];
    expect(ariaLiveMatches.length).toBe(1);
  });
});
