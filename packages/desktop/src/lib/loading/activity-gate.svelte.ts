/**
 * The page's loading indicators, gated (delay + minimum visible time — see
 * delayed-value.ts). One `ActivityGate` holds the three stage streams the
 * chrome can show — opening a book, a hot-reload update, a PDF export — and
 * exposes what is currently ON SCREEN for each as plain runes the template
 * reads.
 *
 * Fed through a `use:` action instead of an effect (`$effect` is banned in
 * the SPA): `<div use:gate.track={{ open, update, exporting }}>` re-runs
 * `update` whenever the derived stages change, which is the sanctioned way to
 * run a DOM-lifetime side effect (timers) off reactive state. The action
 * element must stay mounted for the page's lifetime.
 */
import { DelayedValue, INDICATOR_TIMING, type DelayedTiming } from "./delayed-value";
import type { ActivityStage } from "./activity-stage";

export interface ActivityStages {
  open: ActivityStage | null;
  update: ActivityStage | null;
  exporting: ActivityStage | null;
  /** A book's workspace (preview pane) exists — decides where an open's card sits. */
  workspaceOpen: boolean;
}

export class ActivityGate {
  /** On screen now: the first-open / re-open overlay. */
  open = $state.raw<ActivityStage | null>(null);
  /** On screen now: the non-blocking "Updating preview…" pill. */
  update = $state.raw<ActivityStage | null>(null);
  /** On screen now: the PDF export pill. */
  exporting = $state.raw<ActivityStage | null>(null);
  /**
   * Where the current open's card sits, fixed when the open starts: centred
   * in the window when it began with no workspace (a first open), in the
   * preview pane when a book was already showing. Fixed for the whole open,
   * so the card never jumps when the workspace appears halfway through.
   */
  openOnApp = $state(false);
  private openActive = false;

  private readonly openValue: DelayedValue<ActivityStage>;
  private readonly updateValue: DelayedValue<ActivityStage>;
  private readonly exportValue: DelayedValue<ActivityStage>;

  constructor(timing: DelayedTiming = INDICATOR_TIMING) {
    this.openValue = new DelayedValue((v) => (this.open = v), timing);
    this.updateValue = new DelayedValue((v) => (this.update = v), timing);
    this.exportValue = new DelayedValue((v) => (this.exporting = v), timing);
  }

  /** `use:gate.track={stages}` — see the file header. */
  track = (_node: Element, stages: ActivityStages) => {
    const apply = (s: ActivityStages) => {
      if (s.open && !this.openActive) this.openOnApp = !s.workspaceOpen;
      this.openActive = !!s.open;
      this.openValue.set(s.open);
      this.updateValue.set(s.update);
      this.exportValue.set(s.exporting);
    };
    apply(stages);
    return {
      update: apply,
      destroy: () => {
        this.openValue.dispose();
        this.updateValue.dispose();
        this.exportValue.dispose();
      },
    };
  };
}
