/**
 * Changing a book's targets (ADR 0012 §3): `publish:` is the list, written in
 * the new form; what a person sends this time is theirs (`send: off`), never
 * the book's. Both views read the plan through `publishPlan`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { savePublishSettings, setBookTargets, setPublishProviderConfig } from "./manifest-publish.ts";
import { publishPlan } from "./publish-book.ts";
import { PublishSelectionsStore } from "./selections.ts";

let root: string;
let book: string;
let store: PublishSelectionsStore;

const manifestText = () => readFile(path.join(book, "manifest.yaml"), "utf8");
const manifest = async () => parse(await manifestText()) as Record<string, unknown>;
const plan = () => publishPlan({ projectDir: book }, store);

async function writeBook(body: string): Promise<void> {
  await writeFile(path.join(book, "manifest.yaml"), `title: Field Guide\nauthors: [Ada]\npreset: book\n${body}`);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "gutterpress-book-targets-"));
  book = path.join(root, "book");
  await Bun.write(path.join(book, ".keep"), "");
  store = new PublishSelectionsStore(path.join(root, "mine.json"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("setBookTargets", () => {
  test("an older book is rewritten in the new form, keeping the settings of the targets it keeps", async () => {
    await writeBook(
      "targets: [dtrpg]\npublish:\n  itch:\n    target: ada/guide\n    enabled: true\n  gdrive:\n    folder: Books\n    enabled: false\n",
    );
    await setBookTargets(book, ["drivethrurpg-print", "itch"]);
    const m = await manifest();
    expect(m.targets).toBeUndefined();
    expect(m.publish).toEqual({ itch: { target: "ada/guide" }, "drivethrurpg-print": null });
    expect((await plan()).targets).toEqual(["itch", "drivethrurpg-print"]);
  });

  test("a target with nothing to set is written as just its name, and comments survive", async () => {
    await writeBook("# where it goes\npublish:\n  local:\n    dir: out\n");
    await setBookTargets(book, ["local", "itch"]);
    const text = await manifestText();
    expect(text).toContain("# where it goes");
    expect(text).toMatch(/^ {2}itch:\n?$/m);
    expect(text).not.toContain("null");
  });

  test("removing every target leaves `publish: {}`, which means none, not the preset's", async () => {
    // The dtrpg preset's own target would come back if `publish:` were dropped.
    await writeFile(path.join(book, "manifest.yaml"), "title: Field Guide\npreset: dtrpg\npublish:\n  local:\n");
    await setBookTargets(book, []);
    expect((await manifest()).publish).toEqual({});
    expect((await plan()).targets).toEqual([]);
  });

  test("an old name is read as its target", async () => {
    await writeBook("publish:\n  drivethrurpg:\n    productUrl: https://example.com/p\n");
    await setBookTargets(book, ["drivethrurpg-print"]);
    expect((await plan()).targets).toEqual(["drivethrurpg-print"]);
  });
});

describe("a target stays in the book when its last setting is cleared", () => {
  test("clearing itch's page keeps itch as a target", async () => {
    await writeBook("publish:\n  itch:\n    target: ada/guide\n");
    await setPublishProviderConfig(book, "itch", { target: "" });
    expect((await manifest()).publish).toEqual({ itch: null });
    expect((await plan()).targets).toEqual(["itch"]);
  });
});

describe("what a person sends this time is theirs", () => {
  test("`send: off` is kept in their own settings, never the manifest, and leaves the target out of their run", async () => {
    await writeBook("publish:\n  itch:\n    target: ada/guide\n  local:\n");
    const before = await manifestText();
    await savePublishSettings(book, "itch", { send: "off" }, store);
    expect(await manifestText()).toBe(before);
    expect(await plan()).toEqual({ targets: ["itch", "local"], sending: ["local"] });

    await savePublishSettings(book, "itch", { send: "" }, store);
    expect((await plan()).sending).toEqual(["itch", "local"]);
  });
});
