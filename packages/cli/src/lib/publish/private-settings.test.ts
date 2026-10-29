/**
 * What is shared and what is private in a book's publish settings: the team
 * decides where the book is published, so that is in the manifest; the
 * private store (selections.ts) holds only one person's own values for a book
 * (which of their accounts it uses, an output folder outside the book), and
 * `savePublishSettings` puts each value where it belongs.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileTokenStore } from "../remote-auth/token-store.ts";
import { artifactName, resolveOutputDir } from "../output-paths.ts";
import { readPublishSettings, savePublishSettings } from "./manifest-publish.ts";
import { resolvePublishRequest, runPublish } from "./run-publish.ts";
import { PublishSelectionsStore } from "./selections.ts";
import type { PublishDeps } from "./types.ts";

let root: string;
let book: string;
let store: PublishSelectionsStore;

const manifestOf = (dir = book) => readFile(path.join(dir, "manifest.yaml"), "utf8");

async function makeBook(publish = ""): Promise<string> {
  const dir = await mkdtemp(path.join(root, "book-"));
  await writeFile(path.join(dir, "manifest.yaml"), `title: Test Book\nauthors: [A]\npreset: book\n${publish}`);
  return dir;
}

const deps = (over: Partial<PublishDeps> = {}): PublishDeps => ({
  tokenStore: new FileTokenStore(path.join(root, "creds.json")),
  env: {},
  selections: store,
  ...over,
});

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "gutterpress-private-settings-"));
  store = new PublishSelectionsStore(path.join(root, "private", "publish-selections.json"));
  book = await makeBook();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("PublishSelectionsStore — a person's private values for a book", () => {
  test("keeps each book's values apart, merges, and clears with an empty value", async () => {
    expect(await store.settings(book)).toEqual({});

    await store.setSettings(book, "local", { dir: "/one", note: "x" });
    await store.setSettings(book, "local", { dir: "/two" });
    await store.setSettings("/some/other/book", "local", { dir: "/other" });
    expect(await store.settings(book)).toEqual({ local: { dir: "/two", note: "x" } });

    await store.setSettings(book, "local", { dir: "", note: null });
    expect(await store.settings(book)).toEqual({}); // an emptied provider and book are removed
    expect(await store.settings("/some/other/book")).toEqual({ local: { dir: "/other" } });
  });

  test("the account a book publishes with is the same entry the project default uses", async () => {
    await store.setProject(book, "itch", "Studio");
    expect(await store.settings(book)).toEqual({ itch: { credential: "Studio" } });
    await store.setSettings(book, "itch", { credential: "Home" });
    expect(await store.resolve("itch", book)).toBe("Home");
  });

  test("writes nothing when nothing changes", async () => {
    await store.setSettings(book, "itch", { credential: "" });
    await store.setProject(book, "itch", null);
    await expect(stat(store.filePath)).rejects.toThrow();
  });

  test("is a private file", async () => {
    await store.setSettings(book, "local", { dir: "/elsewhere" });
    expect((await stat(store.filePath)).mode & 0o777).toBe(0o600);
  });
});

describe("precedence: private, then the manifest, then the default", () => {
  test("a private account wins over the manifest's; the manifest's still works alone", async () => {
    const dir = await makeBook("publish:\n  itch:\n    target: a/b\n    credential: Shared\n");

    // Older book, nothing private yet: the manifest's account is used.
    let req = await resolvePublishRequest({ projectDir: dir, providerId: "itch" }, deps());
    expect(req.deps.credentialAccount).toBe("Shared");

    await store.setSettings(dir, "itch", { credential: "Mine" });
    req = await resolvePublishRequest({ projectDir: dir, providerId: "itch" }, deps());
    expect(req.deps.credentialAccount).toBe("Mine");
    expect(req.config).toEqual({ target: "a/b", credential: "Mine" });
  });

  test("a front-end default account is used only when neither names one", async () => {
    const dir = await makeBook("publish:\n  itch:\n    target: a/b\n");
    const withDefault = deps({ credentialAccount: "Everywhere" });
    expect((await resolvePublishRequest({ projectDir: dir, providerId: "itch" }, withDefault)).deps.credentialAccount).toBe("Everywhere");

    await store.setSettings(dir, "itch", { credential: "Mine" });
    expect((await resolvePublishRequest({ projectDir: dir, providerId: "itch" }, withDefault)).deps.credentialAccount).toBe("Mine");
  });

  test("another book's private values do not apply", async () => {
    const dir = await makeBook("publish:\n  itch:\n    target: a/b\n");
    await store.setSettings(book, "itch", { credential: "Mine" });
    const req = await resolvePublishRequest({ projectDir: dir, providerId: "itch" }, deps());
    expect(req.deps.credentialAccount).toBeUndefined();
    expect(req.config).toEqual({ target: "a/b" });
  });

  test("without a private store the manifest alone applies (the CLI)", async () => {
    const dir = await makeBook("publish:\n  itch:\n    credential: Shared\n");
    const req = await resolvePublishRequest({ projectDir: dir, providerId: "itch" }, deps({ selections: undefined }));
    expect(req.deps.credentialAccount).toBe("Shared");
  });

  test("a private output folder wins over the manifest's; the team's Drive folder and format stay", async () => {
    const dir = await makeBook("publish:\n  local:\n    dir: dist\n  gdrive:\n    folderId: F1\n    folder: Team Folder\n    format: html\n");
    await store.setSettings(dir, "local", { dir: "/Users/ada/Dropbox" });
    expect((await resolvePublishRequest({ projectDir: dir, providerId: "local" }, deps())).config).toEqual({ dir: "/Users/ada/Dropbox" });
    const drive = await resolvePublishRequest({ projectDir: dir, providerId: "gdrive" }, deps());
    expect(drive.config).toEqual({ folderId: "F1", folder: "Team Folder", format: "html" });
    expect(drive.artifact.format).toBe("html");
  });

  test("readPublishSettings shows the person's view, and the manifest alone without a store", async () => {
    const dir = await makeBook("publish:\n  itch:\n    target: a/b\n    credential: Shared\n");
    await store.setSettings(dir, "itch", { credential: "Mine" });
    await store.setSettings(dir, "local", { dir: "/elsewhere" });
    expect(await readPublishSettings(dir, store)).toEqual({
      itch: { target: "a/b", credential: "Mine" },
      local: { dir: "/elsewhere" },
    });
    expect(await readPublishSettings(dir)).toEqual({ itch: { target: "a/b", credential: "Shared" } });
  });
});

describe("savePublishSettings — what is shared and what is private", () => {
  test("what the team shares goes to the manifest and nothing goes to the private store", async () => {
    await savePublishSettings(book, "itch", { enabled: true, target: "me/book", channel: "pdf" }, store);
    await savePublishSettings(book, "shopify", { shop: "s.myshopify.com", productId: "1", apiVersion: "2026-04" }, store);
    await savePublishSettings(book, "azure-swa", { env: "preview" }, store);
    await savePublishSettings(book, "drivethrurpg", { productUrl: "https://example.com/p" }, store);
    await savePublishSettings(book, "gdrive", { enabled: true, folderId: "F1", folder: "My Books", format: "html" }, store);

    expect(await readPublishSettings(book)).toEqual({
      itch: { enabled: true, target: "me/book", channel: "pdf" },
      shopify: { shop: "s.myshopify.com", productId: "1", apiVersion: "2026-04" },
      "azure-swa": { env: "preview" },
      drivethrurpg: { productUrl: "https://example.com/p" },
      gdrive: { enabled: true, folderId: "F1", folder: "My Books", format: "html" },
    });
    expect(await store.settings(book)).toEqual({});
  });

  test("ticking a destination is saved in the manifest, and unticking it removes only the tick", async () => {
    await savePublishSettings(book, "itch", { target: "me/book", enabled: true }, store);
    await savePublishSettings(book, "itch", { enabled: "" }, store);
    expect(await readPublishSettings(book)).toEqual({ itch: { target: "me/book" } });
    await savePublishSettings(book, "kdp", { enabled: true }, store);
    await savePublishSettings(book, "kdp", { enabled: "" }, store);
    expect(await readPublishSettings(book)).toEqual({ itch: { target: "me/book" } }); // an emptied section goes
  });

  test("the account choice goes to the private store, never the manifest", async () => {
    await savePublishSettings(book, "itch", { target: "me/book", credential: "Studio" }, store);
    expect(await manifestOf()).not.toContain("Studio");
    expect(await readPublishSettings(book)).toEqual({ itch: { target: "me/book" } });
    expect(await store.settings(book)).toEqual({ itch: { credential: "Studio" } });

    // Back to the default account clears it.
    await savePublishSettings(book, "itch", { credential: "" }, store);
    expect(await store.settings(book)).toEqual({});
  });

  test("saving a value moves it out of an older book's manifest", async () => {
    const dir = await makeBook("publish:\n  itch:\n    target: a/b\n    credential: Shared\n");
    await savePublishSettings(dir, "itch", { credential: "Shared" }, store);

    expect(await readPublishSettings(dir)).toEqual({ itch: { target: "a/b" } });
    expect(await store.settings(dir)).toEqual({ itch: { credential: "Shared" } });
  });

  test("a folder inside the book is recorded relative to it", async () => {
    await savePublishSettings(book, "local", { dir: path.join(book, "exports") }, store);
    expect(await readPublishSettings(book)).toEqual({ local: { dir: "exports" } });
    expect(await store.settings(book)).toEqual({});

    await savePublishSettings(book, "local", { dir: path.join(book, "out", "final") }, store);
    expect((await readPublishSettings(book)).local?.dir).toBe("out/final");

    await savePublishSettings(book, "local", { dir: "./dist/" }, store);
    expect((await readPublishSettings(book)).local?.dir).toBe("dist");
  });

  test("an absolute in-book folder from an older book is rewritten relative on the next save of it", async () => {
    const dir = await makeBook();
    await writeFile(path.join(dir, "manifest.yaml"), `title: T\npreset: book\npublish:\n  local:\n    dir: ${path.join(dir, "dist")}\n    format: html\n`);
    // Until it is saved again it still works as written.
    const before = await resolvePublishRequest({ projectDir: dir, providerId: "local" }, deps());
    expect(before.config.dir).toBe(path.join(dir, "dist"));

    await savePublishSettings(dir, "local", { dir: path.join(dir, "dist") }, store);
    expect(await readPublishSettings(dir)).toEqual({ local: { dir: "dist", format: "html" } });
    expect(await store.settings(dir)).toEqual({});
  });

  test("a folder outside the book is kept only in the private store", async () => {
    const outside = path.join(root, "Dropbox", "Exports");
    const dir = await makeBook("publish:\n  local:\n    dir: exports\n    format: html\n");
    await savePublishSettings(dir, "local", { dir: outside }, store);

    expect(await readPublishSettings(dir)).toEqual({ local: { format: "html" } }); // the manifest's dir is gone
    expect(await manifestOf(dir)).not.toContain("Dropbox");
    expect(await store.settings(dir)).toEqual({ local: { dir: outside } });
    expect((await readPublishSettings(dir, store)).local?.dir).toBe(outside);
  });

  test("a relative folder that leaves the book counts as outside, and is stored absolute", async () => {
    await savePublishSettings(book, "local", { dir: "../shared-exports" }, store);
    expect(await readPublishSettings(book)).toEqual({});
    expect(await store.settings(book)).toEqual({ local: { dir: path.resolve(book, "../shared-exports") } });
  });

  test("a sibling folder with the book's name as a prefix is outside", async () => {
    await savePublishSettings(book, "local", { dir: `${book}-copy/dist` }, store);
    expect(await readPublishSettings(book)).toEqual({});
    expect((await store.settings(book)).local?.dir).toBe(`${book}-copy/dist`);
  });

  test("choosing a folder inside the book again drops the private outside one", async () => {
    await savePublishSettings(book, "local", { dir: path.join(root, "Elsewhere") }, store);
    await savePublishSettings(book, "local", { dir: path.join(book, "dist") }, store);
    expect(await store.settings(book)).toEqual({});
    expect((await readPublishSettings(book, store)).local?.dir).toBe("dist");
  });

  test("clearing the folder clears it everywhere", async () => {
    await savePublishSettings(book, "local", { dir: path.join(root, "Elsewhere") }, store);
    await savePublishSettings(book, "local", { dir: path.join(book, "dist") }, store);
    await savePublishSettings(book, "local", { dir: "" }, store);
    expect(await readPublishSettings(book, store)).toEqual({});
  });

  test("does not rewrite the manifest when only private values change", async () => {
    const dir = await makeBook("publish:\n  itch:\n    target: a/b\n");
    const before = (await stat(path.join(dir, "manifest.yaml"))).ino; // a rewrite replaces the file
    await savePublishSettings(dir, "itch", { credential: "Mine" }, store);
    await savePublishSettings(dir, "local", { dir: path.join(root, "Elsewhere") }, store);
    expect((await stat(path.join(dir, "manifest.yaml"))).ino).toBe(before);
    expect(await manifestOf(dir)).toBe("title: Test Book\nauthors: [A]\npreset: book\npublish:\n  itch:\n    target: a/b\n");

    await savePublishSettings(dir, "itch", { channel: "pdf" }, store); // a shared value does
    expect((await stat(path.join(dir, "manifest.yaml"))).ino).not.toBe(before);
  });

  test("returns the settings as the person now sees them", async () => {
    const settings = await savePublishSettings(book, "itch", { target: "me/book", credential: "Studio" }, store);
    expect(settings).toEqual({ itch: { target: "me/book", credential: "Studio" } });
  });
});

describe("publishing with a private folder", () => {
  test("the local folder copies the PDF to a private folder outside the book", async () => {
    const outside = path.join(root, "Dropbox");
    const out = resolveOutputDir(book, "Test Book");
    await mkdir(out, { recursive: true });
    const pdf = path.join(out, artifactName("Test Book", "pdf"));
    await writeFile(pdf, "%PDF-1.4 fake");

    await savePublishSettings(book, "local", { dir: outside }, store);
    const result = await runPublish({ projectDir: book, providerId: "local" }, deps());

    expect(result.ok).toBe(true);
    expect(await readFile(path.join(outside, path.basename(pdf)), "utf8")).toBe("%PDF-1.4 fake");
  });
});
