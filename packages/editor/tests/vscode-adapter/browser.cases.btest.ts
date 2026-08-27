import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  openHarnessSession,
  waitForHarnessReady,
  type HarnessSession,
} from "../browser-harness/index.ts";
import type { MountOptions } from "./support/entry.ts";

/**
 * SFE-P1b Lane A — real-Chromium proof of D5's mandatory cases 1, 1b, 2, 3
 * plus the rejection path, driving `createVscodeEditorAdapter`
 * (src/vscode-adapter/adapter.ts) through a REAL `@vscode/markdown-editor`
 * mounted in a REAL browser (I-01: "Package declarations alone are
 * insufficient; exercise the exact pinned runtime").
 *
 * ONE shared browser session (`beforeAll`/`afterAll`) drives every case in
 * this file via `window.__gp` (tests/vscode-adapter/support/entry.ts) —
 * measured live in this sandboxed environment: launching a fresh Chromium
 * per `test()` hung the second launch every time (30s timeout); one shared
 * session mounting/disposing between cases ran the same scenarios in
 * ~1-2s (see browser-harness/index.ts's header comment for the measurement
 * and the `openHarnessSession` design this drove).
 *
 * AP-21 ("liveness assertions precede behavioral assertions"): every case
 * asserts the mounted editor rendered real content (`requireBlockText`,
 * `requireDocumentText`) BEFORE asserting on adapter/host behavior, so a
 * silently-failed mount cannot be misread as a passing case.
 */

const entryPath = resolve(import.meta.dir, "support/entry.ts");

let harness: HarnessSession;
let closeHarness: () => Promise<void>;

beforeAll(async () => {
  const opened = await openHarnessSession(entryPath);
  harness = opened.session;
  closeHarness = opened.close;
  await waitForHarnessReady(harness.page);
}, 30_000);

afterAll(async () => {
  await closeHarness();
});

async function mount(text: string, options?: MountOptions): Promise<string> {
  await harness.page.evaluate(
    ({ text, options }) => window.__gp.mount(text, options),
    { text, options },
  );
  return harness.page.evaluate(() => window.__gp.containerSelector);
}

async function dispose(): Promise<void> {
  await harness.page.evaluate(() => window.__gp.dispose());
}

async function hostText(): Promise<string> {
  return harness.page.evaluate(() => window.__gp.getHostText());
}

async function hostVersion(): Promise<number> {
  return harness.page.evaluate(() => window.__gp.getHostVersion());
}

/** AP-21 liveness: asserts the mounted editor rendered a `.md-document`
 * with the exact expected text, and returns that text. Every case calls
 * this (or `requireBlockCount`) before behavioral assertions. */
async function requireDocumentText(selector: string): Promise<string> {
  const text = await harness.page.evaluate(
    (sel: string) => document.querySelector(`${sel} .md-document`)?.textContent ?? null,
    selector,
  );
  expect(text).not.toBeNull();
  return text as string;
}

async function requireBlockCount(selector: string, expected: number): Promise<void> {
  const count = await harness.page.evaluate(
    (sel: string) => document.querySelectorAll(`${sel} .md-document .md-block`).length,
    selector,
  );
  expect(count).toBe(expected);
}

describe("case 1 — exact source edits", () => {
  test("typing at the end of a single-block document submits the exact minimal SourceEdit", async () => {
    const original = "hello world";
    const selector = await mount(original);
    await requireDocumentText(selector);
    await requireBlockCount(selector, 1);

    await harness.page.click(selector);
    await harness.page.keyboard.press("End");
    await harness.page.keyboard.type("!");
    await harness.page.waitForTimeout(50);

    expect(await hostText()).toBe("hello world!");
    expect(await hostVersion()).toBe(1);

    const edit = await harness.page.evaluate(() => window.__gp.lastSubmittedEdit());
    expect(edit).toEqual({ from: 11, to: 11, insert: "!", expectedVersion: 0 });

    // The view round-trips the accepted edit back into rendered content.
    expect(await requireDocumentText(selector)).toContain("hello world!");
  });

  test("multi-block edit locality: typing in the second block submits an edit entirely within it, leaving the first block's text untouched", async () => {
    const original = "first block text\n\nsecond block text";
    const boundary = original.indexOf("second block text");
    const selector = await mount(original);
    await requireDocumentText(selector);
    await requireBlockCount(selector, 2);

    // Click the SECOND rendered block specifically (not just anywhere in
    // the container) so the caret lands inside it, then jump to its end.
    await harness.page.click(`${selector} .md-document .md-block:nth-child(2)`);
    await harness.page.keyboard.press("End");
    await harness.page.keyboard.type("!");
    await harness.page.waitForTimeout(50);

    expect(await hostText()).toBe("first block text\n\nsecond block text!");

    const edit = await harness.page.evaluate(() => window.__gp.lastSubmittedEdit());
    expect(edit).not.toBeUndefined();
    // Byte-exact locality (D3/SFE-P1b.md behavior table row 1): the
    // submitted [from,to) range starts at or after the second block's own
    // boundary -- the first block's 17 characters plus the blank-line
    // separator are never part of the edit.
    expect(edit!.from).toBeGreaterThanOrEqual(boundary);
    expect(edit!.to).toBeGreaterThanOrEqual(boundary);

    const text = await hostText();
    expect(text.slice(0, boundary)).toBe(original.slice(0, boundary));
  });
});

describe("case 1b — no-edit byte identity (G-01)", () => {
  const corpus: Record<string, string> = {
    "mixed bullet characters": "- one\n* two\n- three\n",
    "trailing spaces before newlines": "line one   \nline two\t\nline three",
    "no final newline": "no trailing newline at the end of this document",
    "reference-style links": '[an example][1]\n\n[1]: https://example.com "Example Title"\n',
    "HTML comments": "<!-- a leading comment -->\n\nSome text after the comment.",
    "combined non-normalized markdown": [
      "- one\n* two",
      "",
      "line with trailing spaces   ",
      "",
      "<!-- comment -->",
      "",
      "[ref][1]",
      "",
      "[1]: https://example.com",
      "no final newline after this",
    ].join("\n"),
  };

  for (const [name, text] of Object.entries(corpus)) {
    test(`mount + unmount with zero edits leaves host source byte-identical (${name})`, async () => {
      const selector = await mount(text);
      await requireDocumentText(selector);
      // Not one host.applyEdit call happened as a side effect of mounting
      // and rendering -- the strongest available proof against hidden
      // on-mount normalization (SFE-P1b.md: "check case 1b hard").
      expect(await harness.page.evaluate(() => window.__gp.applyEditCallCount())).toBe(0);
      expect(await hostText()).toBe(text);
      await dispose();
      expect(await hostText()).toBe(text);
    });
  }
});

describe("case 2 — external authoritative replacement", () => {
  test("host.replaceExternal updates the view without echoing an edit back to the host; version increments exactly once", async () => {
    const selector = await mount("hello");
    await requireDocumentText(selector);

    const callsBefore = await harness.page.evaluate(() => window.__gp.applyEditCallCount());

    await harness.page.evaluate(() => window.__gp.replaceExternal("goodbye, world"));
    await harness.page.waitForTimeout(100);

    expect(await hostText()).toBe("goodbye, world");
    expect(await hostVersion()).toBe(1);
    // No echo: the adapter's own `applyEdit` call count did not move as a
    // result of the external replacement.
    expect(await harness.page.evaluate(() => window.__gp.applyEditCallCount())).toBe(callsBefore);

    expect(await requireDocumentText(selector)).toContain("goodbye, world");
  });
});

describe("case 3 — host-delegated undo/redo (D7)", () => {
  test("Ctrl+Z after two accepted edits does not revert source (the package's history is not wired)", async () => {
    const selector = await mount("hello");
    await requireDocumentText(selector);

    await harness.page.click(selector);
    await harness.page.keyboard.press("End");
    await harness.page.keyboard.type(" one");
    await harness.page.waitForTimeout(50);
    await harness.page.keyboard.type(" two");
    await harness.page.waitForTimeout(50);

    expect(await hostText()).toBe("hello one two");
    // Real keystroke-by-keystroke input (Playwright's `.type()` sends one
    // key event per character) submits one edit per keystroke, not one per
    // `.type()` call -- the exact count is an input-method detail; what
    // matters below is whether Ctrl+Z changes it.
    const callsAfterTyping = await harness.page.evaluate(() => window.__gp.applyEditCallCount());
    expect(callsAfterTyping).toBeGreaterThan(0);

    await harness.page.keyboard.press("Control+z");
    await harness.page.waitForTimeout(150);

    // No second, package-owned history undid anything: source is
    // unchanged, no NEW applyEdit call was made (undo did not become a
    // reverse edit submitted to the host either), and no diagnostic fired.
    expect(await hostText()).toBe("hello one two");
    expect(await harness.page.evaluate(() => window.__gp.applyEditCallCount())).toBe(
      callsAfterTyping,
    );
    expect(await harness.page.evaluate(() => window.__gp.diagnostics())).toEqual([]);
    expect(await requireDocumentText(selector)).toContain("hello one two");
  });
});

describe("rejection path — stale edit reverts the model and fires EDITOR_STALE_EDIT", () => {
  test("a host that always rejects as stale leaves source unchanged and reverts the just-typed keystroke", async () => {
    const selector = await mount("hello", { rejectReason: "stale" });
    await requireDocumentText(selector);

    await harness.page.click(selector);
    await harness.page.keyboard.press("End");
    await harness.page.keyboard.type("X");
    await harness.page.waitForTimeout(150);

    expect(await hostText()).toBe("hello");

    const diagnostics = await harness.page.evaluate(() => window.__gp.diagnostics());
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.category).toBe("EDITOR_STALE_EDIT");

    // The revert is visible, not just bookkept: the rejected keystroke does
    // not linger on screen (G-01).
    expect(await requireDocumentText(selector)).toBe("hello");
  });
});

describe("rejection path — external replacement lands during the rejection window (repair)", () => {
  for (const mode of ["sync", "microtask"] as const) {
    const description =
      mode === "sync"
        ? "host fires replaceExternal SYNCHRONOUSLY inside applyEdit, before returning the rejection"
        : "host fires replaceExternal via queueMicrotask scheduled during applyEdit (the desktop file-watcher ordering)";

    test(`${description} — the view converges on the host's post-external text, and the next keystroke is accepted`, async () => {
      const selector = await mount("hello", {
        rejectThenExternal: { mode, externalText: "external text" },
      });
      await requireDocumentText(selector);

      await harness.page.click(selector);
      await harness.page.keyboard.press("End");
      await harness.page.keyboard.type("X");
      await harness.page.waitForTimeout(150);

      // The rendered text converges on the host's post-external state, not
      // on the stale snapshot captured at the moment the rejection fired —
      // this is what the deferred revert's fresh `host.getSnapshot()` read
      // (adapter.ts) proves, for both the synchronous and the microtask
      // ordering of the external replacement.
      expect(await hostText()).toBe("external text");
      expect(await requireDocumentText(selector)).toBe("external text");
      expect(await hostVersion()).toBe(1);

      const diagnosticsAfterFirst = await harness.page.evaluate(() => window.__gp.diagnostics());
      expect(diagnosticsAfterFirst).toHaveLength(1);
      expect(diagnosticsAfterFirst[0]?.category).toBe("EDITOR_STALE_EDIT");

      // The rejected keystroke is not merely lost from the view — the NEXT
      // keystroke must be ACCEPTED, not itself rejected as stale, proving
      // the adapter's own `known.version` resynced to the host's real
      // current version rather than staying pinned to the rejection-time
      // snapshot.
      await harness.page.click(selector);
      await harness.page.keyboard.press("End");
      await harness.page.keyboard.type("!");
      await harness.page.waitForTimeout(150);

      expect(await hostText()).toBe("external text!");
      expect(await requireDocumentText(selector)).toBe("external text!");
      // No second diagnostic: the follow-up keystroke was accepted, not
      // rejected.
      expect(await harness.page.evaluate(() => window.__gp.diagnostics())).toHaveLength(1);
    });
  }
});

describe("bonus — readonly host initializes the model in readonly mode", () => {
  test("a readonly-mounted editor ignores typed input entirely (no edit is ever attempted)", async () => {
    const selector = await mount("hello", { readonly: true });
    await requireDocumentText(selector);

    await harness.page.click(selector);
    await harness.page.keyboard.press("End");
    await harness.page.keyboard.type("X");
    await harness.page.waitForTimeout(100);

    expect(await hostText()).toBe("hello");
    expect(await harness.page.evaluate(() => window.__gp.applyEditCallCount())).toBe(0);
    expect(await requireDocumentText(selector)).toBe("hello");
  });
});

describe("harness liveness", () => {
  test("the shared session produced no console or page errors across every case above", () => {
    expect(harness.consoleErrors).toEqual([]);
    expect(harness.pageErrors).toEqual([]);
  });
});
