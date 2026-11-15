/**
 * The app's side of the one publish run (ADR 0012): main starts the lib's
 * `publishBook` with Electron's own Chromium, forwards its progress, lets the
 * person stop it, and writes outside the book only to a folder a dialog just
 * returned. The lib is faked: what it does is tested in the lib.
 */
import { expect, test } from "bun:test";
import { PublishRunner, type PublishRunnerDeps } from "../../electron/publish-run";
import type { EngineBrowser, PublishBookOptions, PublishBookResult, PublishProgress } from "gutterpress";

const BOOK = "/books/guide";

function result(over: Partial<PublishBookResult> = {}): PublishBookResult {
  return {
    ok: true,
    files: [{ format: "pdf", path: `${BOOK}/dist/guide/guide-pdf.pdf` }],
    targets: [],
    sourceFindings: [],
    diagnostics: [],
    ...over,
  };
}

interface Harness {
  runner: PublishRunner;
  calls: PublishBookOptions[];
  progress: PublishProgress[];
  folderAsks: string[];
  registered: string[];
  logged: string[];
  closed: number;
}

function harness(opts: {
  localDir?: string;
  picked?: string | null;
  publishBook?: (o: PublishBookOptions) => Promise<PublishBookResult>;
} = {}): Harness {
  const h: Harness = { runner: null!, calls: [], progress: [], folderAsks: [], registered: [], logged: [], closed: 0 };
  const lib = {
    publishBook: async (o: PublishBookOptions) => {
      h.calls.push(o);
      return opts.publishBook ? opts.publishBook(o) : result();
    },
    resolvePublishRequest: async () => ({ project: { projectDir: BOOK }, config: {} }),
    localPublishDir: () => opts.localDir ?? `${BOOK}/dist`,
  };
  const deps: PublishRunnerDeps = {
    loadLib: async () => lib as never,
    engineBrowser: async () =>
      ({
        close: async () => {
          h.closed += 1;
        },
      }) as unknown as EngineBrowser,
    tokenStore: {} as never,
    selections: async () => ({}) as never,
    identity: async () => ({ authorName: "Ada" }),
    sendProgress: (p) => h.progress.push(p),
    isWithinProject: async (p) => p === BOOK || p.startsWith(`${BOOK}/`),
    pickFolder: async (dir) => {
      h.folderAsks.push(dir);
      return opts.picked === undefined ? "/elsewhere/chosen" : opts.picked;
    },
    registerPickedPath: (p) => h.registered.push(p),
    log: { event: (l) => h.logged.push(l), error: (l) => h.logged.push(l) },
  };
  h.runner = new PublishRunner(deps);
  return h;
}

test("a run starts the lib's publish run with the targets and choices asked for, and returns its result", async () => {
  const h = harness();
  const out = await h.runner.run({ projectDir: BOOK, targets: ["local", "itch"], checkOnly: true, sendAnyway: ["itch"] });
  expect(out.ok).toBe(true);
  expect(h.calls).toHaveLength(1);
  expect(h.calls[0]).toMatchObject({ projectDir: BOOK, targets: ["local", "itch"], checkOnly: true, sendAnyway: ["itch"] });
  expect(h.calls[0]!.runSettings).toBeUndefined();
});

test("progress reaches the window as the lib words it", async () => {
  const h = harness({
    publishBook: async (o) => {
      o.onProgress?.({ step: "render", message: "Laying out the pages…" });
      return result();
    },
  });
  await h.runner.run({ projectDir: BOOK, targets: ["local"] });
  expect(h.progress).toEqual([{ step: "render", message: "Laying out the pages…" }]);
});

test("a local folder outside the book is confirmed in a dialog, and the folder picked is used for this run only", async () => {
  const h = harness({ localDir: "/home/ada/Desktop/out" });
  await h.runner.run({ projectDir: BOOK, targets: ["local"] });
  expect(h.folderAsks).toEqual(["/home/ada/Desktop/out"]);
  expect(h.calls[0]!.runSettings).toEqual({ local: { dir: "/elsewhere/chosen" } });
  expect(h.registered).toContain("/elsewhere/chosen");
});

test("closing that dialog stops the run before anything is made", async () => {
  const h = harness({ localDir: "/home/ada/Desktop/out", picked: null });
  const out = await h.runner.run({ projectDir: BOOK, targets: ["local"] });
  expect(out.failure).toEqual({ code: "CANCELED", message: "" });
  expect(h.calls).toHaveLength(0);
});

test("a local folder inside the book needs no dialog", async () => {
  const h = harness();
  await h.runner.run({ projectDir: BOOK, targets: ["local"] });
  expect(h.folderAsks).toEqual([]);
});

test("stopping a run aborts it and closes the windows it rendered in", async () => {
  let release!: () => void;
  const h = harness({
    publishBook: async (o) => {
      await o.engineBrowser!();
      await new Promise<void>((r) => (release = r));
      return result({ ok: false, failure: { code: o.signal?.aborted ? "CANCELED" : "BUILD_FAILED", message: "" } });
    },
  });
  const running = h.runner.run({ projectDir: BOOK, targets: ["local"] });
  await new Promise((r) => setTimeout(r, 0));
  expect(h.runner.cancel()).toEqual({ canceled: true });
  expect(h.closed).toBe(1);
  release();
  expect((await running).failure?.code).toBe("CANCELED");
  expect(h.runner.cancel()).toEqual({ canceled: false });
});

test("one run at a time", async () => {
  const gate = Promise.withResolvers<void>();
  const h = harness({ publishBook: () => gate.promise.then(() => result()) });
  const first = h.runner.run({ projectDir: BOOK, targets: ["local"] });
  await new Promise((r) => setTimeout(r, 0));
  const second = h.runner.run({ projectDir: BOOK, targets: ["local"] }).then(
    () => "it ran",
    (e: Error) => e.message,
  );
  gate.resolve();
  expect(await second).toContain("already publishing");
  await first;
});

test("a book that is not open is refused", async () => {
  const h = harness();
  await expect(h.runner.run({ projectDir: "/etc", targets: ["local"] })).rejects.toThrow();
  expect(h.calls).toHaveLength(0);
});

test("the files made, and each target's package, may be shown in their folder", async () => {
  const h = harness({
    publishBook: async () =>
      result({
        targets: [
          {
            id: "drivethrurpg-print",
            label: "DriveThruRPG (print)",
            format: "pdfx",
            status: "prepared",
            connected: true,
            findings: [],
            issues: [],
            outcome: { kind: "guided", packageDir: `${BOOK}/dist/guide/publish/dtrpg`, openUrl: "https://x", checklist: [] },
          },
        ],
      }),
  });
  await h.runner.run({ projectDir: BOOK, targets: ["drivethrurpg-print"] });
  expect(h.registered).toEqual([`${BOOK}/dist/guide/guide-pdf.pdf`, `${BOOK}/dist/guide/publish/dtrpg`]);
});

test("the app log records the run and each target's outcome, with the reason for a failure", async () => {
  const h = harness({
    publishBook: async () =>
      result({
        ok: false,
        targets: [
          { id: "local", label: "A folder", format: "pdf", status: "sent", connected: true, findings: [], issues: [] },
          {
            id: "itch",
            label: "itch.io",
            format: "pdf",
            status: "failed",
            connected: true,
            findings: [],
            issues: [],
            failure: { code: "SEND_FAILED", message: "Uploading failed.", detail: "butler push failed (exit 1)" },
          },
        ],
      }),
  });
  await h.runner.run({ projectDir: BOOK, targets: ["local", "itch"] });
  expect(h.logged[0]).toBe("[publish] local, itch started");
  expect(h.logged).toContain("[publish] local: sent");
  expect(h.logged).toContain("[publish] itch: failed (SEND_FAILED) Uploading failed. butler push failed (exit 1)");
});
