/**
 * `RichDocHostController` tests (SFE-P6a).
 *
 * ## History — why this file replaces a hand-modeled harness
 *
 * The epoch-guarded async-publish algorithm this file tests used to live
 * inline in `+page.svelte` (`rebuildRichDocHost`/`disposeRichDocHost`,
 * SFE-P3ab Lane A; hardened across SFE-P3e review rounds 1-2 — see git
 * history and `rich-doc-host-controller.svelte.ts`'s own header for the
 * full account of both CONFIRMED findings this proves fixed). Because a
 * large `.svelte` file cannot be imported directly by `bun:test`
 * (`file-tree-open-file-rename-delete.test.ts`'s "Wiring check" section
 * documents the same limitation), the original test — this file's own git
 * history — proved the algorithm with a hand-written model
 * (`RichDocHostHarness`) plus a source-text "structural pin" against
 * `+page.svelte` to prove the real file still contained the modeled
 * algorithm.
 *
 * SFE-P6a extracted that algorithm into `RichDocHostController`
 * (`../../src/lib/editor/rich-doc-host-controller.svelte.ts`), a plain
 * `.svelte.ts` module `bun:test` CAN import directly (same `$state` shim
 * `rich-mode.test.ts`/`buffer-state.test.ts` use) — so this file now
 * exercises the REAL class instead of a model of it, and the bottom
 * "structural pin" section instead proves `+page.svelte` still DELEGATES to
 * that controller rather than having reintroduced the algorithm inline.
 *
 * Bun imports the rune-bearing `.svelte.ts` module without Svelte's
 * compiler in these unit tests. The production compiler replaces `$state`;
 * the class only needs plain values for this behavior test.
 */
import { describe, expect, test } from "bun:test";
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  RichDocHostController,
  type RichDocHostBuildResult,
} from "../../src/lib/editor/rich-doc-host-controller.svelte";
import type { GutterpressProjection } from "gutterpress/render";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** A minimal, distinguishable stand-in projection — tests only need to tell
 *  ONE build's result apart from another's, not exercise D6 shape rules
 *  (those are `gutterpress/render`'s own concern, proven elsewhere). */
function projectionFor(label: string): GutterpressProjection {
  return {
    schemaVersion: 1,
    sourceVersion: 0,
    blocks: [],
    generated: [],
    diagnostics: [],
    // Not part of the real D6 shape — a harmless marker so a test can tell
    // which build's projection object ended up published, without needing
    // a second tracking channel.
    __label: label,
  } as unknown as GutterpressProjection;
}

/** A controllable `buildProjection` dependency: `queueBuild()` returns a
 *  `resolve()` the test calls to decide exactly when THAT call's promise
 *  settles — standing in for the real (IPC-routed) round trip's timing,
 *  under full test control instead of a real delay. */
function fakeBuilder() {
  const calls: { content: string; sourceVersion: number }[] = [];
  const pendingResolvers: (() => void)[] = [];
  function buildProjection(content: string, sourceVersion: number): Promise<RichDocHostBuildResult> {
    calls.push({ content, sourceVersion });
    const label = `${content}@${sourceVersion}`;
    const d = deferred<RichDocHostBuildResult>();
    pendingResolvers.push(() => d.resolve({ projection: projectionFor(label), pluginCss: undefined }));
    return d.promise;
  }
  return {
    buildProjection,
    calls,
    /** Resolves the Nth `buildProjection` call (0-indexed, in call order). */
    resolve(index: number): void {
      pendingResolvers[index]();
    },
  };
}

describe("RichDocHostController — rebuild epoch guard (a file switch during an in-flight projection build lands in the right final state)", () => {
  test("starts with no host/projection/pluginCss", () => {
    const builder = fakeBuilder();
    const ctrl = new RichDocHostController({
      buildProjection: builder.buildProjection,
      onSnapshotChange: () => {},
    });
    expect(ctrl.host).toBeNull();
    expect(ctrl.projection).toBeNull();
    expect(ctrl.pluginCss).toBeUndefined();
  });

  test("control: a single rebuild's build resolving normally publishes host + projection + pluginCss together", async () => {
    const builder = fakeBuilder();
    const ctrl = new RichDocHostController({
      buildProjection: builder.buildProjection,
      onSnapshotChange: () => {},
    });

    ctrl.rebuild("/proj/a.md", "A content");
    expect(ctrl.host).toBeNull(); // not published until the build resolves — see header
    builder.resolve(0);
    await ctrl.whenSettled();

    expect(ctrl.host).not.toBeNull();
    expect(ctrl.host?.getSnapshot().text).toBe("A content");
    expect((ctrl.projection as unknown as { __label: string }).__label).toBe("A content@0");
  });

  test("a second switch (to C) while the first (B)'s build is still in flight, then B resolving AFTER C already published: B's late publish is discarded — C's remains the final state", async () => {
    const builder = fakeBuilder();
    const ctrl = new RichDocHostController({
      buildProjection: builder.buildProjection,
      onSnapshotChange: () => {},
    });

    ctrl.rebuild("/proj/b.md", "B content");
    // A second file switch before B's build has resolved at all.
    ctrl.rebuild("/proj/c.md", "C content");

    // C's build (the current, wanted one) resolves first.
    builder.resolve(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(ctrl.host?.getSnapshot().text).toBe("C content");

    // B's slower build FINALLY resolves — strictly after C already
    // published. Without the epoch guard this would silently revert the
    // visible document to B's stale content.
    builder.resolve(0);
    await Promise.resolve();
    await Promise.resolve();

    // THE LOAD-BEARING ASSERTION: B's late-arriving publish never lands.
    expect(ctrl.host?.getSnapshot().text).toBe("C content");
    expect((ctrl.projection as unknown as { __label: string }).__label).toBe("C content@0");
  });

  test("the SAME race with resolution order reversed (B resolves first, then C) still lands on C — order-independent, not a lucky timing win above", async () => {
    const builder = fakeBuilder();
    const ctrl = new RichDocHostController({
      buildProjection: builder.buildProjection,
      onSnapshotChange: () => {},
    });

    ctrl.rebuild("/proj/b.md", "B content");
    ctrl.rebuild("/proj/c.md", "C content");

    // B resolves first this time. It is STILL superseded (its epoch is not
    // current) at the moment it resolves, so it must still be discarded —
    // the guard compares against the CURRENT epoch, not "did I resolve
    // before the next switch was requested."
    builder.resolve(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(ctrl.host).toBeNull(); // C hasn't resolved yet, and B was discarded

    builder.resolve(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(ctrl.host?.getSnapshot().text).toBe("C content");
  });

  test("three switches in flight at once (A, B, C — only C requested last): only C ever publishes, regardless of A/B/C resolution order", async () => {
    const builder = fakeBuilder();
    const ctrl = new RichDocHostController({
      buildProjection: builder.buildProjection,
      onSnapshotChange: () => {},
    });

    ctrl.rebuild("/proj/a.md", "A content");
    ctrl.rebuild("/proj/b.md", "B content");
    ctrl.rebuild("/proj/c.md", "C content");

    // Resolve in the "most stale first" order — the order most likely to
    // expose a guard that only compares against the IMMEDIATELY previous
    // epoch instead of the current one.
    builder.resolve(0);
    builder.resolve(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(ctrl.host).toBeNull();

    builder.resolve(2);
    await ctrl.whenSettled();
    expect(ctrl.host?.getSnapshot().text).toBe("C content");
  });

  test("dispose() during an in-flight rebuild discards its late publish, the same way a superseding rebuild would", async () => {
    const builder = fakeBuilder();
    const ctrl = new RichDocHostController({
      buildProjection: builder.buildProjection,
      onSnapshotChange: () => {},
    });

    ctrl.rebuild("/proj/a.md", "A content");
    ctrl.dispose();
    builder.resolve(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(ctrl.host).toBeNull();
    expect(ctrl.projection).toBeNull();
    expect(ctrl.pluginCss).toBeUndefined();
  });

  test("rebuild(null, ...) clears the host synchronously without waiting on any build", () => {
    const builder = fakeBuilder();
    const ctrl = new RichDocHostController({
      buildProjection: builder.buildProjection,
      onSnapshotChange: () => {},
    });
    ctrl.rebuild("/proj/a.md", "A content");
    ctrl.rebuild(null, "");
    expect(ctrl.host).toBeNull();
    expect(ctrl.projection).toBeNull();
    expect(builder.calls).toHaveLength(1); // no build requested for a null path
  });
});

describe("RichDocHostController — whenSettled()", () => {
  test("resolves immediately when no rebuild is in flight", async () => {
    const builder = fakeBuilder();
    const ctrl = new RichDocHostController({
      buildProjection: builder.buildProjection,
      onSnapshotChange: () => {},
    });
    let settled = false;
    void ctrl.whenSettled().then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(true);
  });

  test("does not resolve until the in-flight rebuild's build settles", async () => {
    const builder = fakeBuilder();
    const ctrl = new RichDocHostController({
      buildProjection: builder.buildProjection,
      onSnapshotChange: () => {},
    });
    ctrl.rebuild("/proj/a.md", "A content");
    let settled = false;
    void ctrl.whenSettled().then(() => (settled = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false); // the build hasn't resolved yet

    builder.resolve(0);
    await ctrl.whenSettled();
    expect(settled).toBe(true);
  });
});

describe("RichDocHostController — edit forwarding", () => {
  test("an accepted edit on the published host is forwarded through onSnapshotChange (the shared-session convergence rich-mode.svelte.ts's header describes)", async () => {
    const builder = fakeBuilder();
    const seen: string[] = [];
    const ctrl = new RichDocHostController({
      buildProjection: builder.buildProjection,
      onSnapshotChange: (text) => seen.push(text),
    });

    ctrl.rebuild("/proj/a.md", "hello");
    builder.resolve(0);
    await ctrl.whenSettled();

    const host = ctrl.host;
    expect(host).not.toBeNull();
    const result = host!.applyEdit({ from: 0, to: 5, insert: "goodbye", expectedVersion: 0 });
    expect(result.ok).toBe(true);
    expect(seen).toEqual(["goodbye"]);
  });

  test("a superseded (pre-publish) host's edits are not observed after a later rebuild supersedes it", async () => {
    // Regression guard for exactly the shape `richDocHostCtrl.host`'s own
    // subscribe wiring relies on: the FIRST host's subscription is torn
    // down (`unsub()`) at the START of the NEXT `rebuild()` call, before
    // the new host is even constructed — so nothing can forward through a
    // superseded host's subscription once a newer rebuild has begun.
    const builder = fakeBuilder();
    const seen: string[] = [];
    const ctrl = new RichDocHostController({
      buildProjection: builder.buildProjection,
      onSnapshotChange: (text) => seen.push(text),
    });

    ctrl.rebuild("/proj/a.md", "A content");
    builder.resolve(0);
    await ctrl.whenSettled();
    const firstHost = ctrl.host!;

    ctrl.rebuild("/proj/b.md", "B content");
    // The first host is superseded now, even though its own subscription
    // object still exists — applying an edit to it directly must not reach
    // onSnapshotChange any more.
    firstHost.applyEdit({ from: 0, to: 1, insert: "X", expectedVersion: 0 });
    expect(seen).toEqual([]);
  });
});

// ── Structural pin: `+page.svelte` still delegates to this controller ──────
// The tests above prove the ALGORITHM is correct against the real class.
// This pin proves `+page.svelte` still actually USES that class for its
// rich-mode document-host lifecycle, rather than having reintroduced the
// epoch-guarded rebuild/dispose logic inline (the exact regression this
// file's SFE-P3e-era predecessor's own structural pin proved didn't exist
// for the pre-extraction code).
describe("+page.svelte delegates rich-mode document-host lifecycle to RichDocHostController", () => {
  test("+page.svelte imports RichDocHostController and instantiates it, with no inline richDocHostEpoch/rebuildRichDocHost of its own", () => {
    const root = path.resolve(import.meta.dir, "../..");
    const page = readFileSync(path.join(root, "src/routes/+page.svelte"), "utf8");

    expect(page).toContain(
      'import { RichDocHostController } from "$lib/editor/rich-doc-host-controller.svelte";',
    );
    expect(page).toContain("const richDocHostCtrl = new RichDocHostController(");
    expect(page).toContain("richDocHostCtrl.rebuild(");
    expect(page).toContain("richDocHostCtrl.dispose(");
    expect(page).toContain("richDocHostCtrl.whenSettled(");
    // The epoch-guarded algorithm itself must live in exactly one place —
    // not reintroduced inline in the page after extraction.
    expect(page).not.toContain("richDocHostEpoch");
    expect(page).not.toContain("function rebuildRichDocHost(");
    expect(page).not.toContain("function disposeRichDocHost(");
  });
});
