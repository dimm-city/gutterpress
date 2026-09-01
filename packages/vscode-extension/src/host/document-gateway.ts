import {
  applyEdit as applyEditPure,
  EDITOR_PROTOCOL_VERSION,
  type DocumentSnapshot,
  type SourceEdit,
} from "@dimm-city/gutterpress-editor/core";
// Type-only: erased at compile time. This module never imports "vscode" as a
// VALUE — every real vscode.* call it needs (constructing a WorkspaceEdit or
// Range, calling workspace.applyEdit, subscribing to the two workspace
// events, posting to the webview) is supplied by the caller through
// DocumentGatewayVscodeApi (see that interface's own doc comment). This is
// what makes the class unit-testable with plain structurally-fake objects —
// no `mock.module("vscode", ...)` needed for this file's own test suite,
// mirroring `tests/provider.test.ts`'s pre-existing pattern for a
// type-only-import module.
import type * as vscode from "vscode";
import { hostDisconnectedDiagnostic } from "../protocol/diagnostics.ts";
import type { HostToWebviewMessage } from "../protocol/messages.ts";

/**
 * SFE-P3c Lane A — `DocumentGateway`: the extension-host-side half of the
 * D3 source-edit contract, wrapping ONE `vscode.TextDocument` (run spec
 * DETAILS #2, "DOCUMENT GATEWAY").
 *
 * The narrow vscode surface this class actually uses — nothing more.
 * `../provider.ts` constructs the REAL implementation (backed by the real
 * `vscode` module and the real `document`/`webviewPanel` for one
 * `resolveCustomTextEditor` call); tests construct a structurally-fake one
 * with no real extension host. `document` itself is typed as the REAL
 * `vscode.TextDocument` (a type-only reference — see this module's header)
 * so `positionAt`/`offsetAt`/`getText`/`version`/`isClosed`/`uri` all read
 * exactly as VS Code defines them; only the IMPURE operations (constructing
 * a `WorkspaceEdit`/`Range`, applying it, subscribing to workspace events,
 * posting to the webview) are injected, since those are the only members
 * that require a live `vscode` runtime.
 */
export interface DocumentGatewayVscodeApi {
  /** The one document this gateway owns. Never swapped after construction —
   *  a file switch in VS Code opens a NEW `resolveCustomTextEditor` call
   *  with a new document and a new `DocumentGateway`. */
  readonly document: vscode.TextDocument;

  /** `() => new vscode.WorkspaceEdit()` in the real adapter. */
  createWorkspaceEdit(): vscode.WorkspaceEdit;

  /** `(start, end) => new vscode.Range(start, end)` in the real adapter. */
  createRange(start: vscode.Position, end: vscode.Position): vscode.Range;

  /** `vscode.workspace.applyEdit` in the real adapter. */
  applyWorkspaceEdit(edit: vscode.WorkspaceEdit): Thenable<boolean>;

  /** `vscode.workspace.onDidChangeTextDocument` in the real adapter — a
   *  GLOBAL event across every open document; `DocumentGateway` itself
   *  filters to `this.document` (run spec: "Subscribes to
   *  workspace.onDidChangeTextDocument for THIS document"). */
  onDidChangeTextDocument(listener: (e: vscode.TextDocumentChangeEvent) => void): vscode.Disposable;

  /** `vscode.workspace.onDidCloseTextDocument` in the real adapter — also
   *  global; filtered the same way. */
  onDidCloseTextDocument(listener: (doc: vscode.TextDocument) => void): vscode.Disposable;

  /** `(message) => webviewPanel.webview.postMessage(message)` in the real
   *  adapter — the ONLY channel this class sends `HostToWebviewMessage`s
   *  through. */
  postMessage(message: HostToWebviewMessage): Thenable<boolean>;
}

/** Injected purely for D15 ("Each editor session has a host-local
 *  correlation ID"); NEVER passed document text — every call site below
 *  passes only event names, rejection reasons, and the diagnostic category
 *  strings that are already D14-safe to log. Defaults to a no-op in tests
 *  that do not care about logging; `../provider.ts` supplies a real
 *  `console`-backed implementation (see that file's header for why a full
 *  `vscode.OutputChannel` is not built for this run — P3e: the smallest
 *  design that satisfies D15, not a logging subsystem nothing calls for
 *  yet). */
export type DocumentGatewayLogger = (event: string, detail?: Readonly<Record<string, unknown>>) => void;

/**
 * Wraps one `vscode.TextDocument` as the host-side authority for the D3
 * source-edit contract. Converts an inbound `SourceEdit` to a
 * `vscode.WorkspaceEdit` using `document.positionAt` ONLY (never hand-rolled
 * line/character arithmetic — run spec DETAILS #2), applies it via
 * `workspace.applyEdit`, and replies with the document's full authoritative
 * text either way.
 *
 * EVERY apply produces EXACTLY ONE reply (run spec DETAILS #2 / behavior
 * table "Document gateway" and "Convergence" rows). This class achieves
 * that with a single reply site at the bottom of `applyEdit` (see that
 * method's own comment) rather than one branch per failure reason — the
 * three named failure shapes ("rejected applyEdit, closed document,
 * concurrent change") differ only in WHAT TEXT ends up in that one reply,
 * never in WHETHER a reply is sent.
 *
 * BASE STAMP (reconciliation addendum — the fix for the committed
 * regression the original authority model left underspecified): `#stamp` is
 * a monotonic integer THIS CLASS ALONE owns, bumped exactly once per
 * authoritative `snapshot` message it sends (`#sendSnapshot`, below) —
 * never vscode's own `TextDocument.version` (host-external; not this
 * class's to control), never the webview mirror's local counter (webview-
 * local; this class never even sees it). `applyEdit`'s inbound `base`
 * parameter is the stamp of the state `ProxyDocumentHost`'s mirror last
 * converged to; the edit is attempted ONLY when `base` equals `#stamp` —
 * otherwise this method skips straight to its single reply site with the
 * document's UNCHANGED truth, exactly "normal convergence" the same way a
 * genuine `invalid-range`/`readonly` rejection already does. `edit.expectedVersion`
 * plays NO role in that decision here: it is the mirror's own LOCAL D3
 * check, in the mirror's own version space, and comparing it against this
 * class's real `document.version` is exactly the bug this addendum fixes
 * (see the committed regression test this run turns green,
 * `tests/webview/edit-version-reconciliation.btest.ts`). `applyEditPure`
 * is still reused for its readonly/invalid-range checks (never reintroduced
 * as a hand-rolled duplicate) by forcing `expectedVersion` to the CURRENT
 * real version before calling it, so its version check trivially agrees —
 * the `base` check above is what actually decided staleness.
 */
export class DocumentGateway {
  readonly #api: DocumentGatewayVscodeApi;
  readonly #log: DocumentGatewayLogger;
  readonly #changeSubscription: vscode.Disposable;
  readonly #closeSubscription: vscode.Disposable;
  #disconnected = false;
  #disposed = false;
  /** The base stamp — see class header. Starts at 0, matching
   *  `ProxyDocumentHost`'s own pre-convergence default (that class's
   *  `#lastKnownStamp` also starts at 0). `sendInitialSnapshot` deliberately
   *  sends this value WITHOUT bumping it first (see that method's own doc
   *  comment) — so an edit submitted before any snapshot has ever been
   *  exchanged (structurally possible only in a fast unit-test harness that
   *  bypasses the async wire entirely — a real webview session always
   *  receives its first snapshot before a user could possibly type, per
   *  `ProxyDocumentHost`'s own header) is accepted rather than spuriously
   *  rejected by two hosts that simply have not talked yet. */
  #stamp = 0;
  /** True for the exact span of an in-flight `workspace.applyEdit` call.
   *  Used by `#broadcastSnapshot` to recognize "this
   *  `onDidChangeTextDocument` firing is the one THIS gateway's own
   *  in-flight `applyEdit()` call is causing" — see that method's own
   *  comment and `#ownChangeAlreadyReported`'s doc comment for the repair
   *  round 1 fix this now composes with (this flag alone no longer decides
   *  whether a reply is sent for that firing — see below). A narrow, local
   *  reentrancy flag scoped to one method call, not the request/reply
   *  correlation the run spec's binding model rules out (point 4): it
   *  never tracks WHICH edit a message corresponds to, only WHETHER a
   *  `workspace.applyEdit` this gateway itself just issued is still in
   *  flight. */
  #applyInProgress = false;
  /**
   * Repair round 1 (finding "The gateway's echo suppression depends on an
   * uncited applyEdit/onDidChangeTextDocument ordering"): PRE-repair,
   * `#broadcastSnapshot` unconditionally SKIPPED sending while
   * `#applyInProgress` was true, and `applyEdit`'s own single reply site
   * ALWAYS sent afterward — correct ONLY if `onDidChangeTextDocument`
   * always fires before `workspace.applyEdit`'s own promise resolves.
   * `@types/vscode`'s own `.d.ts` documents only "a thenable that resolves
   * when the edit could be applied," not that ordering — an unproven
   * assumption this run spec's own rule treats as a confirmed finding
   * either way. Under the OTHER order (the event fires AFTER the promise
   * resolves, once `#applyInProgress` has already been reset to `false`),
   * `#broadcastSnapshot` would ALSO send, producing TWO snapshot replies
   * for the SAME accepted edit — and on the proxy side (`../webview-host/
   * proxy-document-host.ts`), the SECOND one no longer matches what the
   * (already-confirmed, possibly queue-advanced) mirror expects, so it is
   * treated as a divergence: `replaceExternal` fires and discards the send
   * queue, silently dropping an already-accepted keystroke.
   *
   * THE FIX is order-independent: reset to `false` at the TOP of every
   * `applyEdit()` call. If `#broadcastSnapshot` fires WHILE `#applyInProgress`
   * is true (the "favourable" order), it sends for real (so the proxy hears
   * about the change as soon as VS Code reports it, whichever order that
   * is) and sets this to `true`; `applyEdit`'s own single reply site then
   * SKIPS its own send only in that one case, since the change has already
   * been reported. Under the OTHER order, `#broadcastSnapshot` does not
   * fire during the window at all (nothing has changed from the CALLER's
   * perspective while `#applyInProgress` is still true), this flag stays
   * `false`, and `applyEdit`'s own reply site sends as before — the
   * dedicated `#lastReportedVersion` check inside `#broadcastSnapshot`'s
   * "not currently in progress" branch is what then prevents that SAME
   * change's now-delayed event from producing a SECOND, redundant send.
   */
  #ownChangeAlreadyReported = false;
  /**
   * The `document.version` of the most recent snapshot this gateway
   * actually SENT (from EITHER `#sendSnapshot` caller) — repair round 1,
   * the other half of `#ownChangeAlreadyReported`'s fix. `#broadcastSnapshot`'s
   * "not currently in progress" branch skips sending when the document's
   * CURRENT version already equals this value: VS Code's real
   * `TextDocument.version` "will strictly increase after each change," so
   * two snapshot messages ever carrying the identical version can only be
   * describing the exact same underlying state — a delayed echo of a
   * change `applyEdit`'s own reply site already reported, never new
   * information. This can NEVER wrongly suppress a genuinely new external
   * change (a different, always-higher version), and it is deliberately
   * NOT consulted by `applyEdit`'s own reply site itself, which must always
   * reply even when the document's version happens to be unchanged (a
   * rejected edit) — see that method's own comment.
   */
  #lastReportedVersion: number | undefined;

  /**
   * D15's correlation id is not stored here: it identifies a SESSION (one
   * `resolveCustomTextEditor` call) for LOGGING purposes only, and `log`
   * already has it baked in as a closure (`../provider.ts`'s
   * `createSessionLogger(outputChannel, correlationId)`) — every `#log(...)`
   * call below reaches the same correlation id without this class needing
   * its own copy to thread through.
   */
  constructor(api: DocumentGatewayVscodeApi, log: DocumentGatewayLogger = () => {}) {
    this.#api = api;
    this.#log = log;

    // "for THIS document" (run spec DETAILS #2): both workspace events are
    // global across every open document, so every listener filters by
    // reference equality against the one document this gateway owns.
    this.#changeSubscription = api.onDidChangeTextDocument((event) => {
      if (event.document !== this.#api.document) return;
      this.#broadcastSnapshot();
    });
    this.#closeSubscription = api.onDidCloseTextDocument((doc) => {
      if (doc !== this.#api.document) return;
      this.#disconnect("document-closed");
    });
  }

  /** The document's current authoritative `DocumentSnapshot`, read fresh
   *  from `vscode.TextDocument` on every call — this gateway holds no
   *  cached copy of its own (D2: the `TextDocument` IS the authority). */
  currentSnapshot(): DocumentSnapshot {
    return { text: this.#api.document.getText(), version: this.#api.document.version };
  }

  /**
   * The base stamp's CURRENT value — see this class's own header for the
   * full account of what `#stamp` is and is not. Repair round 1 (finding
   * "Projection staleness compares the host's TextDocument.version against
   * the webview mirror's LOCAL version"): `../project/projection.ts`'s
   * `resolveEditorProjectionPayload` stamps a built projection's
   * `sourceVersion` with THIS value — never `currentSnapshot().version`
   * (real `TextDocument.version`) — because `ProxyDocumentHost` (the ONLY
   * thing that ever compares a projection's `sourceVersion` against
   * anything, via `packages/editor`'s `projectionNeedsRefresh`) tracks the
   * gateway's stamp (`#lastKnownStamp`), never the real document version,
   * for exactly the reason this class's own header explains: the two
   * spaces "only ever coincide by accident." Reading this value at the same
   * moment as `currentSnapshot()` (both from `../provider.ts`'s
   * `sendProjection()`, synchronously, before either could change) keeps
   * the pairing accurate — see that call site's own comment.
   */
  currentStamp(): number {
    return this.#stamp;
  }

  /**
   * Sends the CURRENT authoritative snapshot at the CURRENT stamp — the
   * initial ready-handshake reply (`../provider.ts`). Deliberately does
   * NOT bump `#stamp` first, unlike every other authoritative send
   * (`#sendSnapshot`, below): this reply reports the document exactly as
   * it stood before this session began — nothing has changed yet — and a
   * webview session CAN (a synchronous test transport, though never a real
   * one — see `ProxyDocumentHost`'s own header) submit its first edit
   * before this reply has even arrived, using the mirror's own starting
   * stamp (0) as that edit's `base`. If this method bumped first, that
   * edit's `base` would already be stale by the time the gateway sees it,
   * for no reason connected to any real state change — an own-goal this
   * addendum exists to eliminate, not reproduce at a new layer. The value
   * sent is still part of the SAME monotonic sequence `#sendSnapshot` uses
   * (it is simply `#stamp`'s value AT THIS POINT, not yet advanced) — there
   * is no second, parallel numbering.
   */
  async sendInitialSnapshot(): Promise<void> {
    await this.#send({
      type: "snapshot",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      snapshot: this.currentSnapshot(),
      baseStamp: this.#stamp,
    });
  }

  /**
   * Applies an inbound `SourceEdit` against the current base `stamp` and
   * ALWAYS replies with the document's fresh authoritative snapshot
   * afterward — success or failure alike (run spec: "EVERY apply produces
   * EXACTLY ONE reply: success or failure (rejected applyEdit, closed
   * document, concurrent change). Silence on any path is a defect.").
   *
   * `base` is the ONLY thing that decides whether this edit is even
   * attempted — see this class's own header for why `edit.expectedVersion`
   * plays no part in that decision.
   *
   * Path breakdown (each covered by its own test in
   * `tests/host/document-gateway.test.ts`):
   *   1. Already disconnected/closed at entry -> re-announce disconnect,
   *      no vscode call attempted, no reply (the disconnect message IS the
   *      reply this session gets from here on).
   *   2. `base !== #stamp` (a STALE base — the caller's view of the
   *      document is no longer current, the addendum's own "concurrent
   *      change" case) -> skip `workspace.applyEdit` entirely and fall
   *      through to the single reply site with the unchanged current text.
   *   3. `base === #stamp` but the dry-run rejects (`invalid-range` — this
   *      gateway is never constructed readonly, so that reason never fires
   *      here) -> same skip, same unchanged reply.
   *   4. Dry-run accepts -> convert `[from, to)` to a `Range` via
   *      `document.positionAt` ONLY, then call `workspace.applyEdit`. A
   *      `false` result or a thrown error ("rejected applyEdit") is not
   *      re-thrown — the reply at the bottom reports whatever the
   *      document's real state ended up being, never a coerced guess.
   *   5. The document closed during the `await` (a race, not the common
   *      "closed document" case which path 1 already covers) -> disconnect
   *      instead of reading a dead document.
   *   6. Otherwise -> the one reply site, with the document's fresh
   *      snapshot (unchanged on failure, updated on success — the SAME
   *      shape either way, distinguished only by its content, exactly as
   *      the run spec's reconciliation model requires for the "snapshot"
   *      channel).
   */
  async applyEdit(edit: SourceEdit, base: number): Promise<void> {
    if (this.#disconnected || this.#api.document.isClosed) {
      this.#disconnect("document-closed");
      return;
    }

    // Repair round 1 — reset PER CALL; see `#ownChangeAlreadyReported`'s
    // own doc comment for the order-independent fix this is half of.
    this.#ownChangeAlreadyReported = false;

    if (base === this.#stamp) {
      const current = this.currentSnapshot();
      // D3's own pure check (readonly/invalid-range), reused rather than
      // re-derived — see this module's header. `expectedVersion` is FORCED
      // to the document's real current version: the `base === #stamp` test
      // above already proved this edit targets the document's CURRENT
      // state, so `applyEditPure`'s own stale check must not independently
      // (and wrongly) re-litigate that against a value
      // (`edit.expectedVersion`) that lives in a completely different
      // version space and was never meant to cross this boundary.
      const dryRun = applyEditPure(current, { ...edit, expectedVersion: current.version });
      if (dryRun.ok) {
        this.#log("apply-edit-accepted-locally");
        const workspaceEdit = this.#api.createWorkspaceEdit();
        const fromPosition = this.#api.document.positionAt(edit.from);
        const toPosition = this.#api.document.positionAt(edit.to);
        const range = this.#api.createRange(fromPosition, toPosition);
        workspaceEdit.replace(this.#api.document.uri, range, edit.insert);
        this.#applyInProgress = true;
        try {
          const applied = await this.#api.applyWorkspaceEdit(workspaceEdit);
          this.#log(applied ? "apply-edit-workspace-accepted" : "apply-edit-workspace-rejected");
        } catch (error) {
          this.#log("apply-edit-workspace-threw", {
            message: error instanceof Error ? error.message : String(error),
          });
        } finally {
          this.#applyInProgress = false;
        }
      } else {
        this.#log("apply-edit-rejected-locally", { reason: dryRun.reason });
      }
    } else {
      this.#log("apply-edit-rejected-stale-base", { base, currentStamp: this.#stamp });
    }

    if (this.#api.document.isClosed) {
      this.#disconnect("document-closed");
      return;
    }

    // The single reply site (see this method's own doc comment): always
    // the document's FRESH truth, whether or not anything actually
    // changed above — UNLESS `#broadcastSnapshot` already sent this exact
    // change's reply while this call was still in flight (the "favourable"
    // ordering — see `#ownChangeAlreadyReported`'s own doc comment). A
    // rejected-locally/rejected-stale-base path never sets that flag (no
    // `workspace.applyEdit` call, so no `onDidChangeTextDocument` firing to
    // race), so this method always still replies on those paths.
    if (!this.#ownChangeAlreadyReported) {
      await this.#sendSnapshot();
    }
  }

  /**
   * Releases every subscription this gateway owns. Idempotent. Called from
   * `../provider.ts`'s `webviewPanel.onDidDispose` handler (a disposed
   * PANEL has no live webview to message, so `dispose()` sends nothing —
   * unlike `#disconnect`, which is for a live panel whose DOCUMENT went
   * away; see this module's header and `#disconnect`'s own comment).
   */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#changeSubscription.dispose();
    this.#closeSubscription.dispose();
  }

  #broadcastSnapshot(): void {
    if (this.#disconnected) return;
    if (this.#applyInProgress) {
      // Repair round 1 (order-independent fix — see `#ownChangeAlreadyReported`'s
      // own doc comment): this firing is the change THIS gateway's own
      // in-flight `applyEdit()` call is causing. Send now, whichever order
      // this happens to be, and flag it so `applyEdit`'s own reply site
      // recognizes the change is already reported and skips a redundant
      // second send for the SAME resulting state.
      this.#ownChangeAlreadyReported = true;
      void this.#sendSnapshot();
      return;
    }
    // Repair round 1 — the OTHER order: `applyEdit`'s own reply site may
    // already have sent this exact change (see `#lastReportedVersion`'s own
    // doc comment) by the time this now-delayed event fires. Skipping a
    // duplicate here can never wrongly suppress a genuinely NEW external
    // change, since a real change always strictly advances the version.
    if (this.#api.document.version === this.#lastReportedVersion) return;
    void this.#sendSnapshot();
  }

  /**
   * The ONE place `#stamp` ever advances, and the ONE place a "snapshot"
   * message is constructed — every caller (`sendInitialSnapshot`,
   * `applyEdit`'s single reply site, `#broadcastSnapshot`) routes through
   * here so the stamp sequence has no second writer. Bumps unconditionally,
   * even when the reply's text turns out unchanged (an edit rejected for a
   * stale base, or for `invalid-range`): every authoritative snapshot this
   * gateway ever sends is itself a new, distinct point in that sequence,
   * whether or not the DOCUMENT changed as a result.
   */
  async #sendSnapshot(): Promise<void> {
    this.#stamp += 1;
    this.#lastReportedVersion = this.#api.document.version;
    await this.#send({
      type: "snapshot",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      snapshot: this.currentSnapshot(),
      baseStamp: this.#stamp,
    });
  }

  /**
   * D14: "`EDITOR_HOST_DISCONNECTED` gets its first real producer in this
   * run." Idempotent — a document can only close once, and `applyEdit`'s
   * own entry guard means a later call never re-fires this. Posts the
   * `disconnect` message to the (still-live, per this trigger's own
   * precondition) webview panel, then leaves the gateway permanently
   * inert: every subsequent `applyEdit` call re-enters the entry guard
   * above and returns without attempting any vscode call.
   */
  #disconnect(_reason: "document-closed"): void {
    if (this.#disconnected) return;
    this.#disconnected = true;
    this.#log("host-disconnected", { reason: _reason });
    void this.#send({
      type: "disconnect",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      diagnostic: hostDisconnectedDiagnostic(_reason),
    });
  }

  async #send(message: HostToWebviewMessage): Promise<void> {
    try {
      await this.#api.postMessage(message);
    } catch (error) {
      // The panel may already be gone (a race between this async send and
      // panel disposal, which VS Code's own docs say throws if the panel
      // is used after `dispose()`) — there is no live receiver left to
      // notify, and `../provider.ts`'s own `webviewPanel.onDidDispose`
      // handler is the authoritative place panel-gone cleanup happens.
      // Never re-thrown: a send failure must not crash the extension host.
      this.#log("post-message-failed", {
        messageType: message.type,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
