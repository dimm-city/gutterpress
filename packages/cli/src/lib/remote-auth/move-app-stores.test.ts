/**
 * One store per person, shared by the terminal and the app (ADR 0012 §4): the
 * shared store's redacted views and change events, and the one-time move of
 * what the app kept in its own folder.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileTokenStore, type HostCredential } from "./token-store.ts";
import { PublishSelectionsStore } from "../publish/selections.ts";
import { moveAppStores } from "./move-app-stores.ts";

let root: string;
let appDir: string;
let tokenStore: FileTokenStore;
let selections: PublishSelectionsStore;

// The app's keychain stand-in: "enc:<token>" decrypts; anything else does not.
const encrypt = (token: string) => Buffer.from(`enc:${token}`).toString("base64");
const decrypt = (cipher: string) => {
  const text = Buffer.from(cipher, "base64").toString();
  if (!text.startsWith("enc:")) throw new Error("cannot decrypt");
  return text.slice(4);
};

const cred = (host: string, token: string, extra: Partial<HostCredential> = {}): HostCredential => ({
  host,
  kind: "token",
  token,
  createdAt: 1,
  ...extra,
});

async function writeAppCredentials(entries: Record<string, object>): Promise<void> {
  await writeFile(
    path.join(appDir, "credentials.json"),
    JSON.stringify({ version: 1, credentials: entries, notices: { linuxBasicTextStorageShown: true } }),
  );
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "gutterpress-move-app-stores-"));
  appDir = path.join(root, "app");
  await import("node:fs/promises").then((fs) => fs.mkdir(appDir));
  tokenStore = new FileTokenStore(path.join(root, "shared", "credentials.json"));
  selections = new PublishSelectionsStore(path.join(root, "shared", "publish-selections.json"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("the shared account store", () => {
  test("status and listRedacted name the account but never carry its token", async () => {
    await tokenStore.set("itch.io#Studio", cred("itch.io", "tok-secret", { username: "Studio", label: "itch.io — Studio" }));
    expect(await tokenStore.status("itch.io#Studio")).toEqual({
      connected: true,
      username: "Studio",
      label: "itch.io — Studio",
    });
    expect(await tokenStore.status("github.com")).toEqual({ connected: false });
    const listed = await tokenStore.listRedacted();
    expect(listed).toEqual([{ host: "itch.io", kind: "token", username: "Studio", label: "itch.io — Studio", createdAt: 1 }]);
    expect(JSON.stringify(listed)).not.toContain("tok-secret");
  });

  test("a listener hears each saved and removed account, by its key", async () => {
    const heard: string[] = [];
    const stop = tokenStore.onChange((key) => heard.push(key));
    await tokenStore.set("GitHub.com", cred("github.com", "t"));
    await tokenStore.delete("github.com");
    stop();
    await tokenStore.set("itch.io", cred("itch.io", "t"));
    expect(heard).toEqual(["github.com", "github.com"]);
  });
});

describe("moving the app's own copies into the shared store", () => {
  test("each account is decrypted and added; one already saved keeps its credential", async () => {
    await tokenStore.set("github.com", cred("github.com", "from-terminal"));
    await writeAppCredentials({
      "github.com": { host: "github.com", kind: "github-oauth", tokenCipher: encrypt("from-app"), createdAt: 2 },
      "itch.io#Studio": { host: "itch.io", kind: "token", tokenCipher: encrypt("itch-key"), username: "Studio", createdAt: 3 },
      gdrive: { host: "gdrive", kind: "google-oauth", tokenCipher: encrypt("refresh"), label: "me@example.com", createdAt: 4 },
    });

    const moved = await moveAppStores(appDir, decrypt, { tokenStore, selections });

    expect(moved).toEqual({ accounts: 2, unreadable: 0, choices: 0 });
    expect((await tokenStore.get("github.com"))?.token).toBe("from-terminal");
    expect(await tokenStore.get("itch.io#Studio")).toEqual(cred("itch.io", "itch-key", { username: "Studio", createdAt: 3 }));
    expect(await tokenStore.get("gdrive")).toEqual({
      host: "gdrive",
      kind: "google-oauth",
      token: "refresh",
      label: "me@example.com",
      createdAt: 4,
    });
  });

  test("an account the keychain can no longer read is counted, not moved", async () => {
    await writeAppCredentials({
      "github.com": { host: "github.com", kind: "github-oauth", tokenCipher: Buffer.from("junk").toString("base64"), createdAt: 1 },
    });
    expect(await moveAppStores(appDir, decrypt, { tokenStore, selections })).toEqual({
      accounts: 0,
      unreadable: 1,
      choices: 0,
    });
    expect(await tokenStore.get("github.com")).toBeNull();
  });

  test("a book's own choices are added without replacing the shared ones", async () => {
    await selections.setSettings("/books/a", "gdrive", { credential: "work" });
    const old = new PublishSelectionsStore(path.join(appDir, "publish-selections.json"));
    await old.setSettings("/books/a", "gdrive", { credential: "home", myFolderId: "F1" });
    await old.setSettings("/books/b", "local", { dir: "/out" });
    await old.setGlobal("itch", "Studio");

    const moved = await moveAppStores(appDir, decrypt, { tokenStore, selections });

    expect(moved.choices).toBe(3);
    expect(await selections.settings("/books/a")).toEqual({ gdrive: { credential: "work", myFolderId: "F1" } });
    expect(await selections.settings("/books/b")).toEqual({ local: { dir: "/out" } });
    expect(await selections.resolve("itch")).toBe("Studio");
  });

  test("it runs once: the old files are kept beside as .moved, and a second run finds nothing", async () => {
    await writeAppCredentials({
      "itch.io": { host: "itch.io", kind: "token", tokenCipher: encrypt("k"), createdAt: 1 },
    });
    await new PublishSelectionsStore(path.join(appDir, "publish-selections.json")).setGlobal("itch", "Studio");

    await moveAppStores(appDir, decrypt, { tokenStore, selections });
    expect((await readdir(appDir)).sort()).toEqual(["credentials.json.moved", "publish-selections.json.moved"]);
    expect(await moveAppStores(appDir, decrypt, { tokenStore, selections })).toEqual({
      accounts: 0,
      unreadable: 0,
      choices: 0,
    });
  });

  test("a damaged credentials file is left where it is, and nothing is lost from the shared store", async () => {
    await tokenStore.set("github.com", cred("github.com", "kept"));
    await writeFile(path.join(appDir, "credentials.json"), "{not json");
    expect(await moveAppStores(appDir, decrypt, { tokenStore, selections })).toEqual({
      accounts: 0,
      unreadable: 0,
      choices: 0,
    });
    expect(await readFile(path.join(appDir, "credentials.json"), "utf8")).toBe("{not json");
    expect((await tokenStore.get("github.com"))?.token).toBe("kept");
  });
});
