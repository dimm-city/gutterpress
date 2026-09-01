import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { openHarnessSession, waitForHarnessReady, type HarnessSession } from "@dimm-city/gutterpress-editor/test-harness";

/**
 * SFE-P3c Lane C — CONFIRMED FINDING, filed against files outside this
 * lane's write boundary. See this run's report for the full account; this
 * file is the committed, runnable reproduction.
 *
 * DELIBERATELY NOT wired into `package.json`'s `test:browser` script (which
 * chains `mount`/`fallback`/`disposal`/`csp-inertness` with `&&`): this
 * test's own FAILURE is the expected, correct signal until the defect below
 * is fixed, and letting it abort that chain would hide the other four
 * suites' real, passing status behind an unrelated failure. Run it directly
 * — `bun test ./tests/webview/known-issue-edit-version-reconciliation.btest.ts`
 * — to reproduce or to verify a fix.
 *
 * CLAIM: an ordinary, accepted-looking edit in the webview NEVER reaches
 * the host's authoritative document — not "sometimes", not "under a race",
 * but on the FIRST keystroke of every real session, deterministically,
 * with no diagnostic and no visible error. This is exactly what D2/D3 exist
 * to prevent ("exact Markdown source is the only authoritative document";
 * a rejected edit must "change nothing" and be OBSERVABLE as rejected) —
 * the editor's own rendered view shows the edit as applied while the true
 * authoritative text silently diverges underneath it.
 *
 * ROOT CAUSE: `../../src/webview-host/proxy-document-host.ts`'s
 * `ProxyDocumentHost` computes and posts `SourceEdit.expectedVersion` from
 * its own LOCAL mirror version counter (by design — that class's own
 * header: "The mirror's version counter is LOCAL and monotonic; the host's
 * `TextDocument.version` is never exposed to the editor and the two are
 * never conflated") — but the wire `ApplyEditMessage` carries that SAME
 * `expectedVersion` value VERBATIM to the host
 * (`../../src/host/document-gateway.ts`'s `DocumentGateway.applyEdit`),
 * which compares it against the REAL `vscode.TextDocument.version` (or, in
 * this suite, the fake host's own independent version counter — see
 * `support/fake-extension-host.ts`, which reuses the SAME pure `applyEdit`
 * every real host uses, so this reproduces a real `DocumentGateway`'s
 * behavior faithfully, not a fake-host-only artifact).
 *
 * These two counters are NEVER the same number in practice:
 *   1. `ProxyDocumentHost` starts its mirror at an arbitrary placeholder
 *      version (`../../src/webview/index.ts` passes `{text: "", version:
 *      0}` at construction — required, since the real initial text/version
 *      is not known until the handshake's `snapshot` reply arrives later).
 *   2. That FIRST `snapshot` reply always differs in text from the empty
 *      placeholder, so it converges via `replaceExternal`, which
 *      unconditionally bumps the mirror's LOCAL version by exactly 1 (0 ->
 *      1) — regardless of what the host's OWN real version actually is.
 *   3. The very next real edit's `expectedVersion` is therefore 1 — a
 *      number with no relationship to the host's real version (which could
 *      be 0, 1, or any other value a real, previously-edited
 *      `vscode.TextDocument` happens to carry).
 *   4. The host's `applyEditPure` rejects almost every such edit as
 *      "stale" (`expectedVersion !== currentVersion` —
 *      `packages/editor/src/core/apply-edit.ts`), and replies with the
 *      document's UNCHANGED snapshot at the host's OWN (unchanged) version.
 *   5. That rejection reply is then ITSELF silently dropped by
 *      `ProxyDocumentHost#handleSnapshot`'s own de-duplication guard
 *      (`if (snapshot.version <= this.#lastSeenHostVersion) return;`) —
 *      `#lastSeenHostVersion` was already set to the host's version by the
 *      INITIAL convergence reply in step 2, and an unchanged host never
 *      produces a version newer than that. The mirror therefore never
 *      learns its edit was rejected, and the divergence is permanent and
 *      compounding (every subsequent keystroke repeats steps 3-5 against
 *      an ever-growing mirror version, all while the host's real version
 *      never moves).
 *
 * WHY THIS ESCAPED `tests/webview-host/proxy-document-host.test.ts` (Lane
 * A's own unit suite for this exact class, built on the SAME
 * `SimulatedExtensionHost`/`createSimulatedProxyPair` infrastructure this
 * file also uses): every `applyEdit(...)` call in that suite uses
 * `expectedVersion: 0` against a `proxy` that has NOT yet processed any
 * convergence — i.e., it submits its edit BEFORE the initial handshake
 * reply, when the mirror is still at its unconverged placeholder version
 * (also 0), so the two counters coincidentally match by never letting them
 * diverge in the first place. A real webview session cannot do this — a
 * user cannot type before the document has loaded, so the initial
 * convergence (and its version bump) ALWAYS happens first in production.
 *
 * A CANDIDATE FIX DIRECTION (observation only — narrowed and reported per
 * the run spec's own binding instruction: "A lane that finds this model
 * unsound narrows and reports; it does not widen it into optimistic
 * reconciliation heuristics"; this is Lane A's file to design and fix, not
 * this lane's): `ProxyDocumentHost` already tracks the last REAL host
 * version it has proof of (`#lastSeenHostVersion`) for filtering INBOUND
 * messages; it does not currently use that same value for OUTBOUND ones.
 * Substituting the wire `ApplyEditMessage`'s `expectedVersion` with
 * `#lastSeenHostVersion` (rather than the mirror's own local counter) at
 * the point of POSTING to the transport — while leaving the mirror's own
 * LOCAL version untouched for every other purpose (D1's own vocabulary,
 * `getSnapshot()`, and the D3 checks against the MIRROR) — would translate
 * between the two version spaces only at the wire boundary, without
 * un-doing the "local, never conflated" property the binding text
 * describes for the mirror's own editor-facing API.
 */

const entryPath = resolve(import.meta.dir, "support/entry.ts");

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

describe("CONFIRMED FINDING: a normal, accepted-looking keystroke never reaches the fake host's authoritative document", () => {
  test("hostText/hostVersion move to reflect the edit after a single real keystroke (currently fails — see this file's header)", async () => {
    await harness.page.evaluate((text: string) => window.__gpWebview.mount(text), "reg text");
    await harness.page.waitForFunction(
      (expected: string) => window.__gpWebview.documentText() === expected,
      "reg text",
      { timeout: 5_000 },
    );
    // AP-21 liveness before the behavioral assertion below.
    expect(
      await harness.page.evaluate(
        () => document.querySelectorAll(`${window.__gpWebview.containerSelector} .md-editor`).length,
      ),
    ).toBe(1);

    await harness.page.click("#gp-editor-root");
    await harness.page.keyboard.press("End");
    await harness.page.keyboard.type("!");
    await harness.page.waitForTimeout(150);

    // The mirror's OWN optimistic view already shows the edit as applied —
    // this half is NOT the defect, and stays true regardless of the
    // assertions below.
    expect(await harness.page.evaluate(() => window.__gpWebview.documentText())).toBe("reg text!");

    // THE ACTUAL CLAIM (D2/D3): an edit the editor treats as accepted must
    // reach the authoritative document, or the webview must be told it was
    // rejected. Today, neither happens — the assertions below FAIL,
    // reproducing the defect this file's header describes.
    expect(await harness.page.evaluate(() => window.__gpWebview.hostText())).toBe("reg text!");
    expect(await harness.page.evaluate(() => window.__gpWebview.hostVersion())).toBe(1);
  });
});

describe("harness liveness", () => {
  test("the shared session produced no console or page errors", () => {
    expect(harness.consoleErrors).toEqual([]);
    expect(harness.pageErrors).toEqual([]);
  });
});
