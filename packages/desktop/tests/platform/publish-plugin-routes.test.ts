/**
 * Publishing plugins (EXPERIMENTAL, #381) in the desktop's publish routes,
 * against the REAL lib: `publish/list` offers a book's publishing plugin as a
 * card marked `experimental` (after the built-ins), and `publish/set-config`
 * accepts its id — the wizard's format step writes `publish.<id>.format`
 * through it, and an unknown id is still refused. The fixture is a
 * local-folder publisher; nothing here imports its code or uses the network.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { POST as publishList } from "../../src/routes/api/publish/list/+server";
import { POST as publishSetConfig } from "../../src/routes/api/publish/set-config/+server";

let book: string;

function request(body: unknown): Request {
  return new Request("http://local.test", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(async () => {
  book = await mkdtemp(path.join(tmpdir(), "gutterpress-publish-plugin-routes-"));
  await mkdir(path.join(book, "pub"), { recursive: true });
  await writeFile(
    path.join(book, "pub", "package.json"),
    JSON.stringify({
      name: "pub-demo",
      description: "Demo destination",
      type: "module",
      main: "index.js",
      gutterpress: { publish: true },
    }),
  );
  // Throws if anything imports it: listing and settings writes never should.
  await writeFile(path.join(book, "pub", "index.js"), 'throw new Error("imported");\n');
  await writeFile(path.join(book, "manifest.yaml"), "title: Field Guide\nextensions:\n  - ./pub\n", "utf8");
  registerHostServices(
    makeHostServices({
      fsGuard: { projectRoots: () => [book], readOnlyRoots: () => [] as string[] },
      remote: { tokenStore: { get: async () => null, list: async () => [] } as never },
    }),
  );
});

afterEach(async () => {
  registerHostServices(undefined as unknown as HostServices);
  await rm(book, { recursive: true, force: true });
});

test("publish/list offers the book's publishing plugin after the built-ins, marked experimental", async () => {
  const res = await publishList({ request: request({ projectDir: book }) } as never);
  const cards = (await res.json()) as Array<{ id: string; experimental?: boolean; formats?: string[]; description: string }>;

  expect(cards.at(-1)).toMatchObject({
    id: "pub-demo",
    description: "Demo destination",
    experimental: true,
    formats: ["pdf", "html"],
    credentialRequired: false,
  });
  expect(cards.filter((c) => c.experimental).map((c) => c.id)).toEqual(["pub-demo"]);
  expect(cards[0]?.id).toBe("local");
});

test("publish/set-config writes a plugin's settings under its id", async () => {
  await publishSetConfig({
    request: request({ projectDir: book, providerId: "pub-demo", values: { format: "html" } }),
  } as never);

  expect(await readFile(path.join(book, "manifest.yaml"), "utf8")).toMatch(/publish:\n\s+pub-demo:\n\s+format: html/);
});

test("publish/set-config still refuses an id the book does not have", async () => {
  await expect(
    publishSetConfig({
      request: request({ projectDir: book, providerId: "nope", values: { format: "html" } }),
    } as never),
  ).rejects.toThrow();
  expect(await readFile(path.join(book, "manifest.yaml"), "utf8")).not.toContain("nope");
});
