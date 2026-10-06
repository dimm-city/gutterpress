import { describe, expect, test } from "bun:test";
import type { DocumentSnapshot } from "../../src/core/contracts.ts";
import { MemoryDocumentHost } from "../../src/core/memory-host.ts";

describe("MemoryDocumentHost — getSnapshot / applyEdit", () => {
  test("getSnapshot returns the constructor's initial snapshot", () => {
    const host = new MemoryDocumentHost({ text: "abc", version: 0 });
    expect(host.getSnapshot()).toEqual({ text: "abc", version: 0 });
  });

  test("an accepted edit updates the snapshot returned by getSnapshot", () => {
    const host = new MemoryDocumentHost({ text: "abc", version: 0 });
    const result = host.applyEdit({ from: 0, to: 1, insert: "X", expectedVersion: 0 });
    expect(result).toEqual({ ok: true, snapshot: { text: "Xbc", version: 1 } });
    expect(host.getSnapshot()).toEqual({ text: "Xbc", version: 1 });
  });

  test("a stale edit leaves getSnapshot unchanged", () => {
    const host = new MemoryDocumentHost({ text: "abc", version: 5 });
    const result = host.applyEdit({ from: 0, to: 1, insert: "X", expectedVersion: 0 });
    expect(result.ok).toBe(false);
    expect(host.getSnapshot()).toEqual({ text: "abc", version: 5 });
  });

  test("an invalid-range edit leaves getSnapshot unchanged", () => {
    const host = new MemoryDocumentHost({ text: "abc", version: 0 });
    const result = host.applyEdit({ from: 0, to: 99, insert: "X", expectedVersion: 0 });
    expect(result.ok).toBe(false);
    expect(host.getSnapshot()).toEqual({ text: "abc", version: 0 });
  });
});

describe("MemoryDocumentHost — readonly mode", () => {
  test("constructing with readonly:true rejects every edit with reason 'readonly'", () => {
    const host = new MemoryDocumentHost({ text: "abc", version: 0 }, { readonly: true });
    const result = host.applyEdit({ from: 0, to: 1, insert: "X", expectedVersion: 0 });
    expect(result).toEqual({ ok: false, reason: "readonly", snapshot: { text: "abc", version: 0 } });
    expect(host.getSnapshot()).toEqual({ text: "abc", version: 0 });
  });

  test("readonly host still applies replaceExternal (out-of-band change bypasses readonly)", () => {
    const host = new MemoryDocumentHost({ text: "abc", version: 0 }, { readonly: true });
    host.replaceExternal("xyz");
    expect(host.getSnapshot()).toEqual({ text: "xyz", version: 1 });
  });

  test("a fresh host defaults to writable when readonly is omitted", () => {
    const host = new MemoryDocumentHost({ text: "abc", version: 0 });
    const result = host.applyEdit({ from: 0, to: 0, insert: "!", expectedVersion: 0 });
    expect(result.ok).toBe(true);
  });
});

describe("MemoryDocumentHost — replaceExternal", () => {
  test("replaces the full text and increments version exactly once", () => {
    const host = new MemoryDocumentHost({ text: "old", version: 3 });
    host.replaceExternal("brand new content");
    expect(host.getSnapshot()).toEqual({ text: "brand new content", version: 4 });
  });

  test("two replaceExternal calls in a row each increment version by exactly 1", () => {
    const host = new MemoryDocumentHost({ text: "a", version: 0 });
    host.replaceExternal("b");
    host.replaceExternal("c");
    expect(host.getSnapshot()).toEqual({ text: "c", version: 2 });
  });

  test("replaceExternal notifies subscribers with the new snapshot", () => {
    const host = new MemoryDocumentHost({ text: "old", version: 0 });
    const seen: DocumentSnapshot[] = [];
    host.subscribe((snapshot) => seen.push(snapshot));
    host.replaceExternal("new");
    expect(seen).toEqual([{ text: "new", version: 1 }]);
  });
});

describe("MemoryDocumentHost — subscribe / unsubscribe", () => {
  test("a subscriber is notified on an accepted edit", () => {
    const host = new MemoryDocumentHost({ text: "a", version: 0 });
    const seen: DocumentSnapshot[] = [];
    host.subscribe((snapshot) => seen.push(snapshot));
    host.applyEdit({ from: 1, to: 1, insert: "b", expectedVersion: 0 });
    expect(seen).toEqual([{ text: "ab", version: 1 }]);
  });

  test("a subscriber is NOT notified on a rejected edit", () => {
    const host = new MemoryDocumentHost({ text: "a", version: 0 });
    const seen: DocumentSnapshot[] = [];
    host.subscribe((snapshot) => seen.push(snapshot));
    host.applyEdit({ from: 0, to: 1, insert: "b", expectedVersion: 99 }); // stale
    host.applyEdit({ from: 0, to: 99, insert: "b", expectedVersion: 0 }); // invalid-range
    expect(seen).toEqual([]);
  });

  test("multiple subscribers are all notified, in subscription order", () => {
    const host = new MemoryDocumentHost({ text: "a", version: 0 });
    const order: string[] = [];
    host.subscribe(() => order.push("first"));
    host.subscribe(() => order.push("second"));
    host.applyEdit({ from: 0, to: 0, insert: "x", expectedVersion: 0 });
    expect(order).toEqual(["first", "second"]);
  });

  test("calling the returned unsubscribe function stops further notifications", () => {
    const host = new MemoryDocumentHost({ text: "a", version: 0 });
    const seen: DocumentSnapshot[] = [];
    const unsubscribe = host.subscribe((snapshot) => seen.push(snapshot));
    host.applyEdit({ from: 0, to: 0, insert: "1", expectedVersion: 0 });
    unsubscribe();
    host.applyEdit({ from: 0, to: 0, insert: "2", expectedVersion: 1 });
    expect(seen.length).toBe(1);
  });

  test("calling unsubscribe more than once is a no-op, not a throw", () => {
    const host = new MemoryDocumentHost({ text: "a", version: 0 });
    const unsubscribe = host.subscribe(() => {});
    expect(() => {
      unsubscribe();
      unsubscribe();
      unsubscribe();
    }).not.toThrow();
  });

  test("unsubscribing one listener does not affect another", () => {
    const host = new MemoryDocumentHost({ text: "a", version: 0 });
    const seenA: DocumentSnapshot[] = [];
    const seenB: DocumentSnapshot[] = [];
    const unsubscribeA = host.subscribe((s) => seenA.push(s));
    host.subscribe((s) => seenB.push(s));
    unsubscribeA();
    host.applyEdit({ from: 0, to: 0, insert: "x", expectedVersion: 0 });
    expect(seenA).toEqual([]);
    expect(seenB.length).toBe(1);
  });
});
