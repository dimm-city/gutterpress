import { expect, test } from "bun:test";
import { PageNavController } from "../../src/lib/routes/page-nav-controller.svelte";
import type { PageState } from "../../src/lib/routes/page-types";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests. The production compiler replaces $state; the class only
// needs plain values for these behavior tests (same shim as
// export-controller.test / buffer-state.test).
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

/** Flush the microtask/macrotask queue so `.then().finally()` chains settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

/**
 * Fake host-command client capturing (cmd, args). Resolves `client.call()` with
 * a configurable PageState; in `manual` mode the resolution is deferred so a
 * test can observe in-flight state (restoringSavedState) before it settles.
 */
class FakeClient {
  calls: Array<{ cmd: string; args: unknown[] }> = [];
  nextState: PageState = {};
  manual = false;
  private pending: Array<(v: PageState) => void> = [];

  call<T>(cmd: string, args: unknown[] = []): Promise<T> {
    this.calls.push({ cmd, args });
    if (this.manual) {
      return new Promise<PageState>((res) => this.pending.push(res)) as Promise<T>;
    }
    return Promise.resolve(this.nextState) as Promise<T>;
  }

  resolveAll(): void {
    const s = this.nextState;
    this.pending.splice(0).forEach((r) => r(s));
  }

  get last(): { cmd: string; args: unknown[] } | undefined {
    return this.calls[this.calls.length - 1];
  }
}

type Spy = { calls: unknown[][] };
const spy = (): ((...a: unknown[]) => void) & Spy => {
  const fn = ((...a: unknown[]) => {
    fn.calls.push(a);
  }) as ((...a: unknown[]) => void) & Spy;
  fn.calls = [];
  return fn;
};

interface Harness {
  ctrl: PageNavController;
  client: FakeClient | undefined;
  savePrefs: ReturnType<typeof spy>;
  savePageDirect: ReturnType<typeof spy>;
  rendering: boolean;
  viewMode: "single" | "two-column";
}

function make(over: Partial<{ hasClient: boolean }> = {}): Harness {
  const client = over.hasClient === false ? undefined : new FakeClient();
  const savePrefs = spy();
  const savePageDirect = spy();
  const h = {
    client,
    savePrefs,
    savePageDirect,
    rendering: false,
    viewMode: "single" as "single" | "two-column",
  } as Harness;
  h.ctrl = new PageNavController({
    client: () => h.client,
    isRendering: () => h.rendering,
    viewMode: () => h.viewMode,
    savePrefs: (patch) => savePrefs(patch),
    savePageDirect: (page) => savePageDirect(page),
  });
  return h;
}

test("initial public rune state matches the +page.svelte defaults", () => {
  const { ctrl } = make();
  expect(ctrl.currentPage).toBe(1);
  expect(ctrl.totalPages).toBe(0);
  expect(ctrl.restoringSavedState).toBe(false);
});

test("the inline page-edit FSM is gone — the page select replaced it", () => {
  const { ctrl } = make();
  // The select drives navigation via selectPage(); none of the retired
  // begin/cancel/commit editing surface may survive.
  const anyCtrl = ctrl as unknown as Record<string, unknown>;
  expect(anyCtrl.pageEditing).toBeUndefined();
  expect(anyCtrl.pageEditValue).toBeUndefined();
  expect(anyCtrl.beginPageEdit).toBeUndefined();
  expect(anyCtrl.cancelPageEdit).toBeUndefined();
  expect(anyCtrl.commitPageEdit).toBeUndefined();
});

// ── pageOptions (drives the <select> options, one per page) ──────────────────

test("pageOptions is empty before the first render (totalPages = 0)", () => {
  const { ctrl } = make();
  expect(ctrl.pageOptions).toEqual([]);
});

test("pageOptions lists every page 1..totalPages", () => {
  const h = make();
  h.ctrl.totalPages = 4;
  expect(h.ctrl.pageOptions).toEqual([1, 2, 3, 4]);
});

test("pageOptions tracks totalPages updates from host page-state syncs", () => {
  const h = make();
  h.ctrl.syncPageState({ currentPage: 2, totalPages: 3 });
  expect(h.ctrl.pageOptions).toEqual([1, 2, 3]);
  h.ctrl.syncPageState({ currentPage: 2, totalPages: 5 });
  expect(h.ctrl.pageOptions).toEqual([1, 2, 3, 4, 5]);
});

// ── selectPage (the <select> onchange intent) ────────────────────────────────

test("selectPage navigates to the chosen page", () => {
  const h = make();
  h.ctrl.totalPages = 20;
  h.ctrl.selectPage(7);
  expect((h.client as FakeClient).last).toEqual({ cmd: "goToPage", args: [7] });
});

test("selectPage accepts the string value a <select> change event carries", () => {
  const h = make();
  h.ctrl.totalPages = 20;
  h.ctrl.selectPage("12");
  expect((h.client as FakeClient).last).toEqual({ cmd: "goToPage", args: [12] });
});

test("selectPage ignores non-numeric input", () => {
  const h = make();
  h.ctrl.totalPages = 20;
  h.ctrl.selectPage("abc");
  expect((h.client as FakeClient).calls.length).toBe(0);
});

test("selectPage clamps above totalPages down to totalPages", () => {
  const h = make();
  h.ctrl.totalPages = 42;
  h.ctrl.selectPage(999);
  expect((h.client as FakeClient).last).toEqual({ cmd: "goToPage", args: [42] });
});

test("selectPage clamps below 1 up to 1", () => {
  const h = make();
  h.ctrl.totalPages = 42;
  h.ctrl.selectPage(0);
  expect((h.client as FakeClient).last).toEqual({ cmd: "goToPage", args: [1] });
});

test("selectPage uses totalPages||1 as the ceiling when totalPages is 0", () => {
  const h = make();
  h.ctrl.selectPage(5);
  expect((h.client as FakeClient).last).toEqual({ cmd: "goToPage", args: [1] });
});

test("selectPage no-ops while rendering (runPageCommand guard)", () => {
  const h = make();
  h.rendering = true;
  h.ctrl.totalPages = 10;
  h.ctrl.selectPage(3);
  expect((h.client as FakeClient).calls.length).toBe(0);
});

// ── host command plumbing (unchanged by the select refactor) ─────────────────

test("runPageCommand no-ops when there is no client", async () => {
  const h = make({ hasClient: false });
  h.ctrl.runPageCommand("firstPage");
  await flush();
  expect(h.savePrefs.calls.length).toBe(0);
});

test("runPageCommand no-ops while rendering (no host call issued)", async () => {
  const h = make();
  h.rendering = true;
  h.ctrl.runPageCommand("firstPage");
  await flush();
  expect((h.client as FakeClient).calls.length).toBe(0);
  expect(h.savePrefs.calls.length).toBe(0);
});

test("runPageCommand folds state on resolve and persists via savePrefs({currentPage})", async () => {
  const h = make();
  (h.client as FakeClient).nextState = { currentPage: 4, totalPages: 20 };
  h.ctrl.runPageCommand("goToPage", [4]);
  expect((h.client as FakeClient).last).toEqual({ cmd: "goToPage", args: [4] });
  await flush();
  expect(h.ctrl.currentPage).toBe(4);
  expect(h.ctrl.totalPages).toBe(20);
  expect(h.savePrefs.calls).toEqual([[{ currentPage: 4 }]]);
});

test("syncPageState(undefined) no-ops", () => {
  const h = make();
  h.ctrl.syncPageState(undefined);
  expect(h.ctrl.currentPage).toBe(1);
  expect(h.ctrl.totalPages).toBe(0);
  expect(h.savePrefs.calls.length).toBe(0);
});

test("syncPageState partial merge keeps prior fields", () => {
  const h = make();
  h.ctrl.syncPageState({ currentPage: 7, totalPages: 30 });
  expect(h.ctrl.currentPage).toBe(7);
  expect(h.ctrl.totalPages).toBe(30);
  // Partial event carrying only currentPage must preserve totalPages.
  h.ctrl.syncPageState({ currentPage: 9 });
  expect(h.ctrl.currentPage).toBe(9);
  expect(h.ctrl.totalPages).toBe(30);
});

test("nextPage/prevPage pass viewMode() as the sole arg; firstPage/lastPage pass none", () => {
  const h = make();
  h.viewMode = "two-column";
  h.ctrl.nextPage();
  expect((h.client as FakeClient).last).toEqual({ cmd: "nextPage", args: ["two-column"] });
  h.ctrl.prevPage();
  expect((h.client as FakeClient).last).toEqual({ cmd: "prevPage", args: ["two-column"] });
  h.ctrl.firstPage();
  expect((h.client as FakeClient).last).toEqual({ cmd: "firstPage", args: [] });
  h.ctrl.lastPage();
  expect((h.client as FakeClient).last).toEqual({ cmd: "lastPage", args: [] });
});

test("gotoPage issues goToPage with the requested page number", () => {
  const h = make();
  h.ctrl.gotoPage(3);
  expect((h.client as FakeClient).last).toEqual({ cmd: "goToPage", args: [3] });
});

test("restoreProjectPage flags restoringSavedState during flight and clears it in finally", async () => {
  const h = make();
  const client = h.client as FakeClient;
  client.manual = true;
  client.nextState = { currentPage: 15, totalPages: 60 };
  h.ctrl.restoreProjectPage(15);
  // In flight: guard is set, host call issued with the requested page.
  expect(h.ctrl.restoringSavedState).toBe(true);
  expect(client.last).toEqual({ cmd: "goToPage", args: [15] });
  client.resolveAll();
  await flush();
  expect(h.ctrl.currentPage).toBe(15);
  expect(h.ctrl.totalPages).toBe(60);
  // Unguarded per-project write receives the resolved page.
  expect(h.savePageDirect.calls).toEqual([[15]]);
  // savePrefs (the guarded component writer) is NOT used on the restore path.
  expect(h.savePrefs.calls.length).toBe(0);
  expect(h.ctrl.restoringSavedState).toBe(false);
});

test("restoreProjectPage no-ops with no client", async () => {
  const h = make({ hasClient: false });
  h.ctrl.restoreProjectPage(3);
  expect(h.ctrl.restoringSavedState).toBe(false);
  await flush();
  expect(h.savePageDirect.calls.length).toBe(0);
});

test("restoreProjectPage no-ops while rendering", async () => {
  const h = make();
  h.rendering = true;
  h.ctrl.restoreProjectPage(3);
  expect(h.ctrl.restoringSavedState).toBe(false);
  expect((h.client as FakeClient).calls.length).toBe(0);
  await flush();
  expect(h.savePageDirect.calls.length).toBe(0);
});
