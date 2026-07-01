/**
 * Regression guard for the RecoveryGuidanceDialog CTA routing in +page.svelte.
 *
 * The original defect: the guidance dialog's primary button was wired to
 * `onSyncReconnect` for EVERY recovery kind, so an interrupted-operation /
 * generic failure opened the reconnect/setup flow — the wrong action. The fix
 * routes the primary button BY the guidance's machine `recommendedActionKey`.
 *
 * These are source-level assertions (no browser DOM), matching the style of
 * RecoveryGuidanceDialog.test.ts. They lock in the wiring so a future edit can't
 * silently regress to always-reconnect.
 */

import { describe, test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const PAGE_PATH = path.resolve(__dirname, "../../src/routes/+page.svelte");

/** Extract the body of the onRecoveryGuidancePrimary() function (best-effort brace match). */
function extractRoutingFn(source: string): string {
  const start = source.indexOf("function onRecoveryGuidancePrimary");
  expect(start).toBeGreaterThan(-1);
  // Walk from the first "{" after the signature, matching braces to the end.
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error("Could not brace-match onRecoveryGuidancePrimary");
}

describe("RecoveryGuidanceDialog CTA routing (+page.svelte)", () => {
  test("dialog primary is wired to the kind-aware router, NOT always-reconnect", async () => {
    const src = await readFile(PAGE_PATH, "utf-8");
    // The dialog must call the router, not onSyncReconnect directly.
    expect(src).toMatch(/onPrimary=\{onRecoveryGuidancePrimary\}/);
    expect(src).not.toMatch(/<RecoveryGuidanceDialog[\s\S]*?onPrimary=\{onSyncReconnect\}/);
  });

  test("router switches on recommendedActionKey", async () => {
    const src = await readFile(PAGE_PATH, "utf-8");
    const body = extractRoutingFn(src);
    expect(body).toContain("recommendedActionKey");
    // Every machine key produced by the lib must have a branch.
    for (const key of [
      "reconnect",
      "check_connection",
      "sync",
      "resolve_conflict",
      "restore_repo",
      "open_log",
    ]) {
      expect(body).toContain(`"${key}"`);
    }
  });

  test("only the reconnect key routes to onSyncReconnect", async () => {
    const src = await readFile(PAGE_PATH, "utf-8");
    const body = extractRoutingFn(src);
    // onSyncReconnect appears exactly once in the router — under the reconnect case.
    const occurrences = (body.match(/onSyncReconnect\(\)/g) ?? []).length;
    expect(occurrences).toBe(1);
    // And that call sits after the "reconnect" case label, before the next case.
    const reconnectIdx = body.indexOf('case "reconnect"');
    const reconnectCall = body.indexOf("onSyncReconnect()");
    expect(reconnectIdx).toBeGreaterThan(-1);
    expect(reconnectCall).toBeGreaterThan(reconnectIdx);
  });

  test("the generic/unknown (open_log/default) branch does NOT fall back to reconnect", async () => {
    const src = await readFile(PAGE_PATH, "utf-8");
    const body = extractRoutingFn(src);
    // Isolate everything from the open_log/default label to the end of the switch.
    const defaultIdx = Math.max(body.indexOf('case "open_log"'), body.indexOf("default:"));
    expect(defaultIdx).toBeGreaterThan(-1);
    const tail = body.slice(defaultIdx);
    // The default arm must never invoke the reconnect flow — the exact original bug.
    expect(tail).not.toContain("onSyncReconnect()");
    expect(tail).not.toContain("advancedSetupOpen = true");
    expect(tail).not.toContain("githubOpen = true");
  });
});
