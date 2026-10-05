import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { getHostServices } from '../../_lib/route';

// Undo for the FileTree's Delete (#313). A delete MOVES the item into
// userData/recently-deleted/<token>/entry (its original path beside it in
// `origin`) instead of removing it, so the "Deleted … Undo" toast can move it
// back. Only the latest delete is kept: each new delete empties the folder
// first, which bounds the disk it can hold to one item.

const TOKEN = /^[0-9a-f-]{36}$/;

function holdingRoot(): string {
  return path.join(getHostServices().desktop.getUserDataPath(), 'recently-deleted');
}

/** rename(), falling back to copy + remove when userData is on another disk. */
async function move(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
    await cp(from, to, { recursive: true, errorOnExist: true, force: false });
    await rm(from, { recursive: true, force: true });
  }
}

/** Move `target` aside and return the token that brings it back. */
export async function holdDeleted(target: string): Promise<string> {
  const root = holdingRoot();
  await rm(root, { recursive: true, force: true });
  const token = randomUUID();
  const slot = path.join(root, token);
  await mkdir(slot, { recursive: true });
  await writeFile(path.join(slot, 'origin'), target, 'utf8');
  await move(target, path.join(slot, 'entry'));
  return token;
}

/**
 * The held item for `token`, or null when it is gone (a later delete replaced
 * it). The caller re-validates `origin` before restoring.
 */
export async function heldItem(token: unknown): Promise<{ origin: string; entry: string; slot: string } | null> {
  if (typeof token !== 'string' || !TOKEN.test(token)) return null;
  const slot = path.join(holdingRoot(), token);
  const origin = await readFile(path.join(slot, 'origin'), 'utf8').catch(() => null);
  if (origin === null) return null;
  return { origin, entry: path.join(slot, 'entry'), slot };
}

/** Move a held item back to its origin (the caller has checked nothing is there). */
export async function restoreHeld(item: { origin: string; entry: string; slot: string }): Promise<void> {
  await mkdir(path.dirname(item.origin), { recursive: true });
  await move(item.entry, item.origin);
  await rm(item.slot, { recursive: true, force: true });
}
