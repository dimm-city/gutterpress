/**
 * The book's stylesheet as Book setup's design settings see it, and their one
 * writer (#454).
 *
 * What the settings show is what the build assembles: core's CSS, every
 * enabled extension's CSS — its stylesheet files and its `css` export,
 * through the same loader the build uses, each in its cascade layer — then
 * every one of the book's own `styles:` sheets, in the order
 * `assembleCssChunks` gives them. A file's chunk is the file as written, so a
 * value reads back as the author typed it: the build's inlining (fonts and
 * images embedded, local `@import`s followed) is left out here.
 *
 * Writes go to the book's own `styles:` sheets only, never to an extension's
 * files or a sheet the build does not use, with a postcss edit
 * (`root-tokens.ts`).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { assembleCssChunks, type CssChunk } from "./markdown/assemble.ts";
import { loadManifestWithPath, resolveConfig } from "./manifest.ts";
import { loadPluginsWithCss } from "./markdown/plugins.ts";
import { relDisplay, resolveActiveStyles } from "./style-resolver.ts";
import { applyTokenUpdates, rootTokens, type RootToken, type TokenUpdate } from "./root-tokens.ts";

export type { RootToken, TokenUpdate } from "./root-tokens.ts";
export type { CssChunk, CssChunkOrigin } from "./markdown/assemble.ts";

/** One chunk of the book's stylesheet and the root-level custom properties it declares. */
export interface BookCssChunk extends CssChunk {
  /**
   * Its root-level `:root` custom properties, in source order (`@internal`
   * ones left out). Empty for a chunk postcss cannot parse: the print-safety
   * check reports that one.
   */
  tokens: RootToken[];
}

/** The book's stylesheet, in cascade order. */
export interface BookCss {
  /** Joined with blank lines, the chunks cascade as the built book's stylesheet does. */
  chunks: BookCssChunk[];
}

/** One stylesheet the token writer changed: its absolute path and new text. */
export interface StylesheetEdit {
  path: string;
  content: string;
}

/** A file's text, or "" for one that does not exist yet. */
async function readText(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

/** The book's own stylesheets: `resolveActiveStyles`, the build's resolver, as absolute paths. */
async function bookSheets(projectDir: string, styles: string[] | undefined): Promise<string[]> {
  return (await resolveActiveStyles(projectDir, styles)).map((rel) => path.resolve(projectDir, rel));
}

/**
 * The book's stylesheet as ordered chunks tagged with their origin, each with
 * its root-level custom properties. An extension that cannot load (not
 * downloaded yet, a broken folder) is left out, as the live preview leaves it
 * out; Book setup's Extensions tab reports it. Throws for a manifest the
 * build would refuse.
 */
export async function readBookCss(projectDir: string): Promise<BookCss> {
  const { manifest } = await loadManifestWithPath(projectDir);
  const config = resolveConfig({}, manifest);
  const { pluginStyles } = await loadPluginsWithCss(config.extensions, projectDir, () => {});

  const extensions: CssChunk[] = [];
  for (const group of pluginStyles) {
    const layered = (css: string, file?: string): void => {
      if (!css.trim()) return;
      extensions.push({
        origin: { kind: "extension", name: group.name, layer: group.layer, ...(file ? { file } : {}) },
        css: `@layer ${group.layer} {\n${css.trim()}\n}`,
      });
    };
    for (const file of group.paths) layered(await readText(file), relDisplay(projectDir, file));
    if (group.css) layered(group.css);
  }

  const book: CssChunk[] = [];
  for (const file of await bookSheets(projectDir, config.styles)) {
    const css = await readText(file);
    if (css.trim()) book.push({ origin: { kind: "book", file: relDisplay(projectDir, file) }, css });
  }

  const chunks = assembleCssChunks({
    printArea: { ...config.page, preset: config.preset, spec: config.spec },
    extensions,
    book,
  });
  return {
    chunks: chunks.map((chunk) => {
      let tokens: RootToken[] = [];
      try {
        tokens = rootTokens(chunk.css);
      } catch {
        // Unparseable: no settings from it (see BookCssChunk.tokens).
      }
      return { ...chunk, tokens };
    }),
  };
}

/**
 * Apply token edits to the book's own stylesheets with postcss
 * (`applyTokenUpdates`): a token is changed in place in the last of them that
 * declares it at root level, and a new one is added to the `:root` of
 * `target`, which must be one of them. A removal takes the token out of all
 * of them. Returns the sheets that change, with their new text, for the
 * caller to write; nothing is written here.
 */
export async function bookTokenEdits(
  projectDir: string,
  target: string,
  updates: TokenUpdate[],
): Promise<StylesheetEdit[]> {
  const { manifest } = await loadManifestWithPath(projectDir);
  const sheets = await bookSheets(projectDir, Array.isArray(manifest.styles) ? manifest.styles : undefined);
  const at = sheets.indexOf(path.resolve(projectDir, target));
  if (at < 0) {
    throw new Error(`${relDisplay(projectDir, path.resolve(projectDir, target))} is not one of the book's stylesheets.`);
  }
  const before = await Promise.all(sheets.map(readText));
  let after: string[];
  try {
    after = applyTokenUpdates(before, at, updates);
  } catch (error) {
    // postcss's CssSyntaxError carries the text it could not parse: name the sheet.
    const e = error as { source?: string; reason?: string; line?: number };
    const i = e.source === undefined ? -1 : before.indexOf(e.source);
    if (i < 0 || !e.reason) throw error;
    throw new Error(`Couldn't read ${relDisplay(projectDir, sheets[i]!)}${e.line ? ` (line ${e.line})` : ""}: ${e.reason}.`);
  }
  return sheets.flatMap((file, i) => (after[i] === before[i] ? [] : [{ path: file, content: after[i]! }]));
}
