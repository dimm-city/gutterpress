/**
 * The manifest spellings 0.11.23 replaced, read for this release only so a
 * book written for 0.11.22 still builds. Every old key found is translated
 * to its new spelling (or dropped, when nothing replaces it) and named in ONE
 * notice. Book setup writes the new spelling of a threshold when it saves
 * (`rewriteOldThresholds`). Delete this module, its call in
 * `loadManifestWithPath` and the two calls of `rewriteOldThresholds`
 * (manifest-config.ts, page-size.ts) in the release after 0.11.23.
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
 *   validate.pdf.forbidTransparency  -> the matching check, on or off; a level
 *                                       the same book set for it is kept
 *   ink.*, page.tolerance and the
 *   validate.assets / pdf /
 *   heuristics thresholds            -> an option of their check:
 *                                       checks: { <id>: { <option>: value } }
 *                                       (lib/check-options.ts)
 *   validate.source.<tool>: <path>   -> dropped: the config file is found by
 *                                       its usual name in the book's folder
 *                                       or a folder above it
 *   validate.enabled, lint.configPath
 *   and the keys 0.11.22 already
 *   ignored                          -> dropped
 */
import { isMap, type Document } from "yaml";
import type { CheckEntry, CheckLevelInput, GutterpressManifest } from "../schema/manifest.types";
import { UsageError } from "./cli-args";
import { optionForOldSpelling, setCheckOption } from "./check-options";
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

/** How a translated option is named in the notice: `checks: { id: { option: value } }`. */
const optionSpelling = (id: string, option: string, value: unknown): string =>
  `checks: { ${id}: { ${option}: ${JSON.stringify(value)} } }`;

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
  const levels: Record<string, CheckLevelInput> = {};
  const options: Record<string, Record<string, unknown>> = {};

  /** An old threshold key (`ink.maxTac`) -> its check's option, or dropped when it is not one. */
  const threshold = (at: string, value: unknown): void => {
    const moved = optionForOldSpelling(at);
    if (!moved) {
      dropped.push(at);
    } else if (value !== null && value !== undefined) {
      (options[moved.id] ??= {})[moved.option] = value;
      renamed.push(`${at} -> ${optionSpelling(moved.id, moved.option, value)}`);
    }
  };

  if (isObject(source) && "files" in source) {
    renamed.push("source.files -> chapters");
    if (manifest.chapters === undefined) manifest.chapters = source.files ?? null;
  }

  // The level each check had in 0.11.22: `validate.checks` set it, and the
  // runner then applied `lint.rules` over it.
  if (isObject(validate)) {
    for (const [id, entry] of Object.entries(validate.checks ?? {})) {
      if (entry === false || (isObject(entry) && entry.enabled === false)) levels[id] = "off";
      else if (isObject(entry) && typeof entry.severity === "string") levels[id] = entry.severity as CheckLevelInput;
      else levels[id] = "on";
    }
    if (validate.checks !== undefined) renamed.push("validate.checks -> checks");
  }
  if (isObject(lint)) {
    for (const [id, level] of Object.entries(lint.rules ?? {})) levels[id] = level;
    if (lint.rules !== undefined) renamed.push("lint.rules -> checks");
    if (lint.enabled === false) {
      levels["source.stylelint"] = "off";
      renamed.push("lint.enabled: false -> checks: { source.stylelint: off }");
    } else if (lint.enabled !== undefined) {
      dropped.push("lint.enabled");
    }
    if (lint.configPath !== undefined) dropped.push("lint.configPath");
  }

  if (isObject(validate)) {
    for (const [tool, value] of Object.entries(validate.source ?? {})) {
      const id = SOURCE_TOOL_CHECKS[tool];
      if (id && value === false) {
        levels[id] = "off";
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
          // A flag set off meant the check found nothing, whatever its level.
          // Set on, it ran at the level `validate.checks` / `lint.rules` gave
          // it, so that level stays (#483).
          const on = value === flag.trueMeansOn;
          if (!on) levels[flag.check] = "off";
          else levels[flag.check] ??= "on";
          renamed.push(`validate.${block}.${key}: ${value} -> checks: { ${flag.check}: ${String(levels[flag.check])} }`);
        } else {
          threshold(`validate.${block}.${key}`, value);
        }
      }
    }
    if (validate.enabled !== undefined) {
      dropped.push("validate.enabled (`gutterpress build --skip-pre-validate --skip-post-validate` skips validation for one build)");
    }
  }

  if (isObject(ink)) {
    for (const [key, value] of Object.entries(ink)) threshold(`ink.${key}`, value);
  } else if (ink !== undefined && ink !== null) {
    dropped.push("ink");
  }

  if (tolerance) {
    const { tolerance: value, ...page } = raw.page!;
    manifest.page = page;
    threshold("page.tolerance", value);
  }

  const ids = new Set([...Object.keys(levels), ...Object.keys(options)]);
  if (ids.size > 0) {
    const checks: Record<string, CheckLevelInput | CheckEntry> = { ...manifest.checks };
    for (const id of ids) checks[id] = mergeEntry(levels[id], options[id], manifest.checks?.[id]);
    manifest.checks = checks;
  }

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

/**
 * One check's entry from its translated level and options, under what the
 * manifest's own `checks:` already says for it: the new spelling wins, field
 * by field (its level over the old level, its options over the old ones).
 */
function mergeEntry(
  level: CheckLevelInput | undefined,
  options: Record<string, unknown> | undefined,
  own: CheckLevelInput | CheckEntry | undefined,
): CheckLevelInput | CheckEntry {
  const ownEntry: CheckEntry = isObject(own) ? (own as CheckEntry) : own === undefined ? {} : { level: own as CheckLevelInput };
  const merged: CheckEntry = {
    ...(level !== undefined ? { level } : {}),
    ...options,
    ...ownEntry,
  };
  if (ownEntry.level === undefined && level !== undefined) merged.level = level;
  const keys = Object.keys(merged);
  return keys.length === 1 && keys[0] === "level" ? merged.level! : merged;
}

/**
 * Book setup's save: move every 0.11.22 threshold key in a manifest Document
 * (`ink.maxTac`, `validate.pdf.minImageResolution`, `page.tolerance`, …) to
 * its check's option, the way `setManifestFields` moves `source.files` to
 * `chapters`. An option the new spelling already sets keeps its value; a
 * block left empty goes. Every other key stays as written.
 */
export function rewriteOldThresholds(doc: Document): void {
  const blocks: string[][] = [["ink"], ["page"], ["validate", "assets"], ["validate", "pdf"], ["validate", "heuristics"]];
  for (const block of blocks) {
    const node = doc.getIn(block, true);
    if (!isMap(node)) continue;
    for (const item of [...node.items]) {
      const key = String((item.key as { value?: unknown })?.value ?? item.key);
      const moved = optionForOldSpelling([...block, key].join("."));
      if (!moved) continue;
      const value = doc.getIn([...block, key]);
      if (value !== null && value !== undefined && doc.getIn(["checks", moved.id, moved.option]) === undefined) {
        setCheckOption(doc, moved.id, moved.option, value);
      }
      node.delete(key);
    }
  }
  for (const block of [...blocks, ["validate"]]) {
    const node = doc.getIn(block, true);
    if (isMap(node) && node.items.length === 0) doc.deleteIn(block);
  }
}
