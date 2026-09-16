/**
 * Desktop-facing DTOs (ARCH review #39) — plain data shapes the typed IPC
 * capability modules (`$lib/*-capability.ts`) return, plus a handful of
 * app-local view types (extension manager, style resolver, media panel,
 * ...).
 *
 * These are NOT part of the `HostServices`/`ElectronBridge`/`Platform` seam
 * (that lives in `./contract.ts`) — they are the request/response payload
 * shapes the capability modules and their consumers use (through SFE-P5c,
 * `src/routes/api/**`'s now-deleted `+server.ts` routes and `$lib/api.ts`'s
 * typed fetch client returned these same shapes). Most mirror an equivalent
 * type in `gutterpress` (the lib) and are defined locally here so the SPA
 * never value-imports the lib into the renderer bundle (§8 / ADR 0004).
 *
 * Pure type/interface/type-alias declarations ONLY — no runtime values, no
 * imports from `./contract` (that would create a cycle; `contract.ts` is the
 * one that imports FROM this file, not the reverse).
 */
import type { ProjectSource, ProjectCapabilities } from "gutterpress";

// ── Unsaved-changes / recovery types (#44) ────────────────────────────────────
//
// #44 has since shipped in full (EditorBuffer in editor/buffer-state.svelte.ts,
// CrashRecoveryController, the `recovery:write`/`recovery:clear`/`recovery:list`
// typed IPC channels below). `RecoveryEntry` is the live DTO those channels
// return. `EditorBufferPhase` predates that work
// and has no importers — EditorBuffer declares its own identical copy of the
// union locally instead of importing this one.

/** Lifecycle of the in-app editor buffer relative to disk (#44). Unused here —
 *  see the header note above. */
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
 * for manifest-containing folders so the desktop can decide which book is
 * "active" (see `project-session-controller.svelte.ts`'s
 * `resolveActiveBookDir`).
 */
export interface ProjectClassification {
  source: ProjectSource;
  capabilities: ProjectCapabilities;
  /** Whether the folder passed to classification contains a recognized manifest. */
  hasManifest: boolean;
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

/** Paging inputs for `vcs:listSnapshotsPage` (`ElectronBridge.vcs.listSnapshotsPage` in `contract.ts`, called from `$lib/vcs/vcs-capability.ts`). */
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

// ── Extension manager (#265) — the one rail ──────────────────────────────────
//
// Mirror the lib's extension-manager / extension-import types — defined
// locally so the SPA never value-imports the lib (§8 / ADR 0004). A look is
// an extension that carries styles; a feature is one that carries markdown;
// a component library carries both — ONE list, ONE entry shape.

/** How an `extensions:` entry resolves — the form of its specifier decides. */
export type ExtensionSourceKind = "bundled" | "path" | "npm";

/** What an extension declares it ships. */
export interface ExtensionCarries {
  markdown: boolean;
  styles: boolean;
  snippets: boolean;
  components: boolean;
}

/** One configured extension, as listed for the desktop. */
export interface ProjectExtensionEntry {
  /** The specifier exactly as written in the manifest — the stable ref every
   *  mutating call takes (`setEnabled`, `remove`, `reorder`, `readCss`). */
  use: string;
  kind: ExtensionSourceKind;
  /** Package name (bundled, npm) or the path specifier (path). */
  name: string;
  /** Exact pinned version, from the specifier, for an npm entry. */
  version?: string;
  /** Named module export selected as the plugin function. */
  export?: string;
  /** Per-project enable flag (manifest `enabled: false` = off). */
  enabled: boolean;
  /** Display name: the metadata's `name`, else the package name / folder name. */
  label: string;
  description?: string;
  author?: string;
  /** Preview image path relative to the extension folder, when declared. */
  preview?: string | null;
  /** The sheet carrying the `:root` token surface (the Design panel's
   *  target), relative to the folder, when declared. */
  tokensFile?: string;
  /** Declared stylesheets relative to the folder, in cascade order. Absent
   *  when there is no folder. */
  styles?: string[];
  /** What it declares — a styles-carrier shows in the Look view, a
   *  markdown-carrier in Features; one that carries both shows in both. */
  carries: ExtensionCarries;
  /** Absolute folder its metadata was read from. Absent for a bundled name,
   *  a bare JS file, an uninstalled npm entry, or a missing path. */
  dir?: string;
  /** Non-fatal notices: "Not installed …", "Not pinned …", "Not found: …". */
  warnings?: string[];
}

/** Result of load-testing one configured extension. */
export interface ExtensionValidationResult {
  use: string;
  kind: ExtensionSourceKind;
  /** Mirrors the manifest enable flag. Disabled extensions are not load-tested. */
  enabled: boolean;
  /** `true` when the extension loaded OK (or is disabled and skipped). */
  ok: boolean;
  /** The loader's fail-fast error message when `ok` is `false`. */
  error?: string;
}

/** A bundled markdown feature the author can turn on — "Add" writes `use`. */
export interface RecommendedExtension {
  use: string;
  /** Short plain-language feature name (the row title). */
  label: string;
  description: string;
}

/** A built-in look (embedded assets); `id` is its folder name under `extensions/` once used. */
export interface BuiltInStyleSet {
  id: string;
  name: string;
  description: string;
}

/** A non-fatal issue surfaced after a successful `.zip`/`.css`/URL import (#106). */
export interface ExtensionImportWarning {
  code: "print-safety" | "no-theme-json" | "unnamed-theme" | "extra-files";
  message: string;
}

/** Outcome of importing a look from a `.zip` package, a bare `.css` file, or a URL. */
export interface ExtensionImportResult {
  entry: ProjectExtensionEntry;
  warnings: ExtensionImportWarning[];
}

// ── Style resolver (CSS editor; audit B2/G1) ──────────────────────────────────
//
// Mirrors the lib's `ProjectStyle` (packages/cli/src/lib/style-resolver.ts) —
// defined locally so the SPA never value-imports the lib (§8 / ADR 0004).

/** One resolvable project stylesheet surfaced to the CSS-editor picker. */
export interface ProjectStyle {
  /** Absolute path to the `.css` file (the editor's open key). */
  path: string;
  /** Project-relative, "/"-separated display name (e.g. `styles/print.css`). */
  displayName: string;
  /** True when the stylesheet is in the manifest `styles:` list (the active set). */
  active: boolean;
}

// ── Templates (#29) — SFE-P5c2 ────────────────────────────────────────────
//
// Moved here from `$lib/api.ts` (its "genuinely api-local shapes" section)
// when `tpl` migrated off HTTP routes to typed IPC — these have no canonical
// twin in the lib (a starter-template listing is a desktop-only view), so
// they join the rest of this bounded context's DTOs instead of living only
// in the now-deleted `api.tpl` namespace.

/** One starter template offered by the New Project wizard. */
export interface TemplateInfo {
  id: string;
  label: string;
  description: string;
  kind: "builtin" | "custom";
  dir?: string;
  /** The `preset:` this template's manifest declares — the starting point
   *  the new-book wizard seeds its preset choice from (ADR 0008). */
  preset?: string;
  /** The `targets:` this template's manifest declares, if any. */
  targets?: string[];
}

/** {@link TemplateInfo} plus what save-as-template did with out-of-book refs. */
export interface SavedTemplateInfo extends TemplateInfo {
  /** Book-local paths the `../../shared/...` refs were vendored to (vendor mode). */
  vendoredRefs?: string[];
  /** Manifest entries dropped because they pointed outside the book (exclude mode). */
  excludedRefs?: string[];
}

// ── Snippets (#29) — SFE-P5c2 ─────────────────────────────────────────────
//
// Moved here from `$lib/api.ts` alongside `TemplateInfo` (see that section's
// note) when `snip` migrated to typed IPC.

/**
 * Where a listed snippet comes from (#242): the project's own `snippets/`
 * folder, or an installed extension's - `ref` is that extension's manifest
 * specifier, handed back to `snipReadExtension` so the host can re-locate
 * the folder itself (never a filesystem path from the renderer). Mirrors
 * the lib's `SnippetSource` by hand (CLAUDE.md section 8: no type import from `gutterpress`).
 */
export type SnippetSource = { kind: "project" } | { kind: "extension"; ref: string; name: string };

/** One reusable markdown snippet - the project's own or an extension's (see `source`). */
export interface SnippetEntry {
  name: string;
  fileName: string;
  variables: string[];
  source: SnippetSource;
}

// ── Project configuration view (#PCV) — SFE-P5c2 ──────────────────────────
//
// Moved here from `$lib/api.ts` (mirrors the lib's `ProjectConfigFields`)
// when `manifest` migrated to typed IPC — declared locally so the SPA bundle
// stays free of value imports from `gutterpress` (§8 renderer purity).

/** The author-facing manifest subset the Details section reads/writes. */
export interface ProjectConfigFields {
  title?: string;
  authors?: string[];
  /** `source.files` — null is the deliberate "all chapter files" sentinel. */
  sourceFiles?: string[] | null;
  /** `targets:` — the publish destinations this book is validated against
   *  (ADR 0008). `[]` is the explicit "no destination policies" opt-out. */
  targets?: string[];
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
  /**
   * Theme-author-curated display group, from an `@group` annotation comment
   * above the declaration (issue #244) — see `parseStyleTokens` in
   * `$lib/style-tokens` for the annotation grammar. Absent for every token in
   * a theme that carries no annotations at all, which is what keeps an
   * unannotated theme's panel identical to the pre-#244 heuristic grouping. A
   * token with `group` set is shown under that named heading instead of the
   * heuristic Fonts/Colors/Sizes/Other bucket its `kind` would otherwise put
   * it in.
   */
  group?: string;
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

/** A Gutterpress project discovered by the background scan (#27). */
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

/** One diagnostic log file the host can list (userData/logs, newest first). */
export interface LogFileEntry {
  /** File name (e.g. "my-book.log"). */
  name: string;
  /** Absolute path — feed to `$lib/app-lifecycle/app-lifecycle-capability`'s `readLog`. */
  path: string;
  /** File size in bytes. */
  sizeBytes: number;
  /** Last-modified time, ISO-8601. */
  modifiedAt: string;
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
// Mirrors the lib's tool-probe result plus the route's added desktop/electron
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

/** Full `doctor:getDiagnostics` IPC response — system + tool diagnostics for the Help dialog. */
export interface DoctorDiagnostics {
  libVersion: string;
  desktopVersion: string;
  electronVersion: string;
  chromeVersion: string;
  platform: { os: string; arch: string; release: string; node: string };
  tools: DoctorToolStatus[];
  configDir: string;
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

/** `app:appImageIntegrationStatus` typed IPC channel — supported/installed/repair state. */
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
  /** Set when the menu entry launches a DIFFERENT build than the running one. */
  staleCopy: AppImageStaleCopy | null;
  paths: AppImageIntegrationPaths;
}

/** Why the menu copy is out of date, with both sides named. */
export interface AppImageStaleCopy {
  /** `"version"`: a different app version. `"build"`: same version, different binary. */
  kind: "version" | "build";
  installedVersion: string | null;
  runningVersion: string;
}

/** Fields both `POST` actions return. */
interface AppImageIntegrationActionBase {
  ok: true;
  /** Plain-language outcome, ready to show verbatim. */
  message: string;
  /** The refreshed status, so the caller never needs a follow-up GET. */
  status: AppImageIntegrationStatus;
}

/** `POST { action: "install" }` — the result of an install or repair. */
export interface AppImageIntegrationInstallResult extends AppImageIntegrationActionBase {
  /** False means "launch it from the menu next time to use the managed copy". */
  runningManagedCopy: boolean;
}

/** `POST { action: "remove" }` — the result of a removal. */
export interface AppImageIntegrationRemoveResult extends AppImageIntegrationActionBase {
  /** The managed files actually deleted; empty when nothing was installed. */
  removed: string[];
}
