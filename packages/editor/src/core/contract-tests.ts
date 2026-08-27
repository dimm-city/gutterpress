import type { DocumentSnapshot } from "./contracts.ts";
import type { EditorDocumentHost } from "./hosts.ts";

/**
 * D3/D7 shared `EditorDocumentHost` contract suite (SFE-P1c, Lane B).
 *
 * This is the SAME set of behavioral assertions
 * `packages/editor/tests/core/memory-host.test.ts` pins against
 * `MemoryDocumentHost`, factored into a reusable function so a SECOND host
 * implementation (`DesktopDocumentHost`,
 * `packages/desktop/src/lib/editor-host/desktop-document-host.ts`) can be
 * proven substitutable for the memory host under the exact same assertions
 * (Liskov substitution — D7: "Desktop adapts its current session semantics
 * through a narrow adapter"), rather than a hand-copied, silently-weakened
 * variant.
 *
 * `packages/editor/tests/core/contract-tests.test.ts` runs this suite
 * against `MemoryDocumentHost` too. `memory-host.test.ts` is NOT deleted or
 * modified by this run — the two files intentionally overlap in what they
 * cover; `contract-tests.test.ts` exists to prove this suite is a faithful
 * generalization (not a weakened one) of `memory-host.test.ts`'s own
 * assertions, and to give every future host (VS Code, P3c) the same proof
 * for free.
 *
 * ## Design
 *
 * This suite takes `describe`/`test`/`expect` as PARAMETERS rather than
 * importing `bun:test` directly, so it has zero test-framework dependency of
 * its own and any runner exposing a jest/bun:test-shaped API can drive it.
 *
 * `makeHost` constructs a FRESH, isolated host from a starting text (always
 * at version 0 — matching what constructing a fresh host normally means,
 * for both `MemoryDocumentHost` and `DesktopDocumentHost`) and an optional
 * `readonly` flag. Every test below reaches every required rejection reason
 * (stale, readonly, invalid-range) using a fixed starting version of `0`
 * and a deliberately mismatched `expectedVersion` where a stale edit is
 * needed — this is behaviorally identical to `memory-host.test.ts`'s
 * arbitrary starting versions (5, 10, ...) without requiring every host
 * implementation to support constructing at an arbitrary version.
 *
 * `makeHost`'s return type is deliberately the plain `EditorDocumentHost`
 * interface, not a narrower or extended one: TypeScript's return-type
 * covariance already lets a caller hand in a factory that returns a richer
 * type (e.g. `DesktopDocumentHost`, which exposes desktop-only persistence-
 * phase methods beyond the four this suite exercises) — this suite asserts
 * ONLY the D3 contract surfaced through `EditorDocumentHost` itself, so a
 * host with extra behavior (persistence phases, desktop-only methods) still
 * passes cleanly. Desktop's own test file adds its phase-interaction cases
 * separately, calling its host's extra methods directly.
 */

/** A minimal `describe`-shaped grouping function (bun:test, jest, vitest, ...). */
export type ContractDescribeFn = (name: string, fn: () => void) => void;

/** A minimal `test`/`it`-shaped function. */
export type ContractTestFn = (name: string, fn: () => void | Promise<void>) => void;

/**
 * The minimal matcher surface this suite needs from an injected `expect`.
 * Structurally compatible with bun:test's, jest's, and vitest's `expect`.
 */
export interface ContractMatchers {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
  toThrow(): void;
  readonly not: ContractMatchers;
}

/** A minimal `expect`-shaped assertion function. */
export type ContractExpectFn = (actual: unknown) => ContractMatchers;

export interface DocumentHostFactoryOptions {
  /** Construct the host in readonly mode (D3/behavior table: "Readonly host"). */
  readonly readonly?: boolean;
}

/**
 * Constructs a fresh, isolated `EditorDocumentHost` seeded with `initialText`
 * at version 0. Every call must return an independent host — no shared state
 * between hosts returned by different calls.
 */
export type DocumentHostFactory = (
  initialText: string,
  opts?: DocumentHostFactoryOptions,
) => EditorDocumentHost;

/**
 * Every D3 "invalid-range" malformed shape
 * (`packages/editor/tests/core/apply-edit.test.ts`'s "applyEdit — invalid
 * range" describe block), generalized to run through a HOST's `applyEdit`
 * rather than the bare `applyEdit` function directly — proving hosts reject
 * these identically to the pure function they must delegate to.
 */
const INVALID_RANGE_SHAPES: ReadonlyArray<readonly [label: string, from: number, to: number]> = [
  ["from > to", 3, 1],
  ["to > text.length", 0, 7],
  ["negative from", -1, 2],
  ["negative to", 0, -2],
  ["NaN from", Number.NaN, 2],
  ["NaN to", 0, Number.NaN],
  ["non-integer (fractional) from", 1.5, 2],
  ["non-integer (fractional) to", 0, 2.5],
  ["non-finite (+Infinity) to", 0, Number.POSITIVE_INFINITY],
  ["non-finite (-Infinity) from", Number.NEGATIVE_INFINITY, 2],
];

export function runDocumentHostContractTests(
  describeFn: ContractDescribeFn,
  testFn: ContractTestFn,
  expectFn: ContractExpectFn,
  makeHost: DocumentHostFactory,
): void {
  // ── getSnapshot / accepted edit ─────────────────────────────────────────

  describeFn("EditorDocumentHost contract — getSnapshot / applyEdit (accepted edit)", () => {
    testFn("getSnapshot returns the host's initial snapshot", () => {
      const host = makeHost("abc");
      expectFn(host.getSnapshot()).toEqual({ text: "abc", version: 0 });
    });

    testFn("an accepted edit updates the snapshot returned by getSnapshot", () => {
      const host = makeHost("abc");
      const result = host.applyEdit({ from: 0, to: 1, insert: "X", expectedVersion: 0 });
      expectFn(result).toEqual({ ok: true, snapshot: { text: "Xbc", version: 1 } });
      expectFn(host.getSnapshot()).toEqual({ text: "Xbc", version: 1 });
    });

    testFn("pure insert at from === to (no deletion) is accepted", () => {
      const host = makeHost("ac");
      const result = host.applyEdit({ from: 1, to: 1, insert: "b", expectedVersion: 0 });
      expectFn(result).toEqual({ ok: true, snapshot: { text: "abc", version: 1 } });
    });

    testFn("pure deletion with empty insert is accepted", () => {
      const host = makeHost("abc");
      const result = host.applyEdit({ from: 1, to: 2, insert: "", expectedVersion: 0 });
      expectFn(result).toEqual({ ok: true, snapshot: { text: "ac", version: 1 } });
    });

    testFn("successive accepted edits each increment version by exactly 1", () => {
      const host = makeHost("a");
      const first = host.applyEdit({ from: 1, to: 1, insert: "b", expectedVersion: 0 });
      expectFn(first).toEqual({ ok: true, snapshot: { text: "ab", version: 1 } });
      const second = host.applyEdit({ from: 2, to: 2, insert: "c", expectedVersion: 1 });
      expectFn(second).toEqual({ ok: true, snapshot: { text: "abc", version: 2 } });
    });
  });

  // ── stale edit ───────────────────────────────────────────────────────────

  describeFn("EditorDocumentHost contract — stale edit", () => {
    testFn("expectedVersion mismatch rejects with reason 'stale' and the CURRENT snapshot unchanged", () => {
      const host = makeHost("abc");
      const before = host.getSnapshot();
      const result = host.applyEdit({ from: 0, to: 1, insert: "X", expectedVersion: 99 });
      expectFn(result).toEqual({ ok: false, reason: "stale", snapshot: before });
      expectFn(host.getSnapshot()).toEqual(before);
    });

    testFn("a stale edit changes zero bytes", () => {
      const host = makeHost("unchanged");
      host.applyEdit({ from: 0, to: 9, insert: "gone", expectedVersion: 9 });
      expectFn(host.getSnapshot()).toEqual({ text: "unchanged", version: 0 });
    });

    testFn("expectedVersion ahead of the current version is also stale, not accepted", () => {
      const host = makeHost("x");
      const result = host.applyEdit({ from: 0, to: 1, insert: "y", expectedVersion: 2 });
      expectFn(result.ok).toBe(false);
      if (!result.ok) expectFn(result.reason).toBe("stale");
    });
  });

  // ── invalid range — every malformed shape ───────────────────────────────

  describeFn("EditorDocumentHost contract — invalid range (every malformed shape)", () => {
    for (const [label, from, to] of INVALID_RANGE_SHAPES) {
      testFn(`rejects with reason 'invalid-range': ${label}`, () => {
        const host = makeHost("abcdef"); // length 6
        const before = host.getSnapshot();
        const result = host.applyEdit({ from, to, insert: "x", expectedVersion: 0 });
        expectFn(result).toEqual({ ok: false, reason: "invalid-range", snapshot: before });
        expectFn(host.getSnapshot()).toEqual(before);
      });
    }

    testFn("empty document: only from=0,to=0 is valid", () => {
      const host = makeHost("");
      const invalid = host.applyEdit({ from: 0, to: 1, insert: "x", expectedVersion: 0 });
      expectFn(invalid).toEqual({ ok: false, reason: "invalid-range", snapshot: { text: "", version: 0 } });
      const valid = host.applyEdit({ from: 0, to: 0, insert: "x", expectedVersion: 0 });
      expectFn(valid).toEqual({ ok: true, snapshot: { text: "x", version: 1 } });
    });
  });

  // ── readonly mode ────────────────────────────────────────────────────────

  describeFn("EditorDocumentHost contract — readonly mode", () => {
    testFn("constructing with readonly:true rejects every edit with reason 'readonly'", () => {
      const host = makeHost("abc", { readonly: true });
      const result = host.applyEdit({ from: 0, to: 1, insert: "X", expectedVersion: 0 });
      expectFn(result).toEqual({ ok: false, reason: "readonly", snapshot: { text: "abc", version: 0 } });
      expectFn(host.getSnapshot()).toEqual({ text: "abc", version: 0 });
    });

    testFn("readonly host still applies replaceExternal (out-of-band change bypasses readonly)", () => {
      const host = makeHost("abc", { readonly: true });
      host.replaceExternal("xyz");
      expectFn(host.getSnapshot()).toEqual({ text: "xyz", version: 1 });
    });

    testFn("a fresh host defaults to writable when readonly is omitted", () => {
      const host = makeHost("abc");
      const result = host.applyEdit({ from: 0, to: 0, insert: "!", expectedVersion: 0 });
      expectFn(result.ok).toBe(true);
    });

    testFn("readonly wins over an otherwise-stale edit (binding check order)", () => {
      const host = makeHost("abc", { readonly: true });
      const result = host.applyEdit({ from: 0, to: 3, insert: "x", expectedVersion: 99 });
      expectFn(result.ok).toBe(false);
      if (!result.ok) expectFn(result.reason).toBe("readonly");
    });

    testFn("readonly wins over an otherwise-invalid-range edit (binding check order)", () => {
      const host = makeHost("abc", { readonly: true });
      const result = host.applyEdit({ from: 0, to: 99, insert: "x", expectedVersion: 0 });
      expectFn(result.ok).toBe(false);
      if (!result.ok) expectFn(result.reason).toBe("readonly");
    });
  });

  // ── replaceExternal ──────────────────────────────────────────────────────

  describeFn("EditorDocumentHost contract — replaceExternal", () => {
    testFn("replaces the full text and increments version exactly once", () => {
      const host = makeHost("old");
      host.replaceExternal("brand new content");
      expectFn(host.getSnapshot()).toEqual({ text: "brand new content", version: 1 });
    });

    testFn("two replaceExternal calls in a row each increment version by exactly 1", () => {
      const host = makeHost("a");
      host.replaceExternal("b");
      host.replaceExternal("c");
      expectFn(host.getSnapshot()).toEqual({ text: "c", version: 2 });
    });

    testFn("replaceExternal notifies subscribers with the new snapshot", () => {
      const host = makeHost("old");
      const seen: DocumentSnapshot[] = [];
      host.subscribe((snapshot) => seen.push(snapshot));
      host.replaceExternal("new");
      expectFn(seen).toEqual([{ text: "new", version: 1 }]);
    });

    testFn("replaceExternal is accepted even after prior accepted edits (version continues from current)", () => {
      const host = makeHost("a");
      host.applyEdit({ from: 1, to: 1, insert: "b", expectedVersion: 0 });
      host.replaceExternal("z");
      expectFn(host.getSnapshot()).toEqual({ text: "z", version: 2 });
    });
  });

  // ── subscribe / unsubscribe ──────────────────────────────────────────────

  describeFn("EditorDocumentHost contract — subscribe / unsubscribe", () => {
    testFn("a subscriber is notified on an accepted edit", () => {
      const host = makeHost("a");
      const seen: DocumentSnapshot[] = [];
      host.subscribe((snapshot) => seen.push(snapshot));
      host.applyEdit({ from: 1, to: 1, insert: "b", expectedVersion: 0 });
      expectFn(seen).toEqual([{ text: "ab", version: 1 }]);
    });

    testFn("a subscriber is NOT notified on a rejected edit", () => {
      const host = makeHost("a");
      const seen: DocumentSnapshot[] = [];
      host.subscribe((snapshot) => seen.push(snapshot));
      host.applyEdit({ from: 0, to: 1, insert: "b", expectedVersion: 99 }); // stale
      host.applyEdit({ from: 0, to: 99, insert: "b", expectedVersion: 0 }); // invalid-range
      expectFn(seen).toEqual([]);
    });

    testFn("multiple subscribers are all notified, in subscription order", () => {
      const host = makeHost("a");
      const order: string[] = [];
      host.subscribe(() => order.push("first"));
      host.subscribe(() => order.push("second"));
      host.applyEdit({ from: 0, to: 0, insert: "x", expectedVersion: 0 });
      expectFn(order).toEqual(["first", "second"]);
    });

    testFn("calling the returned unsubscribe function stops further notifications", () => {
      const host = makeHost("a");
      const seen: DocumentSnapshot[] = [];
      const unsubscribe = host.subscribe((snapshot) => seen.push(snapshot));
      host.applyEdit({ from: 0, to: 0, insert: "1", expectedVersion: 0 });
      unsubscribe();
      host.applyEdit({ from: 0, to: 0, insert: "2", expectedVersion: 1 });
      expectFn(seen.length).toBe(1);
    });

    testFn("calling unsubscribe more than once is a no-op, not a throw", () => {
      const host = makeHost("a");
      const unsubscribe = host.subscribe(() => {});
      expectFn(() => {
        unsubscribe();
        unsubscribe();
        unsubscribe();
      }).not.toThrow();
    });

    testFn("unsubscribing one listener does not affect another", () => {
      const host = makeHost("a");
      const seenA: DocumentSnapshot[] = [];
      const seenB: DocumentSnapshot[] = [];
      const unsubscribeA = host.subscribe((s) => seenA.push(s));
      host.subscribe((s) => seenB.push(s));
      unsubscribeA();
      host.applyEdit({ from: 0, to: 0, insert: "x", expectedVersion: 0 });
      expectFn(seenA).toEqual([]);
      expectFn(seenB.length).toBe(1);
    });
  });
}
