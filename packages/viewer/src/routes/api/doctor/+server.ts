import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

interface SystemDiagnostics {
  libVersion: string;
  platform: { os: string; arch: string; release: string; node: string };
  tools: Array<{
    name: string;
    bin: string;
    found: boolean;
    path?: string;
    version?: string;
    usedBy: Array<{ feature: string; severity: 'required' | 'optional' }>;
    installHint: string;
  }>;
  docsUrl: string;
}

interface PrefsHooks {
  loadLib: () => Promise<{
    getSystemDiagnostics: () => Promise<SystemDiagnostics>;
  }>;
}

function getHooks(): PrefsHooks | null {
  return (globalThis as unknown as { __printMdPrefsHooks__?: PrefsHooks }).__printMdPrefsHooks__ ?? null;
}

// Web-UI auto-updater status — mirrors the shape returned by getStatus() in updater/index.ts.
interface UpdaterStatus {
  currentVersion: string | null;
}

function getUpdaterGetStatus(): (() => Promise<UpdaterStatus>) | null {
  return (
    (globalThis as unknown as { __printMdUpdaterGetStatus__?: () => Promise<UpdaterStatus> }).__printMdUpdaterGetStatus__ ?? null
  );
}

export const GET: RequestHandler = async () => {
  try {
    const hooks = getHooks();
    if (!hooks) return error(503, 'Prefs hooks not registered');
    const lib = await hooks.loadLib();
    const diag = await lib.getSystemDiagnostics();

    const { app } = await import('electron');

    const getStatus = getUpdaterGetStatus();
    const webUiVersion = getStatus ? (await getStatus().catch(() => null))?.currentVersion ?? null : null;

    const externalTools = diag.tools.filter(
      (tool) => tool.bin !== 'chrome / chromium / msedge'
    );

    return json({
      ...diag,
      tools: [
        {
          name: 'Chromium (built-in via Electron)',
          bin: 'electron',
          found: true,
          path: 'Bundled with the viewer app',
          version: process.versions.chrome,
          usedBy: [
            { feature: 'Preview rendering and Save PDF', severity: 'required' },
          ],
          installHint: 'No setup required in the viewer app.',
        },
        ...externalTools,
      ],
      viewerVersion: app.getVersion(),
      webUiVersion,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
