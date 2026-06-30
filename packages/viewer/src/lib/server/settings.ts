import { DEFAULT_SETTINGS } from "$lib/platform/contract";
import type { AppSettings, DeepPartial } from "$lib/platform/contract";

interface PrefsHooks {
  readSettings: () => Promise<Record<string, unknown>>;
}

function mergeSettings(base: AppSettings, patch: DeepPartial<AppSettings>): AppSettings {
  const out = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(patch) as Array<keyof AppSettings>) {
    const value = patch[key];
    if (value && typeof value === "object") {
      out[key] = { ...base[key], ...(value as object) };
    }
  }
  return out as unknown as AppSettings;
}

export async function readAppSettings(): Promise<AppSettings> {
  try {
    const hooks = (globalThis as unknown as { __printMdPrefsHooks__?: PrefsHooks }).__printMdPrefsHooks__;
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
