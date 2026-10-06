import { error } from '@sveltejs/kit';
import { resolveEditorProjection, type EditorProjectionHostArgs } from '$lib/server/editor-projection';
import { defineRoute, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Build the plugin-aware rich-editor projection of one chapter's text for the
 * open book. Failure outcomes (file too large, plugin load failed) come back
 * as data with `ok: false`; the renderer falls back to the source editor.
 */
export const POST: RequestHandler = defineRoute<EditorProjectionHostArgs>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; content?: unknown; sourceVersion?: unknown };
    const projectDir = await requireProjectDir(body.projectDir, 'editor/projection');
    if (typeof body.content !== 'string') error(400, "editor/projection: 'content' must be a string");
    if (typeof body.sourceVersion !== 'number' || !Number.isFinite(body.sourceVersion) || body.sourceVersion < 0) {
      error(400, "editor/projection: 'sourceVersion' must be a finite, non-negative number");
    }
    return { projectDir, content: body.content, sourceVersion: body.sourceVersion };
  },
  call: ({ body }) => resolveEditorProjection(body),
});
