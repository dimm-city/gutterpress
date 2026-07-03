import { DEFAULT_SETTINGS } from "$lib/platform/contract";
import type { AppSettings, DeepPartial } from "$lib/platform/contract";
import { deepMergeSettings } from "$lib/settings-merge";
import { getPrefsHooks } from '../../../electron/server-bridge/prefs-hooks';

export async function readAppSettings(): Promise<AppSettings> {
  try {
    const hooks = getPrefsHooks();
    if (!hooks) return DEFAULT_SETTINGS;
    return deepMergeSettings(DEFAULT_SETTINGS, await hooks.readSettings() as DeepPartial<AppSettings>);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function gitIdentityArgs(): Promise<{ authorName?: string; authorEmail?: string }> {
  const settings = await readAppSettings();
  const authorName = settings.gitIdentity.authorName.trim();
  const authorEmail = settings.gitIdentity.authorEmail.trim();
  return {
    ...(authorName ? { authorName } : {}),
    ...(authorEmail ? { authorEmail } : {}),
  };
}
