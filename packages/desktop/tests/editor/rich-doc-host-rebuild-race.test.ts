/**
 * rich-doc-host-rebuild-race.test.ts (SFE-P3d-sweep, Lane C — scenario 15
 * gap closure: "a switch DURING an in-flight projection build landing in
 * the right final state").
 *
 * ## Audit finding this file closes
 *
 * `+page.svelte`'s `rebuildRichDocHost` (source, ~lines 1521-1620) guards
 * every async `buildRichProjection(...)` publish with an epoch counter:
 *
 *   richDocHostEpoch += 1;
 *   const epoch = richDocHostEpoch;
 *   ...
 *   richDocHostPending = buildRichProjection(content, nextHost.getSnapshot().version)
 *     .then((result) => {
 *       if (epoch !== richDocHostEpoch) return;   // <-- the guard this file proves
 *       richProjection = result.projection;
 *       richPluginCss = result.pluginCss;
 *       richDocHost = nextHost;
 *     })
 *     .finally(() => {
 *       if (epoch === richDocHostEpoch) richDocHostPending = null;
 *     });
 *
 * `disposeRichDocHost` and every later call to `rebuildRichDocHost` also
 * bump the epoch, so a rebuild superseded by a NEWER file switch (or a
 * leave-rich-mode) before its own async round trip resolves must never
 * publish over whatever superseded it. The doc comment on
 * `richDocHostEpoch` names this exact scenario ("an in-flight
 * buildRichProjection result can tell whether it is still wanted").
 *
 * `commit-engine.test.ts`'s "SFE-P3e round 2: cross-chapter commit vs. an
 * in-flight rich-host publish" suite (read in full for this audit; the file
 * itself was deleted by SFE-P4 along with `CommitEngine` — see git history)
 * proved the ADJACENT half of this mechanism — that `selectEditorFile`
 * awaited `richDocHostPending` so a commit issued immediately after a
 * cross-chapter switch was never silently dropped. It exercised exactly ONE
 * in-flight build at a time and never triggered a SECOND switch while the
 * first was still pending, so it did not exercise the epoch guard's own
 * job at all.
 * `rich-mode.test.ts`'s file-switch describe block proves `RichModeController`
 * (mode/epoch bookkeeping one layer up, unrelated to `richDocHostEpoch`)
 * bumps its OWN epoch and preserves the current mode across `onFileSwitch`
 * calls — it has no async build step to race, so it cannot exercise this
 * either. A repo-wide search confirms zero prior test references
 * `richDocHostEpoch` (verified before writing this file).
 *
 * ## Why this is a model, not an import
 *
 * `richDocHostEpoch`/`richDocHostPending`/`rebuildRichDocHost` are private
 * closure state inside `+page.svelte` — a large Svelte SFC `bun:test`
 * cannot compile or import directly, the same limitation
 * `file-tree-open-file-rename-delete.test.ts`'s "Wiring check" section and
 * the now-deleted `commit-engine.test.ts`'s own "SFE-P3e round 2" header
 * both documented for this identical file. `commit-engine.test.ts` worked
 * around that limit by modeling the exact seam with fakes, toggling ONE
 * behavior under test (`awaitPending`) so the same harness proved both the
 * pre-fix defect and the fix. This file follows that established precedent: `RichDocHostHarness`
 * below is a faithful, line-verified model of `rebuildRichDocHost`'s epoch
 * algorithm (guardEnabled toggles exactly the `if (epoch !== richDocHostEpoch)
 * return;` line quoted above), not a re-description of it — every assertion
 * is driven by the SAME algorithm the production code runs, with async
 * resolution order controlled explicitly (deferred promises, not timers) so
 * the race is deterministic rather than timing-dependent.
 *
 * AP-21/G-12 ("a gate must prove it can fail"): the `guardEnabled: false`
 * variant reproduces the shape `rebuildRichDocHost` would have WITHOUT its
 * epoch check — i.e. the exact defect class this mechanism exists to
 * prevent — so the fixed-shape assertions above it are proven to have real
 * discriminating power, not just to pass regardless of the guard.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

interface Published {
  readonly path: string;
  readonly content: string;
}

/**
 * Faithful model of `rebuildRichDocHost`'s epoch-guarded async publish.
 * `rebuild()` returns a `resolve()` the test calls to control exactly when
 * that rebuild's modeled `buildRichProjection(...)` round trip completes —
 * standing in for the real IPC round trip's timing, under full test control
 * instead of a real (flaky) delay.
 */
class RichDocHostHarness {
  private epoch = 0;
  published: Published | null = null;
  /** Every publish that actually landed, in order — lets a test tell a
   *  discarded/superseded build apart from one that legitimately never
   *  resolved yet. */
  readonly publishLog: string[] = [];
  /** True once a rebuild's `.finally()` has run without being superseded in
   *  the meantime — mirrors `richDocHostPending` becoming `null`. */
  settledEpochs = new Set<number>();

  constructor(private readonly guardEnabled: boolean) {}

  rebuild(path: string, content: string): { resolve: () => void } {
    this.epoch += 1;
    const epoch = this.epoch;
    const gate = deferred<void>();
    gate.promise
      .then(() => {
        // The exact line under test: `if (epoch !== richDocHostEpoch) return;`
        if (this.guardEnabled && epoch !== this.epoch) return;
        this.published = { path, content };
        this.publishLog.push(path);
      })
      .finally(() => {
        if (epoch === this.epoch) this.settledEpochs.add(epoch);
      });
    return { resolve: gate.resolve };
  }
}

describe("rich-doc-host rebuild epoch guard — a file switch during an in-flight projection build lands in the right final state", () => {
  test("control: a single switch's build resolving normally publishes it (the guard does not block ordinary resolution)", async () => {
    const h = new RichDocHostHarness(true);
    const a = h.rebuild("/proj/a.md", "A content");
    a.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(h.published).toEqual({ path: "/proj/a.md", content: "A content" });
    expect(h.publishLog).toEqual(["/proj/a.md"]);
  });

  test("a second switch (to C) while the first (B)'s build is still in flight, then B resolving AFTER C already published: B's late publish is discarded — C's remains the final state", async () => {
    const h = new RichDocHostHarness(true);
    const b = h.rebuild("/proj/b.md", "B content");
    // A second file switch before B's build has resolved at all — this is
    // exactly `rebuildRichDocHost` being called again while
    // `richDocHostPending` from the B call is still outstanding.
    const c = h.rebuild("/proj/c.md", "C content");

    // C's build (the current, wanted one) resolves first.
    c.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.published).toEqual({ path: "/proj/c.md", content: "C content" });

    // B's slower build FINALLY resolves — strictly after C already
    // published. Without the epoch guard this is exactly the shape that
    // would silently revert the visible document to B's stale content.
    b.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // THE LOAD-BEARING ASSERTION: B's late-arriving publish never lands.
    expect(h.published).toEqual({ path: "/proj/c.md", content: "C content" });
    expect(h.publishLog).toEqual(["/proj/c.md"]);
    // C (the current epoch) is marked settled by its own `.finally()`,
    // mirroring `richDocHostPending = null`. B's `.finally()` intentionally
    // does NOT mark epoch 1 settled — mirroring `.finally(() => { if (epoch
    // === richDocHostEpoch) richDocHostPending = null; })`'s own guard,
    // which exists so a SUPERSEDED rebuild's finally can never null out a
    // NEWER rebuild's still-live `richDocHostPending` reference. Both
    // outcomes are the real, intended shape — not a leak.
    expect(h.settledEpochs.has(2)).toBe(true);
    expect(h.settledEpochs.has(1)).toBe(false);
  });

  test("the SAME race with resolution order reversed (B resolves first, then C) still lands on C — order-independent, not a lucky timing win above", async () => {
    const h = new RichDocHostHarness(true);
    const b = h.rebuild("/proj/b.md", "B content");
    const c = h.rebuild("/proj/c.md", "C content");

    // B resolves first this time. It is STILL superseded (epoch 1 !== current
    // epoch 2) at the moment it resolves, so it must still be discarded —
    // the guard compares against the CURRENT epoch, not "did I resolve
    // before the next switch was requested."
    b.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.published).toBeNull(); // C hasn't resolved yet, and B was discarded

    c.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.published).toEqual({ path: "/proj/c.md", content: "C content" });
    expect(h.publishLog).toEqual(["/proj/c.md"]);
  });

  test("three switches in flight at once (A, B, C — only C requested last): only C ever publishes, regardless of A/B/C resolution order", async () => {
    const h = new RichDocHostHarness(true);
    const a = h.rebuild("/proj/a.md", "A content");
    const b = h.rebuild("/proj/b.md", "B content");
    const c = h.rebuild("/proj/c.md", "C content");

    // Resolve in the "most stale first" order — the order most likely to
    // expose a guard that only compares against the IMMEDIATELY previous
    // epoch instead of the current one.
    a.resolve();
    b.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.published).toBeNull();

    c.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.published).toEqual({ path: "/proj/c.md", content: "C content" });
    expect(h.publishLog).toEqual(["/proj/c.md"]);
  });

  // ── AP-21/G-12: prove the assertions above have teeth ──────────────────
  test("WITHOUT the epoch guard, B's late publish DOES clobber C — proving the fixed-shape assertions above are not vacuous", async () => {
    // guardEnabled: false reproduces `rebuildRichDocHost` with its
    // `if (epoch !== richDocHostEpoch) return;` line deleted — the exact
    // defect class this mechanism exists to prevent.
    const h = new RichDocHostHarness(false);
    const b = h.rebuild("/proj/b.md", "B content");
    const c = h.rebuild("/proj/c.md", "C content");

    c.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.published?.path).toBe("/proj/c.md");

    b.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The un-guarded shape lands on the WRONG final state: the author
    // switched to C, but the visible document silently reverts to B's
    // (older, unwanted) content because it happened to resolve last.
    expect(h.published?.path).toBe("/proj/b.md");
    expect(h.publishLog).toEqual(["/proj/c.md", "/proj/b.md"]);
  });
});

// ── Tying the model above to the real, current source ──────────────────────
// `RichDocHostHarness` proves the ALGORITHM is correct in isolation; it
// cannot prove +page.svelte still CONTAINS that algorithm, since nothing in
// this file can import or call the real closures (see this file's header).
// This structural pin closes that gap the same way
// `file-tree-open-file-rename-delete.test.ts`'s "Wiring check" section pins
// other unextractable `.svelte` logic — a source-text assertion tied to the
// real file, not a re-description of it. If the guard line is ever deleted
// from the real `rebuildRichDocHost`, this test fails even though the model
// above still (correctly, but now misleadingly) passes.
describe("the real rebuildRichDocHost still contains the epoch guard this file models", () => {
  test("+page.svelte defines richDocHostEpoch, bumps it per rebuild/dispose, and the async publish checks it before writing richDocHost", () => {
    const root = path.resolve(import.meta.dir, "../..");
    const page = readFileSync(path.join(root, "src/routes/+page.svelte"), "utf8");

    expect(page).toContain("let richDocHostEpoch = 0;");
    // rebuildRichDocHost and disposeRichDocHost both bump it — a switch OR a
    // leave-rich-mode must equally supersede a still-pending build.
    const bumpCount = (page.match(/richDocHostEpoch \+= 1;/g) ?? []).length;
    expect(bumpCount).toBeGreaterThanOrEqual(2);
    // The exact guard line this file's harness models.
    expect(page).toContain("if (epoch !== richDocHostEpoch) return;");
    // The guard runs INSIDE rebuildRichDocHost's own buildRichProjection
    // `.then(...)`, immediately before the publish it protects — not some
    // unrelated epoch check elsewhere in the file.
    const rebuildFn = page.slice(
      page.indexOf("function rebuildRichDocHost("),
      page.indexOf("function disposeRichDocHost("),
    );
    expect(rebuildFn).toContain("if (epoch !== richDocHostEpoch) return;");
    expect(rebuildFn.indexOf("if (epoch !== richDocHostEpoch) return;")).toBeLessThan(
      rebuildFn.indexOf("richDocHost = nextHost;"),
    );
  });
});
