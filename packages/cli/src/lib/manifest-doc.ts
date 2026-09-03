/**
 * Shared manifest-Document helpers — resolve the `manifest.yaml` path,
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
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { parseDocument, isSeq, YAMLSeq } from "yaml";
import type { Document } from "yaml";
import { MANIFEST_FILENAMES } from "./manifest";

/** Resolve `manifest.yaml` inside a project dir. */
export function resolveManifestPath(projectDir: string): string {
  const existing = MANIFEST_FILENAMES.find((name) =>
    existsSync(path.join(projectDir, name))
  );
  return path.join(projectDir, existing ?? MANIFEST_FILENAMES[0]);
}

/** Load the manifest as a yaml Document (empty doc when absent). */
export async function loadManifestDoc(
  projectDir: string,
): Promise<{ doc: Document.Parsed; file: string }> {
  const file = resolveManifestPath(projectDir);
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { doc: parseDocument(text), file };
}

/** Atomically write the doc back, creating the project dir if needed. */
export async function writeManifestDoc(
  file: string,
  doc: Document.Parsed,
): Promise<void> {
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true });
  const temporary = path.join(dir, `.${path.basename(file)}.tmp-${process.pid}-${randomUUID()}`);
  try {
    const handle = await open(temporary, "wx", 0o666);
    try {
      await handle.writeFile(doc.toString(), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
    const directory = await open(dir, "r").catch(() => null);
    if (directory) {
      await directory.sync().catch(() => {});
      await directory.close();
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * The named sequence node, creating (and attaching) an empty one if missing.
 * `key` is a single top-level key (the original, still-exact behavior) OR a
 * path for a nested key (e.g. `["engineStyles", "native"]`, #239) — the
 * `getIn`/`setIn` branch auto-vivifies any missing intermediate map, exactly
 * like a hand-written `engineStyles: { native: [...] }` would parse.
 */
export function ensureSeq(doc: Document.Parsed, key: string | readonly string[]): YAMLSeq {
  if (typeof key === "string") {
    let seq = doc.get(key, true);
    if (!isSeq(seq)) {
      const fresh = new YAMLSeq(doc.schema);
      doc.set(key, fresh);
      seq = fresh;
    }
    return seq as YAMLSeq;
  }
  let seq = doc.getIn(key, true);
  if (!isSeq(seq)) {
    const fresh = new YAMLSeq(doc.schema);
    doc.setIn(key, fresh);
    seq = fresh;
  }
  return seq as YAMLSeq;
}

/**
 * Unwrap a yaml seq item (or `getIn`-style Pair) to its string value: `null`
 * when the item isn't a string. Handles both a bare Scalar/Pair-shaped node
 * (`{ value: … }`, as `doc.get(key, true)` returns for seq items) and a
 * plain JS string (as a freshly-constructed `Scalar`'s `.value` or a raw
 * array entry would be).
 *
 * ARCH finding #25: this was two near-duplicate helpers — `unwrapScalar`
 * (manifest-config.ts) and `styleHrefOf` (theme-manager.ts) — with the same
 * shape-sniffing logic. One implementation here, consumed by both.
 */
export function scalarString(item: unknown): string | null {
  if (item && typeof item === "object" && "value" in (item as object)) {
    const v = (item as { value: unknown }).value;
    return typeof v === "string" ? v : null;
  }
  return typeof item === "string" ? item : null;
}
