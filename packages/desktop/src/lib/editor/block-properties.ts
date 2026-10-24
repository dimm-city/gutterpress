/**
 * block-properties — what the Block properties dialog offers for one marker
 * block, and how its answers become a {@link BlockChanges}.
 *
 * Core offers `.gp-no-break` ("Keep together"), a `@page-break` above, and an
 * `@columns` wrapper. Everything else is a plugin's: a class its component
 * catalog marks `modifier:`, listed under the plugin's name, so a plugin that
 * documents `.dc-avoid-split` or `.my-tight` gets a toggle with no desktop
 * change. The edit itself is `block-attrs.ts`'s.
 *
 * PWA-clean and Svelte-free (CLAUDE.md §8): data and pure functions.
 */
import type { ClassCatalogEntry } from "#lib/api.ts";
import { planBlockEdit, readBlock, type BlockChanges, type BlockInfo, type LinePatch } from "./block-attrs";
import { CORE_CLASSES, KEEP_TOGETHER_CLASS } from "./core-classes";

export interface BlockModifierOption {
  /** The class toggled on the marker line, without its dot. */
  class: string;
  label: string;
  /** One line under the label. */
  description?: string;
  /** Section the toggle sits under: "Gutterpress" or the plugin's name. */
  group: string;
  /** Shown when the plugin documents the class for other markers only. */
  hint?: string;
}

/** Everything the dialog renders for one block. */
export interface BlockPropertiesModel {
  /** Marker name without `@`. */
  marker: string;
  options: BlockModifierOption[];
  columns: BlockInfo["columns"];
}

/** The dialog's answers. Columns is a select's string: "" none, "1"–"5", or "custom" (an unrecognized count, kept). */
export interface BlockPropertiesValue {
  classes: Record<string, boolean>;
  breakBefore: boolean;
  columns: string;
}

export const CORE_GROUP = "Gutterpress";

/**
 * The class toggles for a marker: core's keep-together first, then each
 * plugin's documented modifiers (alphabetical by label within a plugin).
 * Retired and unimplemented catalog entries never reach here.
 */
export function modifierOptions(marker: string, catalog: readonly ClassCatalogEntry[]): BlockModifierOption[] {
  const keep = CORE_CLASSES.find((c) => c.class === KEEP_TOGETHER_CLASS)!;
  const options: BlockModifierOption[] = [
    { class: keep.class, label: "Keep together", description: keep.description, group: CORE_GROUP },
  ];
  const seen = new Set(options.map((o) => o.class));
  const plugin = catalog
    .filter((e) => e.modifier && e.source.kind === "extension")
    .sort((a, b) => (a.label ?? a.class).localeCompare(b.label ?? b.class));
  for (const e of plugin) {
    if (seen.has(e.class) || e.source.kind !== "extension") continue;
    seen.add(e.class);
    options.push({
      class: e.class,
      label: e.label ?? e.class,
      description: e.description,
      group: e.source.name,
      ...(e.appliesTo.length > 0 && !e.appliesTo.includes(marker)
        ? { hint: `Documented for ${e.appliesTo.map((m) => `@${m}`).join(", ")}` }
        : {}),
    });
  }
  return options;
}

export function buildModel(info: BlockInfo, catalog: readonly ClassCatalogEntry[]): BlockPropertiesModel {
  return { marker: info.name, options: modifierOptions(info.name, catalog), columns: info.columns };
}

/** The dialog's starting values, read from the block as written. */
export function initialValue(info: BlockInfo, options: readonly BlockModifierOption[]): BlockPropertiesValue {
  const columns =
    info.columns.kind !== "wrapped" ? "" : info.columns.count === null ? "custom" : String(info.columns.count);
  return {
    classes: Object.fromEntries(options.map((o) => [o.class, info.classes.includes(o.class)])),
    breakBefore: info.breakBefore,
    columns,
  };
}

/**
 * Only the facets the author actually changed. Facets left alone are omitted,
 * so confirming an unchanged dialog writes nothing and an unrelated edit never
 * touches, say, a hand-written `class=` spelling of a class the dialog shows.
 */
export function changesFrom(initial: BlockPropertiesValue, next: BlockPropertiesValue): BlockChanges {
  const changes: BlockChanges = {};
  const classes: Record<string, boolean> = {};
  for (const [cls, on] of Object.entries(next.classes)) {
    if ((initial.classes[cls] ?? false) !== on) classes[cls] = on;
  }
  if (Object.keys(classes).length > 0) changes.classes = classes;
  if (next.breakBefore !== initial.breakBefore) changes.breakBefore = next.breakBefore;
  if (next.columns !== initial.columns && next.columns !== "custom") {
    changes.columns = next.columns === "" ? null : Number(next.columns);
  }
  return changes;
}

export type BlockPropertiesOutcome =
  /** `line` of `source` is not a marker a block can be edited through. */
  | { kind: "unreadable" }
  | { kind: "cancelled" }
  /** Confirmed with nothing changed, or every change already in place. */
  | { kind: "unchanged" }
  | { kind: "error"; message: string }
  | { kind: "patch"; patch: LinePatch };

/**
 * The whole flow both entry points share (the preview's right-click menu and
 * the source editor's Alt+Enter): read the block, ask the dialog, plan the
 * smallest line patch. Applying the patch is the caller's — through the commit
 * engine for the preview, straight into the editor for the source.
 */
export async function editBlockProperties(args: {
  source: string;
  /** 0-based marker line. */
  line: number;
  catalog: readonly ClassCatalogEntry[];
  isSelfClosingMarker: (name: string) => boolean;
  prompt: (model: BlockPropertiesModel, initial: BlockPropertiesValue) => Promise<BlockPropertiesValue | null>;
}): Promise<BlockPropertiesOutcome> {
  const { source, line, catalog } = args;
  // The marker's name decides self-closing, so read it once to learn the name, then for real.
  const name = readBlock(source, line)?.name;
  if (name === undefined) return { kind: "unreadable" };
  const opts = { selfClosing: args.isSelfClosingMarker(name) };
  const info = readBlock(source, line, opts);
  if (!info) return { kind: "unreadable" };

  const model = buildModel(info, catalog);
  const initial = initialValue(info, model.options);
  const next = await args.prompt(model, initial);
  if (next === null) return { kind: "cancelled" };

  const changes = changesFrom(initial, next);
  if (Object.keys(changes).length === 0) return { kind: "unchanged" };
  const plan = planBlockEdit(source, line, changes, opts);
  if (!plan.ok) return { kind: "error", message: plan.reason };
  return plan.patch ? { kind: "patch", patch: plan.patch } : { kind: "unchanged" };
}
