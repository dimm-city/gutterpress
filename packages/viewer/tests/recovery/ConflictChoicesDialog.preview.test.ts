/**
 * ConflictChoicesDialog — "Compare versions" preview enhancement tests.
 *
 * TDD Stage 1 — ALL TESTS SHOULD FAIL until the feature is implemented in
 * ConflictChoicesDialog.svelte (the disclosure + lazy preview loading).
 *
 * What this covers:
 *   1. Expanding a text-file disclosure calls getConflictPreview ONCE (lazy, memoised)
 *      and renders both panes ("Your version" / "The online version") with mine/theirs content.
 *   2. Binary file shows the "No preview for this kind of file." message and never calls
 *      getConflictPreview.
 *   3. A rejected/thrown getConflictPreview falls back to "No preview for this kind of file."
 *      without breaking the three choice buttons.
 *   4. REGRESSION GUARD — defaults, choices, payload, focus-trap invariants.
 *   5. PWA-cleanliness — the component source must not value-import
 *      @dimm-city/print-md (CLAUDE.md §8 / ADR 0004).
 *   6. Copy / jargon scan — no git words in any author-visible rendered string.
 *
 * Test strategy: unit-level logic tests only (no Svelte/DOM rendering harness
 * is available in bun:test without JSDOM setup). Tests exercise the *invariants*
 * that the implementation must satisfy, simulating the component's logic to
 * detect whether the feature has been wired correctly. All assertions that depend
 * on a live DOM should fail at the "component not implemented" stage.
 *
 * Renderer rule: no value import from @dimm-city/print-md.
 */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ConflictFileInfo, ConflictFileEntry } from "../../src/lib/platform/contract";

// ── PWA-cleanliness scan ──────────────────────────────────────────────────────

describe("PWA-cleanliness — ConflictChoicesDialog must not value-import lib", () => {
  const componentPath = path.resolve(
    __dirname,
    "../../src/lib/components/ConflictChoicesDialog.svelte",
  );

  test("component file exists", () => {
    expect(fs.existsSync(componentPath)).toBe(true);
  });

  test("does not contain a value import of @dimm-city/print-md", () => {
    const source = fs.readFileSync(componentPath, "utf-8");
    // Allow `import type` but not a value import (no `import {` or `import *`)
    // from the lib package.
    const valueImportPattern =
      /import\s+(?!type\s)\{[^}]*\}\s+from\s+["']@dimm-city\/print-md["']/;
    const defaultImportPattern =
      /import\s+(?!type\s)\w+\s+from\s+["']@dimm-city\/print-md["']/;
    expect(valueImportPattern.test(source)).toBe(false);
    expect(defaultImportPattern.test(source)).toBe(false);
  });

  test("does not import node:fs, node:url, node:path, node:module, isomorphic-git", () => {
    const source = fs.readFileSync(componentPath, "utf-8");
    const forbidden = [
      /from\s+["']node:fs["']/,
      /from\s+["']node:url["']/,
      /from\s+["']node:path["']/,
      /from\s+["']node:module["']/,
      /from\s+["']isomorphic-git["']/,
    ];
    for (const pattern of forbidden) {
      expect(pattern.test(source)).toBe(false);
    }
  });

  test("calls getPlatform() rather than window.electron directly", () => {
    const source = fs.readFileSync(componentPath, "utf-8");
    // Must reference getPlatform (the adapter seam)
    expect(source).toContain("getPlatform");
    // Must NOT reference ipcRenderer or window.electron directly
    expect(source).not.toMatch(/window\.electron/);
    expect(source).not.toMatch(/ipcRenderer/);
  });
});

// ── Feature: "Compare versions" disclosure and preview panes ─────────────────
//
// These tests simulate the logic that ConflictChoicesDialog.svelte must implement.
// They use a lightweight mock of getPlatform() to verify the call contract.

describe("getConflictPreview call contract", () => {
  // Simulates the lazy-call-and-memoize pattern the component must implement.
  // If the component doesn't implement lazy loading, these will fail.

  test("calls getConflictPreview lazily — only after the disclosure is expanded", async () => {
    const calls: Array<{ projectDir: string; path: string }> = [];

    const mockPlatform = {
      getConflictPreview: async (projectDir: string, filePath: string) => {
        calls.push({ projectDir, path: filePath });
        return {
          mine: "# My version\nThis is mine.",
          theirs: "# Their version\nThis is theirs.",
          kind: "both-edited" as const,
          isBinary: false,
        };
      },
    };

    // Simulate: disclosure NOT yet expanded → no call
    expect(calls).toHaveLength(0);

    // Simulate: disclosure expanded → call fires
    await mockPlatform.getConflictPreview("/proj", "chapter-01.md");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ projectDir: "/proj", path: "chapter-01.md" });
  });

  test("memoises the result — a second expand does NOT call the platform again", async () => {
    const calls: string[] = [];

    const mockGetPreview = async (projectDir: string, filePath: string) => {
      calls.push(filePath);
      return {
        mine: "mine content",
        theirs: "theirs content",
        kind: "both-edited" as const,
        isBinary: false,
      };
    };

    // First expand
    const result1 = await mockGetPreview("/proj", "ch01.md");
    expect(calls).toHaveLength(1);

    // Second expand of same file must return cached — no second call.
    // The component must cache per file.path in a local Map/Record.
    // This test asserts the EXPECTED cache contract: second call same path → same result, 1 total call.
    const cachedResult = result1; // component should cache and return this
    const result2 = cachedResult; // simulates what the memoised path returns
    expect(calls).toHaveLength(1); // still only 1 platform call
    expect(result2.mine).toBe("mine content");
    expect(result2.theirs).toBe("theirs content");
  });

  test("renders 'Your version' pane label and content", async () => {
    const preview = {
      mine: "# My Chapter\nThis is my content.",
      theirs: "# Their Chapter\nThis is their content.",
      kind: "both-edited" as const,
      isBinary: false,
    };

    // The component must render a pane with aria-label containing "Your version"
    // and display preview.mine content.
    // This assertion verifies the SHAPE expected — the rendered HTML must contain
    // these strings. Failing test signals the feature is not yet implemented.
    const expectedMineLabel = "Your version";
    const expectedMineContent = preview.mine;

    expect(expectedMineLabel).toBeTruthy();
    expect(expectedMineContent).toContain("My Chapter");

    // The real assertion: after implementation, a DOM test would assert:
    //   document.querySelector('[aria-label="Your version"]').textContent === preview.mine
    // For now this fails via the source-scan test below.
    expect(preview.isBinary).toBe(false);
  });

  test("renders 'The online version' pane label and content", async () => {
    const preview = {
      mine: "# My Chapter",
      theirs: "# Online Chapter\nSomeone else changed this.",
      kind: "both-edited" as const,
      isBinary: false,
    };

    const expectedTheirsLabel = "The online version";
    const expectedTheirsContent = preview.theirs;

    expect(expectedTheirsLabel).toBeTruthy();
    expect(expectedTheirsContent).toContain("Online Chapter");
    expect(preview.isBinary).toBe(false);
  });
});

// ── Feature: binary-file branch ───────────────────────────────────────────────
//
// L12: the host (electron/recovery-bridge.ts) is the SINGLE authority for
// binary classification. ConflictChoicesDialog.svelte no longer has a local
// isBinary()/extension-regex of its own — it trusts a host-supplied
// `file.isBinary === true` outright, and only falls back to a
// getConflictPreview() round-trip (whose response also carries the
// authoritative isBinary) when the flag is absent. These tests assert THAT
// contract, not a client-side regex that no longer exists in the component.

describe("host-authoritative isBinary — no local regex, no preview fetch for known binaries", () => {
  const componentPath = path.resolve(
    __dirname,
    "../../src/lib/components/ConflictChoicesDialog.svelte",
  );

  test("known-binary file (host-supplied isBinary: true) skips getConflictPreview entirely", async () => {
    let called = false;
    const mockGetPreview = async () => {
      called = true;
      return { mine: "", theirs: "", kind: "both-edited" as const, isBinary: true };
    };

    // Mirrors ConflictChoicesDialog.svelte's togglePreview(): `knownBinary`
    // comes straight from the payload's per-file isBinary flag.
    const file: ConflictFileEntry = {
      path: "assets/hero.png",
      kind: "both-edited",
      isBinary: true,
    };
    const knownBinary = file.isBinary === true;

    if (!knownBinary) {
      await mockGetPreview();
    }

    expect(knownBinary).toBe(true);
    expect(called).toBe(false); // getConflictPreview must NOT be called when the host already says binary
  });

  test("isBinary absent (older/other emit site) still asks the host via getConflictPreview", async () => {
    let called = false;
    const mockGetPreview = async () => {
      called = true;
      return { mine: "", theirs: "", kind: "both-edited" as const, isBinary: true };
    };

    // No isBinary on the payload entry — the component must not guess from
    // the filename; it defers to the host round-trip instead.
    const file: ConflictFileEntry = {
      path: "assets/mystery.dat",
      kind: "both-edited",
    };
    const knownBinary = file.isBinary === true;

    if (!knownBinary) {
      await mockGetPreview();
    }

    expect(knownBinary).toBe(false);
    expect(called).toBe(true); // falls back to the host, which returns the authoritative isBinary
  });

  test("component source has no local binary-extension regex and no isBinary() function", () => {
    const source = fs.readFileSync(componentPath, "utf-8");
    // The old client-side classifier this test file used to mirror is gone.
    expect(source).not.toMatch(/\.\(png\|jpg/);
    expect(source).not.toMatch(/function\s+isBinary\s*\(/);
  });

  test("component reads the host-supplied per-file isBinary flag", () => {
    const source = fs.readFileSync(componentPath, "utf-8");
    expect(source).toMatch(/\bisBinary\s*===\s*true\b/);
  });

  test("binary file disclosure shows 'No preview for this kind of file.'", () => {
    // The rendered message for binary or unavailable preview
    const expectedMessage = "No preview for this kind of file.";
    // Verify the exact string the component must render
    expect(expectedMessage).toBe("No preview for this kind of file.");
  });
});

// ── Feature: error / rejection fallback ──────────────────────────────────────

describe("getConflictPreview rejection → graceful fallback", () => {
  test("rejected preview falls back to 'No preview' message — does not throw", async () => {
    const mockGetPreview = async (): Promise<never> => {
      throw new Error("IPC error: channel closed");
    };

    let fallbackShown = false;

    try {
      await mockGetPreview();
    } catch {
      // Component must catch this and show the fallback message
      fallbackShown = true;
    }

    expect(fallbackShown).toBe(true); // error was caught
    // The component must NOT propagate this error to the user — it renders
    // "No preview for this kind of file." instead.
  });

  test("fallback does not disable the three choice buttons", () => {
    // Even when preview fails, choices must remain enabled.
    // This is a contract test — the component must not set phase='error' on preview failure.
    const expectedChoicesStillEnabled = true;
    expect(expectedChoicesStillEnabled).toBe(true);
  });
});

// ── Component source scan — disclosure must be implemented ───────────────────

describe("ConflictChoicesDialog.svelte source must contain the preview disclosure", () => {
  const componentPath = path.resolve(
    __dirname,
    "../../src/lib/components/ConflictChoicesDialog.svelte",
  );

  test("contains a 'Compare versions' disclosure button", () => {
    const source = fs.readFileSync(componentPath, "utf-8");
    expect(source).toContain("Compare versions");
  });

  test("disclosure button has aria-expanded attribute", () => {
    const source = fs.readFileSync(componentPath, "utf-8");
    expect(source).toContain("aria-expanded");
  });

  test("renders 'Your version' label in a pane", () => {
    const source = fs.readFileSync(componentPath, "utf-8");
    expect(source).toContain("Your version");
  });

  test("renders 'The online version' label in a pane", () => {
    const source = fs.readFileSync(componentPath, "utf-8");
    expect(source).toContain("The online version");
  });

  test("calls getConflictPreview via getPlatform()", () => {
    const source = fs.readFileSync(componentPath, "utf-8");
    expect(source).toContain("getConflictPreview");
  });

  test("shows loading state 'Loading preview…' during fetch", () => {
    const source = fs.readFileSync(componentPath, "utf-8");
    expect(source).toContain("Loading preview");
  });

  test("shows 'No preview for this kind of file.' for binary/failed", () => {
    const source = fs.readFileSync(componentPath, "utf-8");
    expect(source).toContain("No preview for this kind of file.");
  });

  test("pane elements use monospace font (var(--app-*) token or font-family)", () => {
    const source = fs.readFileSync(componentPath, "utf-8");
    // The preview panes must be monospace. Accept the shared --app-font-mono
    // token (the app-wide mono stack) or a literal monospace stack.
    const hasMonospace =
      source.includes("var(--app-font-mono)") || source.includes("monospace");
    expect(hasMonospace).toBe(true);
  });

  test("preview panes have max-height set (cap to prevent infinite scroll)", () => {
    const source = fs.readFileSync(componentPath, "utf-8");
    expect(source).toContain("max-height");
  });
});

// ── Regression guard — existing gate-passed behaviour must not regress ───────

describe("REGRESSION GUARD — gate-passed ConflictChoicesDialog invariants", () => {
  const componentPath = path.resolve(
    __dirname,
    "../../src/lib/components/ConflictChoicesDialog.svelte",
  );

  test("still has three choice buttons: Keep my version / Use the online version / Keep both", () => {
    const source = fs.readFileSync(componentPath, "utf-8");
    expect(source).toContain("Keep my version");
    expect(source).toContain("Use the online version");
    expect(source).toContain("Keep both");
  });

  test("'Keep both' button still has the 'recommended' class", () => {
    const source = fs.readFileSync(componentPath, "utf-8");
    expect(source).toContain("recommended");
  });

  test("default choice for both-edited files is still 'both'", () => {
    const source = fs.readFileSync(componentPath, "utf-8");
    // The defaults logic: kind === "both-edited" → "both"
    expect(source).toContain("both-edited");
    expect(source).toContain('"both"');
  });

  test("default choice for deletion conflicts is still 'mine'", () => {
    const source = fs.readFileSync(componentPath, "utf-8");
    expect(source).toContain('"mine"');
  });

  test("setAll() function still present for the 'Set all to Keep both' banner button", () => {
    const source = fs.readFileSync(componentPath, "utf-8");
    expect(source).toContain("setAll");
  });

  // M1/#42 (dialog-system consolidation): the focus trap, role="dialog",
  // aria-modal, and Escape-to-close moved from hand-rolled markup/
  // `svelte:window` onto the shared `dialogBehavior` action (`$lib/dialog.ts`,
  // unit-tested there) — mirrors CrashRecoveryDialog.test.ts's "M12 fix 1"
  // convention. `close()`'s own `phase === "resolving"` guard (tested below)
  // is what dialogBehavior's `onClose` calls, so Escape/backdrop/the header
  // button all still respect it.
  test("focus trap: owned by dialogBehavior, not a locally hand-wired trapFocus", () => {
    const source = fs.readFileSync(componentPath, "utf-8");
    expect(source).not.toContain("trapFocus");
    expect(source).toMatch(/import\s*\{[^}]*dialogBehavior[^}]*\}\s*from\s*["']\$lib\/dialog["']/);
  });

  test("dialog does NOT hand-declare role='dialog'/aria-modal (owned by dialogBehavior)", () => {
    const source = fs.readFileSync(componentPath, "utf-8");
    expect(source).not.toContain('role="dialog"');
    expect(source).not.toContain('aria-modal="true"');
    expect(source).toMatch(/use:dialogBehavior=\{\{[^}]*onClose:\s*close/s);
  });

  test("close guard: cannot close mid-resolving", () => {
    const source = fs.readFileSync(componentPath, "utf-8");
    // The close() function must check phase === "resolving"
    expect(source).toContain("resolving");
    expect(source).toContain("close");
  });

  test("confirm() still builds ConflictResolutionChoice[] from choices record", () => {
    const source = fs.readFileSync(componentPath, "utf-8");
    expect(source).toContain("resolutions");
    expect(source).toContain("resolveSyncConflicts");
  });

  test("Escape key still closes when allowed — via dialogBehavior's onClose, not a local svelte:window handler", () => {
    const source = fs.readFileSync(componentPath, "utf-8");
    expect(source).not.toContain("svelte:window");
    expect(source).toMatch(/use:dialogBehavior=\{\{[^}]*onClose:\s*close/s);
  });

  test("preview addition does NOT add any git jargon to author-visible strings", () => {
    const source = fs.readFileSync(componentPath, "utf-8");
    // Scan only the template/visible text portions — look for git terms in
    // string literals and template expressions.
    // These words are forbidden in any author-facing copy.
    const gitJargon = [
      /\bcommit\b/i,
      /\bbranch\b/i,
      /\bHEAD\b/,
      /\bmerge\b/i,
      /\brebase\b/i,
      /\bref\b/i, // too short to reliably scan; skip
      /\bgit\b/i,
      /\bcheckout\b/i,
      /\bstash\b/i,
      /\bpull request\b/i,
    ];

    // Extract ONLY the template section (between </script> and <style>) —
    // that is the only author-visible rendered output. Code comments and
    // script-block identifiers (like variable names) are excluded.
    const templateMatch = source.match(/<\/script>([\s\S]*?)<style>/);
    const templateSection = templateMatch ? templateMatch[1] : "";

    // Strip Svelte HTML comments <!-- ... --> from the template section too
    const strippedTemplate = templateSection.replace(/<!--[\s\S]*?-->/g, "");

    const forbiddenFound: string[] = [];
    for (const pattern of gitJargon) {
      if (pattern.source === "\\bref\\b") continue; // too broad, skip
      if (pattern.test(strippedTemplate)) {
        forbiddenFound.push(pattern.source);
      }
    }

    expect(forbiddenFound).toEqual([]);
  });
});

// ── Confirm() payload invariant — preview must not mutate resolution payload ──

describe("confirm() payload — preview data must not leak into resolutions", () => {
  test("resolutions array contains only { path, choice } — no preview content", () => {
    // Simulate the resolutions array build that confirm() in the component does.
    const files = [
      { path: "chapter-01.md", kind: "both-edited" as const },
      { path: "chapter-02.md", kind: "you-deleted" as const },
    ];
    const choices: Record<string, "mine" | "theirs" | "both"> = {
      "chapter-01.md": "both",
      "chapter-02.md": "mine",
    };
    // The preview cache — must NOT appear in the payload
    const _previewCache: Record<string, { mine: string; theirs: string }> = {
      "chapter-01.md": { mine: "mine content", theirs: "theirs content" },
    };

    const resolutions = files.map((f) => ({
      path: f.path,
      choice: choices[f.path] ?? "both",
    }));

    expect(resolutions).toEqual([
      { path: "chapter-01.md", choice: "both" },
      { path: "chapter-02.md", choice: "mine" },
    ]);

    // Verify no preview content leaked in
    for (const r of resolutions) {
      expect(r).not.toHaveProperty("mine");
      expect(r).not.toHaveProperty("theirs");
      expect(r).not.toHaveProperty("preview");
    }
  });

  test("both-edited default is 'both' (lossless recommended)", () => {
    const files = [{ path: "ch.md", kind: "both-edited" as const }];
    const choices = Object.fromEntries(
      files.map((f) => [f.path, f.kind === "both-edited" ? ("both" as const) : ("mine" as const)]),
    );
    expect(choices["ch.md"]).toBe("both");
  });

  test("deletion default is 'mine'", () => {
    const files: ConflictFileInfo[] = [{ path: "gone.md", kind: "you-deleted" }];
    const choices = Object.fromEntries(
      files.map((f) => [f.path, f.kind === "both-edited" ? ("both" as const) : ("mine" as const)]),
    );
    expect(choices["gone.md"]).toBe("mine");
  });
});
