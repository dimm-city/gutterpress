/**
 * Manifest `publish:` section reader/writers (#35) — the desktop's Publish
 * panel edits per-provider, NON-SECRET settings (itch target, Shopify shop
 * domain, …) here, keyed by provider id. Same yaml Document round-trip as
 * manifest-config.ts so author comments and formatting survive. Secrets never
 * touch this file, and neither does anything that belongs to one person:
 * {@link savePublishSettings} keeps those in the private store (selections.ts).
 */
import path from "node:path";
import { isMap, Scalar } from "yaml";
import type { Document } from "yaml";
import { loadManifestDoc, writeManifestDoc } from "../manifest-doc.ts";
import type { PublishSelectionsStore } from "./selections.ts";
import { canonicalTargetId } from "../targets.ts";
import { targetSettings } from "./run-publish.ts";

/** The raw `publish:` map, as written. */
function settingsKeysOf(doc: Document.Parsed): Record<string, unknown> {
  const node = doc.get("publish", true);
  return isMap(node) ? (node.toJSON() as Record<string, unknown>) : {};
}

function settingsFromDoc(
  doc: Document.Parsed,
): Record<string, Record<string, unknown>> {
  const node = doc.get("publish", true);
  if (!isMap(node)) return {};
  const json = node.toJSON() as Record<string, unknown>;
  const out: Record<string, Record<string, unknown>> = {};
  // Keyed by the registry's name for each target: a section an older book
  // keeps under an older name (`drivethrurpg`) is read into its target, with
  // the target's own section laid over it.
  const ids = new Set(Object.keys(json).map(canonicalTargetId));
  for (const id of ids) {
    const settings = targetSettings(json, id);
    const present = Object.entries(json).some(
      ([key, value]) => canonicalTargetId(key) === id && value && typeof value === "object" && !Array.isArray(value),
    );
    if (present) out[id] = settings;
  }
  return out;
}

/**
 * All `publish.*` sections, as plain JSON keyed by provider id (absent → {}).
 * With the person's private store, what they see: their own values for the
 * book laid over the manifest's.
 */
export async function readPublishSettings(
  projectDir: string,
  selections?: Pick<PublishSelectionsStore, "settings">,
): Promise<Record<string, Record<string, unknown>>> {
  const { doc } = await loadManifestDoc(projectDir);
  const settings = settingsFromDoc(doc);
  for (const [id, mine] of Object.entries((await selections?.settings(projectDir)) ?? {})) {
    settings[id] = { ...settings[id], ...mine };
  }
  return settings;
}

/**
 * Merge `values` into the target's `publish:` section. A value of `undefined`, `null`
 * or `""` deletes that key; a section left empty becomes the target's bare
 * name, so the target stays in the book. Returns the updated settings straight
 * from the in-memory document — no re-read.
 */
export async function setPublishProviderConfig(
  projectDir: string,
  providerId: string,
  values: Record<string, unknown>,
): Promise<Record<string, Record<string, unknown>>> {
  const { doc, file } = await loadManifestDoc(projectDir);
  // Written under the registry's name for the target. A book that already
  // keeps the target's section under an older name keeps it there, so a
  // target never ends up with two sections.
  const targetId = canonicalTargetId(providerId);
  const sectionKey = isMap(doc.getIn(["publish", targetId], true))
    ? targetId
    : (Object.keys(settingsKeysOf(doc)).find((key) => canonicalTargetId(key) === targetId) ?? targetId);

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") {
      doc.deleteIn(["publish", sectionKey, key]);
    } else {
      doc.setIn(["publish", sectionKey, key], value);
    }
  }

  // A target is in the book because its entry is there (ADR 0012): clearing
  // its last setting leaves just its name.
  const section = doc.getIn(["publish", sectionKey], true);
  if (isMap(section) && section.items.length === 0) {
    doc.setIn(["publish", sectionKey], bareTarget());
  }

  await writeManifestDoc(file, doc);
  return settingsFromDoc(doc);
}

/** A target with nothing to set, written as just its name (`itch:`). */
function bareTarget(): Scalar {
  const node = new Scalar(null);
  node.source = "";
  return node;
}

/**
 * Make the book's targets exactly `ids` (ADR 0012 §3), in the new form: one
 * `publish:` entry per target, a target with nothing to set written as just
 * its name. A kept target keeps its settings; a removed one goes, settings
 * and all. An older book's `targets:` list and `enabled:` ticks are dropped,
 * since the list now says it all. No targets is `publish: {}`, which means
 * none (no `publish:` key would mean the preset's).
 */
export async function setBookTargets(projectDir: string, ids: string[]): Promise<void> {
  const { doc, file } = await loadManifestDoc(projectDir);
  const wanted = [...new Set(ids.map(canonicalTargetId))];
  if (!isMap(doc.get("publish", true))) doc.set("publish", doc.createNode({}));
  const keys = Object.keys(settingsKeysOf(doc));
  for (const key of keys) {
    if (!wanted.includes(canonicalTargetId(key))) {
      doc.deleteIn(["publish", key]);
      continue;
    }
    doc.deleteIn(["publish", key, "enabled"]);
    const section = doc.getIn(["publish", key], true);
    if (!isMap(section) || section.items.length === 0) doc.setIn(["publish", key], bareTarget());
  }
  for (const id of wanted) {
    if (!keys.some((key) => canonicalTargetId(key) === id)) doc.setIn(["publish", id], bareTarget());
  }
  doc.delete("targets");
  await writeManifestDoc(file, doc);
}

/** `dir` as the manifest records a folder inside the book (relative, `/`); null when it lies outside. */
function insideBook(projectDir: string, dir: string): string | null {
  const rel = path.relative(projectDir, path.resolve(projectDir, dir));
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/") || ".";
}

/**
 * Save a provider's settings where each belongs. The team decides where the
 * book is published, so that is shared and goes in the manifest
 * ({@link setPublishProviderConfig}): which destinations, each one's target,
 * store, folder, environment and format. Only what is one person's own goes in
 * their private store, keyed to this book, and is removed from the manifest if
 * an older book kept it there:
 *
 * - `credential`: which of their saved accounts the book publishes with.
 * - `send`: `off` when they are not sending the book to this target this time.
 * - the local output folder `dir`, when it lies outside the book (a personal
 *   override). A folder inside the book is shared, and is written relative to
 *   it (an absolute in-book path is rewritten) so it means the same thing on
 *   every computer. An absolute path is never written to the manifest.
 * - their own Google Drive folder for the book (`myFolderId`, `myFolder`; #452),
 *   chosen when the book's folder is out of their reach or just for them. It is
 *   recorded with the book's folder it stands in for (`myFolderFor`: the
 *   manifest's `folderId`, else its `folder` name) and the account it was
 *   chosen with (`myFolderAccount`), so it lapses when either changes (see
 *   providers/gdrive.ts). Clearing `myFolderId` clears the whole record.
 *
 * Only the values passed are classified; the manifest is not rewritten unless
 * one of them changes it. Empty values clear. Returns the settings as the
 * person now sees them ({@link readPublishSettings}).
 */
export async function savePublishSettings(
  projectDir: string,
  target: string,
  values: Record<string, unknown>,
  selections: Pick<PublishSelectionsStore, "settings" | "setSettings">,
): Promise<Record<string, Record<string, unknown>>> {
  // One name per target, in the manifest and in the private store alike.
  const providerId = canonicalTargetId(target);
  const shared: Record<string, unknown> = {};
  const mine: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    const text = value === undefined || value === null ? "" : String(value).trim();
    const isDir = providerId === "local" && key === "dir";
    const inside = isDir && text ? insideBook(projectDir, text) : null;
    if (inside !== null) {
      shared[key] = inside;
      mine[key] = "";
    } else if (isDir || key === "credential" || key === "send" || (providerId === "gdrive" && key.startsWith("myFolder"))) {
      mine[key] = isDir && text ? path.resolve(projectDir, text) : text;
      shared[key] = "";
    } else {
      shared[key] = value;
    }
  }

  const inManifest = (await readPublishSettings(projectDir))[providerId] ?? {};
  if ("myFolderId" in mine) {
    const own = !!mine.myFolderId;
    const account = mine.credential ?? (await selections.settings(projectDir))[providerId]?.credential;
    mine.myFolder = own ? (mine.myFolder ?? "") : "";
    mine.myFolderFor = own ? String(inManifest.folderId || inManifest.folder || "") : "";
    mine.myFolderAccount = own ? (account ?? String(inManifest.credential ?? "")) : "";
  }

  // The private side first: a value is never in neither place if the second
  // write fails. An older book's copy in the manifest goes only when there is one.
  if (Object.keys(mine).length > 0) await selections.setSettings(projectDir, providerId, mine);
  const changes = Object.fromEntries(
    Object.entries(shared).filter(([key, value]) => value !== "" || key in inManifest),
  );
  if (Object.keys(changes).length > 0) await setPublishProviderConfig(projectDir, providerId, changes);
  return readPublishSettings(projectDir, selections);
}
