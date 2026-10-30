/**
 * The options a check takes in its `checks:` entry (#443, #483): the numbers
 * and the list it measures against. The preset and the publish target set
 * them; a book overrides one in the same entry that sets the check's level.
 *
 *   checks:
 *     pdf.print.ink-coverage: { maxTac: 300 }
 *     pdf.print.image-resolution: { level: error, minImageResolution: 200 }
 *
 * Each option lands at ONE place in the resolved config, `at`, which is what
 * the check reads (and, for `maxTac`, what the PDF/X conversion holds the ink
 * to). `at` is also how a 0.11.22 manifest spelled the option
 * (`ink.maxTac`, `validate.pdf.minImageResolution`, `page.tolerance`), so
 * manifest-old-spellings.ts translates the old keys from this same table.
 *
 * No filesystem or check-registry imports: manifest.ts resolves with it, and
 * the Book setup writers use {@link setCheckOption}.
 */
import { isMap, type Document } from "yaml";
import type { CheckLevelInput, ResolvedConfig } from "../schema/manifest.types";
import { UsageError } from "./cli-args";

/** What an option's value is: points/bytes/DPI/a count, a `{ min, max }` range, or a list of file patterns. */
type OptionKind = "number" | "range" | "patterns";

interface CheckOption {
  /** Where the value lands in the resolved config, and the 0.11.22 manifest spelling. */
  at: string;
  kind: OptionKind;
}

/** Check id -> option name -> where it lands. */
export const CHECK_OPTIONS: Readonly<Record<string, Readonly<Record<string, CheckOption>>>> = {
  "pdf.print.ink-coverage": {
    maxTac: { at: "ink.maxTac", kind: "number" },
    tacTolerance: { at: "ink.tacTolerance", kind: "number" },
  },
  "pdf.print.page-size": {
    tolerance: { at: "page.tolerance", kind: "number" },
  },
  "pdf.print.image-resolution": {
    minImageResolution: { at: "validate.pdf.minImageResolution", kind: "number" },
  },
  "pdf.print.bleed": {
    bleedSize: { at: "validate.pdf.bleedSize", kind: "number" },
  },
  "asset.image.file-size": {
    maxImageSize: { at: "validate.assets.maxImageSize", kind: "number" },
  },
  "asset.font.approved-files": {
    approvedFontFiles: { at: "validate.assets.approvedFontFiles", kind: "patterns" },
  },
  "heuristic.decoration.layer-count": {
    maxDecorativeLayers: { at: "validate.heuristics.maxDecorativeLayers", kind: "number" },
  },
  "heuristic.whitespace.text-density": {
    textDensityRange: { at: "validate.heuristics.textDensityRange", kind: "range" },
  },
  "heuristic.chunking.section-density": {
    maxParagraphsPerSection: { at: "validate.heuristics.maxParagraphsPerSection", kind: "number" },
  },
};

/** The check id and option name a 0.11.22 spelling (`ink.maxTac`) moved to, if it is one. */
export function optionForOldSpelling(at: string): { id: string; option: string } | undefined {
  for (const [id, options] of Object.entries(CHECK_OPTIONS)) {
    for (const [option, spec] of Object.entries(options)) {
      if (spec.at === at) return { id, option };
    }
  }
  return undefined;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const isAmount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const isRangeEnd = ([k, v]: [string, unknown]): boolean => (k === "min" || k === "max") && isAmount(v);

/** What a value of each kind must be, as the messages say it. */
const MUST_BE: Record<OptionKind, string> = {
  number: "a number, 0 or more",
  range: "`{ min, max }` (numbers, 0 or more)",
  patterns: "a list of file patterns",
};

function fits(kind: OptionKind, value: unknown): boolean {
  if (kind === "number") return isAmount(value);
  if (kind === "range") return isPlainObject(value) && Object.entries(value).every(isRangeEnd);
  return Array.isArray(value) && value.every((p) => typeof p === "string");
}

/** The value checked against its kind; a usage error names the entry and what it takes. */
function checked(id: string, option: string, kind: OptionKind, value: unknown): unknown {
  if (fits(kind, value)) return value;
  throw new UsageError(
    `Manifest field \`checks.${id}.${option}\` must be ${MUST_BE[kind]}, got ${JSON.stringify(value)}.`,
  );
}

/** A `checks:` level as a manifest may write it: `off`, `on`, `info`, `warn` (`warning`), `error`, or a boolean. */
export function isCheckLevelInput(value: unknown): value is CheckLevelInput {
  return typeof value === "boolean" || ["off", "on", "info", "warn", "warning", "error"].includes(value as string);
}

/**
 * A 0.11.22 threshold (`validate.heuristics.maxDecorativeLayers`) read as
 * the option it became, or undefined when the key was never a threshold.
 * 0.11.22 passed any value through, and a check given one it could not use
 * measured nothing, so a value the option cannot take is NOT an error here:
 * `mustBe` says what it should have been and the caller reports it and
 * ignores it, and a book that built in 0.11.22 still builds. A range keeps
 * whichever of `min` and `max` are numbers, as 0.11.22's merge did.
 */
export function readOldThreshold(
  at: string,
  value: unknown,
): { id: string; option: string; value?: unknown; mustBe?: string } | undefined {
  const moved = optionForOldSpelling(at);
  if (!moved) return undefined;
  const { kind } = CHECK_OPTIONS[moved.id]![moved.option]!;
  if (fits(kind, value)) return { ...moved, value };
  const kept = kind === "range" && isPlainObject(value) ? Object.entries(value).filter(isRangeEnd) : [];
  return { ...moved, ...(kept.length > 0 ? { value: Object.fromEntries(kept) } : {}), mustBe: MUST_BE[kind] };
}

/**
 * Read the options of one `checks:` entry (every key but `level`). A key the
 * check does not take is a usage error naming the ones it does, so a typo
 * never silently keeps the preset's number. A `null` value is left unset.
 */
export function readCheckOptions(id: string, entry: Record<string, unknown>): Record<string, unknown> {
  const known = CHECK_OPTIONS[id] ?? {};
  const out: Record<string, unknown> = {};
  for (const [option, value] of Object.entries(entry)) {
    if (option === "level" || value === null || value === undefined) continue;
    const spec = known[option];
    if (!spec) {
      const takes = Object.keys(known);
      throw new UsageError(
        `Manifest field \`checks.${id}\` has no option \`${option}\`. ` +
          (takes.length > 0
            ? `It takes \`level\` and ${takes.map((o) => `\`${o}\``).join(", ")}.`
            : "It takes only `level` (off, on, info, warn or error)."),
      );
    }
    out[option] = checked(id, option, spec.kind, value);
  }
  return out;
}

/**
 * Write read options into a resolved config, over the preset's and the
 * target's values. A range merges key by key, so `{ max: 4000 }` keeps the
 * preset's `min`; a list replaces the preset's whole.
 */
export function applyCheckOptions(
  config: ResolvedConfig,
  options: Record<string, Record<string, unknown>>,
): void {
  for (const [id, values] of Object.entries(options)) {
    for (const [option, value] of Object.entries(values)) {
      const spec = CHECK_OPTIONS[id]![option]!;
      const keys = spec.at.split(".");
      const leaf = keys.pop()!;
      let node = config as unknown as Record<string, unknown>;
      for (const key of keys) node = node[key] as Record<string, unknown>;
      node[leaf] = spec.kind === "range" ? { ...(node[leaf] as object), ...(value as object) } : value;
    }
  }
}

/**
 * Set one option in a manifest Document, keeping the entry's level: a bare
 * level (`warn`) becomes `{ level: warn, <option>: value }`. Used where Book
 * setup and `gutterpress new` write a check's option.
 */
export function setCheckOption(doc: Document, id: string, option: string, value: unknown): void {
  if (!isMap(doc.get("checks", true))) doc.set("checks", doc.createNode({}));
  const current = doc.getIn(["checks", id], true);
  if (!isMap(current)) {
    const level = doc.getIn(["checks", id]);
    doc.setIn(["checks", id], doc.createNode(level === undefined || level === null ? {} : { level }));
  }
  doc.setIn(["checks", id, option], value);
}
