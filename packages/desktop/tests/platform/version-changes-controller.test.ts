/**
 * VersionChangesController (#484): every Version history card lists its
 * version's changed files again, loaded as the card scrolls into view — a few
 * at a time, never a whole page up front (#461) — and the selected version
 * goes ahead of every card, so selecting stays instant.
 */
import { describe, expect, test } from "bun:test";
import type { VersionChanges } from "../../src/lib/api";
import { CARDS_AT_ONCE, VersionChangesController } from "../../src/lib/routes/version-changes-controller.svelte";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests (same shim as sync-controller.test / details-section-controller.test).
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

/** Let settled loads hand the next card its turn. */
const settle = () => new Promise((r) => setTimeout(r, 0));

const changesFor = (id: string): VersionChanges => ({
  files: [{ path: `${id}.md`, kind: "changed", hint: "1 paragraph changed", text: true }],
  more: 0,
});

/** A host whose answers wait until the test gives them. */
function makeHost() {
  const asked: string[] = [];
  const pending = new Map<string, { resolve: (c: VersionChanges) => void; reject: (e: Error) => void }>();
  const fetchChanges = (id: string) =>
    new Promise<VersionChanges>((resolve, reject) => {
      asked.push(id);
      pending.set(id, { resolve, reject });
    });
  const answer = async (id: string) => {
    pending.get(id)!.resolve(changesFor(id));
    pending.delete(id);
    await settle();
  };
  const fail = async (id: string) => {
    pending.get(id)!.reject(new Error("Couldn't read that version"));
    pending.delete(id);
    await settle();
  };
  return { asked, fetchChanges, answer, fail, waiting: () => [...pending.keys()] };
}

describe("VersionChangesController", () => {
  test("cards load as they come into view, two at a time, in the order they came", async () => {
    expect(CARDS_AT_ONCE).toBe(2);
    const host = makeHost();
    const ctrl = new VersionChangesController(host.fetchChanges);
    for (const id of ["a", "b", "c", "d"]) ctrl.show(id);
    expect(host.asked).toEqual(["a", "b"]);
    await host.answer("a");
    expect(ctrl.loaded.a).toEqual(changesFor("a"));
    expect(host.asked).toEqual(["a", "b", "c"]);
    await host.answer("b");
    await host.answer("c");
    await host.answer("d");
    expect(Object.keys(ctrl.loaded).sort()).toEqual(["a", "b", "c", "d"]);
  });

  test("nothing loads for a card until it is shown: no page is loaded up front", () => {
    const host = makeHost();
    const ctrl = new VersionChangesController(host.fetchChanges);
    expect(host.asked).toEqual([]);
    expect(ctrl.loaded).toEqual({});
  });

  test("a card that leaves the view before its turn is never asked for", async () => {
    const host = makeHost();
    const ctrl = new VersionChangesController(host.fetchChanges);
    for (const id of ["a", "b", "c", "d", "e"]) ctrl.show(id);
    ctrl.hide("c");
    ctrl.hide("d");
    await host.answer("a");
    await host.answer("b");
    await host.answer("e");
    expect(host.asked).toEqual(["a", "b", "e"]);
    // Shown again, it waits its turn again.
    ctrl.show("c");
    expect(host.asked).toEqual(["a", "b", "e", "c"]);
  });

  test("the selected version goes ahead of every card waiting, even with two running", async () => {
    const host = makeHost();
    const ctrl = new VersionChangesController(host.fetchChanges);
    for (const id of ["a", "b", "c", "d"]) ctrl.show(id);
    const selected = ctrl.load("d");
    expect(host.asked).toEqual(["a", "b", "d"]);
    await host.answer("d");
    expect(await selected).toEqual(changesFor("d"));
    // "d" is no longer waiting as a card; "c" still is, behind "a" and "b".
    expect(host.waiting()).toEqual(["a", "b"]);
    await host.answer("a");
    expect(host.asked).toEqual(["a", "b", "d", "c"]);
  });

  test("while a page of versions is listed (Show older versions), no card starts loading; then they go on", async () => {
    const host = makeHost();
    const ctrl = new VersionChangesController(host.fetchChanges);
    ctrl.show("a");
    let release!: (page: string) => void;
    const listed = ctrl.listFirst(new Promise<string>((r) => (release = r)));
    for (const id of ["b", "c"]) ctrl.show(id);
    await host.answer("a");
    expect(host.asked).toEqual(["a"]);
    // The selected version still goes ahead.
    const selected = ctrl.load("d");
    expect(host.asked).toEqual(["a", "d"]);
    release("the next page");
    expect(await listed).toBe("the next page");
    expect(host.asked).toEqual(["a", "d", "b", "c"]);
    await host.answer("d");
    expect(await selected).toEqual(changesFor("d"));
  });

  test("a page that can't be listed lets the cards go on", async () => {
    const host = makeHost();
    const ctrl = new VersionChangesController(host.fetchChanges);
    const listed = ctrl.listFirst(Promise.reject(new Error("offline"))).catch((e: Error) => e.message);
    ctrl.show("a");
    expect(host.asked).toEqual([]);
    expect(await listed).toBe("offline");
    expect(host.asked).toEqual(["a"]);
  });

  test("selecting a card already loaded answers at once, without asking the host again", async () => {
    const host = makeHost();
    const ctrl = new VersionChangesController(host.fetchChanges);
    ctrl.show("a");
    await host.answer("a");
    expect(await ctrl.load("a")).toEqual(changesFor("a"));
    ctrl.show("a");
    expect(host.asked).toEqual(["a"]);
  });

  test("selecting a card whose changes are on their way waits for that same load", async () => {
    const host = makeHost();
    const ctrl = new VersionChangesController(host.fetchChanges);
    ctrl.show("a");
    const selected = ctrl.load("a");
    ctrl.show("a");
    await host.answer("a");
    expect(await selected).toEqual(changesFor("a"));
    expect(host.asked).toEqual(["a"]);
  });

  test("a card whose changes can't be listed shows none and lets the next one load; shown again, it is asked again", async () => {
    const host = makeHost();
    const ctrl = new VersionChangesController(host.fetchChanges);
    for (const id of ["a", "b", "c"]) ctrl.show(id);
    await host.fail("a");
    expect(ctrl.loaded.a).toBeUndefined();
    expect(host.asked).toEqual(["a", "b", "c"]);
    ctrl.show("a");
    await host.answer("b");
    expect(host.asked).toEqual(["a", "b", "c", "a"]);
  });

  test("the selected version's failure reaches the screen", async () => {
    const host = makeHost();
    const ctrl = new VersionChangesController(host.fetchChanges);
    const selected = ctrl.load("a").then(() => null, (e: Error) => e.message);
    await host.fail("a");
    expect(await selected).toBe("Couldn't read that version");
    expect(ctrl.loaded.a).toBeUndefined();
  });
});
