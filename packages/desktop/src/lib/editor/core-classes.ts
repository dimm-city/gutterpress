/**
 * core-classes — the `gp-*` classes an author may write by hand, with a
 * one-line description each, for class autocomplete and the Block properties
 * dialog.
 *
 * The vocabulary is core's: `GUTTERPRESS_CSS` / `GP_CLASSES` in
 * `packages/cli/src/lib/markdown/gutterpress-css.ts`. This module mirrors the
 * names the same way `image-classes.ts` does and is held to core by the same
 * kind of drift gate (`tests/editor/core-classes.test.ts`): every class here
 * must exist in core, and every core class must be either listed here or named
 * in {@link CORE_CLASSES_NOT_OFFERED} with the reason an author does not type it.
 *
 * PWA-clean and Svelte-free (CLAUDE.md §8): data only.
 */

/** Where a class is typed, so autocomplete can put the likely ones first. */
export type CoreClassScope =
  /** On an image: `![alt](src){.gp-right}`. */
  | "image"
  /** On a marker line or any element: `@section .gp-no-break`. */
  | "any";

export interface CoreClass {
  /** The class without its dot. */
  class: string;
  /** One line, shown beside the class in the completion list and the dialog. */
  description: string;
  scope: CoreClassScope;
}

export const CORE_CLASSES: readonly CoreClass[] = [
  // Fragmentation: the two a section or card reaches for.
  { class: "gp-no-break", scope: "any", description: "Keep this block whole: it moves to the next page rather than splitting" },
  { class: "gp-break-before", scope: "any", description: "Start this block on a new page" },
  // Flow positions.
  { class: "gp-left", scope: "image", description: "Float left; text wraps around it" },
  { class: "gp-right", scope: "image", description: "Float right; text wraps around it" },
  { class: "gp-center", scope: "image", description: "Center as its own line" },
  { class: "gp-full", scope: "image", description: "Fill the page's content width" },
  { class: "gp-bleed", scope: "image", description: "Its own page, edge to edge across the sheet" },
  // Sizes and spacing.
  { class: "gp-small", scope: "image", description: "25% of the column width" },
  { class: "gp-medium", scope: "image", description: "50% of the column width" },
  { class: "gp-large", scope: "image", description: "60% of the column width" },
  { class: "gp-xl", scope: "image", description: "80% of the column width" },
  { class: "gp-xxl", scope: "image", description: "90% of the column width" },
  { class: "gp-tight", scope: "image", description: "Float clearance of 0.5em" },
  { class: "gp-loose", scope: "image", description: "Float clearance of 2em" },
  { class: "gp-shape", scope: "image", description: "Wrap text to the shape of a floated image" },
  // Pinning.
  { class: "gp-pin", scope: "image", description: "Pin to the page, centered; add an edge to move it" },
  { class: "gp-top", scope: "image", description: "With .gp-pin: pin to the top edge" },
  { class: "gp-bottom", scope: "image", description: "With .gp-pin: pin to the bottom edge" },
  { class: "gp-flush", scope: "image", description: "With .gp-pin and an edge: run to the paper's edge, past the printer's safe area (Problems warns)" },
  // Depth.
  { class: "gp-behind", scope: "image", description: "Pinned art behind the page's text" },
  { class: "gp-base", scope: "image", description: "Depth ladder: the base layer" },
  { class: "gp-raised", scope: "image", description: "Depth ladder: one layer up" },
  { class: "gp-front", scope: "image", description: "Depth ladder: the front layer" },
];

/**
 * Core classes that exist but are not offered, and why. Together with
 * {@link CORE_CLASSES} this must cover core's whole `GP_CLASSES` set.
 */
export const CORE_CLASSES_NOT_OFFERED: Readonly<Record<string, string>> = {
  "gp-columns": "emitted by @columns; authors never type it",
  "gp-columns-1": "emitted by @columns 1; authors never type it",
  "gp-columns-2": "emitted by @columns 2; authors never type it",
  "gp-columns-3": "emitted by @columns 3; authors never type it",
  "gp-columns-4": "emitted by @columns 4; authors never type it",
  "gp-columns-5": "emitted by @columns 5; authors never type it",
  "gp-page-blank": "emitted by @page blank",
  "gp-page-full-bleed": "emitted by @page full-bleed",
  "gp-page-break": "emitted by @page-break",
  "gp-column-break": "emitted by @column-break",
  "gp-continued": "emitted by @continue",
  "gp-alert": "emitted by the GFM alert feature",
  "gp-alert-title": "emitted by the GFM alert feature",
  "gp-alert-note": "emitted by the GFM alert feature",
  "gp-alert-tip": "emitted by the GFM alert feature",
  "gp-alert-important": "emitted by the GFM alert feature",
  "gp-alert-warning": "emitted by the GFM alert feature",
  "gp-alert-caution": "emitted by the GFM alert feature",
};

/** The core class that keeps a block on one page — the Block properties dialog's core "Keep together". */
export const KEEP_TOGETHER_CLASS = "gp-no-break";
