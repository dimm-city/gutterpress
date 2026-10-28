/**
 * The manifest spellings 0.11.23 replaced, read for this release only so a
 * book written for 0.11.22 still builds. Every old key found is translated
 * to its new spelling (or dropped, when nothing replaces it) and named in ONE
 * notice. Delete this module, and its call in `loadManifestWithPath`, in the
 * release after 0.11.23.
 *
 *   source.files                     -> chapters
 *   validate.checks, lint.rules      -> checks (off | on | info | warn | error)
 *   validate.source.<tool>: false    -> checks: { source.<tool>: off }
 *   lint.enabled: false              -> checks: { source.stylelint: off }
 *   validate.assets.allowAlpha,
 *   validate.assets.requireFontLicense,
 *   validate.pdf.requireBookmarks,
 *   validate.pdf.requireTocLinks,
 *   validate.pdf.requireBleed,
 *   validate.pdf.forbidTransparency  -> the matching check, on or off
 *   validate.source.<tool>: <path>   -> dropped: the config file is found by
 *                                       its usual name in the book's folder
 *                                       or a folder above it
 *   ink.*, page.tolerance,
 *   validate thresholds,
 *   validate.enabled, lint.configPath,
 *   and the keys
 *   0.11.22 already ignored           -> dropped: the preset and the publish
 *                                       target set the thresholds
 */
import type { CheckLevelInput, GutterpressManifest } from "../schema/manifest.types";
import { UsageError } from "./cli-args";
import { warnOnce } from "./presets";

type OldCheckEntry = boolean | { enabled?: boolean; severity?: string; options?: unknown };

/** The keys a pre-0.11.23 manifest may carry. */
export interface OldSpellings {
  source?: { files?: string[] | null; assets?: unknown } | null;
  lint?: { enabled?: boolean; configPath?: string | null; rules?: Record<string, CheckLevelInput> } | null;
  validate?: {
    enabled?: boolean;
    checks?: Record<string, OldCheckEntry>;
    source?: Record<string, unknown>;
    assets?: Record<string, unknown>;
    pdf?: Record<string, unknown>;
    heuristics?: Record<string, unknown>;
  } | null;
  ink?: unknown;
  page?: GutterpressManifest["page"] & { tolerance?: unknown };
}

/** `validate.source.<tool>` -> the check id that tool's config fed. */
const SOURCE_TOOL_CHECKS: Record<string, string> = {
  markdownlint: "source.markdownlint",
  htmlhint: "source.htmlhint",
  stylelint: "source.stylelint",
  cssOwnership: "source.css-ownership",
};

/** The on/off flags that only switched one check, and whether `true` meant on. */
const FLAG_CHECKS: Record<string, { check: string; trueMeansOn: boolean }> = {
  "assets.allowAlpha": { check: "asset.image.alpha-channel", trueMeansOn: false },
  "assets.requireFontLicense": { check: "asset.font.license", trueMeansOn: true },
  "pdf.requireBookmarks": { check: "pdf.nav.bookmarks", trueMeansOn: true },
  "pdf.requireTocLinks": { check: "pdf.nav.toc-links", trueMeansOn: true },
  "pdf.requireBleed": { check: "pdf.print.bleed", trueMeansOn: true },
  "pdf.forbidTransparency": { check: "pdf.print.transparency", trueMeansOn: true },
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Translate a parsed manifest's old spellings to the current ones. A key
 * written both ways keeps the new spelling. Throws for `source.assets`,
 * removed before 0.11.23 with an actionable error.
 */
export function readOldSpellings(raw: GutterpressManifest & OldSpellings): GutterpressManifest {
  const { source, lint, validate, ink, ...manifest } = raw;
  const tolerance = isObject(raw.page) && "tolerance" in raw.page;
  if (source === undefined && lint === undefined && validate === undefined && ink === undefined && !tolerance) {
    return raw;
  }

  if (isObject(source) && source.assets !== undefined) {
    throw new UsageError(
      "Manifest field `source.assets` is no longer supported — remove it.\n" +
        "  Assets are discovered from what your book actually references, so no list is needed."
    );
  }

  const renamed: string[] = [];
  const dropped: string[] = [];
  const checks: Record<string, CheckLevelInput> = {};

  if (isObject(source) && "files" in source) {
    renamed.push("source.files -> chapters");
    if (manifest.chapters === undefined) manifest.chapters = source.files ?? null;
  }

  if (isObject(validate)) {
    for (const [id, entry] of Object.entries(validate.checks ?? {})) {
      if (entry === false || (isObject(entry) && entry.enabled === false)) checks[id] = "off";
      else if (isObject(entry) && typeof entry.severity === "string") checks[id] = entry.severity as CheckLevelInput;
      else checks[id] = "on";
    }
    if (validate.checks !== undefined) renamed.push("validate.checks -> checks");

    for (const [tool, value] of Object.entries(validate.source ?? {})) {
      const id = SOURCE_TOOL_CHECKS[tool];
      if (id && value === false) {
        checks[id] = "off";
        renamed.push(`validate.source.${tool}: false -> checks: { ${id}: off }`);
      } else if (id && tool !== "stylelint" && typeof value === "string") {
        dropped.push(`validate.source.${tool} (the config file is found by its usual name in the book's folder or a folder above it)`);
      } else {
        dropped.push(`validate.source.${tool}`);
      }
    }

    for (const block of ["assets", "pdf", "heuristics"] as const) {
      for (const [key, value] of Object.entries(validate[block] ?? {})) {
        const flag = FLAG_CHECKS[`${block}.${key}`];
        if (flag && typeof value === "boolean") {
          const level = value === flag.trueMeansOn ? "on" : "off";
          checks[flag.check] = level;
          renamed.push(`validate.${block}.${key}: ${value} -> checks: { ${flag.check}: ${level} }`);
        } else {
          dropped.push(`validate.${block}.${key} (the preset and the publish target set it)`);
        }
      }
    }
    if (validate.enabled !== undefined) {
      dropped.push("validate.enabled (`gutterpress build --skip-pre-validate --skip-post-validate` skips validation for one build)");
    }
  }

  if (isObject(lint)) {
    for (const [id, level] of Object.entries(lint.rules ?? {})) checks[id] = level;
    if (lint.rules !== undefined) renamed.push("lint.rules -> checks");
    if (lint.enabled === false) {
      checks["source.stylelint"] = "off";
      renamed.push("lint.enabled: false -> checks: { source.stylelint: off }");
    } else if (lint.enabled !== undefined) {
      dropped.push("lint.enabled");
    }
    if (lint.configPath !== undefined) dropped.push("lint.configPath");
  }

  if (ink !== undefined) dropped.push("ink (the preset and the publish target set it)");

  if (tolerance) {
    const { tolerance: _, ...page } = raw.page!;
    manifest.page = page;
    dropped.push("page.tolerance (the preset sets it)");
  }

  if (Object.keys(checks).length > 0) manifest.checks = { ...checks, ...manifest.checks };

  const lines = [
    ...renamed.map((r) => `  ${r}`),
    ...dropped.map((d) => `  ${d} — no longer a setting, ignored`),
  ];
  if (lines.length > 0) {
    warnOnce(
      `old-manifest-spellings:${lines.join("|")}`,
      "[gutterpress] manifest.yaml uses spellings 0.11.23 replaced. They still work in this " +
        "release; rewrite them before the next one:\n" +
        lines.join("\n")
    );
  }
  return manifest;
}
