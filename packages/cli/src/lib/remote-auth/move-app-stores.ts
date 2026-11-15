/**
 * The one-time move of what the desktop app kept in its own folder into the
 * one per-person store the terminal and the app share (ADR 0012 §4):
 *
 * - `credentials.json`: saved accounts, each token encrypted by the OS
 *   keychain. Each is decrypted (by the caller, which owns the keychain) and
 *   added to the shared {@link FileTokenStore}; an account already saved there
 *   keeps its credential.
 * - `publish-selections.json`: the person's own publishing choices per book;
 *   added to the shared {@link PublishSelectionsStore} the same way.
 *
 * Each old file is renamed to `<name>.moved` once its contents are in, so the
 * move runs once and the old copy stays as a backup. A file that cannot be
 * read (other than absent) throws, leaving both files as they are for the
 * next try; a file that is not valid JSON is left in place and skipped.
 */
import { readFile, rename } from "node:fs/promises";
import path from "node:path";
import type { HostCredential } from "./token-store.ts";
import type { FileTokenStore } from "./token-store.ts";
import type { PublishSelectionsStore } from "../publish/selections.ts";

/** What was moved. */
export interface MovedAppStores {
  /** Accounts added to the shared store. */
  accounts: number;
  /** Accounts the keychain could no longer decrypt (they needed signing in again anyway). */
  unreadable: number;
  /** Per-book and global publishing choices added. */
  choices: number;
}

interface OldEntry {
  host?: string;
  kind?: HostCredential["kind"];
  tokenCipher?: string;
  username?: string;
  label?: string;
  createdAt?: number;
}

export async function moveAppStores(
  appDir: string,
  decrypt: (cipherBase64: string) => string,
  stores: {
    tokenStore: Pick<FileTokenStore, "addMissing">;
    selections: Pick<PublishSelectionsStore, "addMissingFrom">;
  },
): Promise<MovedAppStores> {
  const moved: MovedAppStores = { accounts: 0, unreadable: 0, choices: 0 };

  const credentialsFile = path.join(appDir, "credentials.json");
  const raw = await readIfPresent(credentialsFile);
  const entries = raw === null ? null : parseEntries(raw);
  if (entries) {
    const credentials: Record<string, HostCredential> = {};
    for (const [key, entry] of Object.entries(entries)) {
      if (!entry?.host || !entry.kind || !entry.tokenCipher) continue;
      let token: string;
      try {
        token = decrypt(entry.tokenCipher);
      } catch {
        moved.unreadable++;
        continue;
      }
      credentials[key] = {
        host: entry.host,
        kind: entry.kind,
        token,
        ...(entry.username ? { username: entry.username } : {}),
        ...(entry.label ? { label: entry.label } : {}),
        createdAt: entry.createdAt ?? Date.now(),
      };
    }
    moved.accounts = (await stores.tokenStore.addMissing(credentials)).length;
    await rename(credentialsFile, `${credentialsFile}.moved`);
  }

  const selectionsFile = path.join(appDir, "publish-selections.json");
  if ((await readIfPresent(selectionsFile)) !== null) {
    moved.choices = await stores.selections.addMissingFrom(selectionsFile);
    await rename(selectionsFile, `${selectionsFile}.moved`);
  }
  return moved;
}

async function readIfPresent(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw e;
  }
}

function parseEntries(raw: string): Record<string, OldEntry> | null {
  try {
    const parsed = JSON.parse(raw) as { credentials?: Record<string, OldEntry> };
    return parsed && typeof parsed.credentials === "object" ? parsed.credentials : null;
  } catch {
    return null;
  }
}
