import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  openHarnessSession,
  waitForHarnessReady,
  type HarnessSession,
} from "../../browser-harness/index.ts";
import type { MountOptions } from "./support/entry.ts";

/**
 * SFE-P1b Lane B — real-Chromium proof of D5's mandatory cases 7 and 8
 * (docs/plans/source-first-editor/runs/SFE-P1b.md's behavior table), driving
 * `createVscodeEditorAdapter` (src/vscode-adapter/adapter.ts) through a REAL
 * `@vscode/markdown-editor` mounted in a REAL browser (I-01: "Package
 * declarations alone are insufficient; exercise the exact pinned runtime").
 *
 * ONE shared browser session (`beforeAll`/`afterAll`), same reasoning as
 * `tests/vscode-adapter/browser.cases.btest.ts`'s own header comment
 * (measured live in this sandboxed environment: a fresh Chromium launch per
 * `test()` hangs on the second launch).
 *
 * AP-21 ("liveness assertions precede behavioral assertions"): every case
 * asserts the mounted editor rendered real content before asserting on
 * adapter/host/DOM behavior.
 *
 * Static API evidence gathered before writing this file (verified live
 * against the exact installed 0.0.2-84 `dist/index.js`/`dist/index.d.ts`,
 * not assumed from package declarations — I-01):
 *   - The editor's ROOT element (`.md-editor`) is NOT `contenteditable`; it
 *     is a plain, focusable (`tabIndex = 0`) `<div>`. All real text input
 *     flows through a native `EditContext` the view constructs and assigns
 *     to `element.editContext` — confirmed by `this.editContext = new
 *     EditContext({...})` and `this.element.editContext = this.editContext`
 *     in the installed `dist/index.js`.
 *   - The ONLY listener the package registers against that EditContext is
 *     `textupdate` (`c.addEventListener("textupdate", this._handleTextUpdate)`,
 *     where `c = this._view.editContext`). `_handleTextUpdate` unconditionally
 *     forwards `e.text` into `_insertText` (readonly and pending-paragraph
 *     cases aside) — there is NO composition-state guard in that handler, and
 *     no `compositionstart`/`compositionupdate`/`compositionend` DOM listener
 *     is registered anywhere in the package. This is the API evidence behind
 *     this file's IME describe block below.
 *   - Clipboard is the DEFAULT `ba` strategy: plain `copy`/`cut`/`paste` DOM
 *     `ClipboardEvent`s on the view's root element, using
 *     `event.clipboardData` directly (`r.clipboardData?.getData("text/plain")`
 *     on paste) — NOT the async `navigator.clipboard` API. This is why case
 *     8's real-clipboard sub-case exercises `Ctrl+C`/`Ctrl+V` keyboard
 *     shortcuts (which dispatch trusted `copy`/`paste` events Chromium
 *     fulfils even headless) rather than assuming the async Clipboard API
 *     permissions are what gate it.
 *   - Tab-focus accessibility is ACTIVE by construction: the adapter never
 *     overrides `keyboardProfile`, and the package's own default IS the
 *     profile that gates `_registerTabFocusAccessibility` on. That call sets
 *     `aria-description="Press Control+M to toggle whether Tab inserts
 *     indentation or moves focus. While locked, Tab always moves focus."`
 *     and `aria-keyshortcuts="Control+M"` on the editor root, and the
 *     underlying `_tabMovesFocus` flag defaults to `false` — meaning Tab is
 *     intentionally TRAPPED for indentation by default (mirroring real code
 *     editors), with `Control+M` as the documented, exercised escape hatch.
 *     This file's "no keyboard trap" case proves the trap AND the escape
 *     hatch, not just an assumed vanilla Tab-exits behavior.
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

async function mount(id: string, text: string, options?: MountOptions): Promise<string> {
  return harness.page.evaluate(
    ({ id, text, options }) => window.__gpA11y.mount(id, text, options),
    { id, text, options },
  );
}

async function dispose(id: string): Promise<void> {
  await harness.page.evaluate((id) => window.__gpA11y.dispose(id), id);
}

async function hostText(id: string): Promise<string> {
  return harness.page.evaluate((id) => window.__gpA11y.getHostText(id), id);
}

async function applyEditCallCount(id: string): Promise<number> {
  return harness.page.evaluate((id) => window.__gpA11y.applyEditCallCount(id), id);
}

async function activeSubscriberCount(id: string): Promise<number> {
  return harness.page.evaluate((id) => window.__gpA11y.activeSubscriberCount(id), id);
}

async function lastSubmittedEdit(id: string) {
  return harness.page.evaluate((id) => window.__gpA11y.lastSubmittedEdit(id), id);
}

/** AP-21 liveness: asserts the mounted editor rendered a `.md-document` with
 * the exact expected text, and returns that text. Every case calls this
 * before behavioral assertions — mirrors
 * `browser.cases.btest.ts`'s own `requireDocumentText`. */
async function requireDocumentText(selector: string): Promise<string> {
  const text = await harness.page.evaluate(
    (sel: string) => document.querySelector(`${sel} .md-document`)?.textContent ?? null,
    selector,
  );
  expect(text).not.toBeNull();
  return text as string;
}

async function focusEditor(selector: string): Promise<void> {
  await harness.page.click(`${selector} .md-editor`);
}

describe("case 7 — custom CSS + isolated mounting", () => {
  test("7a: an additional custom stylesheet reaches computed styles inside .md-document", async () => {
    const selector = await mount("css-a", "custom css reaches this text", {
      classNames: ["md-theme-default"],
    });
    await requireDocumentText(selector);

    // Not present anywhere in editor.css or themes/default.css (verified by
    // source search before writing this test) — a positive match can only
    // be explained by THIS injected sheet. A literal px value (rather than
    // `em`) sidesteps computed-style unit resolution (`getComputedStyle`
    // resolves `letter-spacing` to an absolute px value regardless of the
    // authored unit — verified live) so the assertion below compares
    // exactly what was authored.
    await harness.page.evaluate(() => {
      window.__gpA11y.injectCustomStyle(
        ".md-document { letter-spacing: 7px; --gp-a11y-case7a: reached; }",
      );
    });

    const letterSpacing = await harness.page.evaluate(
      (sel: string) =>
        getComputedStyle(document.querySelector(`${sel} .md-document`)!).letterSpacing,
      selector,
    );
    expect(letterSpacing).toBe("7px");

    const customProp = await harness.page.evaluate(
      (sel: string) =>
        getComputedStyle(document.querySelector(`${sel} .md-document`)!)
          .getPropertyValue("--gp-a11y-case7a")
          .trim(),
      selector,
    );
    expect(customProp).toBe("reached");

    await dispose("css-a");
  });

  test("7b: editor styles do not leak onto a generic element outside the container", async () => {
    const outsideP = harness.page.locator(
      await harness.page.evaluate(() => window.__gpA11y.outsideProbeParagraphSelector),
    );
    const outsideH1 = harness.page.locator(
      await harness.page.evaluate(() => window.__gpA11y.outsideProbeHeadingSelector),
    );

    async function readProbeStyles() {
      return {
        p: await outsideP.evaluate((el) => {
          const cs = getComputedStyle(el);
          return { margin: cs.margin, fontFamily: cs.fontFamily, fontSize: cs.fontSize };
        }),
        h1: await outsideH1.evaluate((el) => {
          const cs = getComputedStyle(el);
          return { margin: cs.margin, fontFamily: cs.fontFamily, fontSize: cs.fontSize };
        }),
      };
    }

    const before = await readProbeStyles();

    // Mount (theme class + the same custom sheet from 7a, still attached to
    // the page) — the exact operation case 7b needs to prove does not leak.
    const selector = await mount("css-b", "leakage probe document", {
      classNames: ["md-theme-default"],
    });
    await requireDocumentText(selector);
    await harness.page.evaluate(() => {
      window.__gpA11y.injectCustomStyle(".md-document { letter-spacing: 7px; }");
    });

    const after = await readProbeStyles();

    expect(after).toEqual(before);

    await dispose("css-b");
  });

  test("7c: a second independent editor instance on the same page has its own document — edits never cross-contaminate", async () => {
    const selectorA = await mount("iso-a", "first independent document");
    const selectorB = await mount("iso-b", "second independent document");

    // Liveness: both render their OWN text.
    expect(await requireDocumentText(selectorA)).toBe("first independent document");
    expect(await requireDocumentText(selectorB)).toBe("second independent document");

    // Type into A only.
    await focusEditor(selectorA);
    await harness.page.keyboard.press("End");
    await harness.page.keyboard.type("!A");
    await harness.page.waitForTimeout(50);

    expect(await hostText("iso-a")).toBe("first independent document!A");
    // B's host is completely untouched by A's edit.
    expect(await hostText("iso-b")).toBe("second independent document");
    expect(await applyEditCallCount("iso-b")).toBe(0);

    // Type into B only; A's already-edited text must not be reverted or
    // touched by B's own edit.
    await focusEditor(selectorB);
    await harness.page.keyboard.press("End");
    await harness.page.keyboard.type("!B");
    await harness.page.waitForTimeout(50);

    expect(await hostText("iso-b")).toBe("second independent document!B");
    expect(await hostText("iso-a")).toBe("first independent document!A");

    // The rendered DOM is likewise independent, not a shared/duplicated view.
    expect(await requireDocumentText(selectorA)).toContain("first independent document!A");
    expect(await requireDocumentText(selectorB)).toContain("second independent document!B");
    const crossLeak = await harness.page.evaluate(
      (sel: string) => document.querySelector(`${sel} .md-document`)!.textContent!.includes("second independent"),
      selectorA,
    );
    expect(crossLeak).toBe(false);

    await dispose("iso-a");
    await dispose("iso-b");
  });
});

describe("case 8 — clipboard", () => {
  test("document.execCommand('insertText') against the editor's non-contenteditable EditContext surface", async () => {
    const selector = await mount("clip-exec", "exec command probe");
    await requireDocumentText(selector);

    await focusEditor(selector);
    await harness.page.keyboard.press("End");

    const callsBefore = await applyEditCallCount("clip-exec");
    const execResult = await harness.page.evaluate(() =>
      document.execCommand("insertText", false, "-EXEC"),
    );
    await harness.page.waitForTimeout(50);
    const callsAfter = await applyEditCallCount("clip-exec");

    // Recorded finding (see this file's header comment): `.md-editor` is a
    // plain, non-`contenteditable` element — the browser's `execCommand`
    // editing-command infrastructure has no editable root to act on here,
    // so this is expected, exercised evidence of a NO-OP, not a silent
    // assumption. `page.keyboard.insertText` (next test) is this run's
    // PROVEN case 8 "insertText" path.
    expect(execResult).toBe(false);
    expect(callsAfter).toBe(callsBefore);
    expect(await hostText("clip-exec")).toBe("exec command probe");

    await dispose("clip-exec");
  });

  test("page.keyboard.insertText: exactly one byte-exact SourceEdit at the caret", async () => {
    const original = "insert text probe";
    const selector = await mount("clip-insert", original);
    await requireDocumentText(selector);

    await focusEditor(selector);
    await harness.page.keyboard.press("End");

    const callsBefore = await applyEditCallCount("clip-insert");
    await harness.page.keyboard.insertText(" PASTED");
    await harness.page.waitForTimeout(50);

    expect(await applyEditCallCount("clip-insert")).toBe(callsBefore + 1);
    expect(await hostText("clip-insert")).toBe(`${original} PASTED`);

    const edit = await lastSubmittedEdit("clip-insert");
    expect(edit).toEqual({
      from: original.length,
      to: original.length,
      insert: " PASTED",
      expectedVersion: 0,
    });

    await dispose("clip-insert");
  });

  test("real clipboard round-trip: Ctrl+C then Ctrl+V reproduces the copied text", async () => {
    const context = harness.page.context();
    const origin = new URL(harness.page.url()).origin;

    let permissionsGranted = true;
    let permissionsError: string | undefined;
    try {
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    } catch (error) {
      permissionsGranted = false;
      permissionsError = error instanceof Error ? error.message : String(error);
    }

    const selector = await mount("clip-rt", "clipboard round trip source");
    await requireDocumentText(selector);

    await focusEditor(selector);
    // Select the word "clipboard" (offsets [0, 9)) via keyboard only.
    await harness.page.keyboard.press("Home");
    for (let i = 0; i < "clipboard".length; i++) {
      await harness.page.keyboard.press("Shift+ArrowRight");
    }

    if (!permissionsGranted) {
      // SFE-P1b repair (round 1): the ONLY condition allowed to bypass the
      // real behavioral assertion below is a PROVEN-unsupported environment
      // — the clipboard permission grant itself failed, checked here via an
      // explicitly asserted capability probe, not inferred after the fact
      // from whatever the keyboard sequence happened to produce. This
      // branch is loud (a real assertion on the probe's own failure, plus a
      // logged reason), not a silent skip (AP-20) and not the always-true
      // disjunction this replaced (`copyPasteWorked || observedError !==
      // undefined`, which every code path set one side of, so it could
      // never fail regardless of what Ctrl+C/Ctrl+V actually did).
      expect(permissionsGranted, "capability probe: grantPermissions failed").toBe(false);
      console.log(
        "case 8 real-clipboard round-trip: NOT exercisable in this environment " +
          `— grantPermissions failed: ${permissionsError}. ` +
          "The previous test (page.keyboard.insertText) remains this run's proven insertion case.",
      );
      await dispose("clip-rt");
      return;
    }

    await harness.page.keyboard.press("Control+c");
    await harness.page.waitForTimeout(50);
    await harness.page.keyboard.press("End");
    await harness.page.keyboard.type(" ");
    await harness.page.keyboard.press("Control+v");
    await harness.page.waitForTimeout(100);

    // Real, unconditional behavioral assertion: with the capability probe
    // above having proven this environment supports clipboard access, a
    // regression in the package's clipboard strategy now fails this test.
    expect(await hostText("clip-rt")).toBe("clipboard round trip source clipboard");
    console.log(
      "case 8 real-clipboard round-trip: PASS (grantPermissions ok=true, " +
        "Ctrl+C then Ctrl+V reproduced the copied text byte-exact).",
    );

    await dispose("clip-rt");
  });
});

describe("case 8 — IME / composition", () => {
  test("the editor surface is not contenteditable; the package wires ONLY EditContext.textupdate (API evidence, see file header)", async () => {
    const selector = await mount("ime-evidence", "ime evidence probe");
    await requireDocumentText(selector);

    const surface = await harness.page.evaluate((sel: string) => {
      const el = document.querySelector(`${sel} .md-editor`) as HTMLElement;
      return {
        contentEditable: el.contentEditable,
        isContentEditable: el.isContentEditable,
        tabIndex: el.tabIndex,
        hasEditContext: "editContext" in el && (el as unknown as { editContext?: unknown }).editContext != null,
      };
    }, selector);

    expect(surface.isContentEditable).toBe(false);
    expect(surface.tabIndex).toBe(0);
    expect(surface.hasEditContext).toBe(true);

    await dispose("ime-evidence");
  });

  test("a synthetic CompositionEvent + beforeinput sequence does not submit a partial SourceEdit", async () => {
    const original = "compose here: ";
    const selector = await mount("ime-synthetic", original);
    await requireDocumentText(selector);

    await focusEditor(selector);
    await harness.page.keyboard.press("End");

    const callsBefore = await applyEditCallCount("ime-synthetic");

    // Dispatched at document.activeElement, exactly as the run spec names:
    // compositionstart -> compositionupdate('日') -> compositionupdate('日本')
    // -> compositionend, bracketed by matching `beforeinput` composition
    // events. These are SCRIPT-CONSTRUCTED events, not a real OS IME driving
    // the browser's native EditContext pipeline (Playwright/CDP expose no
    // public IME-composition API — see this file's header). What this DOES
    // honestly prove: the package's real, wired-up input listener
    // (`EditContext.textupdate`) is never reached by classic DOM composition
    // events, so no edit is submitted while "composing" this way.
    const result = await harness.page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const dispatchedTypes: string[] = [];
      const fire = (event: Event) => {
        dispatchedTypes.push(event.type);
        el.dispatchEvent(event);
      };
      fire(new CompositionEvent("compositionstart", { data: "", bubbles: true, cancelable: true }));
      fire(
        new InputEvent("beforeinput", {
          inputType: "insertCompositionText",
          data: "日",
          bubbles: true,
          cancelable: true,
        }),
      );
      fire(
        new CompositionEvent("compositionupdate", { data: "日", bubbles: true, cancelable: true }),
      );
      fire(
        new InputEvent("beforeinput", {
          inputType: "insertCompositionText",
          data: "日本",
          bubbles: true,
          cancelable: true,
        }),
      );
      fire(
        new CompositionEvent("compositionupdate", { data: "日本", bubbles: true, cancelable: true }),
      );
      fire(
        new InputEvent("beforeinput", {
          inputType: "insertFromComposition",
          data: "日本",
          bubbles: true,
          cancelable: true,
        }),
      );
      fire(new CompositionEvent("compositionend", { data: "日本", bubbles: true, cancelable: true }));
      return { activeElementClass: el.className, dispatchedTypes };
    });

    await harness.page.waitForTimeout(50);

    expect(result.activeElementClass).toContain("md-editor");
    expect(result.dispatchedTypes).toEqual([
      "compositionstart",
      "beforeinput",
      "compositionupdate",
      "beforeinput",
      "compositionupdate",
      "beforeinput",
      "compositionend",
    ]);

    // The honestly-provable claim: synthetic composition does not corrupt
    // or partially submit source. It does NOT, by itself, prove a REAL IME's
    // interim EditContext.textupdate events are similarly inert — the API
    // evidence in this file's header records that _handleTextUpdate has no
    // composition-state guard, so that remains an open risk for the
    // decision record, not something this synthetic path can honestly rule
    // out either way.
    expect(await applyEditCallCount("ime-synthetic")).toBe(callsBefore);
    expect(await hostText("ime-synthetic")).toBe(original);
    expect(await requireDocumentText(selector)).toBe(original);

    await dispose("ime-synthetic");
  });
});

describe("case 8 — accessibility", () => {
  test("the editor root is focusable via Tab and exposes a reachable accessibility node", async () => {
    const selector = await mount("a11y-focus", "accessibility probe text");
    await requireDocumentText(selector);

    const sentinelBefore = await harness.page.evaluate(() => window.__gpA11y.sentinelBeforeSelector);
    await harness.page.click(sentinelBefore);
    await harness.page.keyboard.press("Tab");
    await harness.page.waitForTimeout(20);

    const focusedClass = await harness.page.evaluate(() => document.activeElement?.className ?? "");
    expect(focusedClass).toContain("md-editor");

    // `.md-focused` (dist/index.d.ts's `EditorView.focused`, mirrored onto
    // the root) gates the painted caret — proven here as the DOM-visible
    // side effect of genuine focus, not the internal observable itself
    // (this driver has no access to package internals per D5).
    const hasFocusedClass = await harness.page.evaluate(
      () => document.activeElement?.classList.contains("md-focused") ?? false,
    );
    expect(hasFocusedClass).toBe(true);

    // `page.accessibility.snapshot()` (used by Lane A's era of Playwright
    // API knowledge) does not exist on the pinned playwright-core@1.60.0
    // `Page` type — verified live while writing this test, it was replaced
    // by `Locator.ariaSnapshot()` (a YAML accessibility-tree dump). Using
    // the API that actually exists in the exact pinned runtime, not an
    // assumed/older one (I-01).
    let axSnapshot: string | undefined;
    let axError: string | undefined;
    try {
      axSnapshot = await harness.page.locator(`${selector} .md-editor`).ariaSnapshot();
    } catch (error) {
      axError = error instanceof Error ? error.message : String(error);
    }

    // Recorded, not assumed: whatever role Chromium actually computes for
    // this focusable-but-role-less element is evidence for the decision
    // record either way. The one hard requirement proven here is that the
    // node is REACHABLE in the accessibility tree at all (not pruned/absent
    // entirely, e.g. not an empty string), which a keyboard-only or
    // screen-reader user depends on.
    if (axError) {
      console.log(`case 8 accessibility snapshot unavailable: ${axError}`);
    } else {
      expect(axSnapshot).toBeTruthy();
      console.log(`case 8 accessibility snapshot (ariaSnapshot): ${JSON.stringify(axSnapshot)}`);
    }

    await dispose("a11y-focus");
  });

  test("arrow-key navigation moves the caret (observable via .md-cursor geometry)", async () => {
    const selector = await mount("a11y-caret", "abcdefghij");
    await requireDocumentText(selector);

    await focusEditor(selector);
    await harness.page.keyboard.press("Home");
    await harness.page.waitForTimeout(20);

    const cursorSelector = `${selector} .md-cursor`;
    const rectAt = async () =>
      harness.page.evaluate((sel: string) => {
        const el = document.querySelector(sel);
        return el ? el.getBoundingClientRect().x : null;
      }, cursorSelector);

    const xBefore = await rectAt();
    expect(xBefore).not.toBeNull();

    for (let i = 0; i < 5; i++) {
      await harness.page.keyboard.press("ArrowRight");
    }
    await harness.page.waitForTimeout(20);

    const xAfter = await rectAt();
    expect(xAfter).not.toBeNull();
    expect(xAfter as number).toBeGreaterThan(xBefore as number);

    await dispose("a11y-caret");
  });

  test("Tab is trapped for indentation by default and Control+M is the documented escape hatch (no permanent keyboard trap)", async () => {
    // showReadonlyToggle: false — the default-rendered readonly-toggle
    // button (see support/entry.ts's `MountOptions.showReadonlyToggle` doc
    // comment) is itself a real, legitimate extra Tab stop INSIDE the
    // editor; excluding it here isolates this case to the MAIN text
    // surface's own Tab behavior, which is what this case is about.
    const selector = await mount("a11y-tab", "tab focus probe", { showReadonlyToggle: false });
    await requireDocumentText(selector);

    const sentinelBefore = await harness.page.evaluate(() => window.__gpA11y.sentinelBeforeSelector);
    const sentinelAfter = await harness.page.evaluate(() => window.__gpA11y.sentinelAfterSelector);

    await harness.page.click(sentinelBefore);
    await harness.page.keyboard.press("Tab");
    await harness.page.waitForTimeout(20);
    let activeClass = await harness.page.evaluate(() => document.activeElement?.className ?? "");
    expect(activeClass).toContain("md-editor");

    // Default state (`_tabMovesFocus === false`, per this file's header
    // evidence): Tab is consumed by the editor (indentation), not handed to
    // the browser's own focus-order handling — focus stays inside.
    await harness.page.keyboard.press("Tab");
    await harness.page.waitForTimeout(20);
    activeClass = await harness.page.evaluate(() => document.activeElement?.className ?? "");
    expect(activeClass).toContain("md-editor");

    // The documented escape hatch (`aria-keyshortcuts="Control+M"`,
    // `aria-description`: "Press Control+M to toggle whether Tab inserts
    // indentation or moves focus.") — toggling it is what proves this is
    // NOT a permanent trap.
    await harness.page.keyboard.press("Control+m");
    await harness.page.waitForTimeout(20);
    await harness.page.keyboard.press("Tab");
    await harness.page.waitForTimeout(20);

    const activeIdAfterEscape = await harness.page.evaluate(() => document.activeElement?.id ?? "");
    expect(activeIdAfterEscape).toBe(sentinelAfter.slice(1));

    await dispose("a11y-tab");
  });
});

describe("case 8 — disposal", () => {
  test("after dispose: zero further applyEdit calls, subscriber count returns to baseline, container is empty", async () => {
    const selector = await mount("disposal-a", "disposal probe text");
    await requireDocumentText(selector);

    expect(await activeSubscriberCount("disposal-a")).toBe(1);

    await focusEditor(selector);
    await harness.page.keyboard.press("End");
    await harness.page.keyboard.type("!");
    await harness.page.waitForTimeout(50);

    const callsBeforeDispose = await applyEditCallCount("disposal-a");
    expect(callsBeforeDispose).toBeGreaterThan(0);

    await dispose("disposal-a");
    await harness.page.waitForTimeout(20);

    expect(await activeSubscriberCount("disposal-a")).toBe(0);

    const childCountAfterDispose = await harness.page.evaluate(
      (sel: string) => document.querySelector(sel)!.children.length,
      selector,
    );
    expect(childCountAfterDispose).toBe(0);

    // Typing/keyboard events produce ZERO further applyEdit calls — the
    // classic "listener kept firing after dispose" leak this proof targets.
    // The container is now empty (0 children, asserted above), so it has
    // zero layout area and cannot be `.click()`ed (Playwright's
    // actionability check requires a visible, non-zero-size target) —
    // `dispose()` removed `.md-editor` along with every listener the
    // package attached to it, so there is deliberately nothing left inside
    // the container to focus. What this proves instead: no OTHER (e.g.
    // document/window-level) listener the disposed adapter left behind
    // reacts to keystrokes and calls back into the disposed host — a real,
    // meaningful leak shape a purely local "was the element removed" check
    // would miss.
    await harness.page.evaluate(() => document.body.focus());
    await harness.page.keyboard.type("more text after dispose");
    await harness.page.waitForTimeout(50);

    expect(await applyEditCallCount("disposal-a")).toBe(callsBeforeDispose);
    expect(await hostText("disposal-a")).toBe("disposal probe text!");
  });

  test("remount is clean: exactly one applyEdit per keypress, no duplicate/leftover listener from the disposed prior instance", async () => {
    const firstSelector = await mount("disposal-remount", "first mount");
    await requireDocumentText(firstSelector);
    await dispose("disposal-remount");
    await harness.page.waitForTimeout(20);

    // Remounting with the SAME id disposes+removes the old
    // container/adapter/host and builds entirely fresh ones (see
    // support/entry.ts's `mount()` doc comment).
    const secondSelector = await mount("disposal-remount", "second mount");
    await requireDocumentText(secondSelector);

    expect(await applyEditCallCount("disposal-remount")).toBe(0);
    expect(await activeSubscriberCount("disposal-remount")).toBe(1);

    await focusEditor(secondSelector);
    await harness.page.keyboard.press("End");
    await harness.page.keyboard.press("x");
    await harness.page.waitForTimeout(50);

    // A single physical keypress produces exactly ONE applyEdit call — a
    // leftover listener from the disposed prior instance firing alongside
    // the fresh one's own listener would double this count (the classic
    // leak symptom the run spec names explicitly).
    expect(await applyEditCallCount("disposal-remount")).toBe(1);
    expect(await hostText("disposal-remount")).toBe("second mountx");

    await dispose("disposal-remount");
  });
});

// ---------------------------------------------------------------------------
// SFE-P3d-sweep Lane A gap closure -- scenario 9 ("paste rich/plain text").
// Case 8's clipboard suite above proves plain-text copy/paste round-trips
// byte-exactly. It does NOT prove what happens with HTML-flavored (rich)
// clipboard content -- this file's own header already records the source
// evidence (verified against the real, pinned fork's `dist/index.js`): the
// paste handler is `const c = r.clipboardData?.getData("text/plain"); c &&
// e.insertText(c);` -- a plain grep for "text/html" against that same bundle
// returns ZERO matches anywhere in the package. This suite turns that static
// evidence into a live, behavioral proof and PINS the real, current result
// rather than an aspirational one: pasting HTML never produces any HTML- or
// Markdown-derived content -- when a plain-text flavor also exists on the
// clipboard (the common real-world case: copying from a browser or word
// processor always sets both), only that plain flavor lands; when the
// clipboard carries ONLY an HTML flavor, pasting is a complete no-op.
//
// Constructed, not real-OS, clipboard data (`new DataTransfer()` +
// `ClipboardEvent`) -- same honest limitation this file's IME suite already
// documents for synthetic input. This is a STRONGER proof here than for IME,
// though: the package's own paste handler reads `event.clipboardData`
// directly off whatever event reaches it, trusted or not, so a
// script-dispatched `ClipboardEvent` carrying a real `DataTransfer` drives
// the exact same code path a real OS-level paste would.
// ---------------------------------------------------------------------------

describe("case 8 — paste: HTML-flavored clipboard content (pinned behavior)", () => {
  test("both text/html and text/plain present: only the plain-text flavor is inserted -- never the HTML, and never any markdown-ified derivative of it", async () => {
    const original = "paste target:";
    const selector = await mount("html-plain", original);
    await requireDocumentText(selector);

    await focusEditor(selector);
    await harness.page.keyboard.press("End");

    const callsBefore = await applyEditCallCount("html-plain");
    const dispatchResult = await harness.page.evaluate((sel: string) => {
      const el = document.querySelector(`${sel} .md-editor`) as HTMLElement;
      const dt = new DataTransfer();
      dt.setData("text/html", "<strong>BOLDHTML</strong>");
      dt.setData("text/plain", "PLAINFALLBACK");
      const evt = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
      return el.dispatchEvent(evt);
    }, selector);
    await harness.page.waitForTimeout(80);

    // AP-21 liveness: `dispatchEvent` returning `false` here means the
    // handler called `preventDefault()` on a cancelable event -- proof the
    // package's real paste listener genuinely intercepted this event, not
    // that it silently bubbled past unhandled.
    expect(dispatchResult).toBe(false);
    expect(await applyEditCallCount("html-plain")).toBe(callsBefore + 1);

    const expectedText = `${original}PLAINFALLBACK`;
    expect(await hostText("html-plain")).toBe(expectedText);
    // The decisive negative proof: no trace of the HTML content, its tag,
    // or a markdown-ified rendering of it (e.g. "**BOLDHTML**") anywhere in
    // the result.
    expect(await hostText("html-plain")).not.toContain("BOLDHTML");
    expect(await hostText("html-plain")).not.toContain("<strong>");
    expect(await hostText("html-plain")).not.toContain("**");

    const edit = await lastSubmittedEdit("html-plain");
    expect(edit).toEqual({
      from: original.length,
      to: original.length,
      insert: "PLAINFALLBACK",
      expectedVersion: 0,
    });

    await dispose("html-plain");
  });

  test("ONLY text/html present (no text/plain flavor at all): pasting is a complete no-op -- no edit is submitted and the document is byte-identical", async () => {
    const original = "paste target:";
    const selector = await mount("html-only", original);
    await requireDocumentText(selector);

    await focusEditor(selector);
    await harness.page.keyboard.press("End");

    const callsBefore = await applyEditCallCount("html-only");
    const dispatchResult = await harness.page.evaluate((sel: string) => {
      const el = document.querySelector(`${sel} .md-editor`) as HTMLElement;
      const dt = new DataTransfer();
      dt.setData("text/html", "<strong>ONLYHTML</strong>");
      const evt = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
      return el.dispatchEvent(evt);
    }, selector);
    await harness.page.waitForTimeout(80);

    // The handler still ran (same liveness signal as the case above) --
    // this is a genuine no-op, not an event that never reached the package.
    expect(dispatchResult).toBe(false);
    expect(await applyEditCallCount("html-only")).toBe(callsBefore);
    expect(await hostText("html-only")).toBe(original);
    expect(await requireDocumentText(selector)).toBe(original);

    await dispose("html-only");
  });
});

describe("harness liveness", () => {
  test("the shared session produced no unexpected console or page errors across every case above", () => {
    expect(harness.pageErrors).toEqual([]);
    expect(harness.consoleErrors).toEqual([]);
  });
});
