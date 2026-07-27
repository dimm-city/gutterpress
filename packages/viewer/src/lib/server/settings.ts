import { DEFAULT_SETTINGS } from "$lib/platform/contract";
import type { AppSettings, DeepPartial } from "$lib/platform/contract";
import { deepMergeSettings } from "$lib/settings-merge";
import { getPrefsHooks } from '../../../electron/server-bridge/prefs-hooks';
import { gitIdentityFrom, type GitIdentityArgs } from '../../../electron/git-identity';

export async function readAppSettings(): Promise<AppSettings> {
  try {
    const hooks = getPrefsHooks();
    if (!hooks) return DEFAULT_SETTINGS;
    return deepMergeSettings(DEFAULT_SETTINGS, await hooks.readSettings() as DeepPartial<AppSettings>);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * The author's configured commit identity, for the route-side (user-initiated)
 * commit paths. Shares `gitIdentityFrom` with the host-side automatic commit
 * paths (auto-snapshot, auto-sync, export gate) so manual and automatic commits
 * can never again disagree about who the author is.
 */
export async function gitIdentityArgs(): Promise<GitIdentityArgs> {
  return gitIdentityFrom(await readAppSettings());
}
