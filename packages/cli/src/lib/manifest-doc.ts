/**
 * Shared manifest-Document helpers — resolve the `manifest.yaml`/`.yml` path,
 * load it as a `yaml` Document (comments/formatting round-trip), and ensure a
 * named sequence node exists.
 *
 * One implementation, three historical call sites (DRY): the manifest-config,
 * plugin-manager, and theme-manager modules each carried a byte-identical
 * `manifestPathFor` + `loadDoc`, and plugin/theme carried a copy of the
 * "ensure this seq exists" helper differing only by key.
 *
 * Host-side (node:fs); the renderer reaches these through SvelteKit server
 * routes / IPC. Bundle-safe (CLAUDE.md §1/§3): no runtime package.json reads,
 * no computed dynamic imports, no bundlers.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument, isSeq, YAMLSeq } from "yaml";
import type { Document } from "yaml";

/** Resolve `manifest.yaml`/`.yml` inside a project dir; prefers an existing file. */
export function resolveManifestPath(projectDir: string): string {
  const yaml = path.join(projectDir, "manifest.yaml");
  const yml = path.join(projectDir, "manifest.yml");
  if (!existsSync(yaml) && existsSync(yml)) return yml;
  return yaml;
}

/** Load the manifest as a yaml Document (empty doc when absent). */
export async function loadManifestDoc(
  projectDir: string,
): Promise<{ doc: Document.Parsed; file: string }> {
  const file = resolveManifestPath(projectDir);
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch {
    text = "";
  }
  return { doc: parseDocument(text), file };
}

/** The named sequence node, creating (and attaching) an empty one if missing. */
export function ensureSeq(doc: Document.Parsed, key: string): YAMLSeq {
  let seq = doc.get(key, true);
  if (!isSeq(seq)) {
    const fresh = new YAMLSeq(doc.schema);
    doc.set(key, fresh);
    seq = fresh;
  }
  return seq as YAMLSeq;
}
