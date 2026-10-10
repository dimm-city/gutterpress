import { expect, test } from "bun:test";
import {
  deriveOpenStage,
  exportStage,
  formatSpec,
  reduceRestore,
  UPDATING_STAGE,
  type OpenStageInput,
  type RestoreView,
} from "../../src/lib/loading/activity-stage";
import type { RestoreProgressEvent } from "../../src/lib/platform/shared-types";

const idle: OpenStageInput = {
  busy: false,
  busyLabel: "",
  restore: null,
  rendering: false,
  settling: false,
  pages: 0,
};

test("idle derives no stage", () => {
  expect(deriveOpenStage(idle)).toBeNull();
});

test("opening a book says which book", () => {
  expect(deriveOpenStage({ ...idle, busy: true, busyLabel: "Opening Dimm City…" })).toEqual({
    id: "opening",
    label: "Opening Dimm City…",
    detail: null,
    progress: null,
  });
  expect(deriveOpenStage({ ...idle, busy: true })?.label).toBe("Opening your book…");
});

test("downloading with several packages is determinate and names the one in flight", () => {
  const restore: RestoreView = { total: 2, index: 0, spec: "gp-dimm-city@1.2.0-alpha.3", completed: 0 };
  expect(deriveOpenStage({ ...idle, busy: true, busyLabel: "Opening X…", restore })).toEqual({
    id: "downloading",
    label: "Downloading extensions (1 of 2)…",
    detail: "gp-dimm-city 1.2.0-alpha.3",
    progress: { value: 0, total: 2 },
  });
  const second = { ...restore, index: 1, spec: "gp-b@2.0.0", completed: 1 };
  const stage = deriveOpenStage({ ...idle, busy: true, restore: second });
  expect(stage?.label).toBe("Downloading extensions (2 of 2)…");
  expect(stage?.progress).toEqual({ value: 1, total: 2 });
});

test("a single package is indeterminate (no sub-progress to show)", () => {
  const restore: RestoreView = { total: 1, index: 0, spec: "gp-x@1.0.0", completed: 0 };
  const stage = deriveOpenStage({ ...idle, busy: true, restore });
  expect(stage).toMatchObject({ id: "downloading", label: "Downloading extension…", progress: null });
});

test("a download that is not part of an open in flight is ignored", () => {
  const restore: RestoreView = { total: 2, index: 0, spec: "gp-x@1.0.0", completed: 0 };
  expect(deriveOpenStage({ ...idle, restore })).toBeNull();
});

test("laying out shows a page count only once there is one", () => {
  expect(deriveOpenStage({ ...idle, rendering: true })).toEqual({
    id: "layout",
    label: "Laying out pages…",
    detail: null,
    progress: null,
  });
  expect(deriveOpenStage({ ...idle, rendering: true, pages: 1 })?.detail).toBe("1 page so far");
  expect(deriveOpenStage({ ...idle, rendering: true, pages: 42 })?.detail).toBe("42 pages so far");
});

test("settling after layout reads as finishing, with the final count", () => {
  expect(deriveOpenStage({ ...idle, settling: true, pages: 287 })).toEqual({
    id: "finishing",
    label: "Finishing up…",
    detail: "287 pages",
    progress: null,
  });
});

test("an open in flight outranks the previous book's leftover render state", () => {
  const stage = deriveOpenStage({ ...idle, busy: true, busyLabel: "Opening B…", rendering: true, pages: 90 });
  expect(stage?.id).toBe("opening");
});

test("stages arrive in order across a whole open", () => {
  const ids = [
    deriveOpenStage({ ...idle, busy: true, busyLabel: "Opening X…" }),
    deriveOpenStage({ ...idle, busy: true, restore: { total: 2, index: 0, spec: "a@1.0.0", completed: 0 } }),
    deriveOpenStage({ ...idle, busy: true, busyLabel: "Opening X…" }),
    deriveOpenStage({ ...idle, rendering: true, pages: 3 }),
    deriveOpenStage({ ...idle, settling: true, pages: 12 }),
    deriveOpenStage(idle),
  ].map((s) => s?.id ?? null);
  expect(ids).toEqual(["opening", "downloading", "opening", "layout", "finishing", null]);
});

// ── restore event folding ─────────────────────────────────────────────────

function fold(events: RestoreProgressEvent[]): Array<RestoreView | null> {
  const out: Array<RestoreView | null> = [];
  let view: RestoreView | null = null;
  for (const e of events) {
    view = reduceRestore(view, e);
    out.push(view);
  }
  return out;
}

test("restore events map to N-of-M progress and clear on end", () => {
  const views = fold([
    { type: "start", specs: ["a@1.0.0", "b@2.0.0"] },
    { type: "package", spec: "a@1.0.0", index: 0, total: 2, state: "downloading" },
    { type: "package", spec: "a@1.0.0", index: 0, total: 2, state: "done" },
    { type: "package", spec: "b@2.0.0", index: 1, total: 2, state: "downloading" },
    { type: "package", spec: "b@2.0.0", index: 1, total: 2, state: "failed", message: "offline" },
    { type: "end", installed: ["a@1.0.0"], failed: [{ use: "b@2.0.0", message: "offline" }] },
  ]);
  expect(views.map((v) => v && [v.index, v.completed])).toEqual([
    [0, 0],
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 2], // a failure still counts as work finished: the bar never stalls
    null,
  ]);
});

test("a start with nothing listed yields no view", () => {
  expect(reduceRestore(null, { type: "start", specs: [] })).toBeNull();
});

test("formatSpec reads a package in a sentence, scoped names included", () => {
  expect(formatSpec("gp-dimm-city@1.2.0-alpha.3")).toBe("gp-dimm-city 1.2.0-alpha.3");
  expect(formatSpec("@dimm-city/gp-x@1.0.0")).toBe("@dimm-city/gp-x 1.0.0");
  expect(formatSpec("no-version")).toBe("no-version");
});

test("hot-reload and export stages", () => {
  expect(UPDATING_STAGE).toMatchObject({ id: "updating", label: "Updating preview…", progress: null });
  expect(exportStage(null, false)).toBeNull();
  expect(exportStage("Rendering page 3…", "rendering")).toMatchObject({
    id: "exporting",
    done: false,
    cancelable: true,
  });
  // Cancel describes the stage on screen: a finished or canceling export offers none.
  expect(exportStage("PDF saved", "success")).toMatchObject({ done: true, cancelable: false });
  expect(exportStage("Canceling export…", "canceling")).toMatchObject({ done: false, cancelable: false });
});
