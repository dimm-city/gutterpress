/**
 * A target and its publish provider are one thing (ADR 0012): the registry
 * (`../targets.ts`) says what a target is and which file it receives; its
 * provider says how the file gets there. These pin the two together.
 */
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { artifactName, resolveOutputDir } from "../output-paths";
import { TARGETS, TARGET_IDS } from "../targets";
import { listPublishProviders, publishProviderFor } from "./registry";
import { resolvePublishFormat, resolvePublishRequest } from "./run-publish";
import type { PublishDeps } from "./types";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function book(manifest: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "gutterpress-target-providers-"));
  dirs.push(dir);
  await writeFile(path.join(dir, "manifest.yaml"), manifest, "utf8");
  return dir;
}

const deps = {} as PublishDeps;
const request = (projectDir: string, providerId: string) => resolvePublishRequest({ projectDir, providerId }, deps);

test("every target has a provider, and every provider is a target, in the registry's order", () => {
  expect(listPublishProviders().map((p) => p.id)).toEqual(TARGET_IDS);
});

test("a provider takes its name and its file from the registry, not from a copy of its own", () => {
  for (const id of TARGET_IDS) {
    const info = publishProviderFor(id).info;
    const target = TARGETS[id]!;
    expect(info.label).toBe(target.label);
    expect(info.format).toBe(target.format);
    expect(info.formats).toEqual(target.formats ? [...target.formats] : undefined);
  }
});

test("the name older books and scripts use for DriveThruRPG still finds it, as print", () => {
  expect(publishProviderFor("drivethrurpg").info.id).toBe("drivethrurpg-print");
  expect(publishProviderFor("dtrpg").info.id).toBe("drivethrurpg-print");
});

test("a saved pick is honoured where the target offers one, and ignored where it defines its file", () => {
  expect(resolvePublishFormat(publishProviderFor("gdrive").info, { format: "pdfx" })).toBe("pdfx");
  expect(resolvePublishFormat(publishProviderFor("gdrive").info, {})).toBe("pdf");
  expect(resolvePublishFormat(publishProviderFor("kdp").info, { format: "html" })).toBe("pdf");
  expect(resolvePublishFormat(publishProviderFor("drivethrurpg-print").info, { format: "pdf" })).toBe("pdfx");
});

test("each target is sent the file it needs: DriveThruRPG print the PDF/X, digital and itch.io the PDF", async () => {
  const dir = await book('title: "Field Guide"\n');
  const out = resolveOutputDir(dir, "Field Guide");
  const pdf = path.join(out, artifactName("Field Guide", "pdf"));
  const pdfx = path.join(out, artifactName("Field Guide", "pdfx"));

  expect((await request(dir, "drivethrurpg-print")).artifact).toEqual({ path: pdfx, format: "pdfx" });
  expect((await request(dir, "drivethrurpg-digital")).artifact).toEqual({ path: pdf, format: "pdf" });
  expect((await request(dir, "itch")).artifact).toEqual({ path: pdf, format: "pdf" });
});

test("a target with a pick is sent the picked file; left unpicked, the PDF", async () => {
  const picked = await book('title: "Field Guide"\npublish:\n  gdrive:\n    format: pdfx\n');
  expect((await request(picked, "gdrive")).artifact).toEqual({
    path: path.join(resolveOutputDir(picked, "Field Guide"), artifactName("Field Guide", "pdfx")),
    format: "pdfx",
  });
  const unpicked = await book('title: "Field Guide"\npublish:\n  gdrive:\n');
  expect((await request(unpicked, "gdrive")).artifact.format).toBe("pdf");
});

test("settings an older book keeps under `publish.drivethrurpg` reach DriveThruRPG print", async () => {
  const dir = await book(
    'title: "Field Guide"\npublish:\n  drivethrurpg:\n    productUrl: https://www.drivethrurpg.com/product/1\n',
  );
  expect((await request(dir, "drivethrurpg-print")).config.productUrl).toBe("https://www.drivethrurpg.com/product/1");
});
