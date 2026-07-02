import { DEFAULT_SETTINGS } from "$lib/platform/contract";
import type { AppSettings, DeepPartial } from "$lib/platform/contract";
import { getPrefsHooks } from '../../../electron/server-bridge/prefs-hooks';

function mergeSettingsSection<K extends keyof AppSettings>(
  target: AppSettings,
  base: AppSettings,
  key: K,
  value: DeepPartial<AppSettings>[K],
): void {
  if (value && typeof value === "object") {
    target[key] = { ...base[key], ...value } as AppSettings[K];
  }
}

function mergeSettings(base: AppSettings, patch: DeepPartial<AppSettings>): AppSettings {
  const out: AppSettings = { ...base };
  for (const key of Object.keys(patch) as Array<keyof AppSettings>) {
    mergeSettingsSection(out, base, key, patch[key]);
  }
  return out;
}

export async function readAppSettings(): Promise<AppSettings> {
  try {
    const hooks = getPrefsHooks();
    if (!hooks) return DEFAULT_SETTINGS;
    return mergeSettings(DEFAULT_SETTINGS, await hooks.readSettings() as DeepPartial<AppSettings>);
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
