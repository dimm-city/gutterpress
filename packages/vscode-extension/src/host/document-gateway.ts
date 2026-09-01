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
 */
export class DocumentGateway {
  readonly #api: DocumentGatewayVscodeApi;
  readonly #log: DocumentGatewayLogger;
  readonly #changeSubscription: vscode.Disposable;
  readonly #closeSubscription: vscode.Disposable;
  #disconnected = false;
  #disposed = false;
  /** True for the exact span of an in-flight `workspace.applyEdit` call.
   *  `workspace.applyEdit` succeeding fires `onDidChangeTextDocument` for
   *  the SAME change `applyEdit`'s own reply (the single reply site below)
   *  is about to report — without this guard, `#broadcastSnapshot` would
   *  send a SECOND, redundant reply for that one change. This is a narrow,
   *  local reentrancy flag scoped to one method call, not the request/reply
   *  correlation the run spec's binding model rules out (point 4): it
   *  never tracks WHICH edit a message corresponds to, only WHETHER a
   *  `workspace.applyEdit` this gateway itself just issued is still in
   *  flight. */
  #applyInProgress = false;

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
   * Applies an inbound `SourceEdit` and ALWAYS replies with the document's
   * fresh authoritative snapshot afterward — success or failure alike (run
   * spec: "EVERY apply produces EXACTLY ONE reply: success or failure
   * (rejected applyEdit, closed document, concurrent change). Silence on
   * any path is a defect.").
   *
   * Path breakdown (each covered by its own test in
   * `tests/host/document-gateway.test.ts`):
   *   1. Already disconnected/closed at entry -> re-announce disconnect,
   *      no vscode call attempted, no reply (the disconnect message IS the
   *      reply this session gets from here on).
   *   2. `applyEditPure` dry-run against the CURRENT live snapshot rejects
   *      (this is "concurrent change": the caller's `expectedVersion` no
   *      longer matches, or its range is no longer valid against the
   *      document's current length) -> skip the real `workspace.applyEdit`
   *      call entirely and fall through to the single reply site with the
   *      unchanged current text.
   *   3. Dry-run accepts -> convert `[from, to)` to a `Range` via
   *      `document.positionAt` ONLY, then call `workspace.applyEdit`. A
   *      `false` result or a thrown error ("rejected applyEdit") is not
   *      re-thrown — the reply at the bottom reports whatever the
   *      document's real state ended up being, never a coerced guess.
   *   4. The document closed during the `await` (a race, not the common
   *      "closed document" case which path 1 already covers) -> disconnect
   *      instead of reading a dead document.
   *   5. Otherwise -> the one reply site, with the document's fresh
   *      snapshot (unchanged on failure, updated on success — the SAME
   *      shape either way, distinguished only by its content, exactly as
   *      the run spec's reconciliation model requires for the "snapshot"
   *      channel).
   */
  async applyEdit(edit: SourceEdit): Promise<void> {
    if (this.#disconnected || this.#api.document.isClosed) {
      this.#disconnect("document-closed");
      return;
    }

    const current = this.currentSnapshot();
    // D3's own pure check (readonly/stale/invalid-range), reused rather
    // than re-derived — see this module's header. A gateway is never
    // constructed readonly on its own; only "stale" (expectedVersion
    // mismatch) or "invalid-range" (offsets no longer valid against the
    // CURRENT live text) can reject here, both of which are exactly what
    // "concurrent change" means in the run spec's own wording.
    const dryRun = applyEditPure(current, edit);
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
        this.#log("apply-edit-workspace-threw", { message: error instanceof Error ? error.message : String(error) });
      } finally {
        this.#applyInProgress = false;
      }
    } else {
      this.#log("apply-edit-rejected-locally", { reason: dryRun.reason });
    }

    if (this.#api.document.isClosed) {
      this.#disconnect("document-closed");
      return;
    }

    // The single reply site (see this method's own doc comment): always
    // the document's FRESH truth, whether or not anything actually
    // changed above.
    await this.#send({
      type: "snapshot",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      snapshot: this.currentSnapshot(),
    });
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
    if (this.#disconnected || this.#applyInProgress) return;
    void this.#send({
      type: "snapshot",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      snapshot: this.currentSnapshot(),
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
