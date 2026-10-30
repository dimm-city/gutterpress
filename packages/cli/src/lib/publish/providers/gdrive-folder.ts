/**
 * Which Google Drive folder one person publishes to (#452), for the `gdrive`
 * provider (gdrive.ts). The book's folder in the manifest is the team's; a
 * person whose Google connection can't reach it publishes to a folder of their
 * own, kept in their private store for the book, and that folder stands in for
 * the book's only while the book's folder and their account are the ones it
 * was chosen for.
 */
import {
  createFolder,
  ensureFolder,
  findFoldersByName,
  getFolderById,
  type DriveFolder,
} from "../google-drive.ts";
import type { PublishDestinationStatus, PublishProduct, PublishRequest } from "../types.ts";

/** Default folder name when the manifest sets neither `folder` nor
 * `folderId` (D5, ratified: one shared "Gutterpress" folder, not
 * per-book-title folders). */
export const DEFAULT_FOLDER_NAME = "Gutterpress";

interface GDriveConfig {
  /** The book's folder: the manifest's, which the team shares. */
  folder?: string;
  folderId?: string;
  /** This person's own folder for the book (#452), from their private store:
   *  its id and name, the book's folder it stands in for (`myFolderFor`: that
   *  folder's id, or its name when the book records only a name) and the saved
   *  account it was chosen with (`myFolderAccount`, absent for the default). */
  myFolderId?: string;
  myFolder?: string;
  myFolderFor?: string;
  myFolderAccount?: string;
  /** The saved account this request publishes with ("" = the default). */
  account: string;
}

/** Clears this person's own folder for a book in their private store. */
const NO_OWN_FOLDER = { myFolderId: "", myFolder: "", myFolderFor: "", myFolderAccount: "" };

function readConfig(req: PublishRequest): GDriveConfig {
  const text = (key: string): string | undefined => {
    const value = req.config[key];
    return (typeof value === "string" ? value.trim() : "") || undefined;
  };
  return {
    folder: text("folder"),
    folderId: text("folderId"),
    myFolderId: text("myFolderId"),
    myFolder: text("myFolder"),
    myFolderFor: text("myFolderFor"),
    myFolderAccount: text("myFolderAccount"),
    account: req.deps.credentialAccount?.trim() ?? "",
  };
}

/**
 * Where this person publishes (#452). The book's folder is the team's: an id,
 * checked with the account this person publishes with (`drive.file` answers 404
 * for a folder it can't see, so "not shared with Gutterpress", "another
 * account" and "trashed" are one case), or a name, which each person finds or
 * creates in their own Drive. Their own folder, from their private store,
 * stands in for it while it was chosen for the book's current folder and with
 * the account they publish with now; one recorded against another folder or
 * account no longer applies, and is dropped once the book's folder is
 * reachable. Never writes the manifest or creates a folder.
 */
export async function resolveFolder(req: PublishRequest, accessToken: string): Promise<PublishDestinationStatus> {
  const fetchImpl = req.deps.fetch ?? globalThis.fetch;
  const cfg = readConfig(req);
  let found: DriveFolder[] = [];
  if (cfg.folderId) {
    const folder = await getFolderById(fetchImpl, accessToken, cfg.folderId);
    if (folder) found = [folder];
  } else if (cfg.folder) {
    found = await findFoldersByName(fetchImpl, accessToken, cfg.folder, 2);
  }
  const first = found[0];
  const book = { title: cfg.folder || cfg.folderId || "", reachable: !cfg.folderId || !!first };

  if (cfg.myFolderId) {
    const bookKey = cfg.folderId || cfg.folder;
    if (bookKey && cfg.myFolderFor === bookKey && (cfg.myFolderAccount ?? "") === cfg.account) {
      const mine = await getFolderById(fetchImpl, accessToken, cfg.myFolderId);
      return mine
        ? { state: "mine", destination: toDestination(mine), book }
        : { state: "unreachable", book, mine: cfg.myFolder || cfg.myFolderId };
    }
    if (book.reachable) {
      await req.deps.selections?.setSettings(req.project.projectDir, "gdrive", NO_OWN_FOLDER);
    }
  }
  if (cfg.folderId) {
    return first ? { state: "book", destination: toDestination(first) } : { state: "unreachable", book };
  }
  if (cfg.folder) {
    return {
      state: "by-name",
      name: cfg.folder,
      ...(first ? { destination: toDestination(first) } : {}),
      several: found.length > 1,
    };
  }
  return { state: "unset" };
}

/** The folder an upload goes to. An unreachable one fails, naming it and how
 * to publish elsewhere: publishing never creates a folder in its place. */
export async function uploadFolder(
  where: PublishDestinationStatus,
  fetchImpl: typeof fetch,
  accessToken: string,
): Promise<PublishProduct> {
  switch (where.state) {
    case "unreachable":
      throw new Error(
        where.mine
          ? `Your own Drive folder "${where.mine}" for this book can't be reached any more: it was trashed or deleted, or belongs to another Google account. Choose a folder you can reach on the Google Drive step (it is saved for you only).`
          : `This book publishes to the Drive folder "${where.book.title}", which this Google account can't reach: it isn't shared with Gutterpress under this account, or it was trashed or deleted. The book keeps its folder for everyone else. To publish to a folder you can reach, choose one for yourself on the Google Drive step in the desktop app (saved for you only), or pass --folder-id <id> or --folder <name> to "gutterpress publish" for one run.`,
      );
    case "unset":
      return toDestination(await ensureFolder(fetchImpl, accessToken, DEFAULT_FOLDER_NAME));
    case "by-name":
      return where.destination ?? toDestination(await createFolder(fetchImpl, accessToken, where.name));
    default:
      return where.destination;
  }
}

function folderUrl(id: string): string {
  return `https://drive.google.com/drive/folders/${id}`;
}

export function toDestination(folder: DriveFolder): PublishProduct {
  return { id: folder.id, title: folder.name, url: folderUrl(folder.id) };
}
