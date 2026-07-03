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
  onBeginEdit: ReturnType<typeof spy>;
  rendering: boolean;
  viewMode: "single" | "two-column";
}

function make(over: Partial<{ hasClient: boolean }> = {}): Harness {
  const client = over.hasClient === false ? undefined : new FakeClient();
  const savePrefs = spy();
  const savePageDirect = spy();
  const onBeginEdit = spy();
  const h = {
    client,
    savePrefs,
    savePageDirect,
    onBeginEdit,
    rendering: false,
    viewMode: "single" as "single" | "two-column",
  } as Harness;
  h.ctrl = new PageNavController({
    client: () => h.client,
    isRendering: () => h.rendering,
    viewMode: () => h.viewMode,
    savePrefs: (patch) => savePrefs(patch),
    savePageDirect: (page) => savePageDirect(page),
    onBeginEdit: () => onBeginEdit(),
  });
  return h;
}

test("initial public rune state matches the +page.svelte defaults", () => {
  const { ctrl } = make();
  expect(ctrl.currentPage).toBe(1);
  expect(ctrl.totalPages).toBe(0);
  expect(ctrl.pageEditing).toBe(false);
  expect(ctrl.pageEditValue).toBe("1");
  expect(ctrl.restoringSavedState).toBe(false);
});

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

test("syncPageState updates pageEditValue only when NOT editing", () => {
  const h = make();
  h.ctrl.syncPageState({ currentPage: 5, totalPages: 10 });
  expect(h.ctrl.pageEditValue).toBe("5");
  // While editing, the in-progress input value must not be clobbered.
  h.ctrl.pageEditing = true;
  h.ctrl.pageEditValue = "user-typing";
  h.ctrl.syncPageState({ currentPage: 8 });
  expect(h.ctrl.currentPage).toBe(8);
  expect(h.ctrl.pageEditValue).toBe("user-typing");
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

test("commitPageEdit with non-numeric input does not navigate and ends editing", () => {
  const h = make();
  h.ctrl.totalPages = 50;
  h.ctrl.pageEditing = true;
  h.ctrl.pageEditValue = "abc";
  h.ctrl.commitPageEdit();
  expect((h.client as FakeClient).calls.length).toBe(0);
  expect(h.ctrl.pageEditing).toBe(false);
});

test("commitPageEdit clamps above totalPages down to totalPages", () => {
  const h = make();
  h.ctrl.totalPages = 42;
  h.ctrl.pageEditing = true;
  h.ctrl.pageEditValue = "999";
  h.ctrl.commitPageEdit();
  expect((h.client as FakeClient).last).toEqual({ cmd: "goToPage", args: [42] });
  expect(h.ctrl.pageEditing).toBe(false);
});

test("commitPageEdit clamps below 1 up to 1", () => {
  const h = make();
  h.ctrl.totalPages = 42;
  h.ctrl.pageEditValue = "0";
  h.ctrl.commitPageEdit();
  expect((h.client as FakeClient).last).toEqual({ cmd: "goToPage", args: [1] });
});

test("commitPageEdit uses totalPages||1 as the ceiling when totalPages is 0", () => {
  const h = make();
  // totalPages defaults to 0 → ceiling is 1.
  h.ctrl.pageEditValue = "5";
  h.ctrl.commitPageEdit();
  expect((h.client as FakeClient).last).toEqual({ cmd: "goToPage", args: [1] });
});

test("beginPageEdit no-ops while rendering", () => {
  const h = make();
  h.rendering = true;
  h.ctrl.beginPageEdit();
  expect(h.ctrl.pageEditing).toBe(false);
  expect(h.onBeginEdit.calls.length).toBe(0);
});

test("beginPageEdit sets editing state, seeds the value, and fires onBeginEdit", () => {
  const h = make();
  h.ctrl.currentPage = 6;
  h.ctrl.beginPageEdit();
  expect(h.ctrl.pageEditing).toBe(true);
  expect(h.ctrl.pageEditValue).toBe("6");
  expect(h.onBeginEdit.calls.length).toBe(1);
});

test("cancelPageEdit ends editing and resets the value to the current page", () => {
  const h = make();
  h.ctrl.currentPage = 11;
  h.ctrl.pageEditing = true;
  h.ctrl.pageEditValue = "garbage";
  h.ctrl.cancelPageEdit();
  expect(h.ctrl.pageEditing).toBe(false);
  expect(h.ctrl.pageEditValue).toBe("11");
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
