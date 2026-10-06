import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  openHarnessSession,
  waitForHarnessReady,
  type HarnessSession,
} from "../browser-harness/index.ts";
import { generateMarkdownCorpus, KIB, MIB } from "./support/corpus.ts";
import { mountDocument, typeAndMeasure } from "./support/drive.ts";
import { formatSummary, summarize, type Summary } from "./support/stats.ts";
import {
  CADENCE_MS,
  D13_BUDGET_MS,
  SAMPLE_KEYSTROKES,
  TYPING_PHRASE,
  WARMUP_KEYSTROKES,
} from "./support/constants.ts";

/**
 * SFE-P3d-sweep Lane B — the D13 performance evidence: real REAL-Chromium
 * mount-to-interactive and edit-to-paint measurements against the REAL
 * `mountEditor` fork surface, at 25 KiB / 100 KiB / 250 KiB / 1 MiB, gated
 * ONLY where D13 itself names a gate (250 KiB p95 < 100ms) — every other
 * number is RECORDED, not gated, per this run's own DETAILS ("inventing
 * extra gates is machinery").
 *
 * Methodology is documented in full in `support/entry.ts`'s header
 * (measurement primitive + why) and this run's audit doc section
 * (`docs/plans/source-first-editor/p3d-sweep-audit.md`, "## Lane B") — this
 * file's own comments cover only what is local to running it.
 *
 * ONE shared browser session drives every case (`beforeAll`/`afterAll`),
 * matching `tests/browser-harness/index.ts`'s own documented reason (a
 * fresh Chromium launch per `test()` hangs on the second launch in this
 * sandboxed environment).
 *
 * AP-21 liveness: every measured size asserts its sample count reached the
 * expected number BEFORE any percentile assertion — an empty or truncated
 * result never silently reads as "fast."
 */

const entryPath = resolve(import.meta.dir, "support/entry.ts");
const TOTAL_KEYSTROKES = WARMUP_KEYSTROKES + SAMPLE_KEYSTROKES;

let harness: HarnessSession;
let closeHarness: () => Promise<void>;

beforeAll(async () => {
  const opened = await openHarnessSession(entryPath);
  harness = opened.session;
  closeHarness = opened.close;
  await waitForHarnessReady(harness.page);
}, 30_000);

afterAll(async () => {
  await closeHarness();
});

interface SizeResult {
  readonly label: string;
  readonly docBytes: number;
  readonly mountMs: number;
  readonly edit: Summary;
}

/** Mounts a `targetBytes` document, types `TOTAL_KEYSTROKES` characters at
 * `CADENCE_MS`, and summarizes the post-warm-up edit-to-paint samples. */
async function measureSize(label: string, targetBytes: number): Promise<SizeResult> {
  const text = generateMarkdownCorpus(targetBytes);
  const docBytes = text.length; // ASCII-only corpus — see corpus.ts header.
  const { selector, mountMs } = await mountDocument(harness.page, text);
  const all = await typeAndMeasure(harness.page, selector, TOTAL_KEYSTROKES, CADENCE_MS, TYPING_PHRASE);

  // AP-21 liveness — before any behavioral/percentile assertion.
  expect(all.length).toBe(TOTAL_KEYSTROKES);

  const samples = all.slice(WARMUP_KEYSTROKES);
  const edit = summarize(samples);
  console.log(`[perf] ${label} (${docBytes} bytes): mount-to-interactive=${mountMs.toFixed(1)}ms edit-to-paint ${formatSummary(edit)}`);
  return { label, docBytes, mountMs, edit };
}

describe("D13 performance evidence — mount-to-interactive and edit-to-paint", () => {
  test("25 KiB — recorded, not gated", async () => {
    await measureSize("25 KiB", 25 * KIB);
  }, 120_000);

  test("100 KiB — recorded, not gated", async () => {
    await measureSize("100 KiB", 100 * KIB);
  }, 120_000);

  test("250 KiB — run 1 of 2 — D13's stated gate: p95 edit-to-paint < 100ms", async () => {
    const result = await measureSize("250 KiB run 1", 250 * KIB);
    expect(result.edit.p95).toBeLessThan(D13_BUDGET_MS);
  }, 120_000);

  test("250 KiB — run 2 of 2 — variance honesty; same gate applies", async () => {
    // A second, independent mount/type pass over the SAME 250 KiB corpus
    // (generateMarkdownCorpus is deterministic — see corpus.ts), so run 1
    // and run 2 differ only in whatever the browser/runtime itself
    // contributes run to run, not in input. This run's DETAILS require the
    // 250 KiB measurement at least twice "in-process" and both reported;
    // the same D13 assertion is applied to both rather than only the
    // first, so a regression that only shows up on the second pass is not
    // silently left unasserted.
    const result = await measureSize("250 KiB run 2", 250 * KIB);
    expect(result.edit.p95).toBeLessThan(D13_BUDGET_MS);
  }, 120_000);

  test("1 MiB — recorded, not gated (under the 2 MiB rich-mode ceiling, so it mounts)", async () => {
    // D13: "Rich mode supports files up to 2 MiB." 1 MiB is under that
    // ceiling, so `mountEditor` is called directly, exactly as a real host
    // would for a file this size — there is no smaller-scale fallback to
    // report here, only the real numbers, however they land, "even if
    // ugly" per this run's own DETAILS. A generous outer timeout (comfortably
    // above `support/entry.ts`'s own 90s `MAX_QUIESCENCE_WAIT_MS` safety net
    // plus headroom for the typing phase) so a genuinely slow mount is
    // reported as a real number by that inner safety net rather than cut
    // off by an uninformative outer bun:test timeout first.
    await measureSize("1 MiB", 1 * MIB);
  }, 240_000);
});
