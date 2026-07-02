import { json } from '@sveltejs/kit';
import { getDoctorHooks } from '$lib/server/host-hooks.js';
import { getPrefsHooks } from '../../../../electron/server-bridge/prefs-hooks';
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

interface DoctorLibModule {
  getSystemDiagnostics: () => Promise<SystemDiagnostics>;
}

export const GET: RequestHandler = async () => {
  try {
    const hooks = getPrefsHooks<DoctorLibModule>();
    if (!hooks) return new Response('Prefs hooks not registered', { status: 503 });
    const lib = await hooks.loadLib();
    const diag = await lib.getSystemDiagnostics();

    const doctorHooks = getDoctorHooks();

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
      viewerVersion: doctorHooks ? doctorHooks.getViewerVersion() : 'unknown',
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(msg, { status: 500 });
  }
};
