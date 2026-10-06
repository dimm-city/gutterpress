import { binOnPath, isToolId, planToolInstall, TOOL_DOWNLOAD_URLS } from '$lib/server/tool-install.js';
import { defineRoute, getHostServices, loadLib } from '../_lib/route';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = defineRoute({
  call: async () => {
    const lib = await loadLib();
    const diag = await lib.getSystemDiagnostics();

    // Filter on the stable machine id, not the human-readable `bin` display
    // string — rewording the label must not silently stop excluding the
    // bundled-Chromium entry from the "external tools" list.
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
        ...externalTools.map((tool) => {
          if (!isToolId(tool.id)) return tool;
          const plan = planToolInstall(tool.id, process.platform, binOnPath);
          const install = plan
            ? { kind: 'run' as const, label: plan.label }
            : { kind: 'download' as const, url: TOOL_DOWNLOAD_URLS[tool.id] };
          return { ...tool, install };
        }),
      ],
      desktopVersion: getHostServices().doctor.getDesktopVersion(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
    };
  },
});
