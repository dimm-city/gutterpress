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
 * `from "vscode"` imports too. Both suites that need a live "vscode" mock
 * today (`extension.test.ts`, `provider.test.ts`) call `vscodeMock()` with
 * the SAME superset shape below (only their OVERRIDES differ), so this
 * collision risk does not produce a cross-suite behavior difference.
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
    },
    workspace: {
      applyEdit: overrides.applyEdit ?? (async (): Promise<boolean> => true),
      onDidChangeTextDocument:
        overrides.onDidChangeTextDocument ?? ((): VscodeDisposableLike => ({ dispose: () => {} })),
      onDidCloseTextDocument:
        overrides.onDidCloseTextDocument ?? ((): VscodeDisposableLike => ({ dispose: () => {} })),
      onDidGrantWorkspaceTrust:
        overrides.onDidGrantWorkspaceTrust ?? ((): VscodeDisposableLike => ({ dispose: () => {} })),
      isTrusted: overrides.isTrusted ?? true,
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
