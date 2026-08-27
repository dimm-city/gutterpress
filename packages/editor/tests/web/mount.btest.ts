import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  openHarnessSession,
  waitForHarnessReady,
  type HarnessSession,
} from "../browser-harness/index.ts";
import type { MountOptions } from "./support/entry.ts";

/**
 * SFE-P2a Lane A — real-Chromium proof of `mountEditor`'s adapter-backed
 * surface, driving it through `window.__gpMount`
 * (`tests/web/support/entry.ts`) exactly the way P1b's
 * `browser.cases.btest.ts` drives `createVscodeEditorAdapter`.
 *
 * SCOPE: this suite proves what is NEW about `mountEditor` versus the raw
 * adapter it wraps — CSS injection (base + theme + `extraCss`), option
 * pass-through (`onDiagnostic`, `readonly`), and the wrapper's OWN
 * mount/dispose/remount cleanliness. It deliberately does NOT re-prove the
 * adapter's own accept/reject/revert/external-replacement/undo semantics in
 * exhaustive detail — those stay proven, unmodified and green, by
 * `tests/vscode-adapter/browser.cases.btest.ts` and its siblings (this
 * run's own "Behavior that must remain unchanged" clause). Re-deriving the
 * same adapter-level proof a second time here would be redundant coverage
 * of the same code path, not stronger evidence.
 *
 * ONE shared browser session drives every case (`beforeAll`/`afterAll`),
 * matching the measured-live reason `browser-harness/index.ts`'s header
 * documents (a fresh Chromium launch per `test()` hangs on the second
 * launch in this sandboxed environment).
 *
 * AP-21 ("liveness assertions precede behavioral assertions"): every case
 * asserts the mounted editor rendered real content (`requireDocumentText`)
 * BEFORE asserting on host/diagnostic/CSS behavior.
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
    ({ text, options }) => window.__gpMount.mount(text, options),
    { text, options },
  );
  return harness.page.evaluate(() => window.__gpMount.containerSelector);
}

async function dispose(): Promise<void> {
  await harness.page.evaluate(() => window.__gpMount.dispose());
}

async function hostText(): Promise<string> {
  return harness.page.evaluate(() => window.__gpMount.getHostText());
}

async function hostVersion(): Promise<number> {
  return harness.page.evaluate(() => window.__gpMount.getHostVersion());
}

async function applyEditCallCount(): Promise<number> {
  return harness.page.evaluate(() => window.__gpMount.applyEditCallCount());
}

async function injectedStyleElementCount(): Promise<number> {
  return harness.page.evaluate(() => window.__gpMount.injectedStyleElementCount());
}

/** AP-21 liveness: asserts the mounted editor rendered a `.md-document` with
 * the exact expected text, and returns that text. */
async function requireDocumentText(selector: string): Promise<string> {
  const text = await harness.page.evaluate(
    (sel: string) => document.querySelector(`${sel} .md-document`)?.textContent ?? null,
    selector,
  );
  expect(text).not.toBeNull();
  return text as string;
}

async function editorElementCount(selector: string): Promise<number> {
  return harness.page.evaluate(
    (sel: string) => document.querySelectorAll(`${sel} .md-editor`).length,
    selector,
  );
}

describe("mount renders host text via the fork (liveness)", () => {
  test("mounts exactly one .md-editor with the host's current snapshot text", async () => {
    const selector = await mount("hello world");

    expect(await requireDocumentText(selector)).toBe("hello world");
    expect(await editorElementCount(selector)).toBe(1);
  });

  test("the default theme class is applied and its CSS reaches computed styles, with no extra option", async () => {
    const selector = await mount("theme probe");
    await requireDocumentText(selector);

    const hasThemeClass = await harness.page.evaluate(
      (sel: string) => document.querySelector(`${sel} .md-editor`)?.classList.contains("md-theme-default") ?? false,
      selector,
    );
    expect(hasThemeClass).toBe(true);

    // themes/default.css sets `.md-editor.md-theme-default { font-size: 16px; }`
    // — not present anywhere in editor.css's own base rules (verified by
    // source search before writing this test), so a positive match can only
    // be explained by mountEditor's own injected theme CSS actually applying.
    const fontSize = await harness.page.evaluate(
      (sel: string) => getComputedStyle(document.querySelector(`${sel} .md-editor`)!).fontSize,
      selector,
    );
    expect(fontSize).toBe("16px");
  });
});

describe("typing updates host through the adapter path", () => {
  test("a real keystroke at the end of the document submits an edit and the host reflects it", async () => {
    const selector = await mount("hello world");
    await requireDocumentText(selector);

    await harness.page.click(selector);
    await harness.page.keyboard.press("End");
    await harness.page.keyboard.type("!");
    await harness.page.waitForTimeout(50);

    expect(await hostText()).toBe("hello world!");
    expect(await hostVersion()).toBe(1);
    expect(await requireDocumentText(selector)).toContain("hello world!");
  });
});

describe("external replacement re-renders the document", () => {
  test("host.replaceExternal updates both the host and the rendered view", async () => {
    const selector = await mount("hello");
    await requireDocumentText(selector);

    await harness.page.evaluate(() => window.__gpMount.replaceExternal("goodbye, world"));
    await harness.page.waitForTimeout(100);

    expect(await hostText()).toBe("goodbye, world");
    expect(await hostVersion()).toBe(1);
    expect(await requireDocumentText(selector)).toBe("goodbye, world");
  });
});

describe("readonly host mounts a readonly editor", () => {
  test("typing on a readonly-mounted editor never attempts an edit (proactive, not reject-then-revert)", async () => {
    const selector = await mount("hello", { readonly: true });
    await requireDocumentText(selector);

    await harness.page.click(selector);
    await harness.page.keyboard.press("End");
    await harness.page.keyboard.type("X");
    await harness.page.waitForTimeout(100);

    expect(await hostText()).toBe("hello");
    // Proactive readonly (options.readonly passed through to the adapter,
    // which sets the model's own readonlyMode) means the model never even
    // ATTEMPTS the edit — distinct from, and stronger than, P1a's textarea
    // shell's readonly behavior, which submitted every keystroke and relied
    // on the host to reject it after the fact.
    expect(await applyEditCallCount()).toBe(0);
    expect(await requireDocumentText(selector)).toBe("hello");
  });
});

describe("a rejected edit still surfaces its diagnostic through mountEditor's onDiagnostic", () => {
  test("an always-invalid-range host leaves source unchanged and reports EDITOR_INVALID_RANGE", async () => {
    const selector = await mount("abc", { rejectReason: "invalid-range" });
    await requireDocumentText(selector);

    await harness.page.click(selector);
    await harness.page.keyboard.press("End");
    await harness.page.keyboard.type("d");
    await harness.page.waitForTimeout(100);

    expect(await hostText()).toBe("abc");
    const diagnostics = await harness.page.evaluate(() => window.__gpMount.diagnostics());
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.category).toBe("EDITOR_INVALID_RANGE");
  });
});

describe("extraCss reaches computed styles", () => {
  test("an extraCss stylesheet passed to mountEditor applies inside .md-document", async () => {
    const selector = await mount("css probe text", {
      extraCss: ".md-document { letter-spacing: 7px; --gp-mount-extra-css: reached; }",
    });
    await requireDocumentText(selector);

    const letterSpacing = await harness.page.evaluate(
      (sel: string) => getComputedStyle(document.querySelector(`${sel} .md-document`)!).letterSpacing,
      selector,
    );
    expect(letterSpacing).toBe("7px");

    const customProp = await harness.page.evaluate(
      (sel: string) =>
        getComputedStyle(document.querySelector(`${sel} .md-document`)!)
          .getPropertyValue("--gp-mount-extra-css")
          .trim(),
      selector,
    );
    expect(customProp).toBe("reached");
  });
});

describe("dispose", () => {
  test("removes the mounted editor and every <style> element mountEditor injected", async () => {
    const selector = await mount("dispose probe");
    await requireDocumentText(selector);
    expect(await editorElementCount(selector)).toBe(1);
    expect(await injectedStyleElementCount()).toBeGreaterThan(0);

    await dispose();

    expect(await editorElementCount(selector)).toBe(0);
    expect(await injectedStyleElementCount()).toBe(0);
  });

  test("is idempotent: disposing an already-disposed mount does not throw", async () => {
    await mount("idempotent dispose probe");
    await dispose();

    await expect(
      harness.page.evaluate(() => {
        window.__gpMount.dispose();
        window.__gpMount.dispose();
      }),
    ).resolves.toBeUndefined();

    expect(await injectedStyleElementCount()).toBe(0);
  });
});

describe("dispose then remount on the same host", () => {
  test("exactly one applyEdit call reaches the host per keypress -- no leaked wiring from the disposed mount", async () => {
    const selector = await mount("hello");
    await requireDocumentText(selector);

    await harness.page.click(selector);
    await harness.page.keyboard.press("End");
    await harness.page.keyboard.type("A");
    await harness.page.waitForTimeout(50);

    const callsAfterFirst = await applyEditCallCount();
    expect(callsAfterFirst).toBe(1);
    expect(await hostText()).toBe("helloA");

    await dispose();
    // `keepHost: true` reuses the SAME host across this remount -- the
    // initial-text argument is ignored by the driver once a host already
    // exists (see entry.ts's `mount()`), so it is irrelevant here.
    const remountedSelector = await mount("ignored", { keepHost: true });
    await requireDocumentText(remountedSelector);

    await harness.page.click(remountedSelector);
    await harness.page.keyboard.press("End");
    await harness.page.keyboard.type("B");
    await harness.page.waitForTimeout(50);

    // If the first (disposed) mount's wiring had leaked, this single
    // keypress would have been observed twice (once by the dead listener,
    // once by the live one) and produced callsAfterFirst + 2.
    expect(await applyEditCallCount()).toBe(callsAfterFirst + 1);
    expect(await hostText()).toBe("helloAB");
  });
});

describe("harness liveness", () => {
  test("the shared session produced no console or page errors across every case above", () => {
    expect(harness.consoleErrors).toEqual([]);
    expect(harness.pageErrors).toEqual([]);
  });
});
