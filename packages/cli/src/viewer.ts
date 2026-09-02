/**
 * gutterpress/viewer — the on-screen pagination engine, as a library.
 *
 * The same code the preview book frame runs (`src/engine/viewer`, bundled to
 * `gutterpress-viewer.js` for that frame) exposed as an importable subpath so
 * a host can paginate a flow root it owns — the desktop's paged editor
 * fragments the live editor document with THIS engine, which is what makes
 * the editor's on-screen pages identical to the preview's.
 *
 * Browser-only and node-free by construction (§1/§8, same rule as
 * `gutterpress/render`): `scripts/check-render-pure.mjs` gates it.
 */
export {
  fragmentDocument,
  paginate,
  injectBreakMapping,
  applySpreadMode,
  injectViewerCss,
  spreadModeSupported,
  pageOf,
  pageRangeOf,
  PX_PER_PT,
} from "./engine/viewer/fragment.ts";
export type {
  LayoutOptions,
  LayoutResult,
  StripInfo,
  GutterpressViewerApi,
} from "./engine/viewer/fragment.ts";

export { decorate } from "./engine/viewer/decorate.ts";
export type { DecorationApi } from "./engine/viewer/decorate.ts";

export { extract } from "./engine/shared/gcpm-extract.ts";
export type { GcpmModel, PageGeometry } from "./engine/shared/gcpm-extract.ts";
