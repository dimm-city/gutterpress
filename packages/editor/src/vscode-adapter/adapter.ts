import {
  EditorController,
  EditorModel,
  EditorView,
  StringValue,
  type EditorViewOptions,
} from "@vscode/markdown-editor";
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
 * this directory may `import ... from "@vscode/markdown-editor"`.
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
 *     that in-flight application has finished, not concurrently with it;
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
  // against the installed 0.0.2-84 runtime — see this run's report) — the
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
  // call THIS adapter makes from inside `onWillApplySourceEdit` below.
  // `MemoryDocumentHost.applyEdit` (and any spec-compliant D3 host) invokes
  // every `subscribe` listener SYNCHRONOUSLY, from inside `applyEdit`,
  // before `applyEdit` itself returns to us — so by the time our OWN
  // `host.subscribe` listener (further down) observes the accepted
  // snapshot, `known` has NOT yet been updated (that happens after
  // `host.applyEdit` returns, in the `onWillApplySourceEdit` handler
  // itself). Comparing the incoming snapshot against `known` at that point
  // would therefore misclassify our own accepted edit as an "external"
  // change and call `model.replaceSourceText` redundantly, racing the
  // model's own in-flight application of the same edit. This flag is the
  // unambiguous signal the snapshot comparison cannot be: "this
  // notification is a synchronous side effect of the edit we are, right
  // now, in the middle of submitting."
  let submittingOwnEdit = false;

  const willApplyDisposable = model.onWillApplySourceEdit((event) => {
    if (disposed) return;

    const sourceEdit = stringEditToSourceEdit(known.text, event.edit, known.version);

    submittingOwnEdit = true;
    let result: ReturnType<EditorDocumentHost["applyEdit"]>;
    try {
      result = host.applyEdit(sourceEdit);
    } finally {
      submittingOwnEdit = false;
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
    const rejectedSnapshot = result.snapshot;
    const reason = result.reason;
    queueMicrotask(() => {
      if (disposed) return;
      known = rejectedSnapshot;
      model.replaceSourceText(new StringValue(rejectedSnapshot.text));
      options.onDiagnostic?.(diagnosticForEditRejection(reason));
    });
  });

  const unsubscribeHost = host.subscribe((snapshot) => {
    if (disposed) return;
    if (submittingOwnEdit) return; // see the comment on the flag's declaration above.
    known = snapshot;
    // `replaceSourceText` does NOT go through `onWillApplySourceEdit` (it
    // is not a "model-owned" edit — see the file header and case-2's
    // browser test, which asserts `host.applyEdit` is never called as a
    // result of reaching this branch), so this cannot loop back into the
    // handler above and re-submit itself to the host as an edit.
    model.replaceSourceText(new StringValue(snapshot.text));
  });

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribeHost();
      willApplyDisposable.dispose();
      controller.dispose();
      view.dispose();
      view.element.remove();
    },
  };
}
