/**
 * The words a writer never sees, as ONE list for every vocabulary test (#448).
 *
 * TEST-ONLY, like testkit.ts. The rules are docs/ux-design-contract.md's
 * "Vocabulary (what an Author reads)"; this is the list the tests hold
 * writer-facing strings to, so a word is banned in one place. Each test keeps
 * its own exceptions (an author's own note, the SSH hint's `git@…` address).
 */

/** Matched against lowercased text. */
export const BANNED_TERMS: readonly RegExp[] = [
  /\bsync/, // sync, syncing, synced
  /snapshot/,
  /commit/,
  /\bgit\b/, // not "GitHub"
  /merge/,
  /repo/, // repo, repository
  /\bremote\b/,
  /\bpush/,
  /\bpull/,
  /branch/,
  /online backup/,
  /saved copy/,
  /restore point/,
  /reconnect/,
  /saved connection/,
  /where your work is kept/,
];

/** The banned terms `text` uses (lowercased); empty when it reads right. */
export function bannedTermsIn(text: string): string[] {
  const lower = text.toLowerCase();
  return BANNED_TERMS.flatMap((term) => lower.match(term)?.[0] ?? []);
}
