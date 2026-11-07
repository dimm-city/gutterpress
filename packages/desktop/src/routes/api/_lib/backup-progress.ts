/**
 * Where setting up a backup has got to, per book, for the screen to ask about
 * while the one long call is still running. In-memory and short-lived. Every
 * call keeps its own entry until its own call ends, and the screen sees the
 * newest call that is still running, so a double submit's second call failing
 * fast cannot clear the first one's live progress (and vice versa).
 */
export type BackupProgress = { step: 'checking' | 'creating' | 'choosing' | 'sending'; label: string; at: string };

const LABELS: Record<BackupProgress['step'], string> = {
  checking: 'Checking your GitHub account…',
  creating: 'Creating the online copy…',
  choosing: 'Checking the online copy you chose…',
  sending: 'Sending your book…',
};

/** Running calls per book, oldest first. */
const running = new Map<string, Array<{ token: symbol; value: BackupProgress | null }>>();

/** Start a call's progress; the returned token is what it sets and clears with. */
export function beginBackupProgress(projectDir: string): symbol {
  const token = Symbol('set-up-backup');
  running.set(projectDir, [...(running.get(projectDir) ?? []), { token, value: null }]);
  return token;
}

export function setBackupProgress(projectDir: string, token: symbol, step: BackupProgress['step']): void {
  const entry = running.get(projectDir)?.find((e) => e.token === token);
  if (entry) entry.value = { step, label: LABELS[step], at: new Date().toISOString() };
}

/** Ends this call's entry only; others keep theirs. */
export function clearBackupProgress(projectDir: string, token: symbol): void {
  const rest = (running.get(projectDir) ?? []).filter((e) => e.token !== token);
  if (rest.length) running.set(projectDir, rest);
  else running.delete(projectDir);
}

/** The newest still-running call's progress (a call that has not reported yet is skipped). */
export function getBackupProgress(projectDir: string): BackupProgress | null {
  const entries = running.get(projectDir) ?? [];
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i]!.value) return entries[i]!.value;
  return null;
}
