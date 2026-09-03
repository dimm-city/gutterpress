import { error } from '@sveltejs/kit';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

// #242 — the read-only counterpart to snip/read for a snippet
// `snip/list`'s merge (`listMergedSnippets`) tagged with an extension
// `source` (`kind: "plugin" | "theme"`). `kind`/`ref` are the opaque pair
// `SnippetEntry.source` already carries; the host (`readExtensionSnippet`)
// re-derives the extension's own folder from them itself rather than
// trusting any filesystem path from the client — see that function's doc
// comment in `snippets.ts`.
export const POST: RequestHandler = defineRoute<{
  projectDir: string;
  kind: 'plugin' | 'theme';
  ref: string;
  fileName: string;
}>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; kind?: string; ref?: string; fileName?: string };
    const projectDir = await requireProjectDir(body.projectDir, 'snip/read-extension');
    if (body.kind !== 'plugin' && body.kind !== 'theme') {
      error(400, 'snip/read-extension requires kind: "plugin" | "theme"');
    }
    if (typeof body.ref !== 'string' || typeof body.fileName !== 'string') {
      error(400, 'snip/read-extension requires { ref: string, fileName: string }');
    }
    return { projectDir, kind: body.kind, ref: body.ref, fileName: body.fileName };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.readExtensionSnippet(body.projectDir, { kind: body.kind, ref: body.ref }, body.fileName);
  },
});
