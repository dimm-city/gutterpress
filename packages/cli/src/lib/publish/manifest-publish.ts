/**
 * Manifest `publish:` section reader/writers (#35) — the viewer's Publish
 * panel edits per-provider, NON-SECRET settings (itch target, Shopify shop
 * domain, …) here, keyed by provider id. Same yaml Document round-trip as
 * manifest-config.ts so author comments and formatting survive. Secrets never
 * touch this file.
 */
import { isMap } from "yaml";
import type { Document } from "yaml";
import { loadManifestDoc, writeManifestDoc } from "../manifest-doc.ts";

function settingsFromDoc(
  doc: Document.Parsed,
): Record<string, Record<string, unknown>> {
  const node = doc.get("publish", true);
  if (!isMap(node)) return {};
  const json = node.toJSON() as Record<string, unknown>;
  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(json)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = value as Record<string, unknown>;
    }
  }
  return out;
}

/** All `publish.*` sections, as plain JSON keyed by provider id (absent → {}). */
export async function readPublishSettings(
  projectDir: string,
): Promise<Record<string, Record<string, unknown>>> {
  const { doc } = await loadManifestDoc(projectDir);
  return settingsFromDoc(doc);
}

/**
 * Merge `values` into `publish.<providerId>`. A value of `undefined`, `null`
 * or `""` deletes that key; emptied sections (and an emptied `publish:` map)
 * are removed rather than left dangling. Returns the updated settings straight
 * from the in-memory document — no re-read.
 */
export async function setPublishProviderConfig(
  projectDir: string,
  providerId: string,
  values: Record<string, unknown>,
): Promise<Record<string, Record<string, unknown>>> {
  const { doc, file } = await loadManifestDoc(projectDir);

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") {
      doc.deleteIn(["publish", providerId, key]);
    } else {
      doc.setIn(["publish", providerId, key], value);
    }
  }

  const section = doc.getIn(["publish", providerId], true);
  if (isMap(section) && section.items.length === 0) {
    doc.deleteIn(["publish", providerId]);
  }
  const publish = doc.get("publish", true);
  if (isMap(publish) && publish.items.length === 0) {
    doc.delete("publish");
  }

  await writeManifestDoc(file, doc);
  return settingsFromDoc(doc);
}
