import { defineRoute, getHostServices } from '../../_lib/route';
import type { RequestHandler } from './$types';

/** Native open dialog for choosing a PDF (the publish artifact picker, #35). */
export const POST: RequestHandler = defineRoute<Record<string, never>>({
  call: async () => {
    const res = await getHostServices().desktop.showOpenDialog({
      title: 'Choose the PDF to publish',
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    // Register the path the NATIVE dialog itself just returned, exactly as
    // `dialog/pick-image-file` does: `publish:run` requires this before it
    // will upload an artifact from OUTSIDE the open project, so a script
    // POSTing an arbitrary `artifactPath` straight to that route — skipping
    // this dialog — can't turn a publish into a file-exfiltration primitive.
    getHostServices().pickedFiles.register(res.filePaths);
    return res.filePaths[0];
  },
});
