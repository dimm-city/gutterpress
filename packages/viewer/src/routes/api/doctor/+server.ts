import { json } from '@sveltejs/kit';
import { getDoctorHooks, type UpdaterStatus } from '$lib/server/host-hooks.js';
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

export const GET: RequestHandler = async () => {
  try {
    const hooks = getHooks();
    if (!hooks) return new Response('Prefs hooks not registered', { status: 503 });
    const lib = await hooks.loadLib();
    const diag = await lib.getSystemDiagnostics();

    const doctorHooks = getDoctorHooks();
    const webUiVersion = doctorHooks
      ? (await doctorHooks.getUpdaterStatus().catch(() => null))?.currentVersion ?? null
      : null;

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
          path: 'Bundled with the Print MD Desktop App',
          version: process.versions.chrome,
          usedBy: [
            { feature: 'Preview rendering and Save PDF', severity: 'required' },
          ],
          installHint: 'No setup required in the Print MD Desktop App.',
        },
        ...externalTools,
      ],
      viewerVersion: doctorHooks ? doctorHooks.getViewerVersion() : 'unknown',
      webUiVersion,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(msg, { status: 500 });
  }
};
