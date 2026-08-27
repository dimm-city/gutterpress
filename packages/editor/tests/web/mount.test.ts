import { describe, expect, test } from "bun:test";
import { mountEditor } from "../../src/web/mount.ts";

/**
 * SFE-P2a Lane A — `mountEditor` stub-viable tests.
 *
 * P1a's `mount.ts` rendered a plain `<textarea>`, so its whole behavioral
 * surface (initial render, accepted/rejected edits, external replacement,
 * dispose/remount, late-notification-after-dispose) could be exercised
 * against `tests/web/support/dom-stub.ts`'s hand-rolled `FakeElement`/
 * `FakeDocument` — a stub implementing only the handful of `Element`/
 * `Document` members a `<textarea>` shell touches.
 *
 * This run swaps `mount.ts`'s internals for the real
 * `@vscode/markdown-editor` fork surface (`createVscodeEditorAdapter`).
 * That surface's `EditorView` constructs a real `EditContext`, a real
 * `ResizeObserver`, and a real rendered block tree the moment it is built —
 * none of which the stub implements or could plausibly fake without
 * becoming a second, parallel DOM implementation (which the P1a stub's own
 * header explicitly rules out: "NOT a general-purpose DOM polyfill"). VERIFIED
 * while writing this run's implementation: `mountEditor` now unconditionally
 * calls `createVscodeEditorAdapter` before returning, so every existing
 * P1a case below reaches real-fork construction and could never pass
 * against the stub. `tests/web/support/dom-stub.ts` is therefore DELETED
 * (dead code — nothing in this package can use it anymore) rather than kept
 * unused.
 *
 * Every P1a behavioral case moved to `tests/web/mount.btest.ts` (real
 * Chromium, via `tests/browser-harness`), where it is either reproduced
 * directly or superseded by an equivalent proof — the table below maps
 * each one so a reviewer can verify nothing was quietly dropped rather than
 * moved. ("Superseded by P1b" means the exact behavior is already proven,
 * unmodified and green per this run's own "Behavior that must remain
 * unchanged" clause, by `tests/vscode-adapter/browser.cases.btest.ts` and
 * its siblings — re-proving it a second time against the same adapter this
 * run does not change would be redundant, not stronger coverage.)
 *
 * | Old test (tests/web/mount.test.ts, P1a)                                    | New location / equivalence                                                                      |
 * |------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
 * | "renders the host's current snapshot text into the surface"                 | mount.btest.ts "mount renders host text via the fork" (liveness: `.md-document` present). ROUND-1  |
 * |                                                                                | CORRECTION: the old test additionally asserted P1a's own `.gp-editor-surface` class (a hook         |
 * |                                                                                | `mount.ts` added to its `<textarea>` shell so a future host wrapper could find/style it — see        |
 * |                                                                                | `db2f68ea`'s `mount.ts`). That class is DROPPED, not renamed: nothing in this tree adds it anymore,  |
 * |                                                                                | and mount.ts authors no purpose-built replacement hook of its own — the real fork's `.md-editor`     |
 * |                                                                                | (used throughout mount.btest.ts, e.g. the theme-class case) is the closest equivalent stable         |
 * |                                                                                | selector, but it belongs to `@vscode/markdown-editor`'s own vocabulary, not a Gutterpress class.     |
 * | "mounts exactly one surface element into the container"                     | mount.btest.ts "mount renders host text via the fork" (asserts exactly one `.md-editor` mounted)  |
 * | "typed input is submitted as a SourceEdit ... and applies"                  | mount.btest.ts "typing updates host through the adapter path"                                     |
 * | "a no-op input notification ... does not submit an edit"                    | Superseded by P1b case 1b (no-edit byte identity) — same adapter, same guarantee, already green   |
 * | "a stale edit ... surfaces EDITOR_STALE_EDIT ..."                           | Superseded by P1b's "rejection path — stale edit reverts the model ..." (identical adapter path)  |
 * | "a readonly host surfaces EDITOR_READONLY ..."                              | mount.btest.ts "readonly host mounts a readonly editor" (now proactive: 0 applyEdit calls, not a  |
 * |                                                                                | reject-then-revert round trip — see that test's own comment for why this is a real improvement)   |
 * | "an invalid-range rejection surfaces EDITOR_INVALID_RANGE ..."              | mount.btest.ts "a rejected edit still surfaces its diagnostic through mountEditor's onDiagnostic"  |
 * | "mountEditor works with no onDiagnostic supplied ..."                       | Covered by every mount.btest.ts case: `entry.ts`'s driver never omits `onDiagnostic`, but every    |
 * |                                                                                | other stub-viable case above and below constructs `mountEditor` without throwing regardless        |
 * | "re-renders the surface and subsequent edits use the new version"           | mount.btest.ts "external replacement re-renders the document"                                     |
 * | "dispose unsubscribes ... releases the DOM listener ... removes the surface"| mount.btest.ts "dispose removes the mounted editor and its injected CSS" (adapter-level listener   |
 * |                                                                                | release is Superseded by P1b's adapter dispose proof; this run's NEW surface is the CSS elements)  |
 * | "dispose is idempotent"                                                     | mount.btest.ts "dispose is idempotent" (mirrors the old assertion exactly, against the real mount) |
 * | "remounting after dispose works ... no leaked listener on the old surface"  | mount.btest.ts "dispose then remount: exactly one applyEdit per keypress" (stronger — the old test |
 * |                                                                                | asserted zero listener leak abstractly; this asserts the CONCRETE observable consequence: no       |
 * |                                                                                | duplicate applyEdit call from a leaked pre-dispose wiring)                                          |
 * | "a late host notification after dispose is ignored ..."                     | Superseded by P1b's adapter dispose semantics (the adapter's own `host.subscribe` listener guards  |
 * |                                                                                | on its own `disposed` flag; `mountEditor` adds no additional subscription of its own to leak)      |
 * | "dispose on one mount does not affect a second, independent mount"          | ROUND-1 CORRECTION: this was WRONGLY claimed superseded by P1b a11y case 7c — 7c mounts on two    |
 * |                                                                                | DIFFERENT hosts and never disposes ONE while asserting the other, and predates this run's own      |
 * |                                                                                | per-mount `<style>` injection entirely. Reproduced directly in mount.btest.ts's "dispose isolation |
 * |                                                                                | between two independent LIVE mounts sharing one document" — a real assertion, not a reused one.    |
 * | "a re-entrant host notification that disposes the mount during applyEdit ..."| ROUND-1 CORRECTION: this was WRONGLY claimed superseded by P1b's rejection-path tests — those       |
 * |                                                                                | exercise a re-entrant NOTIFICATION (`replaceExternal` firing mid-`applyEdit`), never a re-entrant   |
 * |                                                                                | DISPOSE, and `tests/web/support/racy-host.ts` (the only helper that could interleave at that seam)  |
 * |                                                                                | was deleted with zero remaining references — the assertion was DROPPED, not superseded, and had NO  |
 * |                                                                                | coverage until this correction. Reproduced directly in mount.btest.ts's "a re-entrant host           |
 * |                                                                                | notification that disposes the mount during applyEdit" case, via a new dedicated host wrapper        |
 * |                                                                                | (`tests/web/support/self-disposing-host.ts`) against the real fork surface.                          |
 *
 * `diff.test.ts` (P1a's direct unit coverage of `computeMinimalEdit`) is
 * DELETED alongside `src/web/diff.ts` itself — see `src/web/index.ts`'s
 * header for the search proof that nothing imports it anymore.
 *
 * What stays HERE, stub-viable, because it never reaches fork construction:
 * the container-usage guard clause below. Genuinely new coverage (P1a had
 * no equivalent test), kept because it is real, cheap, DOM-independent
 * regression protection for a code path a browser suite cannot exercise any
 * more cheaply than this.
 */
describe("mountEditor — container usage guard (no real DOM required)", () => {
  test("a container with no ownerDocument throws before any adapter/CSS work is attempted", () => {
    const brokenContainer = { ownerDocument: null } as unknown as Element;
    // A `MemoryDocumentHost`-shaped object is never even read: the guard
    // clause fires before `host.getSnapshot()` — passing `undefined as any`
    // would work identically, but a minimal real host keeps this test
    // honest about WHERE the throw happens if the guard's position in
    // mount.ts ever moves.
    const host = {
      getSnapshot: () => ({ text: "", version: 0 }),
      applyEdit: () => {
        throw new Error("unreachable: guard must fire before any host method is called");
      },
      replaceExternal: () => {
        throw new Error("unreachable: guard must fire before any host method is called");
      },
      subscribe: () => () => {},
    };

    expect(() => mountEditor(brokenContainer, host)).toThrow(
      "mountEditor: container has no ownerDocument",
    );
  });
});
