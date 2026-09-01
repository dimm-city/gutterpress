/**
 * The author's configured commit identity for a HOST-INITIATED (not
 * user-typed) commit — shared by every `electron/api/*.ts` handler that
 * calls into the lib's git-writing surface without the author supplying an
 * explicit identity of their own (SFE-P5c1's `fs:delete` safety snapshot,
 * SFE-P5c2's `vcs:*` handlers).
 *
 * Mirrors `src/lib/server/settings.ts`'s `gitIdentityArgs()` exactly (same
 * `DEFAULT_SETTINGS` merge, same `gitIdentityFrom` call) so every commit
 * path — route-side and IPC-side alike — keeps agreeing on who the author
 * is. That module stays in place (still imported by `remote/sync` and other
 * routes outside this subrun); this is the main-process-native twin,
 * extracted out of `fs.ts` (SFE-P5c1) once `vcs.ts` (SFE-P5c2) needed the
 * exact same logic, so the two IPC handlers share one implementation instead
 * of two copies.
 */
import { gitIdentityFrom } from "../git-identity";
import { getPrefsHooks } from "../server-bridge/prefs-hooks";
import { deepMergeSettings } from "../../src/lib/settings-merge";
import { DEFAULT_SETTINGS, type AppSettings, type DeepPartial } from "../../src/lib/platform/shared-types";

export async function gitIdentityArgs(): Promise<ReturnType<typeof gitIdentityFrom>> {
  // Mirrors src/lib/server/settings.ts's own try/catch exactly: a settings
  // read that fails (anything other than the store's own ENOENT-to-default
  // handling — e.g. a transient EACCES/EIO) falls back to the default
  // identity rather than aborting the caller (fs:delete's safety snapshot,
  // every vcs:* write). Losing the read must never be fatal to the write it
  // is only decorating with an author name.
  try {
    const hooks = getPrefsHooks();
    if (!hooks) return gitIdentityFrom(DEFAULT_SETTINGS);
    const merged = deepMergeSettings(DEFAULT_SETTINGS, (await hooks.readSettings()) as DeepPartial<AppSettings>);
    return gitIdentityFrom(merged);
  } catch {
    return gitIdentityFrom(DEFAULT_SETTINGS);
  }
}
