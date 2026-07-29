import { getDoctorHooks } from '$lib/server/host-hooks.js';
import { defineRoute, loadLib } from '../_lib/route';
import type { RequestHandler } from './$types';

interface ToolStatus {
  id: string;
  name: string;
  bin: string;
  found: boolean;
  path?: string;
  version?: string;
  usedBy: Array<{ feature: string; severity: 'required' | 'optional' }>;
  installHint: string;
}

interface SystemDiagnostics {
  libVersion: string;
  platform: { os: string; arch: string; release: string; node: string };
  tools: ToolStatus[];
  configDir: string;
  docsUrl: string;
}

interface DoctorLibModule {
  getSystemDiagnostics: () => Promise<SystemDiagnostics>;
}

export const GET: RequestHandler = defineRoute({
  call: async () => {
    const lib = (await loadLib()) as unknown as DoctorLibModule;
    const diag = await lib.getSystemDiagnostics();

    const doctorHooks = getDoctorHooks();

    // Filter on the stable machine id, not the human-readable `bin` display
    // string — rewording the label must not silently stop excluding the
    // bundled-Chromium entry from the "external tools" list (UX L10).
    const externalTools = diag.tools.filter((tool) => tool.id !== 'chromium');

    return {
      ...diag,
      tools: [
        {
          id: 'electron-chromium',
          name: 'Chromium (built-in via Electron)',
          bin: 'electron',
          found: true,
          path: 'Bundled with the desktop app',
          version: process.versions.chrome,
          usedBy: [
            { feature: 'Preview rendering and Save PDF', severity: 'required' as const },
          ],
          installHint: 'No setup required in the desktop app.',
        },
        ...externalTools,
      ],
      desktopVersion: doctorHooks ? doctorHooks.getDesktopVersion() : 'unknown',
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
    };
  },
});
