import { expect, test } from "bun:test";
import { StylesSectionController } from "../../src/lib/routes/styles-section-controller.svelte";
import type { ProjectStyle } from "../../src/lib/platform/dtos";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests (same shim as design-section-controller.test.ts).
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

type Spy = { calls: unknown[][] };
const spy = (): ((...a: unknown[]) => void) & Spy => {
  const fn = ((...a: unknown[]) => {
    fn.calls.push(a);
  }) as ((...a: unknown[]) => void) & Spy;
  fn.calls = [];
  return fn;
};

const STYLE_A: ProjectStyle = { path: "/proj/a.css", displayName: "a.css", active: true };
const STYLE_B: ProjectStyle = { path: "/proj/b.css", displayName: "b.css", active: false };

interface Harness {
  ctrl: StylesSectionController;
  onToggled: ReturnType<typeof spy>;
  onEditRawCss: ReturnType<typeof spy>;
  afterStyleChange: ReturnType<typeof spy>;
  projectDir: string | null;
  styles: ProjectStyle[];
  setActiveCalls: Array<{ dir: string; paths: string[] }>;
  failSetActive: boolean;
}

function make(over: Partial<{ noProject: boolean; styles: ProjectStyle[] }> = {}): Harness {
  const onToggled = spy();
  const onEditRawCss = spy();
  const afterStyleChange = spy();
  const h = {
    onToggled,
    onEditRawCss,
    afterStyleChange,
    projectDir: over.noProject ? null : "/proj",
    styles: over.styles ?? [STYLE_A, STYLE_B],
    setActiveCalls: [],
    failSetActive: false,
  } as Harness;
  h.ctrl = new StylesSectionController({
    projectDir: () => h.projectDir,
    listStyles: () => Promise.resolve(h.styles),
    setActive: (dir, paths) => {
      h.setActiveCalls.push({ dir, paths });
      if (h.failSetActive) return Promise.reject(new Error("write failed"));
      h.styles = h.styles.map((s) => ({ ...s, active: paths.includes(s.path) }));
      return Promise.resolve(paths);
    },
    onToggled: (on) => onToggled(on),
    onEditRawCss: (p) => onEditRawCss(p),
    afterStyleChange: () => {
      afterStyleChange();
      return Promise.resolve();
    },
  });
  return h;
}

test("initial public rune state matches the panel defaults", () => {
  const { ctrl } = make();
  expect(ctrl.styles).toEqual([]);
  expect(ctrl.stylesError).toBeNull();
  expect(ctrl.stylesBusy).toBe(false);
});

test("loadStyles populates the resolved stylesheet list", async () => {
  const h = make();
  await h.ctrl.loadStyles();
  expect(h.ctrl.styles).toEqual([STYLE_A, STYLE_B]);
});

test("loadStyles no-ops without a project dir", async () => {
  const h = make({ noProject: true });
  await h.ctrl.loadStyles();
  expect(h.ctrl.styles).toEqual([]);
});

test("toggleStyleActive rebuilds the active-paths list, saves, reloads, and refreshes design", async () => {
  const h = make();
  await h.ctrl.loadStyles();
  await h.ctrl.toggleStyleActive(STYLE_B, true);
  expect(h.setActiveCalls).toEqual([{ dir: "/proj", paths: ["/proj/a.css", "/proj/b.css"] }]);
  expect(h.ctrl.styles.find((s) => s.path === STYLE_B.path)?.active).toBe(true);
  expect(h.afterStyleChange.calls.length).toBe(1);
  expect(h.onToggled.calls).toEqual([[true]]);
  expect(h.ctrl.stylesBusy).toBe(false);
});

test("toggling a stylesheet off excludes it from the active-paths list", async () => {
  const h = make();
  await h.ctrl.loadStyles();
  await h.ctrl.toggleStyleActive(STYLE_A, false);
  expect(h.setActiveCalls).toEqual([{ dir: "/proj", paths: [] }]);
  expect(h.onToggled).toBeTruthy();
});

test("a failed toggle surfaces stylesError and does not fire onToggled/afterStyleChange", async () => {
  const h = make();
  await h.ctrl.loadStyles();
  h.failSetActive = true;
  await h.ctrl.toggleStyleActive(STYLE_B, true);
  expect(h.ctrl.stylesError).toContain("write failed");
  expect(h.onToggled.calls.length).toBe(0);
  expect(h.afterStyleChange.calls.length).toBe(0);
  expect(h.ctrl.stylesBusy).toBe(false);
});

test("editStyle forwards the stylesheet path to onEditRawCss", () => {
  const h = make();
  h.ctrl.editStyle(STYLE_A);
  expect(h.onEditRawCss.calls).toEqual([[STYLE_A.path]]);
});
