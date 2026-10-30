/**
 * A teammate who can't reach the book's Drive folder picks their own, saved to
 * their private settings only (#452). One test per case of the issue.
 *
 * The fake Drive mirrors the `drive.file` scope: each account sees only the
 * folders it created or opened through Gutterpress, and answers 404 for any
 * other folder id ("not shared", "another account" and "trashed" are one case).
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileTokenStore } from "../../remote-auth/token-store.ts";
import { savePublishSettings } from "../manifest-publish.ts";
import { resolvePublishRequest, runPublish } from "../run-publish.ts";
import { PublishSelectionsStore } from "../selections.ts";
import type { PublishDeps } from "../types.ts";
import { gdriveProvider } from "./gdrive.ts";

const FOLDER_MIME = "application/vnd.google-apps.folder";
type Folder = { id: string; name: string };
type DriveFile = { id: string; name: string; webViewLink: string };

let root: string;
let book: string;
let store: PublishSelectionsStore;
let tokens: FileTokenStore;
let pdf: string;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const manifest = () => readFile(path.join(book, "manifest.yaml"), "utf8");
const writeManifest = (publish = "") =>
  writeFile(path.join(book, "manifest.yaml"), `title: My Book\nauthors: [A]\npreset: book\n${publish}`, "utf8");
const bookFolder = (id: string, name = "Harbor Books") =>
  `publish:\n  gdrive:\n    folderId: ${id}\n    folder: ${name}\n`;

/**
 * `reach`: each account (by its refresh token) → the folders it can see, most
 * recently changed first. `files`: a file already in a folder, by folder id.
 */
function fakeDrive(reach: Record<string, Folder[]>, files: Record<string, DriveFile> = {}) {
  const calls: Array<{ account: string; method: string; url: string; body?: string }> = [];
  let created = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : undefined;
    if (url.includes("oauth2.googleapis.com/token")) {
      return json({ access_token: `at:${new URLSearchParams(body).get("refresh_token")}`, expires_in: 3599 });
    }
    const account = (new Headers(init?.headers).get("authorization") ?? "").replace("Bearer at:", "");
    calls.push({ account, method, url, body });
    const visible = (reach[account] ??= []);
    if (url.includes("/drive/v3/about")) return json({ storageQuota: { usage: "0" } });
    const byId = /\/drive\/v3\/files\/([^?]+)\?fields=id,name,trashed,mimeType/.exec(url);
    if (byId) {
      const folder = visible.find((f) => f.id === decodeURIComponent(byId[1]!));
      return folder
        ? json({ ...folder, trashed: false, mimeType: FOLDER_MIME })
        : json({ error: { code: 404, message: "File not found." } }, 404);
    }
    if (url.includes("/drive/v3/files?") && method === "GET") {
      const params = new URL(url).searchParams;
      const q = params.get("q") ?? "";
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      if (parent) return json({ files: files[parent] ? [files[parent]] : [] });
      const name = /name='([^']+)'/.exec(q)?.[1];
      const found = name === undefined ? visible : visible.filter((f) => f.name === name);
      return json({ files: found.slice(0, Number(params.get("pageSize") ?? 100)) });
    }
    if (url.endsWith("/drive/v3/files?fields=id,name") && method === "POST") {
      const folder = { id: `new-${++created}`, name: (JSON.parse(body ?? "{}") as Folder).name };
      visible.unshift(folder);
      return json(folder);
    }
    if (url.includes("uploadType=resumable")) {
      return new Response(null, { status: 200, headers: { Location: "https://upload.test/session" } });
    }
    if (url === "https://upload.test/session") {
      return json({ id: "file-1", name: "my-book-pdf.pdf", webViewLink: "https://drive.google.com/file/d/file-1/view" });
    }
    throw new Error(`unexpected fake Drive call: ${method} ${url}`);
  }) as unknown as typeof fetch;

  /** Where the upload went: the parent folder of a new file, or the file updated in place. */
  const uploadedTo = () => {
    const start = calls.find((c) => c.url.includes("uploadType=resumable"));
    if (!start) return null;
    const updated = /\/files\/([^?]+)\?uploadType/.exec(start.url)?.[1];
    if (updated) return { updated };
    const meta = JSON.parse(start.body ?? "{}") as { name: string; parents?: string[] };
    return { folder: meta.parents?.[0], name: meta.name };
  };
  const createdFolder = () => calls.some((c) => c.method === "POST" && c.url.endsWith("/files?fields=id,name"));
  return { fetchImpl, calls, uploadedTo, createdFolder };
}

const deps = (fetchImpl: typeof fetch, over: Partial<PublishDeps> = {}): PublishDeps => ({
  tokenStore: tokens,
  env: {},
  fetch: fetchImpl,
  selections: store,
  ...over,
});

const status = async (fetchImpl: typeof fetch, over: Partial<PublishDeps> = {}) =>
  gdriveProvider.destinationStatus!(
    await resolvePublishRequest({ projectDir: book, providerId: "gdrive" }, deps(fetchImpl, over)),
  );

const publish = (fetchImpl: typeof fetch, over: Partial<PublishDeps> = {}, artifactPath = pdf) =>
  runPublish({ projectDir: book, providerId: "gdrive", artifactPath }, deps(fetchImpl, over));

/** This person's own folder, as the desktop's Drive step saves it. */
const chooseMine = (id: string, name: string) =>
  savePublishSettings(book, "gdrive", { myFolderId: id, myFolder: name }, store);

const mine = async () => (await store.settings(book)).gdrive ?? {};

beforeEach(async () => {
  process.env.GUTTERPRESS_GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GUTTERPRESS_GOOGLE_CLIENT_SECRET = "test-client-secret";
  root = await mkdtemp(path.join(tmpdir(), "gutterpress-gdrive-mine-"));
  book = path.join(root, "book");
  await mkdir(book);
  await writeManifest();
  store = new PublishSelectionsStore(path.join(root, "ben", "publish-selections.json"));
  tokens = new FileTokenStore(path.join(root, "ben", "credentials.json"));
  // Ben's two Google accounts: the default one and a named "work" one.
  await tokens.set("gdrive", { host: "gdrive", kind: "google-oauth", token: "ben", createdAt: 1 });
  await tokens.set("gdrive#work", { host: "gdrive", kind: "google-oauth", token: "ben-work", username: "work", createdAt: 1 });
  pdf = path.join(root, "my-book-pdf.pdf");
  await writeFile(pdf, Buffer.alloc(2048, 1));
});

afterEach(async () => {
  delete process.env.GUTTERPRESS_GOOGLE_CLIENT_ID;
  delete process.env.GUTTERPRESS_GOOGLE_CLIENT_SECRET;
  await rm(root, { recursive: true, force: true });
});

test("case 1: the book's folder is reachable, so it publishes there with no prompt", async () => {
  await writeManifest(bookFolder("F1"));
  const before = await manifest();
  const drive = fakeDrive({ ben: [{ id: "F1", name: "Harbor Books" }] });

  expect(await status(drive.fetchImpl)).toEqual({
    state: "book",
    destination: { id: "F1", title: "Harbor Books", url: "https://drive.google.com/drive/folders/F1" },
  });
  expect((await publish(drive.fetchImpl)).ok).toBe(true);
  expect(drive.uploadedTo()).toEqual({ folder: "F1", name: "my-book-pdf.pdf" });
  expect(await manifest()).toBe(before);
  await expect(stat(store.filePath)).rejects.toThrow();
});

test("case 2: an unreachable book folder asks for one of the person's own, saved privately with the folder it stands in for", async () => {
  await writeManifest(bookFolder("F1"));
  const before = await manifest();
  const drive = fakeDrive({ ben: [{ id: "B1", name: "Ben's Books" }] });

  expect(await status(drive.fetchImpl)).toEqual({ state: "unreachable", book: { title: "Harbor Books", reachable: false } });
  const failed = await publish(drive.fetchImpl);
  expect(failed.ok).toBe(false);
  expect(failed.error).toContain('the Drive folder "Harbor Books", which this Google account can\'t reach');
  // Publishing never creates a folder on its own here, and nothing is sent.
  expect(drive.createdFolder()).toBe(false);
  expect(drive.uploadedTo()).toBeNull();

  await chooseMine("B1", "Ben's Books");
  expect(await manifest()).toBe(before);
  expect(await mine()).toEqual({ myFolderId: "B1", myFolder: "Ben's Books", myFolderFor: "F1" });
  expect((await publish(drive.fetchImpl)).ok).toBe(true);
  expect(drive.uploadedTo()).toEqual({ folder: "B1", name: "my-book-pdf.pdf" });
  expect(await manifest()).toBe(before);
});

test("case 3: a book with no Drive folder yet takes the first pick into the manifest", async () => {
  const drive = fakeDrive({ ben: [] });
  expect(await status(drive.fetchImpl)).toEqual({ state: "unset" });

  await savePublishSettings(book, "gdrive", { folderId: "A1", folder: "Harbor Books" }, store);
  expect(await manifest()).toContain("folderId: A1");
  expect(await manifest()).toContain("folder: Harbor Books");
  await expect(stat(store.filePath)).rejects.toThrow();
});

test("case 4: once the book's folder is reachable again the person's own folder is kept, until they use the book's", async () => {
  await writeManifest(bookFolder("F1"));
  await chooseMine("B1", "Ben's Books");
  const drive = fakeDrive({ ben: [{ id: "F1", name: "Harbor Books" }, { id: "B1", name: "Ben's Books" }] });

  expect(await status(drive.fetchImpl)).toEqual({
    state: "mine",
    destination: { id: "B1", title: "Ben's Books", url: "https://drive.google.com/drive/folders/B1" },
    book: { title: "Harbor Books", reachable: true },
  });
  expect((await publish(drive.fetchImpl)).ok).toBe(true);
  expect(drive.uploadedTo()).toEqual({ folder: "B1", name: "my-book-pdf.pdf" }); // never switches silently

  // "Use the book's folder" clears the whole record.
  await savePublishSettings(book, "gdrive", { myFolderId: "" }, store);
  expect(await mine()).toEqual({});
  expect((await status(drive.fetchImpl)).state).toBe("book");
});

test("case 5: when the team changes the book's folder, an override for the old one no longer applies", async () => {
  await writeManifest(bookFolder("F1"));
  await chooseMine("B1", "Ben's Books");
  await writeManifest(bookFolder("F2", "Harbor Press")); // a pull brought a new folder

  // The new folder is out of reach: case 2 again, and the old override is not used.
  const unreachable = fakeDrive({ ben: [{ id: "B1", name: "Ben's Books" }] });
  expect(await status(unreachable.fetchImpl)).toEqual({ state: "unreachable", book: { title: "Harbor Press", reachable: false } });
  expect((await publish(unreachable.fetchImpl)).ok).toBe(false);
  expect(unreachable.uploadedTo()).toBeNull();

  // The new folder is reachable: use it, and drop the stale override.
  const reachable = fakeDrive({ ben: [{ id: "F2", name: "Harbor Press" }, { id: "B1", name: "Ben's Books" }] });
  expect((await status(reachable.fetchImpl)).state).toBe("book");
  expect(await mine()).toEqual({});
  expect((await publish(reachable.fetchImpl)).ok).toBe(true);
  expect(reachable.uploadedTo()).toEqual({ folder: "F2", name: "my-book-pdf.pdf" });
});

test("case 6: when the person's own folder is gone it asks again, and never falls back to the manifest", async () => {
  await writeManifest(bookFolder("F1"));
  const before = await manifest();
  await chooseMine("B1", "Ben's Books");
  const drive = fakeDrive({ ben: [{ id: "F1", name: "Harbor Books" }] }); // B1 trashed

  expect(await status(drive.fetchImpl)).toEqual({
    state: "unreachable",
    book: { title: "Harbor Books", reachable: true },
    mine: "Ben's Books",
  });
  const failed = await publish(drive.fetchImpl);
  expect(failed.error).toContain('Your own Drive folder "Ben\'s Books" for this book can\'t be reached');
  expect(drive.uploadedTo()).toBeNull();
  expect(drive.createdFolder()).toBe(false);
  expect(await manifest()).toBe(before);
  expect((await mine()).myFolderId).toBe("B1"); // still theirs to replace
});

test("case 7: changing the folder while the book's is reachable writes the manifest; a folder just for me is private", async () => {
  await writeManifest(bookFolder("F1"));
  const drive = fakeDrive({ ben: [{ id: "F1", name: "Harbor Books" }, { id: "F2", name: "New Home" }] });

  await savePublishSettings(book, "gdrive", { folderId: "F2", folder: "New Home" }, store);
  expect(await manifest()).toContain("folderId: F2");
  await expect(stat(store.filePath)).rejects.toThrow();

  const before = await manifest();
  await chooseMine("F1", "Harbor Books");
  expect(await manifest()).toBe(before);
  expect(await mine()).toEqual({ myFolderId: "F1", myFolder: "Harbor Books", myFolderFor: "F2" });
  expect(await status(drive.fetchImpl)).toMatchObject({ state: "mine", book: { title: "New Home", reachable: true } });
});

test("case 8: a folder named only by name is each person's own of that name; several are told apart", async () => {
  await writeManifest("publish:\n  gdrive:\n    folder: Harbor Books\n");
  const before = await manifest();

  // None yet: found or created in this person's own Drive; the id stays out of the manifest.
  const fresh = fakeDrive({ ben: [] });
  expect(await status(fresh.fetchImpl)).toEqual({ state: "by-name", name: "Harbor Books", several: false });
  const created = await publish(fresh.fetchImpl);
  expect(created.ok).toBe(true);
  expect(fresh.uploadedTo()).toEqual({ folder: "new-1", name: "my-book-pdf.pdf" });
  expect(created.outcome?.kind === "published" && created.outcome.followUp?.join(" ")).not.toContain("folderId");
  expect(await manifest()).toBe(before);

  // Several: the most recently changed one is used, and the result says which.
  const several = fakeDrive({ ben: [{ id: "H2", name: "Harbor Books" }, { id: "H1", name: "Harbor Books" }] });
  expect(await status(several.fetchImpl)).toMatchObject({ state: "by-name", destination: { id: "H2" }, several: true });
  const used = await publish(several.fetchImpl);
  expect(several.uploadedTo()).toEqual({ folder: "H2", name: "my-book-pdf.pdf" });
  expect(used.outcome?.kind === "published" && used.outcome.detail).toContain(
    'Several of your folders are named "Harbor Books"; this is the most recently changed one: https://drive.google.com/drive/folders/H2',
  );

  // The desktop's choice among them is private, recorded against the name.
  await chooseMine("H1", "Harbor Books");
  expect(await mine()).toEqual({ myFolderId: "H1", myFolder: "Harbor Books", myFolderFor: "Harbor Books" });
  expect((await status(several.fetchImpl)).state).toBe("mine");
  expect(await manifest()).toBe(before);
});

test("case 9: reachability is checked with the book's account; an override records its account and lapses on a switch", async () => {
  await writeManifest(bookFolder("F1"));
  // Only Ben's work account can reach the book's folder.
  const drive = fakeDrive({ ben: [{ id: "B1", name: "Ben's Books" }], "ben-work": [{ id: "F1", name: "Harbor Books" }] });

  expect((await status(drive.fetchImpl)).state).toBe("unreachable");
  await chooseMine("B1", "Ben's Books"); // made with the default account
  expect((await status(drive.fetchImpl)).state).toBe("mine");

  await savePublishSettings(book, "gdrive", { credential: "work" }, store);
  drive.calls.length = 0;
  expect(await status(drive.fetchImpl)).toMatchObject({ state: "book", destination: { id: "F1" } });
  expect(drive.calls.every((c) => c.account === "ben-work")).toBe(true);
  expect(await mine()).toEqual({ credential: "work" }); // the override made with the other account is dropped

  // An override made with the work account records it.
  await writeManifest(bookFolder("F9", "Elsewhere"));
  await chooseMine("F1", "Harbor Books");
  expect(await mine()).toEqual({
    credential: "work",
    myFolderId: "F1",
    myFolder: "Harbor Books",
    myFolderFor: "F9",
    myFolderAccount: "work",
  });
  // Switching back to the default account re-checks: its own folder is out of reach there (case 6).
  await savePublishSettings(book, "gdrive", { credential: "" }, store);
  expect((await status(drive.fetchImpl)).state).toBe("unreachable");
});

test("case 10: the zipped HTML export goes to the same folder as the PDF", async () => {
  await writeManifest(`${bookFolder("F1")}    format: html\n`);
  await chooseMine("B1", "Ben's Books");
  const site = path.join(root, "site");
  await mkdir(site);
  await writeFile(path.join(site, "book.html"), "<!doctype html><title>x</title>");
  const drive = fakeDrive({ ben: [{ id: "B1", name: "Ben's Books" }] });

  const result = await publish(drive.fetchImpl, {}, site);
  expect(result.ok).toBe(true);
  expect(drive.uploadedTo()).toEqual({ folder: "B1", name: "my-book-website.zip" });
});

test("case 11: without the private store (the CLI) only the manifest is read, and nothing is written on failure", async () => {
  await writeManifest(bookFolder("F1"));
  await chooseMine("B1", "Ben's Books");
  const before = await manifest();
  const privateBefore = await readFile(store.filePath, "utf8");
  const drive = fakeDrive({ ben: [{ id: "B1", name: "Ben's Books" }] });

  const failed = await publish(drive.fetchImpl, { selections: undefined });
  expect(failed.ok).toBe(false);
  expect(failed.error).toContain("pass --folder-id <id> or --folder <name>");
  expect(drive.uploadedTo()).toBeNull();
  expect(await manifest()).toBe(before);
  expect(await readFile(store.filePath, "utf8")).toBe(privateBefore);

  // A folder for this run only (`--folder-id`) publishes there and saves nothing.
  const once = await runPublish(
    { projectDir: book, providerId: "gdrive", artifactPath: pdf, settings: { folderId: "B1", folder: "" } },
    deps(drive.fetchImpl, { selections: undefined }),
  );
  expect(once.ok).toBe(true);
  expect(drive.uploadedTo()).toEqual({ folder: "B1", name: "my-book-pdf.pdf" });
  expect(await manifest()).toBe(before);
});

test("case 12: after a merge conflict on publish.gdrive the app reads whatever folderId resulted", async () => {
  // Ada picked A1 and Ben picked B9 as the book's folder; the merge kept A1.
  await writeManifest(bookFolder("B9", "Ben's pick"));
  await chooseMine("B1", "Ben's Books");
  await writeManifest(bookFolder("A1", "Ada's pick"));
  const drive = fakeDrive({ ben: [{ id: "B1", name: "Ben's Books" }], ada: [{ id: "A1", name: "Ada's pick" }] });
  await tokens.set("gdrive#ada", { host: "gdrive", kind: "google-oauth", token: "ada", username: "ada", createdAt: 1 });

  expect((await status(drive.fetchImpl, { selections: undefined, credentialAccount: "ada" })).state).toBe("book"); // case 1
  // Ben's override was for B9: it no longer applies, and A1 is out of his reach (cases 5 and 2).
  expect(await status(drive.fetchImpl)).toEqual({ state: "unreachable", book: { title: "Ada's pick", reachable: false } });
});

test("case 13: re-publishing updates the same file in the person's own folder and never touches the team's", async () => {
  await writeManifest(bookFolder("F1"));
  await chooseMine("B1", "Ben's Books");
  const drive = fakeDrive(
    { ben: [{ id: "F1", name: "Harbor Books" }, { id: "B1", name: "Ben's Books" }] },
    {
      F1: { id: "team-file", name: "my-book-pdf.pdf", webViewLink: "https://drive.google.com/file/d/team-file/view" },
      B1: { id: "ben-file", name: "my-book-pdf.pdf", webViewLink: "https://drive.google.com/file/d/ben-file/view" },
    },
  );

  expect((await publish(drive.fetchImpl)).ok).toBe(true);
  expect(drive.uploadedTo()).toEqual({ updated: "ben-file" });
  expect(drive.calls.some((c) => decodeURIComponent(c.url).includes("'F1' in parents"))).toBe(false);
  expect(drive.calls.some((c) => c.url.includes("team-file"))).toBe(false);
});
