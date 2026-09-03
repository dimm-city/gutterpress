import {
  EditorController,
  EditorModel,
  EditorView,
  OffsetRange,
  Selection,
  StringValue,
  type EditorViewOptions,
} from "@dimm-city/vscode-markdown-editor";
import {
  diagnosticForEditRejection,
  type Diagnostic,
  type DocumentSnapshot,
  type EditorDocumentHost,
} from "../core/index.ts";
import { stringEditToSourceEdit } from "./convert.ts";

/**
 * SFE-P1b Lane A — the SOLE `@vscode/markdown-editor` adapter (D5: "No
 * application code outside `packages/editor/src/vscode-adapter/` may import
 * package internals"). Everything the rest of the codebase is allowed to
 * depend on is exported from this directory's `index.ts`; nothing outside
 * this directory may `import ... from "@dimm-city/vscode-markdown-editor"` (the vendored fork of @vscode/markdown-editor).
 *
 * `createVscodeEditorAdapter` wires the package's `EditorModel` /
 * `EditorView` / `EditorController` triad to a D3 `EditorDocumentHost`:
 *
 *   - the model is constructed empty and immediately given the host's
 *     current source (D2: opening changes zero bytes — see
 *     `tests/vscode-adapter/browser.cases.btest.ts`'s case-1b);
 *   - every edit the PACKAGE originates (real typing, its own commands) is
 *     intercepted before it lands via `EditorModel.onWillApplySourceEdit`,
 *     converted to ONE D3 `SourceEdit` (`convert.ts`), and submitted
 *     through `host.applyEdit` — the host, not the package, is the
 *     accept/reject authority (G-01);
 *   - a REJECTED edit reverts the model to the host's authoritative
 *     snapshot and reports a `Diagnostic` (D14) — the package's own,
 *     already-in-flight application of the doomed edit cannot be cancelled
 *     (`onWillApplySourceEdit` is a notification, not a request for
 *     permission), so the revert is deliberately deferred to a microtask
 *     (see the long comment on `submittingOwnEdit` below) so it runs AFTER
 *     that in-flight application has finished, not concurrently with it.
 *     The revert re-reads `host.getSnapshot()` AT THAT MOMENT rather than
 *     replaying the snapshot captured when the rejection happened, so an
 *     authoritative external replacement that lands during the rejection
 *     window — including one the host fires synchronously from inside the
 *     `applyEdit` call that produced the rejection — always wins over the
 *     stale rejection snapshot instead of being silently reverted;
 *   - every snapshot the host announces through `subscribe` THAT THIS
 *     ADAPTER DID NOT ITSELF JUST SUBMIT (an external replacement, or any
 *     other actor's accepted edit against the same host) replaces the
 *     model's source directly (`EditorModel.replaceSourceText`) WITHOUT
 *     going back through `host.applyEdit` — no echo (D3/D7 case 2);
 *   - `dispose()` tears down the controller, the view, the
 *     `onWillApplySourceEdit` subscription, and the host subscription, and
 *     detaches the mounted DOM.
 *
 * Undo/redo (D7 case 3): `EditorControllerOptions.historyStrategy` is left
 * UNSET on purpose. The package's own doc comment on that option is exact
 * about what this does: "Left unset, the chords are passed on to the
 * host." No `IHistoryStrategy` (the package's only source of a second,
 * package-owned edit history — see `LocalHistoryStrategy` in the package's
 * `dist/index.d.ts`) is ever constructed or wired here, so the package
 * never builds or consults a persistent history of its own; undo/redo
 * chords are not intercepted, and it is entirely the HOST's responsibility
 * (outside this package, per D7: "`EditorDocumentHost` owns the
 * authoritative snapshot, accepted edits, external replacements") to
 * implement undo by replaying prior `DocumentSnapshot`s through
 * `host.applyEdit`/`replaceExternal`. `tests/vscode-adapter/
 * browser.cases.btest.ts`'s case-3 exercises this in a real browser: typing
 * twice, then pressing Ctrl+Z, leaves the source unchanged.
 *
 * SFE-P3ab (Lane C): the returned handle also exposes `getSelection()` —
 * the fork's live caret/selection as D3 source offsets (see the interface's
 * own doc comment below). This closes the gap the previous run's
 * `desktop/src/lib/editor/rich-commands.ts` reported: every rich-mode
 * command used to anchor at the document end because nothing surfaced the
 * mount's real caret. Verified against the installed runtime, not assumed:
 * `tests/web/mount.btest.ts`'s selection cases type at a keyboard-navigated
 * position and assert the reported offsets against an independently
 * computed index.
 */

/** Options accepted by `createVscodeEditorAdapter`. */
export interface VscodeEditorAdapterOptions {
  /**
   * Called whenever a submitted edit is REJECTED by the host (stale,
   * readonly, or invalid-range) — see `diagnosticForEditRejection` in
   * `../core/diagnostics.ts`, the single place that reason -> category
   * pairing is defined.
   */
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void;

  /**
   * Whether the mounted editor starts in read-only mode. `EditorDocumentHost`
   * (D3/D7, `../core/hosts.ts`) deliberately exposes no queryable
   * "is this host readonly" flag — D7 fixes readonly as a property of a
   * REAL host implementation (e.g. `MemoryDocumentHost`'s own constructor
   * option), not a runtime-inspectable member of the frozen interface every
   * host must implement identically. Only the CALLER that constructed
   * `host` knows whether it is readonly, so that fact is threaded through
   * here rather than guessed or probed. Defaults to `false`.
   *
   * This does not need to track a HOST that starts writable and later
   * becomes readonly out-of-band: D3/D7's `EditorDocumentHost` has no
   * "readonly changed" notification channel (only `subscribe` for
   * SNAPSHOT changes) — should a real host ever need that, `applyEdit`'s
   * own "readonly" rejection reason already reaches `onDiagnostic` on the
   * next attempted edit regardless of this option's initial value.
   */
  readonly readonly?: boolean;

  /**
   * Passed through to the package's `EditorView` untouched (theme class
   * names, limited-width mode, ...). Optional and unused by this run's own
   * cases (1/1b/2/3); present so a later lane (case 7's isolated-mounting
   * spike, case 4-6's custom-view spike) is not blocked from supplying it
   * without a signature change to this function.
   */
  readonly viewOptions?: EditorViewOptions;
}

/** Handle returned by `createVscodeEditorAdapter`. */
export interface VscodeEditorAdapter {
  /**
   * Tears down the mounted view, controller, and both subscriptions
   * (`EditorModel.onWillApplySourceEdit` and `host.subscribe`), and
   * detaches the editor's DOM from `container`. Idempotent — calling
   * `dispose()` more than once is a no-op, matching `web/mount.ts`'s
   * `EditorMount.dispose()` contract.
   */
  dispose(): void;

  /**
   * Rebuild every block view on the next render, keeping the model, its
   * selection and its edit history (fork Patch 7). For a host whose
   * `renderCustomBlock` now answers differently: the blocks built under
   * the old answer are retired without a remount.
   */
  rerender(): void;

  /**
   * SFE-P3ab (Lane C) — the fork's LIVE caret/selection, as UTF-16 source
   * offsets over the same text `host` owns (D3's `SourceEdit`/
   * `DocumentSnapshot` offset convention), or `undefined` when the model has
   * NO CARET AT THIS INSTANT.
   *
   * SFE-P3ab review round 1 (CONFIRMED finding) — `undefined` is NOT proof
   * the mounted surface was "never focused/clicked into". It recurs after
   * REAL interaction: verified live against the installed fork, a caret
   * placed by keyboard navigation is cleared again by clicking the mounted
   * surface's own left gutter (the `.md-editor-content` inline-start
   * padding strip before `.md-document` begins) or its block-start padding
   * — both still inside the mounted surface, not a click outside it. See
   * `packages/editor/tests/web/mount.btest.ts`'s "clears again after a real
   * caret exists" case for the browser proof. Callers that represent an
   * explicit, caret-relative user gesture (a toolbar click, a keyboard
   * shortcut) MUST NOT treat `undefined` as "safe to anchor at the document
   * end" — see `rich-commands.ts`'s header for how the desktop app's
   * callers handle this (some refuse with a diagnostic; image insertion via
   * drag-and-drop deliberately keeps the document-end fallback, since that
   * gesture is genuinely anchorless).
   *
   * Backed by `model.selection` (`ISettableObservable<Selection_2 |
   * undefined, void>` — package internals, not re-exported; this is the
   * ONE place outside the package that may read it, per D5). `Selection_2`
   * carries `anchor`/`active` (which end the user is dragging) rather than
   * an already-ordered `from <= to` pair, so this reads `.range` instead
   * (`Selection_2.range`, verified against the installed runtime's own
   * `get range()`: `isForward ? new OffsetRange(anchor, active) : new
   * OffsetRange(active, anchor)`) — that normalizes a BACKWARD selection
   * (the user dragged right-to-left) the same as a forward one, so callers
   * never see `from > to`.
   *
   * A plain `.get()` read, not a subscription: this run's callers
   * (`rich-commands.ts`) poll it at the moment a command is invoked, the
   * same way `host.getSnapshot()` is read fresh on every call rather than
   * cached — there is no live-updating consumer of this value yet, so no
   * subscribe-and-notify seam is added ahead of a real need (plan: "prefer
   * the smallest design that fully satisfies the specification").
   */
  getSelection(): { readonly from: number; readonly to: number } | undefined;
  /**
   * Scroll a D3 source range into view, centering it only when it is not
   * already on screen — the package's own `revealRangeInCenterIfOutsideViewport`.
   * Takes source offsets, like `getSelection`, and moves nothing but the
   * scroll position: no caret, no selection, no edit. This is what a host's
   * "take me to this line" navigation (an outline row, a diagnostic, a click
   * in the preview) calls.
   */
  revealRange(from: number, to?: number): void;
  /**
   * Place the caret (or a selection) at source offsets, as a click there
   * would: the block the offset lies in becomes the active one and the
   * editor takes focus. A host uses it to open a block it hides from the
   * page-shaped view (a marker's margin tag, `../gutterpress/marker-tags.ts`).
   */
  setSelection(from: number, to?: number): void;

  /**
   * Lock or unlock the mounted editor. The host owns this decision (the
   * desktop's Read/Edit control), and it can change while the editor is
   * mounted — without this the toggle only took effect on the NEXT mount,
   * so switching to Read left the current document editable.
   */
  setReadonly(readonly: boolean): void;
}

/**
 * Mounts a real `@vscode/markdown-editor` surface into `container`, backed
 * by `host`. Mounting is synchronous: the model holds the host's CURRENT
 * snapshot (`host.getSnapshot()`) before this function returns.
 */
export function createVscodeEditorAdapter(
  container: Element,
  host: EditorDocumentHost,
  options: VscodeEditorAdapterOptions = {},
): VscodeEditorAdapter {
  let disposed = false;

  // The snapshot this adapter currently believes is authoritative — kept in
  // sync by every path that changes it (accepted edit, external
  // replacement, rejection revert). Mirrors `web/mount.ts`'s `known`
  // variable for the same reason: every conversion is computed against
  // this value, never a fresh `host.getSnapshot()` read at submit time, so
  // this adapter's own bookkeeping (not a hidden host-side race) is always
  // what a test is exercising.
  let known: DocumentSnapshot = host.getSnapshot();

  // `EditorModel`'s only public constructor is zero-argument (verified
  // against the installed 0.0.2-87 runtime (dist/index.js byte-identical to 0.0.2-85) — see this run's report) — the
  // model starts holding an empty `StringValue` internally, and
  // `replaceSourceText` is the package's own documented "install the
  // host's authoritative text" seam ("Replace the source with an
  // authoritative value from the host ..."), used identically here for
  // BOTH the initial mount and every later external replacement.
  const model = new EditorModel();
  model.readonlyMode.set(options.readonly ?? false, undefined, undefined);
  model.replaceSourceText(new StringValue(known.text));

  const view = new EditorView(model, options.viewOptions);
  container.appendChild(view.element);

  // `EditorController`'s own doc comment: "Left unset, the chords are
  // passed on to the host" (see the file header above) — `historyStrategy`
  // is intentionally never set here.
  const controller = new EditorController(model, view);

  // True for the exact synchronous duration of an `host.applyEdit(...)`
  // call THIS adapter makes from inside `onWillApplySourceEdit` below, and
  // paired with `pendingOwnEditEcho` — the PREDICTED (version, text) the
  // host's own accepted-edit echo notification carries, computed from
  // `sourceEdit` before submitting it.
  //
  // `MemoryDocumentHost.applyEdit` (and any spec-compliant D3 host) invokes
  // every `subscribe` listener SYNCHRONOUSLY, from inside `applyEdit`,
  // before `applyEdit` itself returns to us — so by the time our OWN
  // `host.subscribe` listener (further down) observes the accepted
  // snapshot, `known` has NOT yet been updated (that happens after
  // `host.applyEdit` returns, in the `onWillApplySourceEdit` handler
  // itself). Comparing the incoming snapshot against `known` at that point
  // would therefore misclassify our own accepted edit as an "external"
  // change and call `model.replaceSourceText` redundantly, racing the
  // model's own in-flight application of the same edit.
  //
  // `submittingOwnEdit` alone is NOT that signal — it means "we are inside
  // our own `applyEdit` call", not "this specific notification is an echo
  // of that call". A host may legitimately fire an UNRELATED notification
  // synchronously from inside the same `applyEdit` invocation (e.g. it
  // discovers and applies an external replacement — a concurrent file
  // change — while deciding our edit is now stale, before returning the
  // rejection). Dropping that notification outright would silently lose
  // it: there is no revert-microtask on the accept path to pick it back
  // up, and even on the reject path it left the view briefly showing
  // stale content across the rejection window. So the predicate below
  // matches the PREDICTED echo exactly (version and text); anything else
  // arriving during the window is treated as a genuine external
  // notification and deferred to a microtask (never applied synchronously
  // here, for the same in-flight-splice race reason the rejection revert
  // below defers).
  let submittingOwnEdit = false;
  let pendingOwnEditEcho: { readonly version: number; readonly text: string } | null = null;

  const willApplyDisposable = model.onWillApplySourceEdit((event) => {
    if (disposed) return;

    const sourceEdit = stringEditToSourceEdit(known.text, event.edit, known.version);

    submittingOwnEdit = true;
    pendingOwnEditEcho = {
      version: known.version + 1,
      text: known.text.slice(0, sourceEdit.from) + sourceEdit.insert + known.text.slice(sourceEdit.to),
    };
    let result: ReturnType<EditorDocumentHost["applyEdit"]>;
    try {
      result = host.applyEdit(sourceEdit);
    } finally {
      submittingOwnEdit = false;
      pendingOwnEditEcho = null;
    }

    if (result.ok) {
      known = result.snapshot;
      // The model applies its own copy of `event.edit` right after this
      // listener returns (unstoppable — see the file header). Since the
      // host accepted the IDENTICAL edit, both sides converge on the same
      // text; nothing further to do here.
      return;
    }

    // Rejected (stale, readonly, or invalid-range). The model's internal
    // application of `event.edit` still happens immediately after this
    // listener returns — there is no hook to cancel it — so reverting
    // `sourceText` synchronously, right here, would race that in-flight
    // splice: whichever write lands last would win, and which one that is
    // is an implementation detail of the package's private
    // `_applySourceEdit`, not a contract this adapter can rely on.
    // Deferring the revert to a microtask lets the model's own doomed
    // application finish first, so this adapter's `replaceSourceText`
    // deterministically wins and is the one observable outcome — exercised
    // by tests/vscode-adapter/browser.cases.btest.ts's rejection-path case.
    //
    // The revert reads the host FRESH (`host.getSnapshot()`) at the moment
    // it actually runs, rather than replaying the snapshot captured back
    // when the rejection happened: any authoritative change that landed in
    // the meantime — including an external replacement the host fired
    // SYNCHRONOUSLY inside this very `applyEdit` call, which the guard
    // above deliberately does not apply synchronously (deferring it to its
    // own microtask instead) — must win over a now-stale rejection
    // snapshot. Replaying a captured snapshot here would silently revert
    // that newer state and drop it from `known`; reading fresh cannot.
    const reason = result.reason;
    queueMicrotask(() => {
      if (disposed) return;
      known = host.getSnapshot();
      model.replaceSourceText(new StringValue(known.text));
      options.onDiagnostic?.(diagnosticForEditRejection(reason));
    });
  });

  const unsubscribeHost = host.subscribe((snapshot) => {
    if (disposed) return;
    if (submittingOwnEdit) {
      const echo = pendingOwnEditEcho;
      if (echo !== null && snapshot.version === echo.version && snapshot.text === echo.text) {
        // The synchronous notification `host.applyEdit` fires, from inside
        // the call above, for the edit we are RIGHT NOW submitting — not a
        // distinct external event. `known` is set directly in the
        // `onWillApplySourceEdit` handler once `applyEdit` returns (the
        // `result.ok` branch above), and the model applies its own copy of
        // `event.edit` immediately after that handler returns, so no
        // action is needed here.
        return;
      }
      // A distinct, genuinely external notification arrived synchronously
      // while our own edit is still in flight. Applying it synchronously
      // here would race the model's own pending in-flight application of
      // `event.edit` (see the long comment on the rejection revert above)
      // — defer to a microtask and re-read the host fresh there, same
      // pattern as the rejection revert, so whichever change is
      // authoritative by the time it runs wins.
      queueMicrotask(() => {
        if (disposed) return;
        known = host.getSnapshot();
        model.replaceSourceText(new StringValue(known.text));
      });
      return;
    }
    known = snapshot;
    // `replaceSourceText` does NOT go through `onWillApplySourceEdit` (it
    // is not a "model-owned" edit — see the file header and case-2's
    // browser test, which asserts `host.applyEdit` is never called as a
    // result of reaching this branch), so this cannot loop back into the
    // handler above and re-submit itself to the host as an edit.
    model.replaceSourceText(new StringValue(snapshot.text));
  });

  return {
    setReadonly(readonly: boolean): void {
      if (disposed) return;
      model.readonlyMode.set(readonly, undefined, undefined);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribeHost();
      willApplyDisposable.dispose();
      controller.dispose();
      view.dispose();
      view.element.remove();
    },

    getSelection(): { readonly from: number; readonly to: number } | undefined {
      const selection = model.selection.get();
      if (!selection) return undefined;
      const range = selection.range;
      return { from: range.start, to: range.endExclusive };
    },

    revealRange(from: number, to: number = from): void {
      view.revealRangeInCenterIfOutsideViewport(OffsetRange.fromTo(from, Math.max(from, to)));
    },

    rerender(): void {
      if (disposed) return;
      view.gpRerender();
    },

    setSelection(from: number, to: number = from): void {
      if (disposed) return;
      // The model's own selection observable is the one seam the fork's
      // controller reads the caret from: setting it activates the block the
      // offset lies in, exactly as a click there would. Focus follows, so the
      // caret is live for typing; without it the block shows its source but
      // keystrokes go nowhere.
      model.selection.set(new Selection(from, to), undefined, undefined);
      view.focus();
      view.revealRangeInCenterIfOutsideViewport(OffsetRange.fromTo(Math.min(from, to), Math.max(from, to)));
    },
  };
}
