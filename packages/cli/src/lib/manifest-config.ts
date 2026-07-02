/**
 * Manifest configuration writers — the unified "Project Configuration" view
 * (#PCV) owns editing the simple, author-facing manifest fields that the four
 * retired modal managers never touched: `title`, `authors`, `output.filename`,
 * `source.files`, plus a generic `setActiveStyles` to reorder/enable the
 * stylesheets list (the active set) without going through theme-apply.
 *
 * Storage model mirrors {@link plugin-manager.ts} / {@link theme-manager.ts}:
 * the yaml `Document` API is used so existing comments + formatting round-trip
 * cleanly, and writes go to `manifest.yaml` (or `.yml` when only that exists).
 * Host-side (node:fs); the renderer reaches it through SvelteKit server routes.
 *
 * Bundle-safe (CLAUDE.md §1/§3): no runtime package.json reads, no computed
 * dynamic imports, no bundlers.
 */
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseDocument, isSeq, isMap, YAMLSeq, Scalar } from "yaml";
import type { Document } from "yaml";

/** The author-facing manifest subset the Config view can read + write. */
export interface ProjectConfigFields {
  title?: string;
  authors?: string[];
  /** `output.filename` in the manifest; the built PDF's name. */
  outputFilename?: string;
  /** `source.files` — the markdown inputs (null means "all chapter files"). */
  sourceFiles?: string[] | null;
}

/** Resolve `manifest.yaml`/`.yml` inside a project dir; prefers an existing file. */
function manifestPathFor(projectDir: string): string {
  const yaml = path.join(projectDir, "manifest.yaml");
  const yml = path.join(projectDir, "manifest.yml");
  if (!existsSync(yaml) && existsSync(yml)) return yml;
  return yaml;
}

/** Load the manifest as a yaml Document (empty doc when absent). */
async function loadDoc(projectDir: string): Promise<{ doc: Document.Parsed; file: string }> {
  const file = manifestPathFor(projectDir);
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch {
    text = "";
  }
  return { doc: parseDocument(text), file };
}

/** Write the doc back, creating the project dir if needed. */
async function writeDoc(file: string, doc: Document.Parsed): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, doc.toString(), "utf8");
}

/** Compute the difference of a partial update (only keys the caller set). */
function hasKey(obj: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** Stringify a yaml scalar/Pair item the way `doc.get` would unwrap it. */
function unwrapScalar(item: unknown): string {
  if (item == null) return "";
  // A bare Scalar's `.value` holds the primitive; a Pair (key: value) exposes
  // `.value` on its value side. Handle both — the seq items under `authors:`
  // are string Scalars; nested-map items arrive as Pairs when read via `getIn`.
  const v = (item as { value?: unknown }).value;
  if (typeof v === "string") return v;
  return String(item);
}

/**
 * Apply the author-facing manifest field updates in a single yaml round-trip.
 * Only the keys present in `updates` are written; everything else is left
 * untouched (so unrelated comments + sections survive). `sourceFiles: null`
 * deletes the `source.files` entry (back to "all chapter files").
 */
export async function setManifestFields(
  projectDir: string,
  updates: ProjectConfigFields,
): Promise<ProjectConfigFields> {
  const { doc, file } = await loadDoc(projectDir);

  if (hasKey(updates, "title")) {
    if (updates.title === undefined || updates.title === "") {
      doc.delete("title");
    } else {
      doc.set("title", updates.title);
    }
  }

  if (hasKey(updates, "authors")) {
    const a = updates.authors;
    if (!a || a.length === 0) {
      doc.delete("authors");
    } else {
      doc.set("authors", a);
    }
  }

  if (hasKey(updates, "outputFilename")) {
    if (updates.outputFilename === undefined || updates.outputFilename === "") {
      doc.deleteIn(["output", "filename"]);
      // Drop a now-empty `output:` map rather than leaving a dangling key.
      const output = doc.get("output", true);
      if (isMap(output) && output.items.length === 0) {
        doc.delete("output");
      }
    } else {
      doc.setIn(["output", "filename"], updates.outputFilename);
    }
  }

  if (hasKey(updates, "sourceFiles")) {
    const f = updates.sourceFiles;
    if (f === null || (Array.isArray(f) && f.length === 0)) {
      doc.deleteIn(["source", "files"]);
      const source = doc.get("source", true);
      if (isMap(source) && source.items.length === 0) {
        doc.delete("source");
      }
    } else {
      doc.setIn(["source", "files"], f);
    }
  }

  await writeDoc(file, doc);
  return readManifestFields(projectDir);
}

/**
 * Read the author-facing manifest subset for the Config view's Details section.
 * Reads via the same yaml parse path as the renderer (`loadManifest`) and
 * surfaces empty/absent fields as empty strings so the form inputs are editable.
 */
export async function readManifestFields(projectDir: string): Promise<ProjectConfigFields> {
  const file = manifestPathFor(projectDir);
  try {
    const text = await readFile(file, "utf8");
    const doc = parseDocument(text);
    const out: ProjectConfigFields = {};
    // `doc.get(key)` (no keepNode) unwraps Scalars to their JS primitives; an
    // absent key returns undefined. Nested keys go through `getIn`.
    const title = doc.get("title");
    if (typeof title === "string") out.title = title;
    const authors = doc.get("authors", true);
    if (isSeq(authors)) {
      out.authors = (authors.items as unknown[]).map((i) => unwrapScalar(i));
    }
    const outFilename = doc.getIn(["output", "filename"]);
    if (typeof outFilename === "string") out.outputFilename = outFilename;
    const filesNode = doc.getIn(["source", "files"], true);
    if (isSeq(filesNode)) {
      out.sourceFiles = (filesNode.items as unknown[]).map((i) => unwrapScalar(i));
    } else {
      // `files: null` is a deliberate "all chapter files" sentinel; an absent
      // key stays undefined so the form can distinguish "not set" from "null".
      const sourceNode = doc.get("source", true);
      if (isMap(sourceNode) && sourceNode.has("files")) out.sourceFiles = null;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Replace the manifest's entire `styles:` list with `paths`. This is the
 * generic "which stylesheets are active" control the unified Config view's
 * Styles section drives — toggling a stylesheet on/off or reordering the active
 * set. Theme-apply still owns copying the theme folder; this only rewrites the
 * list entry order. `paths` are project-relative, forward-slash strings (how
 * they appear in the manifest, e.g. `themes/zine/theme.css`, `styles/print.css`).
 */
export async function setActiveStyles(
  projectDir: string,
  paths: string[],
): Promise<string[]> {
  const { doc, file } = await loadDoc(projectDir);
  if (paths.length === 0) {
    doc.delete("styles");
  } else {
    const seq = new YAMLSeq(doc.schema);
    for (const p of paths) seq.add(new Scalar(p));
    doc.set("styles", seq);
  }
  await writeDoc(file, doc);
  return paths;
}
