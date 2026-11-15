import { afterEach, expect, test } from "bun:test";
import { link, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PublishSelectionsStore } from "./selections.ts";

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

test("the choices file is replaced whole, never rewritten in place, so the app and the terminal can share it", async () => {
  root = await mkdtemp(path.join(tmpdir(), "gp-selections-"));
  const file = path.join(root, "publish-selections.json");
  const before = JSON.stringify({ version: 1, global: {}, projects: {} });
  await writeFile(file, before);
  // A second name for the file as it was: an in-place write would change it too.
  await link(file, path.join(root, "as-it-was.json"));

  await new PublishSelectionsStore(file).setGlobal("itch", "studio");

  expect(await readFile(path.join(root, "as-it-was.json"), "utf8")).toBe(before);
  expect(JSON.parse(await readFile(file, "utf8")).global).toEqual({ itch: "studio" });
  expect((await readdir(root)).sort()).toEqual(["as-it-was.json", "publish-selections.json"]);
});
