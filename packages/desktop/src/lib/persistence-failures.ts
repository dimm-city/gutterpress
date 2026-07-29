import type { LastFlushFailure } from "./platform/contract";
import { basenameOf } from "./platform/paths";

const PERSISTENCE_FAILURE_NOTICE_THRESHOLD = 3;

/** One-session threshold gate for ignored, non-critical persistence failures. */
export class PersistenceFailureNotifier {
  private failures = 0;
  private notified = false;

  constructor(private readonly threshold = PERSISTENCE_FAILURE_NOTICE_THRESHOLD) {}

  recordFailure(notify: () => boolean): void {
    this.failures += 1;
    if (!this.notified && this.failures >= this.threshold) {
      this.notified = notify();
    }
  }
}

export function createLastFlushFailure(
  projectDir: string | null | undefined,
  now = new Date(),
): LastFlushFailure {
  return {
    failedAt: now.toISOString(),
    ...(projectDir ? { projectDir } : {}),
  };
}

export function formatLastFlushFailureNotice(
  marker: LastFlushFailure,
  formatDate: (date: Date) => string = (date) =>
    new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date),
): string {
  const project = marker.projectDir ? basenameOf(marker.projectDir) : "your project";
  const failedAt = new Date(marker.failedAt);
  const when = Number.isNaN(failedAt.getTime())
    ? "during your previous session"
    : `on ${formatDate(failedAt)}`;
  return `Your last edit in ${project} ${when} may not have been saved.`;
}
