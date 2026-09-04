/**
 * `ProblemsController` tests (SFE-P6a).
 *
 * Extracted from `+page.svelte`'s own `problems`/`buildProblemEntries`/
 * `problemsLoading`/`problemsError` state and `refreshProblems` function —
 * this file covers the guard behavior that state previously had no
 * isolated test of its own (M5: a stale in-flight lint from a project the
 * author has since navigated away from must not clobber the NEW project's
 * state), now directly against the real controller instead of only
 * indirectly through the page.
 *
 * Bun imports the rune-bearing `.svelte.ts` module without Svelte's
 * compiler in these unit tests — same shim `sync-controller.test.ts` uses.
 */
import { describe, expect, test } from "bun:test";
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

import { ProblemsController } from "../../src/lib/routes/problems-controller.svelte";
import type { ProblemEntry } from "../../src/lib/platform/dtos";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (e: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const ENTRY: ProblemEntry = { severity: "error", message: "boom", source: "test" };

function makeController(overrides: {
  isDesktop?: () => boolean;
  currentDir?: () => string | null;
  sourceMode?: () => "folder" | "url";
  lintProject?: (dir: string) => Promise<ProblemEntry[]>;
} = {}) {
  return new ProblemsController({
    isDesktop: overrides.isDesktop ?? (() => true),
    currentDir: overrides.currentDir ?? (() => "/proj"),
    sourceMode: overrides.sourceMode ?? (() => "folder"),
    lintProject: overrides.lintProject ?? (() => Promise.resolve([])),
  });
}

describe("ProblemsController — starting state", () => {
  test("starts empty, not loading, no error", () => {
    const ctrl = makeController();
    expect(ctrl.entries).toEqual([]);
    expect(ctrl.buildEntries).toEqual([]);
    expect(ctrl.loading).toBe(false);
    expect(ctrl.error).toBeNull();
  });
});

describe("ProblemsController — refresh() guards", () => {
  test("does nothing off-desktop", () => {
    let called = false;
    const ctrl = makeController({
      isDesktop: () => false,
      lintProject: () => {
        called = true;
        return Promise.resolve([]);
      },
    });
    ctrl.refresh();
    expect(called).toBe(false);
    expect(ctrl.loading).toBe(false);
  });

  test("does nothing with no open project", () => {
    let called = false;
    const ctrl = makeController({
      currentDir: () => null,
      lintProject: () => {
        called = true;
        return Promise.resolve([]);
      },
    });
    ctrl.refresh();
    expect(called).toBe(false);
  });

  test("does nothing in url source mode", () => {
    let called = false;
    const ctrl = makeController({
      sourceMode: () => "url",
      lintProject: () => {
        called = true;
        return Promise.resolve([]);
      },
    });
    ctrl.refresh();
    expect(called).toBe(false);
  });

  test("a successful lint publishes entries, clears loading, clears error", async () => {
    const ctrl = makeController({ lintProject: () => Promise.resolve([ENTRY]) });
    ctrl.refresh();
    expect(ctrl.loading).toBe(true);
    // The chain is lintProject().then().catch().finally() — a macrotask
    // flush guarantees every microtask hop has settled regardless of chain
    // depth (a fixed `await Promise.resolve()` count is fragile to that).
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ctrl.entries).toEqual([ENTRY]);
    expect(ctrl.error).toBeNull();
    expect(ctrl.loading).toBe(false);
  });

  test("a failed lint clears entries and sets a distinct error (M5: never a false all-clear)", async () => {
    const ctrl = makeController({ lintProject: () => Promise.reject(new Error("nope")) });
    ctrl.entries = [ENTRY]; // simulate stale prior findings
    ctrl.refresh();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ctrl.entries).toEqual([]);
    expect(ctrl.error).toBe("We couldn't check your project this time.");
    expect(ctrl.loading).toBe(false);
  });

  test("M5: a stale in-flight lint from a project the author has since navigated away from does not clobber the new project's state", async () => {
    let dir = "/proj-a";
    const gate = deferred<ProblemEntry[]>();
    const ctrl = makeController({
      currentDir: () => dir,
      lintProject: () => gate.promise,
    });

    ctrl.refresh(); // starts the lint for /proj-a
    dir = "/proj-b"; // the author switched projects before it resolved
    ctrl.entries = [ENTRY]; // /proj-b's own (already-refreshed) findings
    ctrl.loading = false;

    gate.resolve([]); // /proj-a's stale lint finally resolves
    await Promise.resolve();
    await Promise.resolve();

    // The stale response must not overwrite /proj-b's state.
    expect(ctrl.entries).toEqual([ENTRY]);
    expect(ctrl.loading).toBe(false);
  });
});

describe("ProblemsController — recordBuildEntries()", () => {
  test("sets buildEntries independently of entries", () => {
    const ctrl = makeController();
    ctrl.entries = [ENTRY];
    ctrl.recordBuildEntries([{ severity: "warning", message: "export finding", source: "build" }]);
    expect(ctrl.entries).toEqual([ENTRY]);
    expect(ctrl.buildEntries).toEqual([{ severity: "warning", message: "export finding", source: "build" }]);
  });
});

describe("ProblemsController — reset()", () => {
  test("clears every field", async () => {
    const ctrl = makeController({ lintProject: () => Promise.resolve([ENTRY]) });
    ctrl.refresh();
    await Promise.resolve();
    await Promise.resolve();
    ctrl.recordBuildEntries([ENTRY]);
    expect(ctrl.entries.length).toBeGreaterThan(0);

    ctrl.reset();
    expect(ctrl.entries).toEqual([]);
    expect(ctrl.buildEntries).toEqual([]);
    expect(ctrl.loading).toBe(false);
    expect(ctrl.error).toBeNull();
  });
});
