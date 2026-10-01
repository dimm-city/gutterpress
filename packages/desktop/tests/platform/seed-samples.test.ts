import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { seedSamples } from "../../electron/seed-samples";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "gp-seed-"));
  const src = path.join(root, "src");
  const dest = path.join(root, "Documents", "Gutterpress");
  await mkdir(path.join(src, "guide", "styles"), { recursive: true });
  await writeFile(path.join(src, "guide", "manifest.yaml"), "title: Guide\n");
  await writeFile(path.join(src, "guide", "styles", "g.css"), "a{}");
  await writeFile(path.join(src, "stray.txt"), "ignored");
  return { src, dest };
}

test("copies each book directory, nested files included, skipping loose files", async () => {
  const { src, dest } = await fixture();
  expect(await seedSamples(src, dest)).toEqual(["guide"]);
  expect(await readdir(dest)).toEqual(["guide"]);
  expect(await readFile(path.join(dest, "guide", "styles", "g.css"), "utf8")).toBe("a{}");
});

test("never overwrites an author's edits", async () => {
  const { src, dest } = await fixture();
  await seedSamples(src, dest);
  await writeFile(path.join(dest, "guide", "manifest.yaml"), "title: Mine\n");
  await seedSamples(src, dest);
  expect(await readFile(path.join(dest, "guide", "manifest.yaml"), "utf8")).toBe("title: Mine\n");
});
