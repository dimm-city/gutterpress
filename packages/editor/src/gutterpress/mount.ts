/**
 * SFE-P2b Lane B — `mountGutterpressEditor`: composes the shared editor
 * mount with the projection-driven `renderCustomBlock` provider (D6/G-11).
 *
 * WHY THIS DOES NOT LITERALLY CALL `mountEditor` (run spec: "composing
 * mountEditor + the provider — thin, no new state"): verified by reading
 * `../web/mount.ts` (out of this lane's write ownership — `src/web/**`
 * belongs to another lane) that `EditorMountOptions` has no
 * `viewOptions`/`renderCustomBlock` passthrough today — it hardcodes
 * `viewOptions: { classNames: [FORK_THEME_CLASS_NAME] }` when calling
 * `createVscodeEditorAdapter`, with no seam for a caller to add to it.
 * `renderCustomBlock` MUST be supplied at `EditorView` CONSTRUCTION time
 * (`EditorViewOptions`, consumed once inside `createVscodeEditorAdapter`) —
 * there is no post-mount API to add it afterwards. Widening
 * `EditorMountOptions` would require editing `src/web/mount.ts`, which is
 * outside this lane's write boundary for this run.
 *
 * So this module composes the layer `mountEditor` itself is built on
 * (`createVscodeEditorAdapter`, whose `viewOptions` DOES accept
 * `renderCustomBlock`) plus `mountEditor`'s own exported CSS constants
 * (`../web/fork-editor-css.ts` — plain string constants, a read-only
 * import, not a write), reproducing `mountEditor`'s CSS-injection behavior
 * byte-for-byte (same constants, same injection order, same
 * `container.ownerDocument` scoping, same dispose symmetry) rather than
 * duplicating it by re-deriving it independently. `createVscodeEditorAdapter`
 * is public (`../vscode-adapter/index.ts` — D5's sanctioned import
 * boundary), so this is an ordinary cross-module composition inside
 * `packages/editor`, not a second adapter. Recorded here explicitly per
 * this run's "record every design decision" instruction.
 */
import { createVscodeEditorAdapter, type VscodeEditorAdapter } from "../vscode-adapter/index.ts";
import type { Diagnostic, EditorDocumentHost } from "../core/index.ts";
import { FORK_DEFAULT_THEME_CSS, FORK_EDITOR_BASE_CSS, FORK_THEME_CLASS_NAME } from "../web/fork-editor-css.ts";
import { projectionNeedsRefresh } from "./match.ts";
import { diagnosticForProjection } from "./projection-diagnostics.ts";
import { createGutterpressBlockProvider } from "./provider.ts";
import type { GutterpressProjection } from "gutterpress/render";

export interface MountGutterpressEditorOptions {
  /** The projection to drive inactive marker/raw-html chips and in-chip generated-view previews. */
  readonly projection: GutterpressProjection;
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void;
  readonly readonly?: boolean;
  readonly extraCss?: string;
}

export interface GutterpressEditorMount {
  /** Tears down the mounted adapter and every `<style>` element this mount injected. Idempotent. */
  dispose(): void;
  /**
   * G-11 — true once `host`'s LIVE current version has moved past
   * `options.projection.sourceVersion`. The mounted chips silently stop
   * rendering (fall through to the fork's default view) the instant this
   * flips `true`, since the SAME check gates `renderCustomBlock`
   * internally — this is the caller's cue to build a fresh projection and
   * remount, not a live-updating property of the current mount.
   */
  needsRefresh(): boolean;
  /**
   * SFE-P3ab (Lane C) — an ADDITIVE member, mirroring `../web/mount.ts`'s
   * `EditorMount.getSelection()` (same contract: D3 source offsets, or
   * `undefined` with no caret). Straight passthrough to the underlying
   * `VscodeEditorAdapter` this mount is built on — see that function's own
   * doc comment (`../vscode-adapter/adapter.ts`) for the full contract.
   * Existing callers of the pre-P3ab `{ dispose(), needsRefresh() }` shape
   * are unaffected.
   */
  getSelection(): { readonly from: number; readonly to: number } | undefined;
}

/**
 * Mounts a real `@vscode/markdown-editor` fork surface into `container`,
 * backed by `host`, with `options.projection`'s marker/raw-html blocks and
 * generated views rendered as inactive chips.
 *
 * Mirrors `../web/mount.ts`'s `mountEditor` guard clauses and CSS-injection
 * symmetry exactly (same errors, same scoping) — see this module's header
 * for why it cannot simply delegate to that function.
 */
export function mountGutterpressEditor(
  container: Element,
  host: EditorDocumentHost,
  options: MountGutterpressEditorOptions,
): GutterpressEditorMount {
  const doc = container.ownerDocument;
  if (!doc) {
    throw new Error("mountGutterpressEditor: container has no ownerDocument");
  }

  const styleHost = doc.head ?? doc.documentElement;
  if (!styleHost) {
    throw new Error(
      "mountGutterpressEditor: container's ownerDocument has no <head> or document element to attach editor CSS to",
    );
  }

  // SFE-P2c repair round 1 (finding 5 — "refused plugin regions ship no
  // 'edit in source' affordance"): forward every diagnostic THIS mount's
  // own projection carries — a refused plugin-region, an unrecognized
  // `layout_`-prefixed token, a D13 cap — through `options.onDiagnostic`,
  // the SAME channel `applyEdit` rejections already use
  // (`../vscode-adapter/adapter.ts`). See `projection-diagnostics.ts`'s own
  // header for the full design and `match.ts`'s header ("REFUSED PLUGIN
  // REGIONS") for why this is a document-level notice, never a per-block
  // chip. Fired once, synchronously, at mount time — a fresh projection
  // means a fresh mount (this module's own doc comment on `needsRefresh`),
  // so there is no later point at which new projection diagnostics could
  // appear for this same mount.
  for (const diagnostic of options.projection.diagnostics) {
    options.onDiagnostic?.(diagnosticForProjection(diagnostic));
  }

  const isStale = (): boolean => projectionNeedsRefresh(options.projection, host.getSnapshot().version);

  const provider = createGutterpressBlockProvider(options.projection, {
    source: host.getSnapshot().text,
    ownerDocument: doc,
    isStale,
  });

  const baseStyleEl = doc.createElement("style");
  baseStyleEl.setAttribute("data-gp-editor-css", "fork-base");
  baseStyleEl.textContent = `${FORK_EDITOR_BASE_CSS}\n${FORK_DEFAULT_THEME_CSS}`;
  styleHost.appendChild(baseStyleEl);

  let extraStyleEl: Element | undefined;
  if (options.extraCss !== undefined) {
    extraStyleEl = doc.createElement("style");
    extraStyleEl.setAttribute("data-gp-editor-css", "extra");
    extraStyleEl.textContent = options.extraCss;
    styleHost.appendChild(extraStyleEl);
  }

  const adapter: VscodeEditorAdapter = createVscodeEditorAdapter(container, host, {
    onDiagnostic: options.onDiagnostic,
    readonly: options.readonly,
    viewOptions: {
      classNames: [FORK_THEME_CLASS_NAME],
      renderCustomBlock: provider.renderCustomBlock,
    },
  });

  let disposed = false;

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      adapter.dispose();
      baseStyleEl.remove();
      extraStyleEl?.remove();
    },
    needsRefresh: (): boolean => provider.needsRefresh(host.getSnapshot().version),
    getSelection: (): { readonly from: number; readonly to: number } | undefined => adapter.getSelection(),
  };
}
