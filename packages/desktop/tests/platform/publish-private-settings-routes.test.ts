/**
 * What the Publish routes keep in the book's manifest and what they keep in
 * this person's private settings (`userData/publish-selections.json`), against
 * the REAL lib. The team decides where the book is published, so the
 * destinations ticked and each one's settings (target, store, Google Drive
 * folder, format, an output folder inside the book) are in the manifest. Only
 * which of their saved accounts the book uses, and an output folder outside
 * the book, are one person's own and never land in the manifest.
 * `publish/list` shows the person's view (their values over the manifest's),
 * and an older book that still keeps an account or an absolute folder in its
 * manifest keeps working until the next save moves it. A Drive folder of their
 * own, for when the book's is out of their reach (#452), is private too.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { POST as publishList } from "../../src/routes/api/publish/list/+server";
import { POST as publishRun } from "../../src/routes/api/publish/run/+server";
import { POST as publishSetConfig } from "../../src/routes/api/publish/set-config/+server";
import { POST as publishDestinationStatus } from "../../src/routes/api/publish/destinations/status/+server";

let root: string;
let book: string;
let userData: string;

const manifest = () => readFile(path.join(book, "manifest.yaml"), "utf8");
const privateFile = () => path.join(userData, "publish-selections.json");
const privateSettings = async () =>
  (JSON.parse(await readFile(privateFile(), "utf8")) as { projects: Record<string, unknown> }).projects[book];

function request(body: unknown): Request {
  return new Request("http://local.test", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const setConfig = (providerId: string, values: Record<string, unknown>) =>
  publishSetConfig({ request: request({ projectDir: book, providerId, values }) } as never);

interface Card {
  id: string;
  config: Record<string, string>;
  selectedAccount: string;
  connected: boolean;
  savedAccounts: Array<{ account: string }>;
}
async function card(id: string): Promise<Card> {
  const res = await publishList({ request: request({ projectDir: book }) } as never);
  return ((await res.json()) as Card[]).find((c) => c.id === id)!;
}

/** Two saved itch.io accounts: the default and "Studio". */
const credential = (account: string) => ({
  host: "itch.io",
  kind: "token",
  token: "T",
  createdAt: 1,
  ...(account ? { username: account, label: account } : { label: "itch.io" }),
});
const tokenStore = {
  get: async (key: string) => (key === "itch.io#Studio" ? credential("Studio") : key === "itch.io" ? credential("") : null),
  list: async () => [credential(""), credential("Studio")],
};

async function writeManifest(extra = ""): Promise<void> {
  await writeFile(path.join(book, "manifest.yaml"), `title: Field Guide\nauthors: [A]\npreset: book\n${extra}`, "utf8");
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "gutterpress-publish-private-"));
  book = path.join(root, "book");
  userData = path.join(root, "userData");
  await mkdir(book, { recursive: true });
  await writeManifest();
  registerHostServices(
    makeHostServices({
      fsGuard: { projectRoots: () => [book], readOnlyRoots: () => [] as string[] },
      desktop: { getUserDataPath: () => userData },
      remote: { tokenStore: tokenStore as never },
    }),
  );
});

afterEach(async () => {
  registerHostServices(undefined as unknown as HostServices);
  await rm(root, { recursive: true, force: true });
});

test("opening the wizard writes nothing: listing creates neither the private file nor a manifest change", async () => {
  const before = await manifest();
  await card("itch");
  expect(await manifest()).toBe(before);
  await expect(stat(privateFile())).rejects.toThrow();
});

test("the saved account a book publishes with is private, and the list shows it as selected", async () => {
  await setConfig("itch", { target: "me/book", credential: "Studio" });

  expect(await manifest()).not.toContain("Studio");
  expect(await manifest()).toContain("target: me/book");
  expect(await privateSettings()).toEqual({ itch: { credential: "Studio" } });
  expect((await stat(privateFile())).mode & 0o777).toBe(0o600);

  const itch = await card("itch");
  expect(itch.selectedAccount).toBe("Studio");
  expect(itch.connected).toBe(true);
  expect(itch.config).toEqual({ target: "me/book" }); // the account is a selection, not a settings field
  expect(itch.savedAccounts.map((a) => a.account).sort()).toEqual(["", "Studio"]);
});

test("picking the default account again clears the choice", async () => {
  await setConfig("itch", { credential: "Studio" });
  await setConfig("itch", { credential: "" });
  expect((await card("itch")).selectedAccount).toBe("");
  expect(await privateSettings()).toBeUndefined();
});

test("a book that still names an account in its manifest keeps using it; picking one moves it out", async () => {
  await writeManifest("publish:\n  itch:\n    target: me/book\n    credential: Studio\n");
  expect((await card("itch")).selectedAccount).toBe("Studio");
  expect((await card("itch")).connected).toBe(true);
  await expect(stat(privateFile())).rejects.toThrow(); // looking changed nothing

  await setConfig("itch", { credential: "Studio" });
  expect(await manifest()).not.toContain("credential");
  expect(await manifest()).toContain("target: me/book");
  expect(await privateSettings()).toEqual({ itch: { credential: "Studio" } });
  expect((await card("itch")).selectedAccount).toBe("Studio");
});

test("where the book is published is the team's: the Drive folder and format stay in the manifest", async () => {
  await setConfig("gdrive", { format: "html" });
  await setConfig("gdrive", { folderId: "F1", folder: "My Books" });

  expect(await manifest()).toContain("format: html");
  expect(await manifest()).toContain("folderId: F1");
  expect(await manifest()).toContain("folder: My Books");
  await expect(stat(privateFile())).rejects.toThrow();
  expect((await card("gdrive")).config).toEqual({ format: "html", folderId: "F1", folder: "My Books" });
});

test("ticking a destination is saved in the manifest, so a teammate sees it ticked", async () => {
  await setConfig("itch", { enabled: true });
  await setConfig("itch", { target: "me/book" });
  await setConfig("shopify", { enabled: true });
  await setConfig("shopify", { enabled: "" });

  expect(await manifest()).toMatch(/itch:\n\s+enabled: true\n\s+target: me\/book/);
  expect(await manifest()).not.toContain("shopify");
  expect((await card("itch")).config).toEqual({ enabled: "true", target: "me/book" });
  expect((await card("shopify")).config).toEqual({});
  await expect(stat(privateFile())).rejects.toThrow();
});

test("an output folder inside the book is saved relative to it, in the manifest", async () => {
  await setConfig("local", { dir: path.join(book, "exports") });
  expect(await manifest()).toContain("dir: exports");
  expect(await manifest()).not.toContain(book);
  await expect(stat(privateFile())).rejects.toThrow();
  expect((await card("local")).config.dir).toBe("exports");
});

test("an output folder outside the book is kept only in the private settings, and the list shows it", async () => {
  const outside = path.join(root, "Dropbox", "Books");
  await setConfig("local", { dir: path.join(book, "exports") });
  await setConfig("local", { dir: outside });

  expect(await manifest()).not.toContain("Dropbox");
  expect(await manifest()).not.toContain("dir:");
  expect(await privateSettings()).toEqual({ local: { dir: outside } });
  expect((await card("local")).config.dir).toBe(outside);
});

test("an older book's absolute in-book folder still works, and is rewritten relative on the next save of it", async () => {
  await writeManifest(`publish:\n  local:\n    dir: ${path.join(book, "dist")}\n`);
  expect((await card("local")).config.dir).toBe(path.join(book, "dist"));

  await setConfig("local", { dir: path.join(book, "dist") });
  expect(await manifest()).toContain("dir: dist");
  expect(await manifest()).not.toContain(book);
});

test("publishing copies the PDF to the private folder outside the book", async () => {
  const outside = path.join(root, "Dropbox");
  await setConfig("local", { dir: outside });
  const dist = path.join(book, "dist", "field-guide");
  await mkdir(dist, { recursive: true });
  await writeFile(path.join(dist, "field-guide-pdf.pdf"), "%PDF-1.4 fake");

  const res = await publishRun({
    request: request({ projectDir: book, providerId: "local", artifactPath: "dist/field-guide/field-guide-pdf.pdf" }),
  } as never);
  const result = (await res.json()) as { ok: boolean };

  expect(result.ok).toBe(true);
  expect(await readFile(path.join(outside, "field-guide-pdf.pdf"), "utf8")).toBe("%PDF-1.4 fake");
});

test("another book's private settings do not apply to this one", async () => {
  await setConfig("itch", { credential: "Studio" });
  const other = path.join(root, "other-book");
  await mkdir(other, { recursive: true });
  await writeFile(path.join(other, "manifest.yaml"), "title: Other\nauthors: [A]\npreset: book\n", "utf8");
  registerHostServices(
    makeHostServices({
      fsGuard: { projectRoots: () => [other], readOnlyRoots: () => [] as string[] },
      desktop: { getUserDataPath: () => userData },
      remote: { tokenStore: tokenStore as never },
    }),
  );
  const res = await publishList({ request: request({ projectDir: other }) } as never);
  const itch = ((await res.json()) as Card[]).find((c) => c.id === "itch")!;
  expect(itch.selectedAccount).toBe("");
});

// ── A Drive folder of one's own (#452) ───────────────────────────────────────

test("a Drive folder of one's own is private: the manifest is byte-identical, and it records the book's folder", async () => {
  await writeManifest("publish:\n  gdrive:\n    folderId: F1\n    folder: Harbor Books\n");
  const before = await manifest();

  await setConfig("gdrive", { myFolderId: "B1", myFolder: "Ben's Books" });
  expect(await manifest()).toBe(before);
  expect(await privateSettings()).toEqual({ gdrive: { myFolderId: "B1", myFolder: "Ben's Books", myFolderFor: "F1" } });

  await setConfig("gdrive", { myFolderId: "" }); // "Use the book's folder"
  expect(await manifest()).toBe(before);
  expect(await privateSettings()).toBeUndefined();
});

test("a teammate whose Google account can't reach the book's folder publishes to their own, and the manifest is untouched", async () => {
  // Ada set up the book's folder F1. Ben's Google account sees only his own B1:
  // Drive answers 404 for anything else, as it does under the drive.file scope.
  await writeManifest("publish:\n  gdrive:\n    folderId: F1\n    folder: Harbor Books\n");
  const before = await manifest();
  const ben = { host: "gdrive", kind: "google-oauth", token: "ben", createdAt: 1, label: "ben@example.com" };
  registerHostServices(
    makeHostServices({
      fsGuard: { projectRoots: () => [book], readOnlyRoots: () => [] as string[] },
      desktop: { getUserDataPath: () => userData },
      remote: { tokenStore: { get: async (key: string) => (key === "gdrive" ? ben : null), list: async () => [ben] } as never },
    }),
  );
  const uploads: Array<{ parents?: string[] }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.includes("oauth2.googleapis.com/token")) return json({ access_token: "at", expires_in: 3599 });
    if (url.includes("/drive/v3/about")) return json({ storageQuota: { usage: "0" } });
    if (/\/files\/B1\?fields=id,name,trashed,mimeType/.test(url)) {
      return json({ id: "B1", name: "Ben's Books", trashed: false, mimeType: "application/vnd.google-apps.folder" });
    }
    if (/\/files\/[^?]+\?fields=id,name,trashed,mimeType/.test(url)) return json({ error: { code: 404 } }, 404);
    if (url.includes("/drive/v3/files?q=")) return json({ files: [] });
    if (url.includes("uploadType=resumable")) {
      uploads.push(JSON.parse(String(init?.body)) as { parents?: string[] });
      return new Response(null, { status: 200, headers: { Location: "https://upload.test/s" } });
    }
    if (url === "https://upload.test/s") return json({ id: "f", name: "x", webViewLink: "https://drive.google.com/file/d/f/view" });
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  process.env.GUTTERPRESS_GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GUTTERPRESS_GOOGLE_CLIENT_SECRET = "test-client-secret";
  const status = async () =>
    (await publishDestinationStatus({ request: request({ projectDir: book, providerId: "gdrive" }) } as never)).json();
  try {
    expect(await status()).toEqual({ state: "unreachable", book: { title: "Harbor Books", reachable: false } });

    await setConfig("gdrive", { myFolderId: "B1", myFolder: "Ben's Books" });
    expect(await status()).toMatchObject({ state: "mine", destination: { id: "B1" }, book: { reachable: false } });

    const dist = path.join(book, "dist");
    await mkdir(dist, { recursive: true });
    await writeFile(path.join(dist, "field-guide-pdf.pdf"), "%PDF-1.4 fake");
    const res = await publishRun({
      request: request({ projectDir: book, providerId: "gdrive", artifactPath: "dist/field-guide-pdf.pdf" }),
    } as never);
    const ran = (await res.json()) as { ok: boolean; error?: string; issues?: unknown };
    expect(ran).toMatchObject({ ok: true });
    expect(uploads).toEqual([{ name: "field-guide-pdf.pdf", parents: ["B1"] }]);

    expect(await manifest()).toBe(before);
    expect(await privateSettings()).toEqual({ gdrive: { myFolderId: "B1", myFolder: "Ben's Books", myFolderFor: "F1" } });
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.GUTTERPRESS_GOOGLE_CLIENT_ID;
    delete process.env.GUTTERPRESS_GOOGLE_CLIENT_SECRET;
  }
});
