/**
 * Shared "vscode" module mock for `bun test` (SFE-P1a; extended SFE-P3c).
 *
 * The real "vscode" module is injected by the VS Code extension host at
 * runtime — it is not an npm package and importing it outside a real (or
 * `@vscode/test-electron`-launched) host throws/fails to resolve. Any suite
 * that imports a module which imports "vscode" as a VALUE must
 * `mock.module("vscode", ...)` BEFORE that dynamic `import()`. This mirrors
 * `packages/desktop/tests/support/electron-mock.ts`'s `mock.module("electron",
 * ...)` pattern for the identical reason (Electron isn't a real runtime
 * outside a packaged Electron app either).
 *
 * SFE-P3c widened WHICH files need this: `src/provider.ts` now imports
 * "vscode" as a VALUE (it constructs `new vscode.WorkspaceEdit()`/
 * `new vscode.Range(...)`, calls `vscode.workspace.applyEdit`/
 * `vscode.Uri.joinPath`/`vscode.window.createOutputChannel`, and reads
 * `vscode.workspace.isTrusted`) — where the SFE-P1a placeholder provider
 * only ever imported "vscode" as a TYPE (erased at compile time, no runtime
 * module needed). `tests/provider.test.ts` therefore now ALSO needs
 * `mock.module("vscode", ...)` before its dynamic import, exactly like
 * `tests/extension.test.ts` already does.
 *
 * `src/host/document-gateway.ts` and `src/webview-host/proxy-document-host.ts`
 * are DELIBERATELY DIFFERENT: they accept the vscode surface they use
 * through a narrow INJECTED interface (`DocumentGatewayVscodeApi`/
 * `WebviewHostTransport`) rather than importing "vscode" themselves at all
 * (type-only, or not at all) — see each file's own header. Their own test
 * suites (`tests/host/**`, `tests/webview-host/**`) build plain
 * structurally-fake/fidelity objects directly and need NO mock.module.
 *
 * `bun test --isolate` does not fully sandbox `mock.module()` registrations
 * across files that touch the SAME specifier (see `electron-mock.ts`'s
 * header for the identical caveat applied to "electron") — whichever
 * suite's factory ends up "live" serves every other suite's static
 * `from "vscode"` imports too. Every suite that needs a live "vscode" mock
 * calls `vscodeMock()` with the SAME superset shape below (only their
 * OVERRIDES differ), so this collision risk does not produce a cross-suite
 * behavior difference.
 *
 * SFE-P3c Lane B widened this mock again: `registerProjectServices`
 * (`../../src/project/register.ts`) now calls `vscode.commands.registerCommand`
 * (three times) and its three command modules (`../../src/commands/**`) call
 * `vscode.window.withProgress`/`showErrorMessage`/`showInformationMessage`/
 * `activeTextEditor`/`tabGroups`, `vscode.workspace.getWorkspaceFolder`/
 * `workspaceFolders`/`openTextDocument`, `vscode.window.showTextDocument`,
 * and `vscode.env.openExternal` — `../../src/extension.ts`'s `activate()`
 * now transitively exercises ALL of these (it calls `registerProjectServices`
 * unconditionally) even though it never TRIGGERS a command, so every one of
 * these members needs a working DEFAULT below or `tests/extension.test.ts`
 * and `tests/provider.test.ts` (both outside this lane's write boundary)
 * would throw on a call to `undefined(...)` the moment they run `activate()`/
 * `resolveCustomTextEditor(...)` — extending ONLY the shared factory's
 * defaults, never those two files themselves, is what keeps them green.
 */

export interface VscodeDisposableLike {
  dispose(): void;
}

export interface FakeOutputChannel {
  readonly name: string;
  readonly lines: string[];
  appendLine(value: string): void;
  dispose(): void;
}

export interface FakeWorkspaceEdit {
  readonly replacements: ReadonlyArray<{ readonly uri: unknown; readonly range: unknown; readonly newText: string }>;
  replace(uri: unknown, range: unknown, newText: string): void;
  readonly size: number;
}

export interface VscodeMockOverrides {
  /** Merged into `window` (so a spying override replaces just this key). */
  registerCustomEditorProvider?: (
    viewType: string,
    provider: unknown,
    options: unknown,
  ) => VscodeDisposableLike;
  /** Defaults to a `FakeOutputChannel` that records every `appendLine` call
   *  in `.lines` — tests assert on that array rather than intercepting
   *  `console`. */
  createOutputChannel?: (name: string) => FakeOutputChannel;
  /** Merged into `workspace`. Defaults to `async () => true` (always
   *  accepts) — override per-test to simulate VS Code itself rejecting an
   *  edit. */
  applyEdit?: (edit: unknown) => Promise<boolean>;
  onDidChangeTextDocument?: (listener: (e: unknown) => void) => VscodeDisposableLike;
  onDidCloseTextDocument?: (listener: (doc: unknown) => void) => VscodeDisposableLike;
  onDidGrantWorkspaceTrust?: (listener: () => void) => VscodeDisposableLike;
  /** `workspace.isTrusted` is a plain `boolean` in the real API (not a
   *  function) — see `node_modules/.bun/@types+vscode@1.134.0/.../index.d.ts`
   *  line ~14534: `export const isTrusted: boolean;`. Defaults to `true`. */
  isTrusted?: boolean;

  // ── SFE-P3c Lane B additions — see this file's header ──────────────────

  /** Merged into `commands`. Defaults to a no-op registration (returns a
   *  disposable, never invokes the callback — matches every OTHER
   *  `register*` default below: these mocks register real handlers for
   *  later triggering by a test, never call them automatically). */
  registerCommand?: (command: string, callback: (...args: unknown[]) => unknown) => VscodeDisposableLike;
  /** Merged into `workspace`. Defaults to `() => undefined` (no workspace
   *  folder — the "ungrouped single file" / "nothing open" case). */
  getWorkspaceFolder?: (uri: unknown) => { readonly uri: { readonly fsPath: string } } | undefined;
  /** Merged into `workspace`. A plain property, not a function — matches
   *  the real API's `workspaceFolders: WorkspaceFolder[] | undefined`.
   *  Defaults to `undefined` (no workspace open). */
  workspaceFolders?: ReadonlyArray<{ readonly uri: { readonly fsPath: string } }> | undefined;
  /** Merged into `workspace`. Defaults to resolving a minimal
   *  `{uri, getText: () => ""}` fake — enough for `showTextDocument` to
   *  receive something document-shaped without needing a real
   *  `vscode.TextDocument`. */
  openTextDocument?: (uri: unknown) => Promise<unknown>;
  /** Merged into `window`. A plain property (not a function), matching the
   *  real `window.activeTextEditor: TextEditor | undefined`. Defaults to
   *  `undefined` (no editor focused). */
  activeTextEditor?: { readonly document: { readonly uri: unknown } } | undefined;
  /** Merged into `window`. Defaults to simply invoking `task` with a no-op
   *  progress reporter and a fake, never-cancelled token — no real
   *  notification UI, but the SAME control-flow shape
   *  (`vscode.window.withProgress`'s real signature) so command code under
   *  test runs unmodified. */
  withProgress?: <R>(options: unknown, task: (progress: unknown, token: unknown) => Thenable<R>) => Thenable<R>;
  /** Merged into `window`. Defaults to `async () => undefined` (no button
   *  chosen) — override to capture the message text a command showed. */
  showErrorMessage?: (message: string, ...items: string[]) => Thenable<string | undefined>;
  /** Merged into `window`. Same default shape as `showErrorMessage`. */
  showInformationMessage?: (message: string, ...items: string[]) => Thenable<string | undefined>;
  /** Merged into `window`. Defaults to resolving a minimal fake text
   *  editor. */
  showTextDocument?: (document: unknown, options?: unknown) => Promise<unknown>;
  /** Merged into `window.tabGroups`. Defaults to no active tab (the
   *  "nothing open" / "active tab is not a custom editor" case). */
  activeTab?: { readonly input: unknown } | undefined;
  /** Merged into `env`. Defaults to `async () => true` (opened
   *  successfully) — override to capture the URL a command opened. */
  openExternal?: (uri: unknown) => Thenable<boolean>;
}

/**
 * Build the canonical mocked "vscode" namespace, with optional per-suite
 * overrides. Call as `mock.module("vscode", () => vscodeMock({ ... }))`.
 */
export function vscodeMock(overrides: VscodeMockOverrides = {}) {
  return {
    window: {
      registerCustomEditorProvider:
        overrides.registerCustomEditorProvider ?? ((): VscodeDisposableLike => ({ dispose: () => {} })),
      createOutputChannel:
        overrides.createOutputChannel ??
        ((name: string): FakeOutputChannel => {
          const lines: string[] = [];
          return {
            name,
            lines,
            appendLine: (value: string) => lines.push(value),
            dispose: () => {},
          };
        }),
      // LIVE getters — see `workspace.isTrusted`'s own comment below for
      // why (`mock.module`'s factory runs once per resolution, so any
      // property a test wants to change PARTWAY THROUGH must stay a
      // pass-through, never a value snapshotted at construction time).
      get activeTextEditor() {
        return overrides.activeTextEditor;
      },
      withProgress:
        overrides.withProgress ??
        (<R>(_options: unknown, task: (progress: unknown, token: unknown) => Thenable<R>): Thenable<R> =>
          task({ report: () => {} }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) })),
      showErrorMessage: overrides.showErrorMessage ?? (async (): Promise<string | undefined> => undefined),
      showInformationMessage: overrides.showInformationMessage ?? (async (): Promise<string | undefined> => undefined),
      showTextDocument: overrides.showTextDocument ?? (async (document: unknown): Promise<unknown> => ({ document })),
      tabGroups: {
        activeTabGroup: {
          get activeTab() {
            return overrides.activeTab;
          },
        },
      },
    },
    workspace: {
      applyEdit: overrides.applyEdit ?? (async (): Promise<boolean> => true),
      onDidChangeTextDocument:
        overrides.onDidChangeTextDocument ?? ((): VscodeDisposableLike => ({ dispose: () => {} })),
      onDidCloseTextDocument:
        overrides.onDidCloseTextDocument ?? ((): VscodeDisposableLike => ({ dispose: () => {} })),
      onDidGrantWorkspaceTrust:
        overrides.onDidGrantWorkspaceTrust ?? ((): VscodeDisposableLike => ({ dispose: () => {} })),
      // LIVE getters, not snapshotted plain values: `mock.module`'s
      // factory runs once per resolution (SFE-P3c Lane B measured this —
      // see this file's header), so a property a test wants to change
      // PARTWAY THROUGH (D9: "Trust granted mid-session re-resolves"; a
      // command test switching which folder is open between cases) must
      // stay a live pass-through to an `overrides` ACCESSOR reading its
      // own mutable test-local state — a plain property here would freeze
      // whatever that accessor returned at construction time and never
      // re-read it. A plain constant override still works exactly as
      // before (a getter returning a constant is indistinguishable from a
      // constant).
      get isTrusted() {
        return overrides.isTrusted ?? true;
      },
      getWorkspaceFolder: overrides.getWorkspaceFolder ?? ((): undefined => undefined),
      get workspaceFolders() {
        return overrides.workspaceFolders;
      },
      openTextDocument:
        overrides.openTextDocument ?? (async (uri: unknown): Promise<unknown> => ({ uri, getText: () => "" })),
    },
    commands: {
      registerCommand:
        overrides.registerCommand ?? ((): VscodeDisposableLike => ({ dispose: () => {} })),
    },
    env: {
      openExternal: overrides.openExternal ?? (async (): Promise<boolean> => true),
    },
    /** Real values — `node_modules/.bun/@types+vscode@1.134.0/.../index.d.ts`'s
     *  `enum ProgressLocation`. */
    ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
    /** A REAL constructible class, not a stub — `../../src/commands/open-source.ts`
     *  narrows with `input instanceof vscode.TabInputCustom`, which only
     *  works when this mock's own `TabInputCustom` is what BOTH the
     *  production code and a test's own tab fixture reference (module
     *  caching under `mock.module` guarantees the same class identity to
     *  every importer of "vscode" within one test run). Field names/order
     *  match the real `.d.ts` constructor exactly. */
    TabInputCustom: class {
      constructor(
        public readonly uri: unknown,
        public readonly viewType: string,
      ) {}
    },
    /** A minimal fidelity-shaped `WorkspaceEdit`: `.replace()` records the
     *  call, `.replacements`/`.size` let a test inspect what
     *  `DocumentGateway`/`provider.ts` actually constructed. Real
     *  `vscode.WorkspaceEdit` also has `insert`/`delete`/`set`/`get`/`has`/
     *  `createFile`/`deleteFile` — not implemented (nothing under test
     *  calls them; see `../support/fidelity-vscode.ts`'s header for the
     *  same scoping rule applied to the FULL fidelity mock). */
    WorkspaceEdit: class implements FakeWorkspaceEdit {
      readonly replacements: Array<{ uri: unknown; range: unknown; newText: string }> = [];
      replace(uri: unknown, range: unknown, newText: string): void {
        this.replacements.push({ uri, range, newText });
      }
      get size(): number {
        return this.replacements.length;
      }
    },
    Range: class {
      constructor(
        public readonly start: unknown,
        public readonly end: unknown,
      ) {}
    },
    Position: class {
      constructor(
        public readonly line: number,
        public readonly character: number,
      ) {}
    },
    Uri: {
      joinPath: (base: unknown, ...segments: string[]) => makeFakeUri(base, segments),
      file: (path: string) => makeFakeUri(undefined, [path]),
      parse: (value: string) => makeFakeUri(undefined, [value]),
    },
  };
}

function makeFakeUri(base: unknown, segments: readonly string[]): { toString(): string; fsPath: string } {
  const baseString = base && typeof (base as { toString?: unknown }).toString === "function"
    ? String(base)
    : "";
  const full = [baseString, ...segments].filter((part) => part.length > 0).join("/");
  return { toString: () => full, fsPath: full };
}
