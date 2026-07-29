import { expect, test } from "bun:test";
import { DesignSectionController } from "../../src/lib/routes/design-section-controller.svelte";
import type { ProjectStyle } from "../../src/lib/platform/contract";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests. The production compiler replaces $state; the class only
// needs plain values for these behavior tests (same shim as
// page-nav-controller.test / export-controller.test / buffer-state.test).
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

/** Flush the microtask/macrotask queue so `.then()` commit chains settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

type Spy = { calls: unknown[][] };
const spy = (): ((...a: unknown[]) => void) & Spy => {
  const fn = ((...a: unknown[]) => {
    fn.calls.push(a);
  }) as ((...a: unknown[]) => void) & Spy;
  fn.calls = [];
  return fn;
};

/** In-memory fs double counting reads/writes, so coalescing is observable. */
class FakeFs {
  files = new Map<string, string>();
  reads = 0;
  writes = 0;
  failNextWrite = false;

  readFile = (path: string): Promise<string> => {
    this.reads++;
    return Promise.resolve(this.files.get(path) ?? "");
  };
  writeFile = (path: string, content: string): Promise<{ mtimeMs: number }> => {
    this.writes++;
    if (this.failNextWrite) {
      this.failNextWrite = false;
      return Promise.reject(new Error("disk full"));
    }
    this.files.set(path, content);
    return Promise.resolve({ mtimeMs: 1 });
  };
}

/** Single-slot fake timer: the controller only ever has one flush timer live. */
class FakeTimer {
  pending: (() => void) | null = null;
  set = (fn: () => void): number => {
    this.pending = fn;
    return 1;
  };
  clear = (): void => {
    this.pending = null;
  };
  /** Simulate the debounce window elapsing. */
  fire(): void {
    const fn = this.pending;
    this.pending = null;
    fn?.();
  }
}

const ROOT_CSS = `:root {\n  --heading-color: #cc0000;\n  --body-size: 1rem;\n}\n`;

interface Harness {
  ctrl: DesignSectionController;
  fs: FakeFs;
  timer: FakeTimer;
  onError: ReturnType<typeof spy>;
  onEditRawCss: ReturnType<typeof spy>;
  styles: ProjectStyle[];
  projectDir: string | null;
}

function make(over: Partial<{ cssPath: string; noProject: boolean }> = {}): Harness {
  const cssPath = over.cssPath ?? "/proj/styles/theme.css";
  const fs = new FakeFs();
  fs.files.set(cssPath, ROOT_CSS);
  const timer = new FakeTimer();
  const onError = spy();
  const onEditRawCss = spy();
  const h = {
    fs,
    timer,
    onError,
    onEditRawCss,
    styles: [{ path: cssPath, displayName: "styles/theme.css", active: true }],
    projectDir: over.noProject ? null : "/proj",
  } as Harness;
  h.ctrl = new DesignSectionController({
    projectDir: () => h.projectDir,
    listStyles: () => Promise.resolve(h.styles),
    readFile: fs.readFile,
    writeFile: fs.writeFile,
    onError: (m) => onError(m),
    onEditRawCss: (p) => onEditRawCss(p),
    debounceMs: 250,
    setTimer: timer.set,
    clearTimer: timer.clear,
  });
  return h;
}

test("initial public rune state matches the panel defaults", () => {
  const { ctrl } = make();
  expect(ctrl.cssPath).toBeNull();
  expect(ctrl.cssName).toBe("");
  expect(ctrl.tokens).toEqual([]);
  expect(ctrl.designLoading).toBe(false);
  expect(ctrl.designError).toBeNull();
  expect(ctrl.designSaveStatus).toBe("idle");
  expect(ctrl.anyDirty).toBe(false);
});

test("loadDesign resolves the active stylesheet and parses its :root tokens", async () => {
  const h = make();
  await h.ctrl.loadDesign();
  expect(h.ctrl.cssPath).toBe("/proj/styles/theme.css");
  expect(h.ctrl.cssName).toBe("styles/theme.css");
  expect(h.ctrl.designLoading).toBe(false);
  expect(h.ctrl.designError).toBeNull();
  expect(h.ctrl.tokens.map((t) => t.name)).toEqual(["--heading-color", "--body-size"]);
  expect(h.ctrl.colorTokens.map((t) => t.name)).toEqual(["--heading-color"]);
  expect(h.ctrl.sizeTokens.map((t) => t.name)).toEqual(["--body-size"]);
  // Freshly loaded → nothing dirty.
  expect(h.ctrl.anyDirty).toBe(false);
});

test("loadDesign no-ops without a project dir", async () => {
  const h = make({ noProject: true });
  await h.ctrl.loadDesign();
  expect(h.ctrl.cssPath).toBeNull();
  expect(h.ctrl.tokens).toEqual([]);
});

test("loadDesign clears cssPath when there are no styles", async () => {
  const h = make();
  h.styles = [];
  await h.ctrl.loadDesign();
  expect(h.ctrl.cssPath).toBeNull();
  expect(h.ctrl.cssName).toBe("");
});

test("setToken marks the section saving and dirty but does not write until the debounce fires", async () => {
  const h = make();
  await h.ctrl.loadDesign();
  const t = h.ctrl.colorTokens[0];
  const writesBefore = h.fs.writes;
  h.ctrl.setToken(t, "#00ff00");
  expect(t.value).toBe("#00ff00");
  expect(h.ctrl.isDirty(t)).toBe(true);
  expect(h.ctrl.anyDirty).toBe(true);
  expect(h.ctrl.designSaveStatus).toBe("saving");
  // Debounce hasn't elapsed → no write yet.
  expect(h.fs.writes).toBe(writesBefore);
  // Fire the debounce → single read + write, status flips to saved.
  h.timer.fire();
  await flush();
  expect(h.fs.writes).toBe(writesBefore + 1);
  expect(h.ctrl.designSaveStatus).toBe("saved");
  expect(h.fs.files.get("/proj/styles/theme.css")).toContain("--heading-color: #00ff00;");
});

test("two edits inside one debounce window coalesce into a single read-modify-write", async () => {
  const h = make();
  await h.ctrl.loadDesign();
  const color = h.ctrl.colorTokens[0];
  const size = h.ctrl.sizeTokens[0];
  h.fs.reads = 0;
  h.fs.writes = 0;
  h.ctrl.setToken(color, "#123456");
  h.ctrl.setLength(size, "2"); // -> "2rem"
  // Only the latest timer is live; firing it commits BOTH edits at once.
  h.timer.fire();
  await flush();
  expect(h.fs.writes).toBe(1);
  expect(h.fs.reads).toBe(1);
  const out = h.fs.files.get("/proj/styles/theme.css")!;
  expect(out).toContain("--heading-color: #123456;");
  expect(out).toContain("--body-size: 2rem;");
  expect(h.ctrl.designSaveStatus).toBe("saved");
});

test("resetToken reverts a dirty token to its original and schedules a write", async () => {
  const h = make();
  await h.ctrl.loadDesign();
  const t = h.ctrl.colorTokens[0];
  h.ctrl.setToken(t, "#00ff00");
  h.timer.fire();
  await flush();
  expect(h.ctrl.isDirty(t)).toBe(true);
  h.ctrl.resetToken(t);
  expect(t.value).toBe("#cc0000");
  h.timer.fire();
  await flush();
  expect(h.ctrl.isDirty(t)).toBe(false);
  expect(h.fs.files.get("/proj/styles/theme.css")).toContain("--heading-color: #cc0000;");
});

test("revertAllTokens restores every dirty token", async () => {
  const h = make();
  await h.ctrl.loadDesign();
  h.ctrl.setToken(h.ctrl.colorTokens[0], "#00ff00");
  h.ctrl.setLength(h.ctrl.sizeTokens[0], "3");
  h.timer.fire();
  await flush();
  expect(h.ctrl.anyDirty).toBe(true);
  h.ctrl.revertAllTokens();
  h.timer.fire();
  await flush();
  expect(h.ctrl.anyDirty).toBe(false);
  const out = h.fs.files.get("/proj/styles/theme.css")!;
  expect(out).toContain("--heading-color: #cc0000;");
  expect(out).toContain("--body-size: 1rem;");
});

test("setLength ignores blank input (no schedule)", async () => {
  const h = make();
  await h.ctrl.loadDesign();
  const size = h.ctrl.sizeTokens[0];
  h.ctrl.designSaveStatus = "idle";
  h.ctrl.setLength(size, "   ");
  expect(h.ctrl.designSaveStatus).toBe("idle");
  expect(h.timer.pending).toBeNull();
});

test("a failed write re-queues the batch, surfaces onError, and drops to idle", async () => {
  const h = make();
  await h.ctrl.loadDesign();
  const t = h.ctrl.colorTokens[0];
  h.fs.failNextWrite = true;
  h.ctrl.setToken(t, "#00ff00");
  h.timer.fire();
  await flush();
  expect(h.onError.calls.length).toBe(1);
  expect(String(h.onError.calls[0][0])).toContain("disk full");
  expect(h.ctrl.designSaveStatus).toBe("idle");
  // The batch is re-queued: a later successful flush persists it.
  h.ctrl.flushPendingTokenWrites();
  await flush();
  expect(h.fs.files.get("/proj/styles/theme.css")).toContain("--heading-color: #00ff00;");
});

test("editRawCss forwards the active css path only when one is loaded", async () => {
  const h = make();
  h.ctrl.editRawCss();
  expect(h.onEditRawCss.calls.length).toBe(0); // no cssPath yet
  await h.ctrl.loadDesign();
  h.ctrl.editRawCss();
  expect(h.onEditRawCss.calls).toEqual([["/proj/styles/theme.css"]]);
});

test("a stylesheet switch during a token-write commit never redirects the old sheet's tokens into the new file (finding #10)", async () => {
  const OLD = "/proj/styles/old.css";
  const NEW = "/proj/styles/new.css";
  const NEW_ORIGINAL = ":root {\n  --heading-color: #0000ff;\n}\n";
  const files = new Map<string, string>([
    [OLD, ":root {\n  --heading-color: #cc0000;\n}\n"],
    [NEW, NEW_ORIGINAL],
  ]);
  const writes: Array<{ path: string; content: string }> = [];

  // A one-shot gate: the NEXT readFile blocks until released, so we can switch
  // the active stylesheet while a commit is parked on its read-before-write.
  let releaseGatedRead: (() => void) | null = null;
  let armGate = false;
  const readFile = (path: string): Promise<string> => {
    const content = files.get(path) ?? "";
    if (armGate) {
      armGate = false;
      return new Promise<string>((resolve) => {
        releaseGatedRead = () => resolve(content);
      });
    }
    return Promise.resolve(content);
  };
  const writeFile = (path: string, content: string): Promise<{ mtimeMs: number }> => {
    writes.push({ path, content });
    files.set(path, content);
    return Promise.resolve({ mtimeMs: 1 });
  };

  const timer = new FakeTimer();
  let styles: ProjectStyle[] = [{ path: OLD, displayName: "old.css", active: true }];
  const ctrl = new DesignSectionController({
    projectDir: () => "/proj",
    listStyles: () => Promise.resolve(styles),
    readFile,
    writeFile,
    onError: () => {},
    onEditRawCss: () => {},
    debounceMs: 250,
    setTimer: timer.set,
    clearTimer: timer.clear,
  });

  await ctrl.loadDesign(); // cssPath = OLD (this read is ungated)
  expect(ctrl.cssPath).toBe(OLD);
  ctrl.setToken(ctrl.colorTokens[0], "#00ff00"); // schedules a pending write on OLD

  // Fire the debounce with the gate armed: commitPendingTokens reads OLD and
  // parks on the gate, mid read-before-write.
  armGate = true;
  timer.fire();
  await flush();
  expect(releaseGatedRead).not.toBeNull(); // commit is parked on the read

  // Concurrent stylesheet switch while the commit is parked.
  styles = [{ path: NEW, displayName: "new.css", active: true }];
  await ctrl.loadDesign();
  expect(ctrl.cssPath).toBe(NEW);

  // Release the parked read; the commit's write now runs.
  releaseGatedRead!();
  await flush();

  // The write must land on OLD (the captured path), never the newly selected
  // NEW file — and NEW's content must be exactly what loadDesign parsed.
  expect(writes.map((w) => w.path)).toEqual([OLD]);
  expect(files.get(NEW)).toBe(NEW_ORIGINAL);
  expect(files.get(OLD)).toContain("--heading-color: #00ff00;");
});
