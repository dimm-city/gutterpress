import type * as vscode from "vscode";

/**
 * TYPED STUB — SFE-P3c Lane A.
 *
 * Per this run's lane table, Lane A creates this file ONLY so
 * `../extension.ts` has a real call site to typecheck and wire disposal
 * against; Lane B owns this file's real implementation from the moment
 * this run's Lane A work is committed ("src/project/register.ts (a TYPED
 * STUB only — Lane B owns it from the next phase onward)"). No two lanes
 * write it concurrently.
 *
 * D9 assigns Lane B: "project discovery; trusted plugin loading;
 * build/preview/export commands" — none of which this run's Lane A scope
 * (protocol, document gateway, proxy document host, provider/extension
 * wiring, build, webview-purity rule, host fidelity) needs. This stub is
 * intentionally inert: it registers nothing, resolves no project, loads no
 * plugin.
 *
 * The FROZEN part of this stub's contract is its signature —
 * `(context) => vscode.Disposable`, called once from `activate()` and
 * pushed onto `context.subscriptions` exactly like the custom editor
 * registration next to it. Lane B replaces the body; changing the
 * signature is Lane B's call to make (and, per the plan's lane rules, would
 * land together with its one caller in `extension.ts`).
 */
export function registerProjectServices(_context: vscode.ExtensionContext): vscode.Disposable {
  return {
    dispose(): void {
      // No-op: this stub registers nothing that needs releasing.
    },
  };
}
