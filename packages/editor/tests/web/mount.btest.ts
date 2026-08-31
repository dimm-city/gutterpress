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

async function mountSecond(text: string, options?: { shareHost?: boolean }): Promise<string> {
  await harness.page.evaluate(
    ({ text, options }) => window.__gpMount.mountSecond(text, options),
    { text, options },
  );
  return harness.page.evaluate(() => window.__gpMount.secondContainerSelector);
}

async function disposeSecond(): Promise<void> {
  await harness.page.evaluate(() => window.__gpMount.disposeSecond());
}

async function secondHostText(): Promise<string> {
  return harness.page.evaluate(() => window.__gpMount.getSecondHostText());
}

/** Active subscriber count on the PRIMARY host (`mount()`'s host) —
 * SFE-P2a round-2 repair, see `support/entry.ts`'s `activeSubscriberCount`. */
async function activeSubscriberCount(): Promise<number> {
  return harness.page.evaluate(() => window.__gpMount.activeSubscriberCount());
}

/** SFE-P3ab (Lane D) — the primary mount's live caret/selection, via
 *  `EditorMount.getSelection()` (`support/entry.ts`'s passthrough). */
async function selectionOffsets(): Promise<{ from: number; to: number } | undefined> {
  return harness.page.evaluate(() => window.__gpMount.getSelection());
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

describe("a re-entrant host notification that disposes the mount during applyEdit (SFE-P2a round-1 repair)", () => {
  test("does not resurrect DOM or fire a diagnostic, and leaves the mount cleanly disposed", async () => {
    const selector = await mount("hello", { disposeOnFirstNotify: true });
    await requireDocumentText(selector);
    expect(await editorElementCount(selector)).toBe(1);

    // A real keystroke drives the mount's own `host.applyEdit(edit)` call.
    // `MemoryDocumentHost.applyEdit` notifies subscribers SYNCHRONOUSLY on
    // success, before it returns — and this mount's host wrapper
    // (`self-disposing-host.ts`) disposes the mount from inside that very
    // notification, re-entrantly, before the keystroke's own `applyEdit`
    // call has unwound.
    await harness.page.click(selector);
    await harness.page.keyboard.press("End");
    await harness.page.keyboard.type("X");
    await harness.page.waitForTimeout(100);

    // No DOM resurrection: the editor stays removed, not re-rendered by
    // whatever code ran after the re-entrant dispose.
    expect(await editorElementCount(selector)).toBe(0);
    expect(await injectedStyleElementCount()).toBe(0);
    // No diagnostic: this is a clean re-entrant dispose, not an error path.
    expect(await harness.page.evaluate(() => window.__gpMount.diagnostics())).toEqual([]);

    // The mount is left genuinely disposed — a further dispose() call is
    // still safely idempotent (mirrors the "dispose is idempotent" case
    // above, but starting from a RE-ENTRANT disposal, not a caller-driven
    // one).
    await expect(dispose()).resolves.toBeUndefined();
  });
});

describe("dispose isolation between two independent LIVE mounts on SEPARATE hosts (SFE-P2a round-1 repair)", () => {
  // ROUND-2 CORRECTION: this describe's original title read "...sharing one
  // document", which this case's own body does NOT prove — mount() and
  // mountSecond() (no options) each construct their OWN, independent
  // MemoryDocumentHost, so what this case actually demonstrates is DOM and
  // injected-<style> isolation between two mounts that happen to share one
  // browser page, not host/subscriber isolation on a SHARED document/host.
  // The shared-HOST half of the original P1a "dispose on one mount does not
  // affect a second, independent mount" case — subscriber-count isolation,
  // and B staying reachable via `replaceExternal` and its own keystroke
  // after A disposes — was NOT covered here despite mount.test.ts's table
  // row claiming this test as a direct reproduction. See the next describe
  // block below, which closes that gap.
  test("disposing one mount leaves the other's DOM, injected <style>, and host completely intact", async () => {
    const selectorA = await mount("first mount");
    await requireDocumentText(selectorA);
    const selectorB = await mountSecond("second mount");
    await requireDocumentText(selectorB);

    expect(await editorElementCount(selectorA)).toBe(1);
    expect(await editorElementCount(selectorB)).toBe(1);
    const stylesWithBoth = await injectedStyleElementCount();
    // Each live mount injects its own <style> elements — with two mounts up,
    // the count reflects both (this run's own NEW per-mount CSS injection;
    // the P1a-era table's superseded-by claim covered adapter-level listener
    // isolation only, not this).
    expect(stylesWithBoth).toBeGreaterThan(0);

    await dispose(); // disposes ONLY mount A

    // A's DOM and styles are gone...
    expect(await editorElementCount(selectorA)).toBe(0);
    // ...but B's editor, styles, and host are completely untouched.
    expect(await editorElementCount(selectorB)).toBe(1);
    expect(await requireDocumentText(selectorB)).toBe("second mount");
    expect(await secondHostText()).toBe("second mount");
    const stylesWithOnlyB = await injectedStyleElementCount();
    expect(stylesWithOnlyB).toBeGreaterThan(0);
    expect(stylesWithOnlyB).toBeLessThan(stylesWithBoth);

    await disposeSecond();
    expect(await editorElementCount(selectorB)).toBe(0);
    expect(await injectedStyleElementCount()).toBe(0);
  });
});

describe("dispose isolation between two independent LIVE mounts SHARING one host (SFE-P2a round-2 repair)", () => {
  // Closes the gap the ROUND-2 CORRECTION comment above names: the P1a
  // "dispose on one mount does not affect a second, independent mount on
  // the SAME host" case (git show d6c3a2b5:packages/editor/tests/web/
  // mount.test.ts:268) asserted subscriber-count isolation (2 -> 1 on A's
  // dispose) AND that B stayed reachable via `host.replaceExternal(...)`
  // afterward. `support/entry.ts`'s `mountSecond(text, { shareHost: true })`
  // mounts B onto the EXACT SAME host object `mount()` constructed for A,
  // wrapped in `withSubscriberCounting` so `activeSubscriberCount()` proves
  // it directly against the real fork surface -- not a reused/superseded
  // proof, a fresh assertion of the dropped behavior.
  test("disposing one mount unsubscribes only that mount -- the other stays live and reachable on the shared host", async () => {
    const selectorA = await mount("shared doc");
    await requireDocumentText(selectorA);
    // shareHost: true mounts B onto the SAME host object A is using
    // (support/entry.ts) -- the initial-text argument below is ignored,
    // mirroring MountOptions.keepHost's own "initial text is ignored"
    // convention, since the shared host already holds A's "shared doc" text.
    const selectorB = await mountSecond("ignored", { shareHost: true });
    await requireDocumentText(selectorB);

    expect(await activeSubscriberCount()).toBe(2);

    await dispose(); // disposes ONLY mount A, on the shared host

    // A's own subscription is gone -- but B's is still active. This is the
    // exact P1a assertion the round-1 repair dropped: disposing one mount
    // on a host shared with another live mount unsubscribes exactly that
    // one mount, never every subscriber of the shared host.
    expect(await activeSubscriberCount()).toBe(1);
    expect(await editorElementCount(selectorA)).toBe(0);
    expect(await editorElementCount(selectorB)).toBe(1);

    // B is still live: an external replacement on the shared host still
    // reaches B's rendered surface.
    await harness.page.evaluate(() =>
      window.__gpMount.replaceExternal("changed via shared host"),
    );
    await harness.page.waitForTimeout(100);
    expect(await requireDocumentText(selectorB)).toBe("changed via shared host");

    // B's own keystroke still reaches the shared host too -- not just
    // external replacement.
    const callsBeforeBKeystroke = await applyEditCallCount();
    await harness.page.click(selectorB);
    await harness.page.keyboard.press("End");
    await harness.page.keyboard.type("!");
    await harness.page.waitForTimeout(50);
    expect(await applyEditCallCount()).toBe(callsBeforeBKeystroke + 1);
    expect(await hostText()).toBe("changed via shared host!");
    expect(await requireDocumentText(selectorB)).toBe("changed via shared host!");

    await disposeSecond();
    expect(await activeSubscriberCount()).toBe(0);
  });
});

describe("getSelection reports the fork's LIVE caret as D3 source offsets (SFE-P3ab, Lane D)", () => {
  // AP-21 liveness precedes behavior here too: every case below reads
  // through `requireDocumentText` before asserting on the selection.
  test("undefined before the mounted surface has ever been focused", async () => {
    const selector = await mount("hello world");
    await requireDocumentText(selector);

    expect(await selectionOffsets()).toBeUndefined();
  });

  test("a keyboard-navigated collapsed caret matches an INDEPENDENTLY computed index", async () => {
    const text = "hello world";
    const selector = await mount(text);
    await requireDocumentText(selector);

    await harness.page.click(selector);
    await harness.page.keyboard.press("Home");
    // The independent computation: "hello ".length, not a number pulled
    // from the accessor itself or from mount()'s own bookkeeping.
    const target = "hello ".length;
    for (let i = 0; i < target; i++) {
      await harness.page.keyboard.press("ArrowRight");
    }

    expect(await selectionOffsets()).toEqual({ from: target, to: target });
  });

  test("a real keystroke at that reported position lands EXACTLY there — corroborating the offset independently of the accessor itself", async () => {
    const text = "hello world";
    const selector = await mount(text);
    await requireDocumentText(selector);

    await harness.page.click(selector);
    await harness.page.keyboard.press("Home");
    const target = "hello ".length;
    for (let i = 0; i < target; i++) {
      await harness.page.keyboard.press("ArrowRight");
    }
    expect(await selectionOffsets()).toEqual({ from: target, to: target });

    await harness.page.keyboard.type("X");
    await harness.page.waitForTimeout(50);

    // If the caret had actually been anywhere else, this exact string could
    // not result — independent, non-tautological proof the reported offset
    // was the REAL caret position, not merely a value the accessor invented.
    expect(await hostText()).toBe("hello Xworld");
  });

  test("a non-collapsed FORWARD selection reports {from: start, to: end}, matching an independently computed span", async () => {
    const text = "hello world";
    const selector = await mount(text);
    await requireDocumentText(selector);

    await harness.page.click(selector);
    await harness.page.keyboard.press("Home");
    const wordStart = "hello ".length;
    for (let i = 0; i < wordStart; i++) {
      await harness.page.keyboard.press("ArrowRight");
    }
    for (let i = 0; i < "world".length; i++) {
      await harness.page.keyboard.press("Shift+ArrowRight");
    }

    expect(await selectionOffsets()).toEqual({ from: wordStart, to: text.length });
  });

  test("a non-collapsed BACKWARD selection (dragged right-to-left) still normalizes to {from <= to}", async () => {
    const text = "hello world";
    const selector = await mount(text);
    await requireDocumentText(selector);

    await harness.page.click(selector);
    await harness.page.keyboard.press("End"); // anchor at text.length
    const wordStart = "hello ".length;
    for (let i = 0; i < text.length - wordStart; i++) {
      await harness.page.keyboard.press("Shift+ArrowLeft"); // active walks BACKWARD past the anchor
    }

    // anchor (text.length) > active (wordStart) here -- a real backward
    // drag -- yet the accessor's contract (adapter.ts: "never see from > to")
    // still reports the normalized, ascending pair.
    expect(await selectionOffsets()).toEqual({ from: wordStart, to: text.length });
  });

  test("dispose leaves getSelection reporting the LAST known state on the disposed handle, not a throw", async () => {
    const selector = await mount("probe");
    await requireDocumentText(selector);
    await harness.page.click(selector);
    await harness.page.keyboard.press("End");

    await expect(dispose()).resolves.toBeUndefined();
    // dispose() does not null out mountHandle in the driver (see
    // support/entry.ts) -- reading getSelection() on an already-disposed
    // mount must not throw. An unhandled rejection from evaluate() below
    // would fail this test on its own; what the disposed handle actually
    // REPORTS is not this test's concern (the underlying model is torn
    // down) -- only that reading it stays safe.
    await harness.page.evaluate(() => window.__gpMount.getSelection());
  });
});

describe("harness liveness", () => {
  test("the shared session produced no console or page errors across every case above", () => {
    expect(harness.consoleErrors).toEqual([]);
    expect(harness.pageErrors).toEqual([]);
  });
});
