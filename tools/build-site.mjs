#!/usr/bin/env node
/**
 * build-site.mjs — assemble the GitHub Pages site into `_site/`.
 *
 *   node tools/build-site.mjs            # → ./_site
 *   node tools/build-site.mjs --out DIR  # → DIR (the test uses a temp dir)
 *
 * The site is two things: `site/` copied as-is (the landing page and its
 * stylesheet), and markdown documents from the repository root rendered into
 * the shared page template. The privacy policy is the reason the site exists
 * — Google's OAuth consent screen needs it at a stable public URL (ADR 0011,
 * docs/gdrive-publish-plan.md D11) — and the root `PRIVACY.md` stays its ONE
 * source: this script renders it, so the published page can never drift from
 * the file the repository, README and changelog all link to.
 *
 * markdown-it comes from packages/cli's dependency tree (Bun keeps workspace
 * dependencies under the package that declares them, not the repo root), so
 * it is resolved from there rather than imported by bare name.
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const siteDir = join(repoRoot, "site");

const args = process.argv.slice(2);
const outFlag = args.indexOf("--out");
const outDir = resolve(outFlag >= 0 && args[outFlag + 1] ? args[outFlag + 1] : join(repoRoot, "_site"));

/** Markdown documents to render: repo-root source → site path (a directory
 *  index, so the public URL is `/privacy/`, not `/privacy.html`). */
const PAGES = [
  {
    source: "PRIVACY.md",
    out: "privacy/index.html",
    description:
      "What Gutterpress can access in your Google Drive, where your credentials are stored, and how to revoke access.",
    nav: "privacy",
  },
];

const require = createRequire(join(repoRoot, "packages", "cli", "package.json"));
const MarkdownIt = require("markdown-it");
// No linkify: the policy's links are explicit, and its example address
// ("you@example.com") must stay plain text rather than becoming a mailto.
const md = new MarkdownIt({ html: false, linkify: false, typographer: false });

function titleOf(markdown, fallback) {
  const m = markdown.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1] : fallback;
}

function escapeAttr(text) {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function render(page, template) {
  const markdown = readFileSync(join(repoRoot, page.source), "utf8");
  const depth = page.out.split("/").length - 1;
  const root = depth === 0 ? "./" : "../".repeat(depth);
  const html = template
    .replaceAll("{{title}}", escapeAttr(titleOf(markdown, "Gutterpress")))
    .replaceAll("{{description}}", escapeAttr(page.description))
    .replaceAll("{{root}}", root)
    .replaceAll("{{privacy-current}}", page.nav === "privacy" ? ' aria-current="page"' : "")
    .replaceAll("{{content}}", md.render(markdown).trimEnd());
  if (html.includes("{{")) throw new Error(`unfilled placeholder left in ${page.out}`);
  return html;
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// 1. Static files: everything in site/ except the underscore-prefixed
//    template inputs.
for (const name of readdirSync(siteDir)) {
  if (name.startsWith("_")) continue;
  const from = join(siteDir, name);
  cpSync(from, join(outDir, name), { recursive: statSync(from).isDirectory() });
}

// 2. Rendered markdown pages.
const template = readFileSync(join(siteDir, "_template.html"), "utf8");
for (const page of PAGES) {
  const target = join(outDir, page.out);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, render(page, template));
}

// 3. Pages serves the artifact as-is, but `.nojekyll` keeps any future
//    underscore-prefixed asset from being dropped should the source ever move
//    to a branch deploy.
writeFileSync(join(outDir, ".nojekyll"), "");

console.log(`site built → ${relative(process.cwd(), outDir) || "."} (${PAGES.length} rendered page(s))`);
