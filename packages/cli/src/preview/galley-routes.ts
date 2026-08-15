/**
 * Galley editor routes (preview-interface protocol v8).
 *
 * Three same-origin endpoints served alongside `/__chapter` by the preview
 * HTTP server (http-server.ts dispatches every `/__galley/*` path here):
 *
 *   GET  /__galley/book                   → { chapters: [{ chapter, source, tokens }] }
 *   POST /__galley/tokens   { markdown }  → { tokens }
 *   POST /__galley/fragment { markdown }  → { html }
 *
 * The galley frame editor never tokenizes markdown itself — "exactly one
 * parser in the product" (engine/galley/markdown.ts). All three routes build
 * their markdown-it instance the SAME way the preview render path does
 * (assemble.ts → createMarkdownRenderer with the manifest's plugins, loaded
 * degrade-and-report like renderPreviewBook), so the token stream the editor
 * models is byte-for-byte the one the rendered book came from.
 */

import type http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'path';
import type MarkdownIt from 'markdown-it';
import { warn } from '../utils/logger';
import { createMarkdownRenderer } from '../lib/markdown/renderer';
import { loadPluginsWithCss } from '../lib/markdown/plugins';
import { resolveActiveMarkdownFiles } from '../lib/markdown/index';
import { canonicalChapterId } from '../lib/markdown/chapter-id';
import type { ServerState } from './server-context';

/** Request-body cap for the POST routes. A whole chapter is typically tens of
 * kilobytes; 2 MB leaves generous headroom without letting a runaway client
 * buffer unbounded memory server-side. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

/**
 * The same markdown-it configuration the preview render path uses — the
 * manifest's plugins through {@link loadPluginsWithCss} (degrade-and-report,
 * matching file-watcher.ts's renderPreviewBook: one uninstalled plugin warns
 * and is skipped rather than taking the whole editor down), applied by
 * {@link createMarkdownRenderer}. Never build a second differently-configured
 * renderer for the galley.
 */
async function createGalleyRenderer(state: ServerState): Promise<MarkdownIt> {
  const { plugins } = await loadPluginsWithCss(
    state.config.plugins,
    state.currentInputPath,
    (ref, err) => warn(`Skipping plugin "${ref}" in galley routes — ${err.message}`),
  );
  return createMarkdownRenderer(plugins);
}

class PayloadTooLargeError extends Error {}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new PayloadTooLargeError(`Request body exceeds ${MAX_BODY_BYTES} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Read and validate a `{ markdown }` JSON body. Writes the 4xx response
 * itself and returns `null` when the body is oversized, unparsable, or
 * missing a string `markdown` field.
 */
async function readMarkdownBody(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<string | null> {
  let raw: Buffer;
  try {
    raw = await readBody(req);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      sendJson(res, 413, { error: error.message });
    } else {
      sendJson(res, 400, { error: 'Could not read request body' });
    }
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf-8'));
  } catch {
    sendJson(res, 400, { error: 'Request body is not valid JSON' });
    return null;
  }
  const markdown = (parsed as { markdown?: unknown } | null)?.markdown;
  if (typeof markdown !== 'string') {
    sendJson(res, 400, { error: 'Request body must be JSON with a string "markdown" field' });
    return null;
  }
  return markdown;
}

/** Line-ending normalization: the codec's source slices are `\n`-indexed. */
function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * GET /__galley/book — every watched markdown chapter in book order (the SAME
 * order the render uses: manifest `source.files` if set, else root-level `.md`
 * files alphabetically — {@link resolveActiveMarkdownFiles}), each carrying
 * its canonical chapter id (the `data-chapter-src` identity), its current
 * source, and that source's markdown-it token stream.
 */
async function handleBook(res: http.ServerResponse, state: ServerState): Promise<void> {
  if (!state.currentInputPath) {
    sendJson(res, 404, { error: 'No project open' });
    return;
  }
  const md = await createGalleyRenderer(state);
  const files = await resolveActiveMarkdownFiles(
    state.currentInputPath,
    state.config.source?.files,
  );
  const chapters = [];
  for (const file of files) {
    const chapter = canonicalChapterId(file);
    const raw = await readFile(path.join(state.currentInputPath, chapter), 'utf-8');
    const source = normalizeNewlines(raw);
    chapters.push({ chapter, source, tokens: md.parse(source, {}) });
  }
  sendJson(res, 200, { chapters });
}

/**
 * Handle one `/__galley/*` request. The caller (http-server.ts) has already
 * matched the path prefix; unknown subpaths 404 and known subpaths with the
 * wrong method 405, both as JSON.
 */
export async function handleGalleyRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  state: ServerState,
): Promise<void> {
  try {
    switch (url.pathname) {
      case '/__galley/book': {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'Method Not Allowed' });
          return;
        }
        await handleBook(res, state);
        return;
      }
      case '/__galley/tokens': {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method Not Allowed' });
          return;
        }
        const markdown = await readMarkdownBody(req, res);
        if (markdown === null) return;
        const md = await createGalleyRenderer(state);
        sendJson(res, 200, { tokens: md.parse(normalizeNewlines(markdown), {}) });
        return;
      }
      case '/__galley/fragment': {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method Not Allowed' });
          return;
        }
        const markdown = await readMarkdownBody(req, res);
        if (markdown === null) return;
        const md = await createGalleyRenderer(state);
        sendJson(res, 200, { html: md.render(normalizeNewlines(markdown)) });
        return;
      }
      default:
        sendJson(res, 404, { error: 'Not Found' });
    }
  } catch (error) {
    if (!res.headersSent) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    } else {
      res.end();
    }
  }
}
