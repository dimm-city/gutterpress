/**
 * Viewer-facing DTOs (ARCH review #39) — plain data shapes returned by the
 * server routes under `src/routes/api/**`, plus a handful of app-local view
 * types (plugin manager, theme manager, style resolver, media panel, …).
 *
 * These are NOT part of the `HostServices`/`ElectronBridge`/`Platform` seam
 * (that lives in `./contract.ts`) — they are the request/response payload
 * shapes `$lib/api.ts` and its consumers use. Most mirror an equivalent type
 * in `@dimm-city/print-md` (the lib) and are defined locally here so the SPA
 * never value-imports the lib into the renderer bundle (§8 / ADR 0004).
 *
 * Pure type/interface/type-alias declarations ONLY — no runtime values, no
 * imports from `./contract` (that would create a cycle; `contract.ts` is the
 * one that imports FROM this file, not the reverse).
 */
import type { ProjectSource, ProjectCapabilities } from "@dimm-city/print-md";
import type { ConflictKind } from "./shared-types";

// ── Unsaved-changes / recovery types (#44) ────────────────────────────────────
//
// Phase-0 type stub only — no implementation in this pass. See
// docs/design/issue-44-plan.md.

/** Lifecycle of the in-app editor buffer relative to disk (#44). */
export type EditorBufferPhase = "clean" | "dirty" | "saving" | "error";

/**
 * One pending crash-recovery snapshot (#44), stored under
 * `<userData>/recovery/`. `savedAt` is epoch ms of the snapshot; `baseMtimeMs`
 * is the disk mtime the snapshot was taken against, so launch-time recovery can
 * skip entries the user has since saved or that an external edit superseded.
 */
export interface RecoveryEntry {
  filePath: string;
  recoveryPath: string;
  savedAt: number;
  baseMtimeMs: number;
}

// ── Project classification (#12, C1 repo-root sessions) ──────────────────────

/** One book (manifest-containing folder) found inside a classified repo (C1). */
export interface ProjectClassificationBook {
  /** Absolute path to the book folder. */
  path: string;
  /** Display title — the folder's basename (background-scan convention). */
  title: string;
  /** Book's path relative to the repo root, forward-slash form; "" at the repo root. */
  subPath: string;
}

/**
 * Result of classifying an opened folder (#12). `repoRoot`/`books` are
 * present only when `source` is a `local-git-folder` with discoverable
 * sibling books (C1 — repo-root sessions): the host BFS-scans the repo root
 * for manifest-containing folders so the viewer can decide which book is
 * "active" (see `project-session-controller.svelte.ts`'s
 * `resolveActiveBookDir`).
 */
export interface ProjectClassification {
  source: ProjectSource;
  capabilities: ProjectCapabilities;
  /** Repo root, present when `source.type === "local-git-folder"` (C1). */
  repoRoot?: string;
  /** Sibling books inside `repoRoot`, sorted by `subPath` (C1). */
  books?: ProjectClassificationBook[];
}

// ── Local version history (#13) ───────────────────────────────────────────────
//
// SnapshotEntry, SnapshotPage, RestoreVersionResult are IPC-shared and live in
// shared-types.ts (re-exported by contract.ts). ListSnapshotsOptions is a
// renderer-only request shape, so it stays here.

/** Paging inputs for {@link HostServices.listSnapshotsPage}. */
export interface ListSnapshotsOptions {
  /** Max entries per page (host default: 100). */
  limit?: number;
  /** Continuation cursor: the id of the previous page's LAST entry. */
  before?: string;
}

/**
 * One CSS print-safety warning (#39). Mirrors the lib's `PrintSafeWarning`
 * (packages/cli/src/lib/printsafe.ts) — defined locally so the SPA never imports
 * the lib (and its postcss/node deps) into the renderer bundle.
 */
export interface PrintSafeWarning {
  rule: string;
  severity: "error" | "warning";
  message: string;
  line: number;
  column: number;
}

/**
 * One row in the Problems panel (#28). Mirrors the lib's `CheckResult`
 * (packages/cli/src/checks/types.ts) plus a resolved absolute path — defined
 * locally so the SPA never value-imports the lib (§8 / ADR 0004).
 */
export interface ProblemEntry {
  /** Absolute path of the offending file, when the check reported one. */
  filePath?: string;
  /** Project-relative display path (falls back to the basename). */
  file?: string;
  /** 1-based line number, when known. */
  line?: number;
  column?: number;
  severity: "error" | "warning" | "info";
  message: string;
  /** Originating check id (e.g. "source.links.local-refs"). */
  source: string;
}

// ── Plugin manager (#30) ──────────────────────────────────────────────────────
//
// Mirror the lib's plugin-manager types — defined locally so the SPA never
// value-imports the lib (§8 / ADR 0004).

/** How a plugin entry is referenced in the manifest. */
export type PluginKind = "local" | "npm";

/** One configured plugin, as surfaced to the manager UI. */
export interface ProjectPluginEntry {
  /** Stable reference: the manifest `path` (local) or `name` (npm). */
  ref: string;
  /** `"local"` (file path) or `"npm"` (package name). */
  kind: PluginKind;
  /** Per-project enable flag (manifest `enabled: false` = disabled). */
  enabled: boolean;
}

/** Result of load-testing one configured plugin. */
export interface PluginValidationResult {
  ref: string;
  kind: PluginKind;
  enabled: boolean;
  /** `true` when the plugin loaded OK (or is disabled and skipped). */
  ok: boolean;
  /** The loader's fail-fast error message when `ok` is `false`. */
  error?: string;
}

/** A curated, informational plugin recommendation (NOT auto-installed). */
export interface RecommendedPlugin {
  name: string;
  /** Short plain-language feature name (the row title; `name` is demoted). */
  label?: string;
  description: string;
  /** print-md ships this plugin — "Add" enables it instantly, no install. */
  builtin?: boolean;
}

// ── Theme manager (#32) ───────────────────────────────────────────────────────
//
// Mirror the lib's theme-manager types — defined locally so the SPA never
// value-imports the lib (§8 / ADR 0004).

/** Author-friendly metadata for one theme (built-in or project). */
export interface ThemeInfo {
  /** Stable id (a built-in id, or a slug for imported/applied themes). */
  id: string;
  /** Display name. */
  name: string;
  /** Theme author, when known. */
  author?: string;
  /** One-line description. */
  description: string;
  /** `"builtin"` (embedded) or `"project"` (copied into the project). */
  kind: "builtin" | "project";
  /** Optional preview image path relative to the theme folder. */
  preview?: string | null;
}

/** Which theme to apply: a built-in id, or a project theme already on disk. */
export type ApplyThemeTarget =
  | { kind: "builtin"; id: string }
  | { kind: "project"; id: string };

// ── Theme package import (#106) ───────────────────────────────────────────────
//
// Mirror the lib's theme-import types locally so the SPA never value-imports the
// lib (§8 / ADR 0004).

/** A non-fatal issue surfaced after a successful `.zip`/`.css` theme import. */
export interface ThemeImportWarning {
  code: "print-safety" | "no-theme-json" | "unnamed-theme" | "extra-files";
  message: string;
}

/** Outcome of importing a theme from a `.zip` package or a bare `.css` file. */
export interface ThemeImportResult {
  theme: ThemeInfo;
  warnings: ThemeImportWarning[];
}

// ── Style resolver (CSS editor; audit B2/G1) ──────────────────────────────────
//
// Mirrors the lib's `ProjectStyle` (packages/cli/src/lib/style-resolver.ts) —
// defined locally so the SPA never value-imports the lib (§8 / ADR 0004).

/** One resolvable project stylesheet surfaced to the CSS-editor picker. */
export interface ProjectStyle {
  /** Absolute path to the `.css` file (the editor's open key). */
  path: string;
  /** Project-relative, "/"-separated display name (e.g. `themes/dark/theme.css`). */
  displayName: string;
  /** True when the stylesheet is in the manifest `styles:` list (the active set). */
  active: boolean;
}

// Mirrors the lib's `StyleToken` (packages/cli/src/lib/style-tokens.ts) —
// defined locally so the SPA never value-imports the lib (§8 / ADR 0004). One
// editable `:root` custom property surfaced to the guided Design panel.
// `font` = a font-family stack (curated dropdown + free text); `number` = a
// unitless number (e.g. `--leading: 1.55`) — same numeric control as `length`,
// just with no unit suffix.
export type StyleTokenKind = "color" | "length" | "text" | "font" | "number";
export interface StyleToken {
  /** The custom-property name, e.g. `--heading-color`. */
  name: string;
  /** The raw declared value, e.g. `#cc0000` or `1.5rem`. */
  value: string;
  /** Which guided control to render. */
  kind: StyleTokenKind;
  /** Human label derived from the name, e.g. "Heading color". */
  label: string;
  /** For `length`/`number`: the numeric part. */
  number?: number;
  /** For `length`: the unit (px, rem, em, …). Absent for `number`. */
  unit?: string;
}

export interface RecentFolderEntry {
  key: string;
  displayName: string;
  title: string;
  openedAt: string;
  exists: boolean;
}

export interface FavoriteEntry {
  key: string;
  displayName: string;
  title: string;
  exists: boolean;
}

/** A print-md project discovered by the background scan (#27). */
export interface DiscoveredProject {
  path: string;
  title: string;
}

// ── Advanced Setup (#14, ADR 0006 D3/D7) ──────────────────────────────────────
//
// RemoteAccessResult and ProjectRemoteDiagnosis are IPC-shared and live in
// shared-types.ts (re-exported by contract.ts). The refined ForgeKind /
// RemoteGuidanceId named aliases below give consumers more semantic type names.

/** Why a remote-access probe failed, in machine-readable form. */
export type RemoteAccessFailureReason =
  | "auth"
  | "not-found"
  | "unreachable"
  | "ssh-unsupported"
  | "insecure-transport"
  | "tls"
  | "unknown";

/** Recognized forge families, for per-provider guidance copy. */
export type ForgeKind =
  | "github"
  | "gitea"
  | "forgejo"
  | "gitlab"
  | "bitbucket"
  | "azure"
  | "generic";

/** Machine-readable next-step hint the UI maps to author copy. */
export type RemoteGuidanceId =
  | "local-only"
  | "connect-github-to-sync"
  | "https-connect-server"
  | "ready-to-sync"
  | "ssh-use-own-tools";

/**
 * Yours/theirs text for the conflict preview disclosure in ConflictChoicesDialog.
 */
export interface ConflictPreview {
  mine: string;
  theirs: string;
  kind: ConflictKind;
  isBinary: boolean;
}

/** Payload types for the image pick/copy host service (#31). */
export interface ImagePickResult {
  /** Absolute path chosen by the user, or null when cancelled. */
  filePath: string | null;
}

// ── Media panel (#47) ─────────────────────────────────────────────────────────
//
// Mirrors the lib's ImageInfo (packages/cli/src/lib/image-inspect.ts) — defined
// locally so the SPA never value-imports the lib (§8 / ADR 0004).

/** One image file found under the open project folder. */
export interface MediaImageEntry {
  /** File basename ("cover.png"). */
  name: string;
  /** Project-relative path, "/"-separated — also the markdown src to insert. */
  relPath: string;
  /** Absolute path on disk (input to thumbnails / inspection). */
  path: string;
  /** File size in bytes. */
  size: number;
  mtimeMs: number;
}

/** Header-parse result for one image (PNG/JPEG/TIFF). */
export interface MediaImageInfo {
  width: number;
  height: number;
  /** Effective DPI from metadata; 72 when the file carries no density info. */
  xDpi: number;
  yDpi: number;
  hasAlpha: boolean;
  colorSpace: "srgb" | "gray" | "cmyk" | "";
}

/** Detail-view payload: size always; `info` null for unparsed formats (SVG…). */
export interface MediaImageDetails {
  fileSize: number;
  info: MediaImageInfo | null;
}

// ── System diagnostics (Help dialog / doctor) ─────────────────────────────────
//
// Mirrors the lib's tool-probe result plus the route's added viewer/electron
// fields — defined locally so the SPA never value-imports the lib.

/** One diagnosed external tool (or the built-in-Chromium synthetic entry). */
export interface DoctorToolStatus {
  id: string;
  name: string;
  bin: string;
  found: boolean;
  path?: string;
  version?: string;
  usedBy: Array<{ feature: string; severity: "required" | "optional" }>;
  installHint: string;
}

/** Full `/api/doctor` response — system + tool diagnostics for the Help dialog. */
export interface DoctorDiagnostics {
  libVersion: string;
  viewerVersion: string;
  electronVersion: string;
  chromeVersion: string;
  platform: { os: string; arch: string; release: string; node: string };
  tools: DoctorToolStatus[];
  docsUrl: string;
}

// ── Linux AppImage application-menu integration (#119) ───────────────────────
//
// Mirrors `electron/appimage-integration.ts`'s result shapes — declared here so
// the SPA never imports host code (§8 / ADR 0004), even type-only.

/** The three fixed per-user destinations the integration manages. */
export interface AppImageIntegrationPaths {
  appImage: string;
  desktopEntry: string;
  icon: string;
}

/** `GET /api/app/appimage-integration` — supported/installed/repair state. */
export interface AppImageIntegrationStatus {
  /** Linux + packaged + running from an AppImage. The Settings action renders only when true. */
  supported: boolean;
  /** Why it is unsupported; `null` when supported. */
  reason: "not-linux" | "not-packaged" | "not-appimage" | null;
  installed: boolean;
  /** Managed files exist but are incomplete or stale — installing again repairs them. */
  needsRepair: boolean;
  /** The running process is already the managed copy. */
  runningManagedCopy: boolean;
  paths: AppImageIntegrationPaths;
}

/** `POST /api/app/appimage-integration` — the result of an install or remove. */
export interface AppImageIntegrationActionResult {
  ok: true;
  message: string;
  status: AppImageIntegrationStatus;
  /** install only — false means "launch from the menu next time to use the managed copy". */
  runningManagedCopy?: boolean;
  /** remove only — the managed files actually deleted. */
  removed?: string[];
}
