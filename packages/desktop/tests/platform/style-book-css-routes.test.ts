import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isHttpError } from "@sveltejs/kit";
import { registerHostServices } from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { POST as bookCssRoute } from "../../src/routes/api/style/book-css/+server";
import { POST as editTokensRoute } from "../../src/routes/api/style/edit-tokens/+server";

// #454: Book setup's design settings read the book's assembled stylesheet and
// write with a postcss edit, both host-side, through these two routes and the
// real lib.

let root: string;
let book: string;
let previewWrites: Array<[string, string]>;
let snapshots: string[];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "gp-book-css-"));
  book = path.join(root, "book");
  await mkdir(path.join(book, "styles"), { recursive: true });
  await writeFile(path.join(book, "manifest.yaml"), "title: T\npreset: book\nstyles:\n  - styles/book.css\n  - styles/late.css\n");
  await writeFile(path.join(book, "styles", "book.css"), ":root {\n  --fs-body: 10.5pt;\n}\n");
  await writeFile(path.join(book, "styles", "late.css"), ":root {\n  --color-accent: #c0392b;\n}\n");
  previewWrites = [];
  snapshots = [];
  registerHostServices(
    makeHostServices({
      fsGuard: { projectRoots: () => [book], readOnlyRoots: () => [] },
      write: {
        notifyPreviewSettledWrite: (file, content) => previewWrites.push([file, content]),
        scheduleAutoSnapshot: (dir) => snapshots.push(dir),
        getWatchedDir: () => book,
      },
    }),
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const post = (route: typeof bookCssRoute, body: unknown) =>
  route({
    request: new Request("http://local.test", { method: "POST", body: JSON.stringify(body) }),
  } as Parameters<typeof bookCssRoute>[0]);

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e) {
    if (!isHttpError(e)) throw e;
    return e.status;
  }
}

test("style/book-css returns the book's stylesheet as tagged chunks, every book sheet with its tokens", async () => {
  const res = await post(bookCssRoute, { projectDir: book });
  const { chunks } = (await res.json()) as {
    chunks: Array<{ origin: { kind: string; file?: string }; tokens: Array<{ name: string; value: string }> }>;
  };
  expect(chunks.filter((c) => c.origin.kind === "book").map((c) => [c.origin.file, c.tokens])).toEqual([
    ["styles/book.css", [{ name: "--fs-body", value: "10.5pt" }]],
    ["styles/late.css", [{ name: "--color-accent", value: "#c0392b" }]],
  ]);
});

test("style/edit-tokens edits the sheet that declares the token, in place, and tells the preview and versions", async () => {
  const res = await post(editTokensRoute, {
    projectDir: book,
    file: path.join(book, "styles", "book.css"),
    updates: [{ name: "--color-accent", value: "#112233" }],
  });
  const late = path.join(book, "styles", "late.css");
  expect(await res.json()).toEqual({ written: [late] });
  expect(await readFile(late, "utf8")).toBe(":root {\n  --color-accent: #112233;\n}\n");
  expect(await readFile(path.join(book, "styles", "book.css"), "utf8")).toBe(":root {\n  --fs-body: 10.5pt;\n}\n");
  expect(previewWrites).toEqual([[late, ":root {\n  --color-accent: #112233;\n}\n"]]);
  expect(snapshots).toEqual([book]);
});

test("style/edit-tokens never writes outside the open book, even a sheet the manifest lists", async () => {
  const outside = path.join(root, "shared.css");
  await writeFile(outside, ":root {\n  --color-accent: red;\n}\n");
  await writeFile(path.join(book, "manifest.yaml"), "title: T\npreset: book\nstyles:\n  - styles/book.css\n  - ../shared.css\n");
  expect(
    await status(
      post(editTokensRoute, {
        projectDir: book,
        file: path.join(book, "styles", "book.css"),
        updates: [{ name: "--color-accent", value: "#112233" }],
      }),
    ),
  ).toBe(403);
  expect(await readFile(outside, "utf8")).toBe(":root {\n  --color-accent: red;\n}\n");
  expect(previewWrites).toEqual([]);
});

test("style/edit-tokens refuses a malformed batch", async () => {
  for (const updates of [undefined, [{ name: "color", value: "red" }], [{ name: "--a" }]]) {
    expect(
      await status(post(editTokensRoute, { projectDir: book, file: path.join(book, "styles", "book.css"), updates })),
    ).toBe(400);
  }
});

// #482: a color setting takes a `var(--name)` reference again, written by the
// same postcss edit; a value that would end its declaration writes nothing.
test("style/edit-tokens writes a var(--name) reference in place, and refuses a value that is not one declaration's", async () => {
  const late = path.join(book, "styles", "late.css");
  await post(editTokensRoute, {
    projectDir: book,
    file: path.join(book, "styles", "book.css"),
    updates: [{ name: "--color-accent", value: "var(--color-ink)" }],
  });
  expect(await readFile(late, "utf8")).toBe(":root {\n  --color-accent: var(--color-ink);\n}\n");

  previewWrites = [];
  expect(
    await status(
      post(editTokensRoute, {
        projectDir: book,
        file: path.join(book, "styles", "book.css"),
        updates: [{ name: "--color-accent", value: "red; } body { display: none" }],
      }),
    ),
  ).toBe(500);
  expect(await readFile(late, "utf8")).toBe(":root {\n  --color-accent: var(--color-ink);\n}\n");
  expect(previewWrites).toEqual([]);
});
