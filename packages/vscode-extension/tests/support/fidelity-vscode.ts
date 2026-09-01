import type * as vscode from "vscode";

/**
 * SFE-P3c — the HOST-FIDELITY MOCK (run spec "Host-fidelity requirement").
 *
 * P1a recorded a gap: no real VS Code host, only a `mock.module("vscode", ...)`
 * namespace with hand-hardcoded return values per test. This run's bounded
 * `@vscode/test-electron` attempt is recorded in this run's report; this
 * module is the FIDELITY MOCK that requirement calls for regardless of that
 * attempt's outcome ("the mock stays only for fast unit suites" if the
 * attempt succeeds) — a `TextDocument` with REAL `offsetAt`/`positionAt`/
 * `getText`/`version` semantics (computed from actual text content, not
 * returned from a table the test wrote by hand), a `WorkspaceEdit` that
 * ACTUALLY applies (mutates the target document's real text), real event
 * emitters (`onDidChangeTextDocument`/`onDidCloseTextDocument` fire for
 * real, to every real subscriber, when a real change happens), and a
 * `workspace.isTrusted`/`onDidGrantWorkspaceTrust` surface.
 *
 * SCOPE (run spec: "Keep the mock to what deliverables 2-3 actually
 * exercise ... do not build mock surface nothing calls"): this module
 * implements exactly the `vscode.TextDocument`/`WorkspaceEdit`/workspace-
 * event/trust surface `../../src/host/document-gateway.ts`'s
 * `DocumentGatewayVscodeApi` and `../../src/provider.ts` actually call. It
 * does not implement `TextDocument.save`, `lineAt`, `getWordRangeAtPosition`,
 * `validateRange`/`validatePosition`, `WorkspaceEdit.insert`/`delete`/
 * `createFile`/`deleteFile`, or anything else neither of those two files
 * reads or calls.
 *
 * ── FIDELITY CHECKLIST (per member, what is real and what is not) ─────────
 *
 * `FidelityDocument` (the `vscode.TextDocument`-shaped object):
 *   - `uri`               REAL: an actual (fake-scheme) `Uri`-shaped value
 *                          with a stable `.toString()`/`.fsPath`, used for
 *                          reference/string equality exactly as real
 *                          `vscode.Uri` values are.
 *   - `version`           REAL: starts at 0, increments by exactly 1 on
 *                          every accepted `WorkspaceEdit` application or
 *                          `externalChange()` call — matches the real
 *                          `.d.ts`'s "will strictly increase after each
 *                          change, including undo/redo" (verified against
 *                          `node_modules/.bun/@types+vscode@1.134.0/.../index.d.ts`
 *                          line ~143).
 *   - `isClosed`          REAL: false until `.close()` is called on this
 *                          handle, then permanently true.
 *   - `getText()`         REAL: returns the CURRENT text, computed live —
 *                          not a snapshot frozen at construction.
 *   - `positionAt(offset)` REAL for LF-only text: walks the text counting
 *                          `"\n"` characters up to `offset` (clamped to
 *                          `[0, text.length]`), matching the real
 *                          `.d.ts`'s "A valid zero-based offset in UTF-16
 *                          code units" contract for LF line endings. NOT
 *                          verified for CRLF (`"\r\n"`) documents — real
 *                          VS Code's line/character accounting for CRLF
 *                          files was not independently re-derived here
 *                          (this repo's own Markdown fixtures and editor
 *                          pipeline are LF-normalized throughout; a book
 *                          author's CRLF-saved file is untested by this
 *                          mock — flagged per the run spec's "where you
 *                          cannot verify a VS Code semantic ... say so
 *                          explicitly" instruction).
 *   - `offsetAt(position)` REAL for LF-only text, the exact inverse of
 *                          `positionAt` above (same CRLF caveat).
 *
 * `FidelityWorkspaceEdit` (`vscode.WorkspaceEdit`-shaped):
 *   - `replace(uri, range, newText)`  REAL in shape (records the call) but
 *                          the actual MUTATION happens when
 *                          `FidelitySimulatedWorkspace.applyWorkspaceEdit`
 *                          processes it (see below) — matching real
 *                          VS Code, where `WorkspaceEdit` is an inert
 *                          description until `workspace.applyEdit` runs it.
 *   - `insert`/`delete`/`set`/`get`/`has`/`createFile`/`deleteFile`
 *                          NOT IMPLEMENTED — `DocumentGateway` never calls
 *                          these; see this file's SCOPE note above.
 *
 * `FidelitySimulatedWorkspace` (`vscode.workspace`-shaped, the pieces used):
 *   - `applyEdit(edit)`   REAL: for every `replace()` call recorded against
 *                          a document THIS workspace created, converts
 *                          `range.start`/`range.end` back to offsets via
 *                          that document's OWN `offsetAt`, splices the
 *                          text, bumps its version by 1, and fires
 *                          `onDidChangeTextDocument` to every subscriber —
 *                          exactly what a successful real
 *                          `workspace.applyEdit` does. Can be told to
 *                          REJECT instead (see `rejectNextApply`) to
 *                          exercise `DocumentGateway`'s "rejected
 *                          applyEdit" path without a separate stub. Only
 *                          single, non-overlapping replacements are
 *                          exercised by this run's own tests — real
 *                          VS Code's documented "all-or-nothing" multi-edit
 *                          semantics for a batch of edits across several
 *                          resources are NOT reproduced (this mock applies
 *                          whatever replacements target ITS documents, in
 *                          array order, with no atomicity guarantee across
 *                          them — `DocumentGateway` never constructs more
 *                          than one replacement per edit, so this gap is
 *                          not exercised by anything that calls this mock
 *                          today).
 *   - `onDidChangeTextDocument`/`onDidCloseTextDocument`
 *                          REAL: genuinely GLOBAL across every document
 *                          this workspace created (matching real VS Code,
 *                          where these are workspace-wide events, not
 *                          per-document) — a change on document B fires
 *                          for a listener that only cares about document A
 *                          too, exactly like the real API; `DocumentGateway`
 *                          is the one that filters by reference equality,
 *                          and this fidelity actually exercises that filter
 *                          (see the sabotage case below).
 *   - `isTrusted`/`onDidGrantWorkspaceTrust`
 *                          REAL in shape: `isTrusted` starts `false` by
 *                          default (constructor option), `grantTrust()`
 *                          flips it to `true` and fires the event exactly
 *                          once — matching the real one-directional
 *                          "trust granted" semantics (VS Code has no
 *                          "revoke trust mid-session" event, confirmed
 *                          against the real `.d.ts`: only
 *                          `onDidGrantWorkspaceTrust: Event<void>` exists).
 *
 * ── SABOTAGE CASE (proves this mock CAN fail a wrong implementation) ──────
 * `tests/host/document-gateway.test.ts`'s "ignores onDidChangeTextDocument
 * events for a different document" test constructs TWO documents on ONE
 * shared `FidelitySimulatedWorkspace`, applies an edit to document B only,
 * and asserts the `DocumentGateway` watching document A never posts a
 * `snapshot` message. Deleting `DocumentGateway`'s
 * `if (event.document !== this.#api.document) return;` guard (a real,
 * plausible implementation bug this exact mock is capable of catching,
 * since the event genuinely fires for both documents) makes that test fail
 * — verified by temporarily deleting the guard locally while authoring
 * this run (not committed; see this run's report).
 */

// ── Uri ──────────────────────────────────────────────────────────────────

export interface FidelityUri {
  readonly scheme: "fidelity";
  readonly path: string;
  readonly fsPath: string;
  toString(): string;
}

let uriCounter = 0;

export function createFidelityUri(path?: string): FidelityUri {
  const resolvedPath = path ?? `/fidelity-doc-${(uriCounter += 1)}.md`;
  return {
    scheme: "fidelity",
    path: resolvedPath,
    fsPath: resolvedPath,
    toString: () => `fidelity://${resolvedPath}`,
  };
}

// ── Position / Range ─────────────────────────────────────────────────────

export class FidelityPosition {
  constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}
}

export class FidelityRange {
  constructor(
    public readonly start: FidelityPosition,
    public readonly end: FidelityPosition,
  ) {}
}

// ── WorkspaceEdit ────────────────────────────────────────────────────────

interface FidelityReplacement {
  readonly uri: FidelityUri;
  readonly range: FidelityRange;
  readonly newText: string;
}

export class FidelityWorkspaceEdit {
  readonly #replacements: FidelityReplacement[] = [];

  replace(uri: FidelityUri, range: FidelityRange, newText: string): void {
    this.#replacements.push({ uri, range, newText });
  }

  get size(): number {
    return this.#replacements.length;
  }

  /** Internal — read by `FidelitySimulatedWorkspace.applyEdit`. Not part of
   *  the real `vscode.WorkspaceEdit` surface. */
  replacementsFor(uri: FidelityUri): readonly FidelityReplacement[] {
    return this.#replacements.filter((r) => r.uri.toString() === uri.toString());
  }
}

// ── TextDocument + simulated workspace ──────────────────────────────────

// Matches the shape of real `vscode.TextDocumentChangeEvent` closely enough
// to satisfy `DocumentGatewayVscodeApi.onDidChangeTextDocument`'s real
// `(e: vscode.TextDocumentChangeEvent) => void` listener type: `document` is
// REAL (see this module's fidelity checklist); `contentChanges`/`reason`
// are FILLER (always `[]`/`undefined`) since nothing under test —
// `DocumentGateway` only ever reads `event.document` — reads either field
// (see this module's SCOPE note above: "do not build mock surface nothing
// calls" applies to the FIELD level too, not just whole members).
type ChangeListener = (event: { document: vscode.TextDocument; contentChanges: readonly never[]; reason: undefined }) => void;
type CloseListener = (document: vscode.TextDocument) => void;

interface FidelityDocumentState {
  text: string;
  version: number;
  closed: boolean;
}

/**
 * One document created by a `FidelitySimulatedWorkspace`. `.document` is
 * the `vscode.TextDocument`-shaped value to hand to `DocumentGateway`
 * (structurally cast — see this module's header for exactly which members
 * are implemented).
 */
export interface FidelityDocumentHandle {
  readonly document: vscode.TextDocument;
  /** Directly mutates this document's text as an EXTERNAL change (not via
   *  `WorkspaceEdit`) and fires `onDidChangeTextDocument` — simulates
   *  undo/redo, another extension's edit, or a save-triggered reformat. */
  externalChange(newText: string): void;
  /** Marks this document closed and fires `onDidCloseTextDocument`. */
  close(): void;
}

/**
 * `vscode.workspace`-shaped simulated environment (the pieces this run's
 * tests use): can host multiple documents sharing ONE real, global change/
 * close event pair (see this module's header), applies `WorkspaceEdit`s for
 * real, and carries a real workspace-trust surface.
 */
export class FidelitySimulatedWorkspace {
  readonly #changeListeners = new Set<ChangeListener>();
  readonly #closeListeners = new Set<CloseListener>();
  readonly #documents = new Map<string, { state: FidelityDocumentState; document: vscode.TextDocument; uri: FidelityUri }>();
  readonly #trustListeners = new Set<() => void>();
  #isTrusted: boolean;
  /** When set, the NEXT `applyEdit` call returns `false` without mutating
   *  anything — exercises `DocumentGateway`'s "rejected applyEdit" path
   *  (run spec behavior table / DETAILS #2) without a separate stub. */
  rejectNextApply = false;

  constructor(options: { readonly isTrusted?: boolean } = {}) {
    this.#isTrusted = options.isTrusted ?? false;
  }

  get isTrusted(): boolean {
    return this.#isTrusted;
  }

  onDidGrantWorkspaceTrust(listener: () => void): vscode.Disposable {
    this.#trustListeners.add(listener);
    return { dispose: () => this.#trustListeners.delete(listener) };
  }

  /** Test-only: flips `isTrusted` to `true` and fires
   *  `onDidGrantWorkspaceTrust` exactly once — matches the real one-way
   *  "trust granted" semantics (see this module's header). */
  grantTrust(): void {
    if (this.#isTrusted) return;
    this.#isTrusted = true;
    for (const listener of this.#trustListeners) listener();
  }

  onDidChangeTextDocument(listener: ChangeListener): vscode.Disposable {
    this.#changeListeners.add(listener);
    return { dispose: () => this.#changeListeners.delete(listener) };
  }

  onDidCloseTextDocument(listener: CloseListener): vscode.Disposable {
    this.#closeListeners.add(listener);
    return { dispose: () => this.#closeListeners.delete(listener) };
  }

  createWorkspaceEdit(): FidelityWorkspaceEdit {
    return new FidelityWorkspaceEdit();
  }

  /**
   * REAL application: for every replacement in `edit` that targets a
   * document THIS workspace created, converts its `Range` back to offsets
   * via that document's own `offsetAt`, splices the text, bumps its
   * version by 1, and fires `onDidChangeTextDocument`. Returns `false`
   * (mutating nothing) if `rejectNextApply` was set.
   */
  async applyEdit(edit: FidelityWorkspaceEdit): Promise<boolean> {
    if (this.rejectNextApply) {
      this.rejectNextApply = false;
      return false;
    }
    for (const entry of this.#documents.values()) {
      const replacements = edit.replacementsFor(entry.uri);
      for (const replacement of replacements) {
        const from = offsetAt(entry.state.text, replacement.range.start);
        const to = offsetAt(entry.state.text, replacement.range.end);
        entry.state.text = entry.state.text.slice(0, from) + replacement.newText + entry.state.text.slice(to);
        entry.state.version += 1;
      }
      if (replacements.length > 0) this.#fireChange(entry.document);
    }
    return true;
  }

  createDocument(initialText: string, uri: FidelityUri = createFidelityUri()): FidelityDocumentHandle {
    const state: FidelityDocumentState = { text: initialText, version: 0, closed: false };
    const key = uri.toString();
    const document = this.#buildDocument(uri, state);
    this.#documents.set(key, { state, document, uri });

    return {
      document,
      externalChange: (newText: string) => {
        state.text = newText;
        state.version += 1;
        this.#fireChange(document);
      },
      close: () => {
        if (state.closed) return;
        state.closed = true;
        for (const listener of this.#closeListeners) listener(document);
      },
    };
  }

  #fireChange(document: vscode.TextDocument): void {
    for (const listener of this.#changeListeners) listener({ document, contentChanges: [], reason: undefined });
  }

  #buildDocument(uri: FidelityUri, state: FidelityDocumentState): vscode.TextDocument {
    const fake = {
      get uri() {
        return uri as unknown as vscode.Uri;
      },
      get version() {
        return state.version;
      },
      get isClosed() {
        return state.closed;
      },
      getText(): string {
        return state.text;
      },
      positionAt(offset: number): vscode.Position {
        return positionAt(state.text, offset) as unknown as vscode.Position;
      },
      offsetAt(position: vscode.Position): number {
        return offsetAt(state.text, position as unknown as FidelityPosition);
      },
    };
    return fake as unknown as vscode.TextDocument;
  }
}

/** Real, LF-only `positionAt` — see this module's header's fidelity
 *  checklist for the CRLF caveat. */
function positionAt(text: string, offset: number): FidelityPosition {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < clamped; i++) {
    if (text[i] === "\n") {
      line += 1;
      lineStart = i + 1;
    }
  }
  return new FidelityPosition(line, clamped - lineStart);
}

/** Real, LF-only `offsetAt` — the exact inverse of `positionAt` above. */
function offsetAt(text: string, position: FidelityPosition): number {
  const lines = text.split("\n");
  const lineIndex = Math.max(0, Math.min(position.line, lines.length - 1));
  let offset = 0;
  for (let i = 0; i < lineIndex; i++) offset += (lines[i]?.length ?? 0) + 1;
  const lineText = lines[lineIndex] ?? "";
  offset += Math.max(0, Math.min(position.character, lineText.length));
  return offset;
}
