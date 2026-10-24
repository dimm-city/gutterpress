/**
 * Publishing plugins (EXPERIMENTAL, #381) in the desktop's publish routes,
 * against the REAL lib: `publish/list` offers a book's publishing plugin as a
 * `kind: "plugin"` card marked `experimental` (after the built-ins),
 * `publish/set-config` accepts its id — the wizard's format step writes
 * `publish.<id>.format` through it, and an unknown id is still refused — and
 * `publish/run` runs the plugin in this (host) process. The fixture is a
 * local-folder publisher whose entry throws if imported, so listing and
 * settings writes prove they never load it; only the run test swaps in an
 * entry that publishes. Nothing here uses the network.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { POST as publishList } from "../../src/routes/api/publish/list/+server";
import { POST as publishRun } from "../../src/routes/api/publish/run/+server";
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
    kind: "plugin",
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

test("publish/run publishes through the plugin, in this process, with its log lines captured", async () => {
  await writeFile(
    path.join(book, "pub", "index.js"),
    `import { writeFile } from "node:fs/promises";
import path from "node:path";
export async function publish(outputDir, context) {
  context.log("uploading");
  await writeFile(path.join(context.project.dir, "received.json"), JSON.stringify({ outputDir, artifact: context.artifact, settings: context.settings }));
  return { url: "https://example.com/field-guide", detail: "Sent" };
}
`,
  );
  await mkdir(path.join(book, "dist"), { recursive: true });
  await writeFile(path.join(book, "dist", "book.pdf"), "%PDF-1.4 fake");

  const res = await publishRun({
    request: request({ projectDir: book, providerId: "pub-demo", artifactPath: "dist/book.pdf" }),
  } as never);
  const result = (await res.json()) as { ok: boolean; issues: Array<{ id: string }>; outcome?: unknown; log: string[] };

  expect(result).toMatchObject({
    ok: true,
    outcome: { kind: "published", url: "https://example.com/field-guide", detail: "Sent" },
    log: ["uploading"],
  });
  expect(result.issues.map((i) => i.id)).toEqual(["plugin/experimental"]);
  expect(JSON.parse(await readFile(path.join(book, "received.json"), "utf8"))).toEqual({
    outputDir: path.join(book, "dist"),
    artifact: { format: "pdf", path: path.join(book, "dist", "book.pdf") },
    settings: {},
  });
});

test("publish/set-config still refuses an id the book does not have", async () => {
  await expect(
    publishSetConfig({
      request: request({ projectDir: book, providerId: "nope", values: { format: "html" } }),
    } as never),
  ).rejects.toThrow();
  expect(await readFile(path.join(book, "manifest.yaml"), "utf8")).not.toContain("nope");
});
