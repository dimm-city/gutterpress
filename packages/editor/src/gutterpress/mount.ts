/**
 * SFE-P2b Lane B — `mountGutterpressEditor`: `mountEditor` (`../web/mount.ts`)
 * plus the projection-driven `renderCustomBlock` provider (D6/G-11). The
 * provider is built BEFORE the mount because the fork consumes
 * `renderCustomBlock` at `EditorView` construction time; everything else —
 * the `ownerDocument`/style-host guards, the two CSS injections, dispose
 * symmetry, `getSelection` — is `mountEditor`'s own, reached through its
 * `renderCustomBlock` option (this module used to reproduce that body
 * byte-for-byte because the option did not exist yet).
 */
import type { Diagnostic, EditorDocumentHost } from "../core/index.ts";
import { mountEditor } from "../web/mount.ts";
import { projectionNeedsRefresh } from "./match.ts";
import { diagnosticForProjection } from "./projection-diagnostics.ts";
import { createGutterpressBlockProvider } from "./provider.ts";
import { GUTTERPRESS_EDITOR_CSS } from "./editor-css.ts";
import { decorateAttrsTrailer } from "./attrs.ts";
import type { GutterpressProjection } from "gutterpress/render";

export interface MountGutterpressEditorOptions {
  /** The projection to drive inactive marker/raw-html chips and in-chip generated-view previews. */
  readonly projection: GutterpressProjection;
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void;
  readonly readonly?: boolean;
  readonly extraCss?: string;
  /** See `mountEditor`'s option of the same name. Pass `null` when `extraCss` carries the book's own typography. */
  readonly themeClassName?: string | null;
  /** See `mountEditor`'s option of the same name. */
  readonly showReadonlyToggle?: boolean;
  /** See `mountEditor`'s option of the same name. */
  readonly afterDocumentMount?: (documentElement: HTMLElement) => void;
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
  /** See `EditorMount.revealRange` — scrolls a source range into view, changing nothing else. */
  revealRange(from: number, to?: number): void;
  /** Lock or unlock the mounted editor (the host's Read/Edit decision). */
  setReadonly(readonly: boolean): void;
}

/**
 * Mounts a real `@vscode/markdown-editor` fork surface into `container`,
 * backed by `host`, with `options.projection`'s marker/raw-html blocks and
 * generated views rendered as inactive chips.
 */
export function mountGutterpressEditor(
  container: Element,
  host: EditorDocumentHost,
  options: MountGutterpressEditorOptions,
): GutterpressEditorMount {
  // The provider needs the document before `mountEditor` runs its own guard.
  const doc = container.ownerDocument;
  if (!doc) {
    throw new Error("mountGutterpressEditor: container has no ownerDocument");
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

  const mount = mountEditor(container, host, {
    onDiagnostic: options.onDiagnostic,
    readonly: options.readonly,
    extraCss: `${GUTTERPRESS_EDITOR_CSS}\n${options.extraCss ?? ""}`,
    renderCustomBlock: provider.renderCustomBlock,
    groupBlocks: provider.groupBlocks,
    themeClassName: options.themeClassName,
    showReadonlyToggle: options.showReadonlyToggle,
    decorateInactiveBlock: decorateAttrsTrailer,
    afterDocumentMount: options.afterDocumentMount,
  });

  return {
    dispose: (): void => mount.dispose(),
    setReadonly: (readonly: boolean): void => mount.setReadonly(readonly),
    needsRefresh: isStale,
    getSelection: (): { readonly from: number; readonly to: number } | undefined => mount.getSelection(),
    revealRange: (from: number, to?: number): void => mount.revealRange(from, to),
  };
}
