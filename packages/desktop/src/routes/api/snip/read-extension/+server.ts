import { error } from '@sveltejs/kit';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

// #242 — the read-only counterpart to snip/read for a snippet
// `snip/list`'s merge (`listMergedSnippets`) tagged with an extension
// `source` (`kind: "extension"` — one rail since #265, so one kind). `ref`
// is the extension's manifest specifier (`ProjectExtensionEntry.use`) the
// list already handed back; the host (`readExtensionSnippet`) re-derives the
// extension's own folder from it itself rather than trusting any filesystem
// path from the client — see that function's doc comment in `snippets.ts`.
export const POST: RequestHandler = defineRoute<{
  projectDir: string;
  ref: string;
  fileName: string;
}>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; kind?: string; ref?: string; fileName?: string };
    const projectDir = await requireProjectDir(body.projectDir, 'snip/read-extension');
    if (body.kind !== 'extension') {
      error(400, 'snip/read-extension requires kind: "extension"');
    }
    if (typeof body.ref !== 'string' || typeof body.fileName !== 'string') {
      error(400, 'snip/read-extension requires { ref: string, fileName: string }');
    }
    return { projectDir, ref: body.ref, fileName: body.fileName };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.readExtensionSnippet(body.projectDir, { kind: 'extension', ref: body.ref }, body.fileName);
  },
});
