// ──────────────────────────────────────────────────────────────────────────
// Activity stages — pure decision logic for the app's loading indicators.
//
// Every "something is happening" surface around the preview (the first-open
// overlay, the hot-reload pill, the export pill, the start screen's continue
// card) says what is going on through ONE shape, `ActivityStage`, derived here
// from live workspace state. Kept pure (no runes, no DOM) so the wording and
// the progress mapping are unit-testable without mounting the page, the same
// split as startup-landing.ts.
// ──────────────────────────────────────────────────────────────────────────

import type { RestoreProgressEvent } from "../platform/shared-types";

export interface ActivityStage {
  /** Stable machine id — callers branch on it (e.g. which Cancel applies), never on the wording. */
  id: "opening" | "downloading" | "layout" | "finishing" | "updating" | "exporting";
  /** One plain-language line. Announced politely to assistive tech when it changes. */
  label: string;
  /** Secondary line (a package, a page count). Visual only; null when there is none. */
  detail: string | null;
  /** Known N of M (determinate bar), or null when the amount of work is unknown. */
  progress: { value: number; total: number } | null;
  /** Finished successfully — the indicator swaps its spinner for a check. */
  done?: boolean;
  /**
   * Whether Cancel still applies. Carried on the stage (not read live from the
   * controller) because a stage stays on screen for a moment after its work
   * ends: Cancel must describe the stage being shown, not the state behind it.
   */
  cancelable?: boolean;
}

/** Where the open-time extension download has got to, as the renderer tracks it. */
export interface RestoreView {
  total: number;
  /** 0-based index of the package in flight (or the last one touched). */
  index: number;
  /** `name@version` of that package. */
  spec: string;
  /** Packages finished so far (downloaded or failed). */
  completed: number;
}

/** Fold one pushed restore event into the tracked view. `end` clears it. */
export function reduceRestore(
  _previous: RestoreView | null,
  event: RestoreProgressEvent,
): RestoreView | null {
  switch (event.type) {
    case "start":
      return event.specs.length === 0
        ? null
        : { total: event.specs.length, index: 0, spec: event.specs[0]!, completed: 0 };
    case "package":
      return {
        total: event.total,
        index: event.index,
        spec: event.spec,
        completed: event.state === "downloading" ? event.index : event.index + 1,
      };
    case "end":
      return null;
  }
}

/** `@scope/name@1.2.3` -> `@scope/name 1.2.3` — how the package reads in a sentence. */
export function formatSpec(spec: string): string {
  const at = spec.lastIndexOf("@");
  return at > 0 ? `${spec.slice(0, at)} ${spec.slice(at + 1)}` : spec;
}

export interface OpenStageInput {
  busy: boolean;
  /** What the opening flow called itself ("Opening “Book”…", "Setting up your book…"). */
  busyLabel: string;
  restore: RestoreView | null;
  rendering: boolean;
  /** Pagination finished; the layout is still settling under the scrim. */
  settling: boolean;
  /** Pages laid out so far (the final count once `settling`). */
  pages: number;
}

const pagesPhrase = (n: number, suffix = "") => `${n} ${n === 1 ? "page" : "pages"}${suffix}`;

/**
 * What the open of a book is doing right now, or null when it is idle.
 * Order matters: an open in flight (download, then opening) outranks a
 * previous book's leftover render state; layout and settling follow it.
 */
export function deriveOpenStage(input: OpenStageInput): ActivityStage | null {
  if (input.busy && input.restore) {
    const { total, index, spec, completed } = input.restore;
    return {
      id: "downloading",
      label:
        total > 1
          ? `Downloading extensions (${Math.min(index + 1, total)} of ${total})…`
          : "Downloading extension…",
      detail: formatSpec(spec),
      // One package has no sub-progress to show: an empty bar for the whole
      // wait would read as stuck, so it stays a spinner.
      progress: total > 1 ? { value: completed, total } : null,
    };
  }
  if (input.busy) {
    return { id: "opening", label: input.busyLabel || "Opening your book…", detail: null, progress: null };
  }
  if (input.rendering) {
    return {
      id: "layout",
      label: "Laying out pages…",
      detail: input.pages > 0 ? pagesPhrase(input.pages, " so far") : null,
      progress: null,
    };
  }
  if (input.settling) {
    return {
      id: "finishing",
      label: "Finishing up…",
      detail: input.pages > 0 ? pagesPhrase(input.pages) : null,
      progress: null,
    };
  }
  return null;
}

/** The hot-reload stage: a save is being re-laid-out behind a visible book. */
export const UPDATING_STAGE: ActivityStage = {
  id: "updating",
  label: "Updating preview…",
  detail: null,
  progress: null,
};

/** The PDF export stage, from the export controller's own label and FSM state. */
export function exportStage(
  label: string | null,
  state: string,
): ActivityStage | null {
  if (!label) return null;
  const done = state === "success";
  return {
    id: "exporting",
    label,
    detail: null,
    progress: null,
    done,
    cancelable: !done && state !== "canceling",
  };
}
