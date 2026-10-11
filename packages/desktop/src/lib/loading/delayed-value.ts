// ──────────────────────────────────────────────────────────────────────────
// DelayedValue — the timing rule shared by every loading indicator.
//
// A fast operation must not flash an indicator, and an indicator that did
// appear must not strobe off the instant its work ends. So:
//   - a value only becomes VISIBLE after it has been continuously present for
//     `delayMs` (work that finishes sooner never shows anything);
//   - once visible it stays for at least `minVisibleMs`, then clears.
// While visible, newer values replace the shown one immediately (a stage
// change should read live), and while a hide is pending the LAST value stays
// on screen rather than blanking.
//
// Plain TS with an injectable clock so the rule is unit-testable with fake
// time; the rune wrapper (delayed-value.svelte.ts) only carries the result
// into the template.
// ──────────────────────────────────────────────────────────────────────────

export interface DelayedTiming {
  /** How long work must last before an indicator appears. */
  delayMs: number;
  /** How long an indicator that appeared stays up at minimum. */
  minVisibleMs: number;
}

/** One pair for every indicator, so they all feel the same. */
export const INDICATOR_TIMING: DelayedTiming = { delayMs: 200, minVisibleMs: 500 };

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class DelayedValue<T> {
  /** The value currently on screen, or null. */
  private shown: T | null = null;
  private visible = false;
  private shownAt = 0;
  /** The freshest value fed while hidden — what a pending reveal will show. */
  private latest: T | null = null;
  /** The pending reveal (when hidden) or pending hide (when visible) — never both. */
  private timer: unknown = null;

  constructor(
    private readonly onChange: (value: T | null) => void,
    private readonly timing: DelayedTiming = INDICATOR_TIMING,
    private readonly clock: Clock = realClock,
  ) {}

  /** Feed the live value: non-null while the work is happening, null when it is not. */
  set(next: T | null): void {
    if (next !== null) {
      if (this.visible) {
        this.clearTimer(); // a pending hide is moot: the work is back
        this.show(next);
      } else if (this.timer === null) {
        this.latest = next;
        this.timer = this.clock.setTimeout(() => {
          this.timer = null;
          if (this.latest === null) return;
          this.visible = true;
          this.shownAt = this.clock.now();
          this.show(this.latest);
        }, this.timing.delayMs);
      } else {
        this.latest = next; // reveal already pending: it will show the freshest value
      }
      return;
    }
    this.latest = null;
    if (!this.visible) {
      this.clearTimer(); // never got to show: nothing flickers
      return;
    }
    if (this.timer !== null) return; // hide already pending
    const remaining = this.timing.minVisibleMs - (this.clock.now() - this.shownAt);
    if (remaining <= 0) this.hide();
    else {
      this.timer = this.clock.setTimeout(() => {
        this.timer = null;
        this.hide();
      }, remaining);
    }
  }

  /** Stop all timers (component teardown). Emits nothing. */
  dispose(): void {
    this.clearTimer();
    this.visible = false;
    this.shown = null;
    this.latest = null;
  }

  private show(value: T): void {
    if (value === this.shown) return;
    this.shown = value;
    this.onChange(value);
  }

  private hide(): void {
    this.visible = false;
    this.shown = null;
    this.onChange(null);
  }

  private clearTimer(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }
}
