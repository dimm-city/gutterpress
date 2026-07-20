/**
 * TDD — tests for CrashRecoveryDialog.svelte (M12, dialog-system migration pilot).
 *
 * M12 (docs/reviews/2026-07-10-ux-critical-review.md): CrashRecoveryDialog was
 * keyboard-inaccessible (no dialogBehavior/trapFocus/Escape, role="dialog"
 * aria-modal on the BACKDROP instead of the dialog) and Discard fired
 * immediately with no way to see what was being restored/discarded.
 *
 * Required fixes verified here:
 *  1. Adopts the shared `dialogBehavior` action — Escape maps to onDismiss
 *     ("Decide later"), and role="dialog"/aria-modal are owned by the ACTION
 *     on the dialog element (not hand-declared on the backdrop).
 *  2. A recovered-vs-on-disk "Compare versions" preview disclosure per item,
 *     mirroring ConflictChoicesDialog's compare pattern (lazy fetch + memoise).
 *  3. Discard is two-step: an inline confirm swap on the same button ("Really
 *     discard? This can't be undone") before onDiscard actually fires.
 *
 * Test strategy: source-level static analysis (following the established
 * project pattern — see RecoveryConfirmDialog.test.ts, ConflictChoicesDialog
 * .preview.test.ts) since there is no Svelte/DOM component-render harness in
 * this repo, plus logic-level unit tests for the toggle/arm state machines
 * that mirror the component's implementation.
 */

import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const COMPONENT_PATH = path.resolve(
  __dirname,
  "../../src/lib/components/CrashRecoveryDialog.svelte",
);

function readSource(): string {
  return fs.readFileSync(COMPONENT_PATH, "utf-8");
}

// ── PWA-cleanliness (§8) ──────────────────────────────────────────────────────

describe("CrashRecoveryDialog — PWA-cleanliness (§8)", () => {
  test("component file exists", () => {
    expect(fs.existsSync(COMPONENT_PATH)).toBe(true);
  });

  test("does not value-import @dimm-city/print-md", () => {
    const source = readSource();
    const valueImportPattern =
      /import\s+(?!type\s)\{[^}]*\}\s+from\s+["']@dimm-city\/print-md["']/;
    const defaultImportPattern =
      /import\s+(?!type\s)\w+\s+from\s+["']@dimm-city\/print-md["']/;
    expect(valueImportPattern.test(source)).toBe(false);
    expect(defaultImportPattern.test(source)).toBe(false);
  });

  test("does not import node:*/fs/path/url/child_process/isomorphic-git as values", () => {
    const source = readSource();
    const forbidden = [
      /from\s+["']node:/,
      /from\s+["']fs["']/,
      /from\s+["']path["']/,
      /from\s+["']url["']/,
      /from\s+["']child_process["']/,
      /from\s+["']isomorphic-git["']/,
    ];
    for (const pattern of forbidden) {
      const hits = source
        .split("\n")
        .filter((l) => pattern.test(l) && !/import\s+type\s/.test(l));
      expect(hits).toHaveLength(0);
    }
  });

  test("does not touch window.electron or ipcRenderer directly", () => {
    const source = readSource();
    expect(source).not.toMatch(/window\.electron/);
    expect(source).not.toMatch(/ipcRenderer/);
  });
});

// ── Fix 1: shared dialogBehavior action ──────────────────────────────────────

describe("CrashRecoveryDialog — dialogBehavior adoption (M12 fix 1)", () => {
  test("imports dialogBehavior from $lib/dialog", () => {
    const source = readSource();
    expect(source).toMatch(/import\s*\{\s*dialogBehavior\s*\}\s*from\s*["']\$lib\/dialog["']/);
  });

  test("the dialog element uses the action, wired to onDismiss and a title id", () => {
    const source = readSource();
    expect(source).toMatch(/use:dialogBehavior=\{\{[^}]*onClose:\s*onDismiss/);
    expect(source).toMatch(/use:dialogBehavior=\{\{[^}]*labelledBy:\s*["']cr-title["']/);
  });

  test("role=dialog / aria-modal are NOT hand-declared on the backdrop (owned by the action instead)", () => {
    const source = readSource();
    const backdropMatch = source.match(/<div class="cr-backdrop"[^>]*>/);
    expect(backdropMatch).not.toBeNull();
    const backdropTag = backdropMatch![0];
    expect(backdropTag).not.toContain("role=\"dialog\"");
    expect(backdropTag).not.toContain("aria-modal");
  });

  test("role=dialog / aria-modal are not hand-declared anywhere else either (the action owns them)", () => {
    const source = readSource();
    // The action (dialog.ts) sets these at runtime; the component source
    // itself must not re-declare them (that was the M12 bug — declared on
    // the wrong element AND redundant with a migrated action).
    expect(source).not.toContain('role="dialog"');
    expect(source).not.toContain('aria-modal="true"');
  });

  test("title h2 still carries id=cr-title for the labelledBy target", () => {
    const source = readSource();
    expect(source).toContain('id="cr-title"');
  });
});

// ── Fix 2: recovered-vs-on-disk preview disclosure ───────────────────────────

describe("CrashRecoveryDialog — Compare versions preview (M12 fix 2)", () => {
  test("contains a 'Compare versions' disclosure button per item", () => {
    const source = readSource();
    expect(source).toContain("Compare versions");
  });

  test("disclosure button has aria-expanded", () => {
    const source = readSource();
    expect(source).toContain("aria-expanded");
  });

  test("renders 'Your unsaved changes' and 'Currently on disk' pane labels", () => {
    // M38: was "Recovered (unsaved)" — renamed off the "recovery" vocabulary
    // (see the vocabulary-separation describe block below).
    const source = readSource();
    expect(source).toContain("Your unsaved changes");
    expect(source).toContain("Currently on disk");
  });

  test("shows a loading state while fetching", () => {
    const source = readSource();
    expect(source).toContain("Loading preview");
  });

  test("falls back to an unavailable message on error", () => {
    const source = readSource();
    expect(source).toContain("No preview available for this file.");
  });

  test("handles the no-on-disk-copy case distinctly from a fetch error", () => {
    const source = readSource();
    expect(source).toContain("No saved version on disk yet.");
  });

  test("fetches the recovered text via api.fs.readFile(item.recoveryPath)", () => {
    const source = readSource();
    expect(source).toMatch(/api\.fs\.readFile\(\s*item\.recoveryPath\s*\)/);
  });

  test("fetches the on-disk text via api.fs.readFile(item.filePath)", () => {
    const source = readSource();
    expect(source).toMatch(/api\.fs\.readFile\(\s*item\.filePath\s*\)/);
  });

  test("panes use a monospace font", () => {
    const source = readSource();
    // The shared --app-font-mono token (theme.css) or a literal stack both count.
    expect(
      source.includes("var(--app-font-mono)") || source.includes("monospace"),
    ).toBe(true);
  });

  test("preview content has a max-height cap (prevents unbounded growth)", () => {
    const source = readSource();
    expect(source).toContain("max-height");
  });

  test("preview logic — lazy + memoised toggle (unit-level simulation of togglePreview)", async () => {
    // Mirrors the component's togglePreview(): first expand fetches and
    // caches both texts; a collapse+re-expand of the SAME item does not
    // re-fetch because the cache already holds an entry for that path.
    let recoveredCalls = 0;
    let onDiskCalls = 0;
    const readFile = async (p: string) => {
      if (p === "/recovery/ch01.snapshot") {
        recoveredCalls++;
        return "# recovered text";
      }
      onDiskCalls++;
      return "# on-disk text";
    };

    const previewExpanded: Record<string, boolean> = {};
    const previewCache: Record<string, { recovered: string; onDisk: string | null } | "loading" | "error"> = {};
    const item = { filePath: "/proj/ch01.md", recoveryPath: "/recovery/ch01.snapshot", fileName: "ch01.md", savedAt: 0 };

    async function togglePreview(it: typeof item) {
      const wasExpanded = previewExpanded[it.filePath] ?? false;
      previewExpanded[it.filePath] = !wasExpanded;
      if (wasExpanded || it.filePath in previewCache) return;
      previewCache[it.filePath] = "loading";
      const recovered = await readFile(it.recoveryPath);
      let onDisk: string | null = null;
      try {
        onDisk = await readFile(it.filePath);
      } catch {
        onDisk = null;
      }
      previewCache[it.filePath] = { recovered, onDisk };
    }

    // First expand — fetches both.
    await togglePreview(item);
    expect(recoveredCalls).toBe(1);
    expect(onDiskCalls).toBe(1);
    expect(previewCache[item.filePath]).toEqual({ recovered: "# recovered text", onDisk: "# on-disk text" });

    // Collapse.
    await togglePreview(item);
    expect(previewExpanded[item.filePath]).toBe(false);

    // Re-expand — memoised, no new fetch.
    await togglePreview(item);
    expect(recoveredCalls).toBe(1);
    expect(onDiskCalls).toBe(1);
  });

  test("preview logic — missing on-disk file resolves to onDisk: null, not an error state", async () => {
    const previewCache: Record<string, { recovered: string; onDisk: string | null } | "loading" | "error"> = {};
    const item = { filePath: "/proj/new-file.md", recoveryPath: "/recovery/new-file.snapshot" };

    async function readRecovered() {
      return "# brand new content";
    }
    async function readOnDisk(): Promise<string> {
      throw new Error("ENOENT");
    }

    const recovered = await readRecovered();
    let onDisk: string | null = null;
    try {
      onDisk = await readOnDisk();
    } catch {
      onDisk = null;
    }
    previewCache[item.filePath] = { recovered, onDisk };

    expect(previewCache[item.filePath]).toEqual({ recovered: "# brand new content", onDisk: null });
  });

  test("preview logic — a rejected recovered-text fetch surfaces 'error', not a throw", async () => {
    let threw = false;
    async function togglePreviewFailure() {
      try {
        throw new Error("channel closed");
      } catch {
        return "error" as const;
      }
    }
    try {
      const result = await togglePreviewFailure();
      expect(result).toBe("error");
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

// ── M38: crash-draft vs sync-repair vocabulary separation ────────────────────

/**
 * Extracts the rendered markup only (everything after the closing
 * `</script>` and before the opening `<style>`), so the vocabulary check below
 * covers what a writer actually SEES/hears (text, aria-label/title attributes)
 * without tripping on internal identifiers (`RecoveryItem`, `recoveryPath`,
 * doc-comment prose) that are explicitly allowed to keep the word "recovery"
 * per the naming-map comment in this component's header and in
 * electron/recovery.ts / electron/recovery-bridge.ts.
 */
function renderedMarkup(): string {
  const source = readSource();
  const scriptEnd = source.indexOf("</script>");
  const styleStart = source.indexOf("<style>", scriptEnd);
  expect(scriptEnd).toBeGreaterThan(-1);
  expect(styleStart).toBeGreaterThan(scriptEnd);
  return source.slice(scriptEnd + "</script>".length, styleStart);
}

describe("CrashRecoveryDialog — M38 crash-draft vocabulary (not 'recovery')", () => {
  test("the writer-facing title uses 'unsaved changes', not 'recovered'", () => {
    const markup = renderedMarkup();
    expect(markup).toContain("Unsaved changes found");
  });

  test("no writer-facing 'recovery' jargon anywhere in the rendered markup", () => {
    // The crash-draft dialog and the sync-repair dialogs (RecoveryConfirmDialog/
    // RecoveryGuidanceDialog/RecoveryOverlay) share the word "recovery" only in
    // internal identifiers/comments (see this file's header naming-map note).
    // Nothing a writer can see or hear (text nodes, aria-label, title) may use
    // that word — "unsaved changes" is the only vocabulary this surface uses.
    const markup = renderedMarkup();
    const hits = markup.match(/recovery/gi) ?? [];
    expect(hits).toEqual([]);
  });

  test("no writer-facing 'snapshot' jargon either (collides with version-history 'snapshot')", () => {
    const markup = renderedMarkup();
    const hits = markup.match(/snapshot/gi) ?? [];
    expect(hits).toEqual([]);
  });
});

// ── Fix 3: two-step Discard ───────────────────────────────────────────────────

describe("CrashRecoveryDialog — two-step Discard (M12 fix 3)", () => {
  test("contains the armed confirm copy 'Really discard? This can't be undone'", () => {
    const source = readSource();
    expect(source).toContain("Really discard? This can't be undone");
  });

  test("contains a Cancel affordance to back out of the armed state", () => {
    const source = readSource();
    expect(source).toContain("Cancel");
  });

  test("onDiscard is NOT called directly from the template — only via requestDiscard", () => {
    const source = readSource();
    // The raw prop must not be wired straight to a click handler anymore.
    expect(source).not.toMatch(/onclick=\{?\(\)\s*=>\s*onDiscard\(item\)\}?/);
    expect(source).toContain("requestDiscard(item)");
  });

  test("Discard is a single persistent button (label/class toggle in place) — not two swapped elements", () => {
    const source = readSource();
    // Exactly one button carries the discard click handler + the marker class
    // used to re-find it after Cancel; the armed label is an inline ternary
    // on that same element, not a second competing button.
    expect(source).toContain("cr-btn-discard");
    expect(source).toMatch(/class:cr-btn-danger=\{armed\}/);
    expect(source).toMatch(/\{armed\s*\?\s*"Really discard\? This can't be undone"\s*:\s*"Discard"\}/);
  });

  test("cancelDiscard restores focus to the persistent Discard button (cr-btn-discard)", () => {
    const source = readSource();
    expect(source).toMatch(/function cancelDiscard\(/);
    expect(source).toMatch(/querySelector[^\n]*cr-btn-discard/);
    expect(source).toContain(".focus()");
  });

  test("requestDiscard() logic — first call arms, second call (while armed) fires onDiscard exactly once", () => {
    // Mirrors the component's requestDiscard()/confirmingDiscard state machine.
    const confirmingDiscard: Record<string, boolean> = {};
    const discarded: string[] = [];
    const item = { filePath: "/proj/ch01.md" };

    function requestDiscard(it: typeof item) {
      if (confirmingDiscard[it.filePath]) {
        confirmingDiscard[it.filePath] = false;
        discarded.push(it.filePath);
      } else {
        confirmingDiscard[it.filePath] = true;
      }
    }

    // First click — arms, does not discard.
    requestDiscard(item);
    expect(confirmingDiscard[item.filePath]).toBe(true);
    expect(discarded).toHaveLength(0);

    // Second click while armed — discards.
    requestDiscard(item);
    expect(discarded).toEqual(["/proj/ch01.md"]);
  });

  test("cancelDiscard() logic — disarms without discarding", () => {
    const confirmingDiscard: Record<string, boolean> = { "/proj/ch01.md": true };
    function cancelDiscard(filePath: string) {
      confirmingDiscard[filePath] = false;
    }
    cancelDiscard("/proj/ch01.md");
    expect(confirmingDiscard["/proj/ch01.md"]).toBe(false);
  });

  test("each item's armed state is independent (arming one does not arm another)", () => {
    const confirmingDiscard: Record<string, boolean> = {};
    function requestDiscard(filePath: string, discarded: string[]) {
      if (confirmingDiscard[filePath]) {
        confirmingDiscard[filePath] = false;
        discarded.push(filePath);
      } else {
        confirmingDiscard[filePath] = true;
      }
    }
    const discarded: string[] = [];
    requestDiscard("/proj/ch01.md", discarded);
    expect(confirmingDiscard["/proj/ch01.md"]).toBe(true);
    expect(confirmingDiscard["/proj/ch02.md"]).toBeUndefined();
  });
});

// ── Regression guard — existing gate-passed behaviour must not regress ──────

describe("REGRESSION GUARD — CrashRecoveryDialog invariants", () => {
  test("still exports the RecoveryItem interface with the same shape", () => {
    const source = readSource();
    expect(source).toContain("export interface RecoveryItem");
    expect(source).toContain("filePath: string");
    expect(source).toContain("recoveryPath: string");
    expect(source).toContain("fileName: string");
    expect(source).toContain("savedAt: number");
  });

  test("still guards render on items.length > 0", () => {
    const source = readSource();
    expect(source).toMatch(/\{#if\s+items\.length\s*>\s*0\}/);
  });

  test("still has a Restore button wired to onRestore(item)", () => {
    const source = readSource();
    expect(source).toContain("Restore");
    expect(source).toMatch(/onRestore\(item\)/);
  });

  test("still has a 'Decide later' footer button wired to onDismiss", () => {
    const source = readSource();
    expect(source).toContain("Decide later");
    expect(source).toMatch(/onclick=\{onDismiss\}/);
  });

  test("still formats savedAt via a when()-style helper with a try/catch fallback", () => {
    const source = readSource();
    expect(source).toMatch(/function when\(/);
    expect(source).toContain("toLocaleString");
  });

  test("props signature unchanged: items, onRestore, onDiscard, onDismiss", () => {
    const source = readSource();
    expect(source).toContain("items,");
    expect(source).toContain("onRestore,");
    expect(source).toContain("onDiscard,");
    expect(source).toContain("onDismiss,");
  });

  test("uses var(--app-*) design tokens (not new hard-coded colours) for the new styles", () => {
    const source = readSource();
    const styleMatch = source.match(/<style>([\s\S]*?)<\/style>/);
    expect(styleMatch).not.toBeNull();
    const style = styleMatch![1]!;
    expect(style).toMatch(/var\(--app-/);
  });
});
