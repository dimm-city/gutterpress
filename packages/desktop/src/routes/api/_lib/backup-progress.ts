/**
 * Where setting up a backup has got to, per book, for the screen to ask about
 * while the one long call is still running. In-memory and short-lived. Each
 * call has its own token, so a second (double) submit cannot have its progress
 * cleared by the first one finishing.
 */
export type BackupProgress = { step: 'checking' | 'creating' | 'choosing' | 'sending'; label: string; at: string };

const LABELS: Record<BackupProgress['step'], string> = {
  checking: 'Checking your GitHub account…',
  creating: 'Creating the online copy…',
  choosing: 'Checking the online copy you chose…',
  sending: 'Sending your book…',
};

const progress = new Map<string, { token: symbol; value: BackupProgress | null }>();

/** Start a call's progress; the returned token is what it sets and clears with. */
export function beginBackupProgress(projectDir: string): symbol {
  const token = Symbol('set-up-backup');
  progress.set(projectDir, { token, value: null });
  return token;
}

export function setBackupProgress(projectDir: string, token: symbol, step: BackupProgress['step']): void {
  const entry = progress.get(projectDir);
  if (entry?.token !== token) return;
  entry.value = { step, label: LABELS[step], at: new Date().toISOString() };
}

/** Clears only if `token` is still the current call's. */
export function clearBackupProgress(projectDir: string, token: symbol): void {
  if (progress.get(projectDir)?.token === token) progress.delete(projectDir);
}

export function getBackupProgress(projectDir: string): BackupProgress | null {
  return progress.get(projectDir)?.value ?? null;
}
