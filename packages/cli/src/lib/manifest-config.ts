/**
 * Manifest configuration writers — the unified "Project Configuration" view
 * (#PCV) owns editing the simple, author-facing manifest fields that the four
 * retired modal managers never touched: `title`, `authors`,
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
import { isSeq, isMap, YAMLSeq, Scalar } from "yaml";
import {
  loadManifestDoc,
  writeManifestDoc as writeDoc,
  scalarString,
} from "./manifest-doc";

/** The author-facing manifest subset the Config view can read + write. */
export interface ProjectConfigFields {
  title?: string;
  authors?: string[];
  /** `source.files` — the markdown inputs (null means "all chapter files"). */
  sourceFiles?: string[] | null;
}

/** Compute the difference of a partial update (only keys the caller set). */
function hasKey(obj: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
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
  const { doc, file } = await loadManifestDoc(projectDir);

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
 * Loads via the same shared {@link loadManifestDoc} every other manifest reader/
 * writer in this module uses (ARCH finding #25 — this used to re-implement
 * loadManifestDoc's read-and-parse inline) and surfaces empty/absent fields as
 * empty strings so the form inputs are editable.
 */
export async function readManifestFields(projectDir: string): Promise<ProjectConfigFields> {
  try {
    const { doc } = await loadManifestDoc(projectDir);
    const out: ProjectConfigFields = {};
    // `doc.get(key)` (no keepNode) unwraps Scalars to their JS primitives; an
    // absent key returns undefined. Nested keys go through `getIn`.
    const title = doc.get("title");
    if (typeof title === "string") out.title = title;
    const authors = doc.get("authors", true);
    if (isSeq(authors)) {
      out.authors = (authors.items as unknown[]).map((i) => scalarString(i) ?? "");
    }
    const filesNode = doc.getIn(["source", "files"], true);
    if (isSeq(filesNode)) {
      out.sourceFiles = (filesNode.items as unknown[]).map((i) => scalarString(i) ?? "");
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
  const { doc, file } = await loadManifestDoc(projectDir);
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
