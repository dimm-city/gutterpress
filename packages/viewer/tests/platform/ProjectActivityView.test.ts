/**
 * TDD — tests for ProjectActivityView.svelte (UX review H2 restore UI, M37
 * log-surface consolidation).
 *
 * No component-render harness exists for Svelte 5 SFCs in this repo; these
 * tests follow the established source-level-analysis pattern used for other
 * component files (RecoveryConfirmDialog.test.ts, RecoveryOverlay.test.ts):
 * assert on the compiled-away script/template/style text directly.
 *
 * Test surface:
 *  1. PWA-cleanliness (§8) — no lib/node value imports
 *  2. H2 — a Restore action exists per snapshot entry, wired to
 *     api.vcs.restoreSnapshot
 *  3. H2 — plain-language confirmation copy before restoring
 *  4. H2 — a busy/"Restoring…" state while the call is in flight
 *  5. H2 — friendly error handling on a failed restore (routed through
 *     friendlyHostError, not raw e.message)
 *  6. H2 — onRestored fires after a successful restore, and the history list
 *     reloads so a new safety snapshot appears
 *  7. H2/L8 — refreshHistory() is exported for the parent's sync-completion
 *     wiring
 *  8. M37 — loadOlder's fetch is guarded (no unhandled promise rejection)
 *  9. M37 — the raw operation log sits behind a "Technical details" disclosure
 * 10. M37 — history/log load errors are also routed through friendlyHostError
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const COMPONENT_PATH = path.resolve(
  __dirname,
  "../../src/lib/components/ProjectActivityView.svelte",
);

function readSource(): string {
  return fs.readFileSync(COMPONENT_PATH, "utf8");
}

const FORBIDDEN_VALUE_IMPORTS = [
  /from\s+["']@dimm-city\/print-md["']/,
  /from\s+["']node:/,
  /require\s*\(\s*["']node:/,
  /from\s+["']fs["']/,
  /from\s+["']path["']/,
  /from\s+["']url["']/,
  /from\s+["']child_process["']/,
  /from\s+["']isomorphic-git["']/,
];

describe("ProjectActivityView — PWA-cleanliness (§8)", () => {
  test("component source file exists", () => {
    expect(fs.existsSync(COMPONENT_PATH)).toBe(true);
  });

  test("does NOT value-import @dimm-city/print-md or node builtins", () => {
    const src = readSource();
    for (const pattern of FORBIDDEN_VALUE_IMPORTS) {
      const lines = src.split("\n").filter((l) => pattern.test(l) && !/import\s+type\s/.test(l));
      expect(lines).toHaveLength(0);
    }
  });

  test("all host work goes through the typed api wrapper", () => {
    const src = readSource();
    expect(src).toContain('from "$lib/api"');
    expect(src).not.toMatch(/window\.electron/);
    expect(src).not.toMatch(/ipcRenderer/);
  });
});

describe("ProjectActivityView — H2 restore action", () => {
  test("calls api.vcs.restoreSnapshot with the project dir and snapshot id", () => {
    const src = readSource();
    expect(src).toMatch(/api\.vcs\.restoreSnapshot\(\s*projectDir\s*,\s*id\s*\)/);
  });

  test("a Restore control exists per history entry, keyed off the row's own armed state", () => {
    const src = readSource();
    expect(src).toContain("armRestore(entry.id)");
    expect(src).toContain("restoreConfirmId === entry.id");
  });

  test("shows a plain-language confirmation before restoring (no git jargon in the prompt)", () => {
    const src = readSource();
    expect(src).toContain("We'll save what you have now first");
    // The confirmation copy itself must not say "commit" — it's addressed to
    // the non-technical audience even though the operation is a git checkout.
    const confirmLine = src
      .split("\n")
      .find((l) => l.includes("We'll save what you have now first"));
    expect(confirmLine ?? "").not.toMatch(/\bcommit\b/i);
  });

  test("has a distinct busy/'Restoring…' state gated on the in-flight row", () => {
    const src = readSource();
    expect(src).toContain("restoringId === entry.id");
    expect(src).toContain("Restoring…");
  });

  test("only one row can be armed or restoring at a time (other Restore buttons disabled)", () => {
    const src = readSource();
    expect(src).toMatch(/disabled=\{restoringId !== null\}/);
  });

  test("a failed restore is routed through friendlyHostError, not raw e.message", () => {
    const src = readSource();
    const confirmRestoreBody = src.slice(
      src.indexOf("async function confirmRestore("),
      src.indexOf("async function loadHistory("),
    );
    expect(confirmRestoreBody).toMatch(/catch\s*\(e\)\s*\{[\s\S]*friendlyHostError\(/);
  });

  test("restore error is rendered as an alert scoped to the affected row", () => {
    const src = readSource();
    expect(src).toMatch(/restoreError[\s\S]{0,160}role="alert"/);
  });

  test("a successful restore reloads history and calls onRestored", () => {
    const src = readSource();
    const confirmRestoreBody = src.slice(
      src.indexOf("async function confirmRestore("),
      src.indexOf("async function loadHistory("),
    );
    expect(confirmRestoreBody).toContain("await loadHistory()");
    expect(confirmRestoreBody).toContain("onRestored?.()");
  });

  test("onRestored is an optional prop the parent can supply", () => {
    const src = readSource();
    expect(src).toMatch(/onRestored\?:\s*\(\)\s*=>\s*void/);
  });
});

describe("ProjectActivityView — H2/L8 refreshHistory export", () => {
  test("exports a refreshHistory() function for the parent's sync-completion wiring", () => {
    const src = readSource();
    expect(src).toMatch(/export function refreshHistory\(\)\s*\{/);
  });
});

describe("ProjectActivityView — M37 guarded loadOlder", () => {
  test("loadOlder's fetch is wrapped in try/catch (no unhandled rejection)", () => {
    const src = readSource();
    const loadOlderBody = src.slice(
      src.indexOf("async function loadOlder("),
      src.indexOf("async function loadLog("),
    );
    expect(loadOlderBody).toContain("try {");
    expect(loadOlderBody).toMatch(/catch\s*\(e\)\s*\{/);
  });

  test("loadOlder guards against a concurrent in-flight call", () => {
    const src = readSource();
    const loadOlderBody = src.slice(
      src.indexOf("async function loadOlder("),
      src.indexOf("async function loadLog("),
    );
    expect(loadOlderBody).toMatch(/loadingOlder/);
  });
});

describe("ProjectActivityView — M37 log surface", () => {
  test("the raw operation log sits behind a 'Technical details' disclosure", () => {
    const src = readSource();
    expect(src).toMatch(/<details[^>]*>[\s\S]*?<summary>Technical details<\/summary>[\s\S]*?<pre>\{logContent\}<\/pre>[\s\S]*?<\/details>/);
  });

  test("history/log load failures are routed through friendlyHostError", () => {
    const src = readSource();
    const loadHistoryBody = src.slice(
      src.indexOf("async function loadHistory("),
      src.indexOf("export function refreshHistory"),
    );
    const loadLogBody = src.slice(
      src.indexOf("async function loadLog("),
      src.indexOf("function when("),
    );
    expect(loadHistoryBody).toMatch(/catch\s*\(e\)\s*\{[\s\S]*friendlyHostError\(/);
    expect(loadLogBody).toMatch(/catch\s*\(e\)\s*\{[\s\S]*friendlyHostError\(/);
  });

  test("imports friendlyHostError from the shared errors module", () => {
    const src = readSource();
    expect(src).toContain('import { friendlyHostError } from "$lib/errors"');
  });
});
