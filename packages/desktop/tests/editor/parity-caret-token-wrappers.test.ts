/**
 * parity-caret-token-wrappers.test.ts (SFE-P3d-parity repair round 1)
 *
 * Closes a CONFIRMED review finding: none of the ten replacement commands
 * parity-matrix.md's `image-properties`/`image-unwrap`/`link-edit` rows
 * name — `locateImagePropertiesAtCaret`, `applyImagePropertiesEdit`,
 * `applyImageUnwrapAtCaret`, `locateLinkEditAtCaret`, `applyLinkEditEdit`
 * (`toolbar-actions.ts`, source) and `locateRichImagePropertiesAtCaret`,
 * `applyRichImagePropertiesEdit`, `applyRichImageUnwrapAtCaret`,
 * `locateRichLinkEditAtCaret`, `applyRichLinkEditEdit` (`rich-commands.ts`,
 * rich) — was exercised by any test. Every existing test in this
 * neighborhood (`parity-image-link-*.test.ts`) imports only the SHARED
 * PURE module (`caret-token-commands.ts`'s `locateImageAtCaret`/
 * `computeImagePropertiesEdit`/…), which proves the token math and nothing
 * else. The wrapper functions this file imports hold the ONE piece of
 * logic that is NOT in the pure core: the source-mode document-identity
 * staleness guard (`toolbar-actions.ts`'s `staleCaretTokenSpanDiagnostic`)
 * and the rich-mode `expectedVersion` threading — exactly the
 * wrong-bytes-prevention logic G-01/AP-01 requires be EXERCISED, not
 * merely asserted to exist.
 *
 * Each of the ten commands gets:
 *   1. a real, end-to-end case asserting EXACT resulting bytes against a
 *      live `EditorView` (source) or `DesktopDocumentHost` (rich), and
 *   2. — for the two-step (locate/apply) commands only — a case that
 *      mutates the document BETWEEN locate and apply and asserts the apply
 *      step refuses with `EDITOR_STALE_EDIT` rather than silently writing
 *      into the wrong place.
 */
import { describe, expect, test } from "bun:test";
import { EditorState, EditorSelection, type Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  locateImagePropertiesAtCaret,
  applyImagePropertiesEdit,
  applyImageUnwrapAtCaret,
  locateLinkEditAtCaret,
  applyLinkEditEdit,
} from "../../src/lib/editor/toolbar-actions";
import {
  locateRichImagePropertiesAtCaret,
  applyRichImagePropertiesEdit,
  applyRichImageUnwrapAtCaret,
  locateRichLinkEditAtCaret,
  applyRichLinkEditEdit,
  type LiveSelection,
} from "../../src/lib/editor/rich-commands";
import { DesktopDocumentHost } from "../../src/lib/editor-host/desktop-document-host";

// ── Minimal headless EditorView mock (mirrors toolbar-actions.test.ts's own
//    makeMockView — reproduced locally, matching this test neighborhood's
//    existing posture of disposable, self-contained fixtures). ────────────
function makeMockView(
  docStr: string,
  from = docStr.length,
  to = docStr.length,
): { state: EditorState; dispatch: (...specs: Parameters<EditorView["dispatch"]>) => void; focus: () => void } {
  let state = EditorState.create({ doc: docStr, selection: EditorSelection.range(from, to) });
  const view = {
    get state() {
      return state;
    },
    dispatch(...specs: Array<Transaction | Parameters<EditorView["dispatch"]>[0]>) {
      for (const spec of specs) {
        if (spec && "state" in spec) {
          state = (spec as Transaction).state;
        } else {
          state = state.update(spec as Parameters<EditorState["update"]>[0]).state;
        }
      }
    },
    focus() {},
  };
  return view as unknown as typeof view;
}

function getDoc(view: ReturnType<typeof makeMockView>): string {
  return view.state.doc.toString();
}

// ═══════════════════════════════════════════════════════════════════════
// SOURCE MODE — toolbar-actions.ts
// ═══════════════════════════════════════════════════════════════════════

describe("source mode: locateImagePropertiesAtCaret / applyImagePropertiesEdit", () => {
  test("locates the image at the caret, applies the edit, and produces exact resulting bytes", () => {
    const text = "Intro.\n\n![A cat](cat.png)\n\nOutro.";
    const view = makeMockView(text, text.indexOf("cat.png"), text.indexOf("cat.png"));

    const located = locateImagePropertiesAtCaret(view as unknown as EditorView);
    expect(located.ok).toBe(true);
    if (!located.ok) throw new Error("unreachable");
    expect(located.value.initial.src).toBe("cat.png");

    const outcome = applyImagePropertiesEdit(view as unknown as EditorView, located.value, {
      ...located.value.initial,
      alt: "A happy cat",
      size: "gp-large",
    });
    expect(outcome.ok).toBe(true);
    expect(getDoc(view)).toBe("Intro.\n\n![A happy cat](cat.png){.gp-large}\n\nOutro.");
  });

  test("an intervening edit between locate and apply refuses with EDITOR_STALE_EDIT, changing nothing", () => {
    const text = "Intro.\n\n![A cat](cat.png)\n\nOutro.";
    const view = makeMockView(text, text.indexOf("cat.png"), text.indexOf("cat.png"));

    const located = locateImagePropertiesAtCaret(view as unknown as EditorView);
    expect(located.ok).toBe(true);
    if (!located.ok) throw new Error("unreachable");

    // Something else writes to the SAME live view before the dialog
    // resolves — a file switch (`switchFile` -> `view.setState`) or an
    // out-of-band commit both replace `view.state`/`view.state.doc`.
    (view as unknown as { dispatch: EditorView["dispatch"] }).dispatch({
      changes: { from: 0, to: 0, insert: "X" },
    });
    const afterInterveningEdit = getDoc(view);

    const outcome = applyImagePropertiesEdit(view as unknown as EditorView, located.value, {
      ...located.value.initial,
      alt: "A happy cat",
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.diagnostic.category).toBe("EDITOR_STALE_EDIT");
    // Nothing further changed — the refused apply must be a no-op.
    expect(getDoc(view)).toBe(afterInterveningEdit);
  });

  test("a FILE SWITCH between locate and apply (same EditorView, brand-new state) refuses rather than writing into the new document", () => {
    // Two "chapters" that happen to share the SAME bytes at the SAME
    // offset — exactly the case a bare byte-compare guard cannot detect
    // (SFE-P3d-parity repair round 1, CONFIRMED finding).
    const chapterA = "![Logo](logo.png)\n\nChapter A body.";
    const chapterB = "![Logo](logo.png)\n\nChapter B body — a completely different document.";
    const view = makeMockView(chapterA, chapterA.indexOf("logo.png"), chapterA.indexOf("logo.png"));

    const located = locateImagePropertiesAtCaret(view as unknown as EditorView);
    expect(located.ok).toBe(true);
    if (!located.ok) throw new Error("unreachable");

    // Simulate MarkdownEditor.svelte's switchFile(): the SAME EditorView
    // instance ("the view itself is never torn down between files"), a
    // BRAND-NEW EditorState via setState (not an incremental transaction).
    const newState = EditorState.create({ doc: chapterB, selection: EditorSelection.cursor(0) });
    (view as unknown as { dispatch: (spec: { state: EditorState }) => void }).dispatch({ state: newState });
    expect(getDoc(view)).toBe(chapterB);

    const outcome = applyImagePropertiesEdit(view as unknown as EditorView, located.value, {
      ...located.value.initial,
      alt: "This must never land in chapter B",
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.diagnostic.category).toBe("EDITOR_STALE_EDIT");
    // Chapter B is completely untouched.
    expect(getDoc(view)).toBe(chapterB);
  });
});

describe("source mode: applyImageUnwrapAtCaret", () => {
  test("removes the link wrapper at the caret in one step, producing exact resulting bytes", () => {
    const text = "Para.\n\n[![Logo](logo.png)](https://example.com)\n\nMore.";
    const caret = text.indexOf("logo.png");
    const view = makeMockView(text, caret, caret);

    const outcome = applyImageUnwrapAtCaret(view as unknown as EditorView);
    expect(outcome.ok).toBe(true);
    expect(getDoc(view)).toBe("Para.\n\n![Logo](logo.png)\n\nMore.");
  });

  test("refuses with EDITOR_INVALID_RANGE when the image has no wrapper to remove", () => {
    const text = "![Plain](plain.png)";
    const view = makeMockView(text, 3, 3);
    const outcome = applyImageUnwrapAtCaret(view as unknown as EditorView);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.diagnostic.category).toBe("EDITOR_INVALID_RANGE");
    expect(getDoc(view)).toBe(text); // refused edit changes nothing
  });
});

describe("source mode: locateLinkEditAtCaret / applyLinkEditEdit", () => {
  test("locates the link at the caret, applies the new href, and produces exact resulting bytes", () => {
    const text = 'See [our docs](https://old.example.com/docs "Docs").';
    const caret = text.indexOf("old.example.com");
    const view = makeMockView(text, caret, caret);

    const located = locateLinkEditAtCaret(view as unknown as EditorView);
    expect(located.ok).toBe(true);
    if (!located.ok) throw new Error("unreachable");
    expect(located.value.initialHref).toBe("https://old.example.com/docs");

    const outcome = applyLinkEditEdit(view as unknown as EditorView, located.value, "https://new.example.com/docs");
    expect(outcome.ok).toBe(true);
    expect(getDoc(view)).toBe('See [our docs](https://new.example.com/docs "Docs").');
  });

  test("an intervening edit between locate and apply refuses with EDITOR_STALE_EDIT, changing nothing", () => {
    const text = "See [our docs](https://old.example.com/docs).";
    const caret = text.indexOf("old.example.com");
    const view = makeMockView(text, caret, caret);

    const located = locateLinkEditAtCaret(view as unknown as EditorView);
    expect(located.ok).toBe(true);
    if (!located.ok) throw new Error("unreachable");

    (view as unknown as { dispatch: EditorView["dispatch"] }).dispatch({
      changes: { from: text.length, to: text.length, insert: "\n\nAppended after the link." },
    });
    const afterInterveningEdit = getDoc(view);

    const outcome = applyLinkEditEdit(view as unknown as EditorView, located.value, "https://new.example.com/docs");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.diagnostic.category).toBe("EDITOR_STALE_EDIT");
    expect(getDoc(view)).toBe(afterInterveningEdit);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// RICH MODE — rich-commands.ts + DesktopDocumentHost
// ═══════════════════════════════════════════════════════════════════════

describe("rich mode: locateRichImagePropertiesAtCaret / applyRichImagePropertiesEdit", () => {
  test("locates the image via a real DesktopDocumentHost, applies the edit, and produces an exact resulting snapshot", () => {
    const text = "Intro.\n\n![A cat](cat.png)\n\nOutro.";
    const host = new DesktopDocumentHost(text, { documentId: "chapter.md" });
    const live: LiveSelection = { from: text.indexOf("cat.png"), to: text.indexOf("cat.png") };

    const located = locateRichImagePropertiesAtCaret(host, live);
    expect(located.ok).toBe(true);
    if (!located.ok) throw new Error("unreachable");
    expect(located.value.initial.src).toBe("cat.png");

    const outcome = applyRichImagePropertiesEdit(
      host,
      located.value,
      { ...located.value.initial, alt: "A happy cat", size: "gp-large" },
      host.getSnapshot().version,
    );
    expect(outcome.ok).toBe(true);
    expect(host.getSnapshot().text).toBe("Intro.\n\n![A happy cat](cat.png){.gp-large}\n\nOutro.");
    expect(host.getSnapshot().version).toBe(1);
  });

  test("an intervening edit before the captured version is applied refuses with EDITOR_STALE_EDIT, changing nothing", () => {
    const text = "Intro.\n\n![A cat](cat.png)\n\nOutro.";
    const host = new DesktopDocumentHost(text, { documentId: "chapter.md" });
    const live: LiveSelection = { from: text.indexOf("cat.png"), to: text.indexOf("cat.png") };

    const located = locateRichImagePropertiesAtCaret(host, live);
    expect(located.ok).toBe(true);
    if (!located.ok) throw new Error("unreachable");
    const capturedVersion = host.getSnapshot().version;

    // An out-of-band edit lands on the SAME host while the caller's dialog
    // was open (an external reload, a plugin, or a race with another
    // command) — the caller's captured `capturedVersion` is now stale.
    const intervening = host.applyEdit({ from: 0, to: 0, insert: "X", expectedVersion: host.getSnapshot().version });
    expect(intervening.ok).toBe(true);
    const afterIntervening = host.getSnapshot().text;

    const outcome = applyRichImagePropertiesEdit(
      host,
      located.value,
      { ...located.value.initial, alt: "This must never land" },
      capturedVersion,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.diagnostic.category).toBe("EDITOR_STALE_EDIT");
    expect(host.getSnapshot().text).toBe(afterIntervening);
  });
});

describe("rich mode: applyRichImageUnwrapAtCaret", () => {
  test("removes the link wrapper at the caret in one step, producing an exact resulting snapshot", () => {
    const text = "Para.\n\n[![Logo](logo.png)](https://example.com)\n\nMore.";
    const host = new DesktopDocumentHost(text, { documentId: "chapter.md" });
    const live: LiveSelection = { from: text.indexOf("logo.png"), to: text.indexOf("logo.png") };

    const outcome = applyRichImageUnwrapAtCaret(host, live);
    expect(outcome.ok).toBe(true);
    expect(host.getSnapshot().text).toBe("Para.\n\n![Logo](logo.png)\n\nMore.");
    expect(host.getSnapshot().version).toBe(1);
  });

  test("refuses with EDITOR_INVALID_RANGE when the image has no wrapper to remove", () => {
    const text = "![Plain](plain.png)";
    const host = new DesktopDocumentHost(text, { documentId: "chapter.md" });
    const outcome = applyRichImageUnwrapAtCaret(host, { from: 3, to: 3 });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.diagnostic.category).toBe("EDITOR_INVALID_RANGE");
    expect(host.getSnapshot().version).toBe(0); // refused edit changes nothing
  });
});

describe("rich mode: locateRichLinkEditAtCaret / applyRichLinkEditEdit", () => {
  test("locates the link via a real DesktopDocumentHost, applies the new href, and produces an exact resulting snapshot", () => {
    const text = 'See [our docs](https://old.example.com/docs "Docs").';
    const host = new DesktopDocumentHost(text, { documentId: "chapter.md" });
    const caret = text.indexOf("old.example.com");
    const live: LiveSelection = { from: caret, to: caret };

    const located = locateRichLinkEditAtCaret(host, live);
    expect(located.ok).toBe(true);
    if (!located.ok) throw new Error("unreachable");
    expect(located.value.initialHref).toBe("https://old.example.com/docs");

    const outcome = applyRichLinkEditEdit(host, located.value, "https://new.example.com/docs", host.getSnapshot().version);
    expect(outcome.ok).toBe(true);
    expect(host.getSnapshot().text).toBe('See [our docs](https://new.example.com/docs "Docs").');
    expect(host.getSnapshot().version).toBe(1);
  });

  test("an intervening edit before the captured version is applied refuses with EDITOR_STALE_EDIT, changing nothing", () => {
    const text = "See [our docs](https://old.example.com/docs).";
    const host = new DesktopDocumentHost(text, { documentId: "chapter.md" });
    const caret = text.indexOf("old.example.com");
    const live: LiveSelection = { from: caret, to: caret };

    const located = locateRichLinkEditAtCaret(host, live);
    expect(located.ok).toBe(true);
    if (!located.ok) throw new Error("unreachable");
    const capturedVersion = host.getSnapshot().version;

    const intervening = host.applyEdit({
      from: text.length,
      to: text.length,
      insert: "\n\nAppended after the link.",
      expectedVersion: host.getSnapshot().version,
    });
    expect(intervening.ok).toBe(true);
    const afterIntervening = host.getSnapshot().text;

    const outcome = applyRichLinkEditEdit(host, located.value, "https://new.example.com/docs", capturedVersion);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.diagnostic.category).toBe("EDITOR_STALE_EDIT");
    expect(host.getSnapshot().text).toBe(afterIntervening);
  });
});
