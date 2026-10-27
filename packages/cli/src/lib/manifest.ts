import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parse as parseYaml, YAMLParseError } from "yaml";
import type {
  CheckLevel,
  CheckLevelInput,
  GutterpressManifest,
  PageMargin,
  ResolvedConfig,
  ExtensionConfig,
  ResolvedExtensionConfig,
} from "../schema/manifest.types";
import { isNonNegativePoints } from "../engine/shared/print-area";
import { isPathSpecifier, parseExtensionSpecifier } from "./extension-specifier";
import { resolvePreset, type VendorPreset } from "./presets";
import { overlayPreset, publishTargetFor, resolveTargets } from "./targets";
import { UsageError } from "./cli-args";
import { TWO_VERSIONS_OPEN } from "./two-versions-markers";
import { readOldSpellings } from "./manifest-old-spellings";

/**
 * The manifest file name Gutterpress recognizes.
 * Single source of truth — any code that needs to find/match a manifest file
 * (project scanning, GitHub repo book discovery, …) should consume this
 * instead of hardcoding the names.
 */
export const MANIFEST_FILENAMES = [
  "manifest.yaml",
] as const;

/** True when a directory contains any recognized project manifest file. */
export function hasProjectManifest(dir: string): boolean {
  return MANIFEST_FILENAMES.some((name) => {
    const candidate = resolve(dir, name);
    try {
      return statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * Load a recognized manifest from a given path or CWD.
 * Returns an empty object if the file doesn't exist.
 */
export async function loadManifest(
  pathOrDir?: string
): Promise<GutterpressManifest> {
  // Thin wrapper over loadManifestWithPath — the candidate-resolution loop
  // lives there; callers that don't need the directory use this.
  const { manifest } = await loadManifestWithPath(pathOrDir);
  return manifest;
}

/**
 * Load a recognized manifest and return its contents, directory, and resolved path.
 * Returns an empty manifest, a null path, and the current working directory if none is found —
 * UNLESS `explicit` is set (PR #98): a caller that resolved
 * `pathOrDir` from a user-supplied `--manifest` flag (as opposed to a project
 * directory being scanned for a manifest that may legitimately not exist) must
 * pass `{ explicit: true }` so a missing/typo'd path throws instead of
 * silently resolving to an empty manifest whose `manifestDir` is the
 * nonexistent path itself, which later path resolution would then build
 * beneath.
 */
export async function loadManifestWithPath(
  pathOrDir?: string,
  opts?: { explicit?: boolean }
): Promise<{
  manifest: GutterpressManifest;
  manifestDir: string;
  manifestPath: string | null;
}> {
  const candidates = pathOrDir
    ? [resolve(pathOrDir), ...MANIFEST_FILENAMES.map((name) => resolve(pathOrDir, name))]
    : MANIFEST_FILENAMES.map((name) => resolve(name));

  for (const p of candidates) {
    if (existsSync(p) && statSync(p).isFile()) {
      const raw = await readFile(p, "utf8");
      // A sync that found a setting edited both here and online leaves both
      // versions in the file (`remote-auth/converge-merge.ts`). That is not
      // "invalid YAML at line 1": say what happened and what to do.
      if (raw.split(/\r?\n/).includes(TWO_VERSIONS_OPEN)) {
        throw new UsageError(
          `"${p}" has two versions of a setting — yours and the online version — left by a sync. Open it, keep the one you want and delete the marker lines.`
        );
      }
      try {
        const parsed = (parseYaml(raw) as GutterpressManifest | null) ?? {};
        return { manifest: readOldSpellings(parsed), manifestDir: dirname(p), manifestPath: p };
      } catch (error) {
        if (!(error instanceof YAMLParseError)) throw error;
        const position = error.linePos?.[0];
        const location = position
          ? ` at line ${position.line}, column ${position.col}`
          : "";
        const summary = (error.message.split("\n", 1)[0] ?? error.message).replace(
          /\s+at line \d+, column \d+:?$/,
          ""
        );
        throw new UsageError(`Invalid YAML in "${p}"${location}: ${summary}`);
      }
    }
  }

  if (opts?.explicit && pathOrDir !== undefined) {
    throw new UsageError(
      `manifest not found: ${pathOrDir}. Pass an existing file or a directory containing ${MANIFEST_FILENAMES.join(" or ")}.`
    );
  }

  // If no manifest found, return empty manifest and the input dir or cwd
  const manifestDir = pathOrDir ? resolve(pathOrDir) : resolve('.');
  return { manifest: {}, manifestDir, manifestPath: null };
}

const EXTENSION_ENTRY_KEYS = new Set(["use", "export", "options", "enabled"]);

/**
 * Normalize one `extensions:` entry (#265): a bare specifier string, or the
 * object form `{ use, export?, options?, enabled? }`. The specifier's FORM
 * says what it is (`extension-specifier.ts`); the resolved shape keeps
 * `path`/`name`/`version` apart for the loader, plus `use` as written.
 */
function normalizeExtensionEntry(
  entry: string | ExtensionConfig,
  index: number
): ResolvedExtensionConfig {
  const where = `extensions[${index}]`;
  let use: string;
  let rest: ExtensionConfig | undefined;
  if (typeof entry === "string") {
    use = entry;
  } else if (entry && typeof entry === "object") {
    const obj = entry as unknown as Record<string, unknown>;
    if ("priority" in obj) {
      throw new UsageError(
        `${where}: \`priority\` was removed — the \`extensions:\` list order is the load order. ` +
          "An entry later in the list is registered later, sees earlier entries' output, and its " +
          "CSS wins ties; move the entry instead."
      );
    }
    if ("path" in obj || "name" in obj) {
      throw new UsageError(
        `${where}: an \`extensions\` entry carries its specifier in \`use:\` — write ` +
          `\`use: ${String(obj.path ?? obj.name)}\` (or just the bare string).`
      );
    }
    const unknown = Object.keys(obj).filter((k) => !EXTENSION_ENTRY_KEYS.has(k));
    if (unknown.length > 0) {
      throw new UsageError(
        `${where}: unknown key(s) ${unknown.map((k) => `\`${k}\``).join(", ")} — an entry takes ` +
          "`use`, `options`, `export`, `enabled`."
      );
    }
    if (typeof obj.use !== "string" || !obj.use.trim()) {
      throw new UsageError(`${where}: an object entry needs \`use: <specifier>\`.`);
    }
    use = obj.use;
    rest = entry;
  } else {
    throw new UsageError(`${where}: expected a specifier string or an object with \`use:\`.`);
  }
  let parsed;
  try {
    parsed = parseExtensionSpecifier(use);
  } catch (error) {
    throw new UsageError(`${where}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    use: use.trim(),
    ...(parsed.kind === "path" ? { path: parsed.path } : { name: parsed.name }),
    ...(parsed.kind === "npm" && parsed.version ? { version: parsed.version } : {}),
    ...(rest?.export ? { export: rest.export } : {}),
    options: rest?.options ?? {},
  };
}

/**
 * The rewrite for a manifest that still carries `plugins:` — the author's
 * own entries, spelled the new way, in the order they used to load.
 */
function pluginsRemovedMessage(raw: unknown): string {
  const specifierOf = (s: string): string =>
    isPathSpecifier(s) || s.startsWith("@") || !/[\\/]/.test(s) ? s : `./${s}`;
  const priorityOf = (e: unknown): number =>
    e && typeof e === "object" && typeof (e as { priority?: unknown }).priority === "number"
      ? (e as { priority: number }).priority
      : 100;
  const entries = Array.isArray(raw) ? [...raw] : [];
  entries.sort((a, b) => priorityOf(b) - priorityOf(a));
  const lines: string[] = [];
  for (const e of entries) {
    if (typeof e === "string") {
      lines.push(`  - ${specifierOf(e)}`);
      continue;
    }
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const spec =
      typeof o.path === "string"
        ? specifierOf(o.path)
        : typeof o.name === "string"
          ? `${o.name}${typeof o.version === "string" ? `@${o.version}` : ""}`
          : "<specifier>";
    const extra = ["export", "options", "enabled"].filter(
      (k) => k in o && (k !== "enabled" || o[k] === false)
    );
    if (extra.length === 0) {
      lines.push(`  - ${spec}`);
      continue;
    }
    lines.push(`  - use: ${spec}`);
    for (const k of extra) {
      lines.push(`    ${k}: ${k === "options" ? JSON.stringify(o[k]) : String(o[k])}`);
    }
  }
  return (
    "Manifest field `plugins` was replaced by `extensions` — one list of bare specifiers in " +
    "load order (no `path:`/`name:` wrappers, no `priority`; a later entry loads later and " +
    "its CSS wins ties). Rewrite it as:" + "\n" +
    "extensions:" + "\n" +
    (lines.length > 0 ? lines.join("\n") : "  - ./plugins/my-plugin.js")
  );
}

type PlainObject = Record<string, unknown>;

/** Recursion helper's "every nested plain object stays optional too" type. */
type DeepPartial<T> = T extends PlainObject
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

function isPlainObject(v: unknown): v is PlainObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Recursively merge a "closed shape" nested config object — cli overrides
 * manifest overrides preset, leaf-by-leaf, at any depth (e.g.
 * `page.margin.top`). Keys always come from `preset`'s own shape, NOT the
 * union with `cli`/`manifest`, so a key the manifest type happens to carry
 * alongside real ones but `preset` (and `ResolvedConfig`) doesn't declare can
 * never leak into the resolved result; the spellings an older manifest used
 * are translated where it is read (manifest-old-spellings.ts).
 *
 * A leaf value (anything that isn't a plain object — string, number,
 * boolean, array, or `null`) resolves with `??` precedence: the first of
 * (cli, manifest, preset) that isn't `null`/`undefined` wins. `??` is also
 * the right behavior for `styles`: a manifest author who writes `styles:`
 * with nothing under it gets `null` from the yaml parser, and that must fall
 * through to `resolveActiveStyles`'s own discovery, not crash trying to
 * `.filter()` a `null`.
 *
 * `checks` — an OPEN dictionary keyed by check or rule id, where a manifest
 * can introduce ids the preset never declared — is intentionally NOT run
 * through this (a closed-shape merge would silently drop custom check ids); it
 * keeps its own one-line `{...preset, ...manifest, ...cli}` union merge in
 * `resolveConfig`.
 */
function mergeShape<T extends PlainObject>(
  cli: DeepPartial<T> | null | undefined,
  manifest: DeepPartial<T> | null | undefined,
  preset: T
): T {
  const out: PlainObject = {};
  for (const key of Object.keys(preset)) {
    const presetValue = preset[key];
    const manifestValue = manifest ? (manifest as PlainObject)[key] : undefined;
    const cliValue = cli ? (cli as PlainObject)[key] : undefined;
    out[key] = isPlainObject(presetValue)
      ? mergeShape(
          cliValue as PlainObject | undefined,
          manifestValue as PlainObject | undefined,
          presetValue
        )
      : cliValue ?? manifestValue ?? presetValue;
  }
  return out as T;
}

/** A BCP 47 tag: a 2–3 letter language, then optional subtags (`de-CH`, `zh-Hant-TW`). */
const LANGUAGE_TAG = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

function resolveLanguage(value: unknown): string {
  if (value === undefined) return "en";
  if (typeof value !== "string" || !LANGUAGE_TAG.test(value)) {
    throw new UsageError(
      `Manifest field \`language\` must be a language tag such as "en", "de" or "pt-BR", got ${JSON.stringify(value)}.`
    );
  }
  return value;
}

/**
 * Merge CLI args > manifest > preset defaults into a fully-resolved config.
 * Any field explicitly set in `cliOverrides` wins, then manifest, then preset.
 */
export function resolveConfig(
  cliOverrides: Partial<GutterpressManifest>,
  manifest: GutterpressManifest
): ResolvedConfig {
  const presetName = cliOverrides.preset ?? manifest.preset;
  return resolveWithPreset(cliOverrides, manifest, resolvePreset(presetName));
}

/**
 * Resolve the config AS ONE PUBLISH TARGET SEES IT (ADR 0008): the target's
 * policy overlay is merged onto the preset before the manifest merges over
 * both, giving the single precedence chain cli > manifest > target > preset.
 * The author's explicit manifest values always beat the target's policy —
 * the same sovereignty rule presets follow.
 */
export function resolveConfigForTarget(
  cliOverrides: Partial<GutterpressManifest>,
  manifest: GutterpressManifest,
  targetId: string
): ResolvedConfig {
  const presetName = cliOverrides.preset ?? manifest.preset;
  const preset = resolvePreset(presetName);
  return resolveWithPreset(cliOverrides, manifest, overlayPreset(preset, publishTargetFor(targetId)));
}

/**
 * `custom` supplies no geometry, so the manifest (or CLI) must: width and
 * height in points are required (the page-size check allows the same 0.5pt
 * the other presets do). The error
 * names exactly what to add — this is the contract that makes
 * `preset: custom` safe to offer non-technical authors.
 */
function resolveCustomPage(
  c: Partial<GutterpressManifest>,
  m: GutterpressManifest
): ResolvedConfig["page"] {
  const width = c.page?.width ?? m.page?.width;
  const height = c.page?.height ?? m.page?.height;
  const missing = [
    width === undefined ? "page.width" : null,
    height === undefined ? "page.height" : null,
  ].filter((f): f is string => f !== null);
  if (missing.length > 0) {
    throw new UsageError(
      `preset: custom requires ${missing.join(" and ")} in manifest.yaml ` +
        "(points; 72pt = 1in). Example for US Letter:\n" +
        "  page:\n    width: 612\n    height: 792"
    );
  }
  return {
    width: width!,
    height: height!,
    tolerance: 0.5,
    bleed: c.page?.bleed ?? m.page?.bleed,
    safe: c.page?.safe ?? m.page?.safe,
    artSafe: c.page?.artSafe ?? m.page?.artSafe,
    gutter: c.page?.gutter ?? m.page?.gutter,
    margin: c.page?.margin ?? m.page?.margin,
  };
}

/** The edges of `page.margin`, in the order they are shown and written. */
export const MARGIN_EDGES = ["top", "bottom", "inside", "outside"] as const;

/**
 * The one rule for a legal `page.margin`, applied to a manifest as it is
 * resolved and to a margin Book setup is about to write: all four edges or
 * nothing (a partial block would leave the missing edges to whatever a
 * stylesheet says, the two-places split the field exists to end), each a
 * finite point value of 0 or more, and the four leaving room for text on the
 * page. Returns the margin typed, or throws the message both callers show.
 */
export function validatePageMargin(margin: unknown, size: { width: number; height: number }): PageMargin {
  const edges =
    isPlainObject(margin) &&
    Object.keys(margin).every((k) => (MARGIN_EDGES as readonly string[]).includes(k)) &&
    MARGIN_EDGES.every((e) => isNonNegativePoints(margin[e]));
  if (!edges) {
    throw new UsageError(
      "Manifest field `page.margin` must set all four edges in points (72pt = 1in), for example\n" +
        "  page:\n    margin:\n      top: 54\n      bottom: 54\n      inside: 54\n      outside: 54\n" +
        `got ${JSON.stringify(margin)}.`
    );
  }
  const m = margin as unknown as PageMargin;
  if (m.inside + m.outside >= size.width || m.top + m.bottom >= size.height) {
    throw new UsageError(
      `Manifest field \`page.margin\` leaves no room for text on a ${size.width} x ${size.height}pt page ` +
        `(inside ${m.inside} + outside ${m.outside} across, top ${m.top} + bottom ${m.bottom} down).`
    );
  }
  return m;
}

function resolveWithPreset(
  cliOverrides: Partial<GutterpressManifest>,
  manifest: GutterpressManifest,
  preset: VendorPreset
): ResolvedConfig {

  const m = manifest;
  const c = cliOverrides;

  // `output:` is gone entirely (not merely ignored): the output location is a
  // convention (lib/output-paths.ts). A manifest that still carries it gets
  // one actionable error rather than silently building to a place the author
  // no longer controls. (`source.assets` is refused where the old spellings
  // are read, manifest-old-spellings.ts.)
  if ((m as { output?: unknown }).output !== undefined) {
    throw new UsageError(
      "Manifest field `output` is no longer supported — remove it.\n" +
        "  Output goes to `dist/<title-slug>/` automatically (use `--out` for a one-off location)."
    );
  }

  // `engine:` and `engineStyles:` are gone (#266). The Gutterpress engine is
  // the only engine, so a switch had nothing to select; and `engineStyles.
  // native` only ever appended to `styles:` — list position says the same
  // thing. Each gets one actionable error, like `output` above, rather than
  // a schema complaint about an unknown key.
  const removed = m as { engine?: unknown; engineStyles?: unknown };
  if (removed.engine !== undefined) {
    throw new UsageError(
      "Manifest field `engine` was removed — delete it. The Gutterpress engine " +
        "(native Chromium pagination) is the only engine, so there is nothing to select."
    );
  }
  if (removed.engineStyles !== undefined) {
    throw new UsageError(
      "Manifest field `engineStyles` was removed — move its entries to the END of " +
        "`styles:`. They were always loaded last; their place in that list is the " +
        "only thing the field ever expressed."
    );
  }

  // `plugins:` was replaced by `extensions:` (#265) — one actionable error
  // carrying the author's own entries rewritten, not a schema complaint.
  const legacyPlugins = (m as { plugins?: unknown }).plugins;
  if (legacyPlugins !== undefined) {
    throw new UsageError(pluginsRemovedMessage(legacyPlugins));
  }
  // A mistyped `lastPage` would otherwise silently stop reserving the page.
  const lastPage = c.print?.lastPage ?? m.print?.lastPage;
  if (lastPage !== undefined && lastPage !== "blank" && lastPage !== "short-by-one") {
    throw new UsageError(
      `Manifest field \`print.lastPage\` must be "blank" or "short-by-one", got ${JSON.stringify(lastPage)}.`
    );
  }
  // A mistyped `pdfx.transparency` would otherwise silently keep the default.
  const transparency = c.pdfx?.transparency ?? m.pdfx?.transparency;
  if (transparency !== undefined && transparency !== "flatten-page" && transparency !== "preserve-text") {
    throw new UsageError(
      `Manifest field \`pdfx.transparency\` must be "flatten-page" or "preserve-text", got ${JSON.stringify(transparency)}.`
    );
  }
  const flattenPages = c.pdfx?.flattenPages ?? m.pdfx?.flattenPages;
  if (
    flattenPages !== undefined &&
    !(Array.isArray(flattenPages) && flattenPages.every((n) => Number.isInteger(n) && n >= 1))
  ) {
    throw new UsageError(
      `Manifest field \`pdfx.flattenPages\` must be a list of page numbers (1, 2, …), got ${JSON.stringify(flattenPages)}.`
    );
  }
  const rasterDpi = c.pdfx?.rasterDpi ?? m.pdfx?.rasterDpi;
  if (rasterDpi !== undefined && !(Number.isInteger(rasterDpi) && rasterDpi >= 72 && rasterDpi <= 1200)) {
    throw new UsageError(
      `Manifest field \`pdfx.rasterDpi\` must be a whole number from 72 to 1200, got ${JSON.stringify(rasterDpi)}.`
    );
  }
  // Extensions, in manifest order — which IS the load order and the cascade
  // order; nothing re-sorts them. An entry with `enabled: false` (#30) stays
  // in the manifest but is skipped here so it is never loaded.
  const rawExtensions = c.extensions ?? m.extensions ?? [];
  if (!Array.isArray(rawExtensions)) {
    throw new UsageError("Manifest field `extensions` must be a list of specifiers.");
  }
  const extensions = rawExtensions
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => typeof entry === "string" || (entry as ExtensionConfig)?.enabled !== false)
    .map(({ entry, index }) => normalizeExtensionEntry(entry, index));

  const page = preset.page ? mergeShape(c.page, m.page, preset.page) : resolveCustomPage(c, m);
  if (page.margin !== undefined && page.margin !== null) validatePageMargin(page.margin, page);

  return {
    title: c.title ?? m.title ?? "Document",
    authors: c.authors ?? m.authors ?? [],
    language: resolveLanguage(c.language ?? m.language),
    preset: preset.id,
    spec: preset.spec,
    // No preset fallback here — resolveActiveStyles (style-resolver.ts)
    // is the single source of default-stylesheet truth (styles/book.css, else
    // the first discovered .css, else []). Baking a preset default in here
    // would defeat that documented fallback chain on every real render path.
    styles: c.styles ?? m.styles,
    extensions,
    targets: resolveTargets(c.targets ?? m.targets, preset.defaultTargets),
    chapters: c.chapters ?? m.chapters ?? preset.chapters,
    // An open dictionary keyed by check or rule id: merged key by key, the
    // preset's (and the target's) levels first, then the manifest's, then
    // the CLI's.
    checks: { ...preset.checks, ...resolveCheckLevels(m.checks), ...resolveCheckLevels(c.checks) },
    pdfx: mergeShape(c.pdfx, m.pdfx, preset.pdfx),
    // `book` defaults to signature: 1 = no padding (postprocess only pads
    // when > 1). `dtrpg` defaults to signature 4 + reserveLastPage so the
    // interior ends on a blank page, which DriveThruRPG reserves for printer info.
    // `print.lastPage` (blank | short-by-one) is absent from both presets: it
    // only exists when an author writes it, and then wins over reserveLastPage.
    print: mergeShape(c.print, m.print, preset.print),
    page,
    // The thresholds are the preset's and the publish target's: a printer's
    // specification, not a book's choice. A book changes a check's level.
    ink: structuredClone(preset.ink),
    validate: structuredClone(preset.validate),
  };
}

/**
 * Read a manifest's (or the CLI's) `checks:` map: `off` / `false` switch a
 * check or rule off, `on` / `true` switch it on at its own severity, and
 * `info`, `warn` (or `warning`) and `error` set the severity its findings
 * are reported at. Anything else is a usage error naming the entry, so a
 * typo never silently does nothing.
 */
function resolveCheckLevels(input: Record<string, CheckLevelInput> | undefined): Record<string, CheckLevel> {
  if (input === undefined || input === null) return {};
  if (!isPlainObject(input)) {
    throw new UsageError("Manifest field `checks` must map check ids to off, on, info, warn or error.");
  }
  const out: Record<string, CheckLevel> = {};
  for (const [id, value] of Object.entries(input)) {
    if (value === false || value === "off") out[id] = "off";
    else if (value === true || value === "on") out[id] = "on";
    else if (value === "warn" || value === "warning") out[id] = "warning";
    else if (value === "info" || value === "error") out[id] = value;
    else {
      throw new UsageError(
        `Manifest field \`checks.${id}\` must be off, on, info, warn or error, got ${JSON.stringify(value)}.`
      );
    }
  }
  return out;
}
