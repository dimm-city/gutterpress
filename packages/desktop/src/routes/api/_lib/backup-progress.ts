/**
 * Where setting up a backup has got to, per book, for the screen to ask about
 * while the one long call is still running. In-memory and short-lived: set as
 * the steps happen, cleared when the call ends.
 */
export type BackupProgress = { step: 'checking' | 'creating' | 'choosing' | 'sending'; label: string; at: string };

const LABELS: Record<BackupProgress['step'], string> = {
  checking: 'Checking your GitHub account…',
  creating: 'Creating the online copy…',
  choosing: 'Checking the online copy you chose…',
  sending: 'Sending your book…',
};

const progress = new Map<string, BackupProgress>();

export function setBackupProgress(projectDir: string, step: BackupProgress['step']): void {
  progress.set(projectDir, { step, label: LABELS[step], at: new Date().toISOString() });
}

export function clearBackupProgress(projectDir: string): void {
  progress.delete(projectDir);
}

export function getBackupProgress(projectDir: string): BackupProgress | null {
  return progress.get(projectDir) ?? null;
}
