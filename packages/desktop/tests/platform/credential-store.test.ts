/**
 * The app's account and publishing-choice stores are the lib's, shared with
 * the terminal (ADR 0012): what older versions kept in the app's own folder is
 * moved there before anything is read, and a failed move never stops the
 * stores from working.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createUserStores } from "../../electron/credential-store";

let root: string;
let appDir: string;
let savedConfigDir: string | undefined;
const logged: string[] = [];

const decrypt = (cipher: string) => Buffer.from(cipher, "base64").toString().replace(/^enc:/, "");
const stores = () =>
  createUserStores({
    loadLib: () => import("gutterpress"),
    whenReady: async () => {},
    appDir: () => appDir,
    decrypt,
    log: { event: (l: string) => logged.push(l), error: (l: string) => logged.push(l) },
  });

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "gutterpress-user-stores-"));
  appDir = path.join(root, "app");
  await mkdir(appDir);
  savedConfigDir = process.env.GUTTERPRESS_CONFIG_DIR;
  process.env.GUTTERPRESS_CONFIG_DIR = path.join(root, "shared");
  logged.length = 0;
});

afterEach(async () => {
  if (savedConfigDir === undefined) delete process.env.GUTTERPRESS_CONFIG_DIR;
  else process.env.GUTTERPRESS_CONFIG_DIR = savedConfigDir;
  await rm(root, { recursive: true, force: true });
});

test("an account an older version saved is moved before the first read", async () => {
  await writeFile(
    path.join(appDir, "credentials.json"),
    JSON.stringify({
      version: 1,
      credentials: {
        "github.com": {
          host: "github.com",
          kind: "github-oauth",
          tokenCipher: Buffer.from("enc:gho_app").toString("base64"),
          username: "ada",
          createdAt: 1,
        },
      },
    }),
  );
  const { tokenStore } = stores();
  expect((await tokenStore.get("github.com"))?.token).toBe("gho_app");
  expect(await tokenStore.status("github.com")).toEqual({ connected: true, username: "ada" });
  expect(await readdir(path.join(root, "shared"))).toContain("credentials.json");
  expect(await readdir(appDir)).toEqual(["credentials.json.moved"]);
  expect(logged.join("\n")).toContain("1 account(s)");
});

test("a move that fails is logged, and the stores still work", async () => {
  await mkdir(path.join(appDir, "credentials.json")); // unreadable as a file
  const { tokenStore, selections } = stores();
  await tokenStore.set("itch.io", { host: "itch.io", kind: "token", token: "k", createdAt: 1 });
  expect((await tokenStore.get("itch.io"))?.token).toBe("k");
  await (await selections()).setGlobal("itch", "Studio");
  expect(await (await selections()).resolve("itch")).toBe("Studio");
  expect(logged.join("\n")).toContain("could not move");
});

test("a saved or removed account is announced by its key", async () => {
  const user = stores();
  const heard: string[] = [];
  user.onCredentialChange((key) => heard.push(key));
  await user.tokenStore.set("GitHub.com", { host: "github.com", kind: "token", token: "t", createdAt: 1 });
  await user.tokenStore.delete("github.com");
  expect(heard).toEqual(["github.com", "github.com"]);
});
