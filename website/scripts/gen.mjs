// Writes the site's derived pages into the overlay directory unify hands it
// before every build (generate: scripts/gen.mjs in unify.yaml):
//
//   blog.html                  every post under posts/, newest first
//   _includes/latest-posts.html  the newest three, included by the home page
//   privacy/index.md           the repository's PRIVACY.md, rendered by unify
//
// The privacy policy is why the site exists: Google's OAuth consent screen
// needs it at a stable public URL, https://dimm-city.github.io/gutterpress/privacy/
// (ADR 0011). The root PRIVACY.md stays its ONE source — this script reads it
// on every build, so the published page can never drift from the file the
// repository, README and changelog all link to.
//
// unify passes argv[2] the source root, argv[3] the overlay directory, argv[4]
// generator-context.json, which names source-pages.json: every source page's
// title, description, date and <meta> records, already parsed by unify.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [, , sourceRoot, outDir, contextPath] = process.argv;
if (!sourceRoot || !outDir || !contextPath) {
  throw new Error("gen.mjs: unify runs this (generate: scripts/gen.mjs in unify.yaml); run unify build");
}
const context = JSON.parse(readFileSync(contextPath, "utf8"));
const inventory = JSON.parse(readFileSync(context.inputs.sourcePages, "utf8"));

const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s = "") => esc(s).replace(/"/g, "&quot;");
const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

const posts = inventory.pages
  .filter((p) => p.source.startsWith("posts/"))
  .map((p) => ({ href: p.href, title: p.title || p.source, description: p.description || "", date: p.date || "" }))
  .sort((a, b) => cmp(b.date, a.date) || cmp(a.href, b.href));

const card = (p) =>
  '<li class="card">' +
  (p.date ? '<time datetime="' + escAttr(p.date) + '">' + esc(p.date.slice(0, 10)) + "</time>" : "") +
  '<h3><a href="' + escAttr(p.href) + '">' + esc(p.title) + "</a></h3>" +
  (p.description ? "<p>" + esc(p.description) + "</p>" : "") +
  "</li>";
const cards = (list) =>
  list.length === 0 ? "<p>No posts yet.</p>" : '<ul class="cards">\n' + list.map(card).join("\n") + "\n</ul>";

mkdirSync(join(outDir, "_includes"), { recursive: true });
mkdirSync(join(outDir, "privacy"), { recursive: true });

const LISTING_DESCRIPTION = "News from the Gutterpress project: releases, features and fixes, newest first.";
writeFileSync(
  join(outDir, "blog.html"),
  "<!doctype html>\n<html>\n<head>\n<title>Blog</title>\n" +
    '<meta name="description" content="' + escAttr(LISTING_DESCRIPTION) + '">\n' +
    '<meta property="og:title" content="Blog">\n' +
    '<meta property="og:description" content="' + escAttr(LISTING_DESCRIPTION) + '">\n' +
    "</head>\n<body>\n<main>\n" +
    '<header class="page-head"><span class="eyebrow">Blog</span><h1>News from the press</h1>' +
    "<p>" + esc(LISTING_DESCRIPTION) + "</p></header>\n" +
    cards(posts) + "\n</main>\n</body>\n</html>\n",
);

writeFileSync(join(outDir, "_includes", "latest-posts.html"), cards(posts.slice(0, 3)) + "\n");

const privacy = readFileSync(join(sourceRoot, "..", "..", "PRIVACY.md"), "utf8");
writeFileSync(
  join(outDir, "privacy", "index.md"),
  "---\ntitle: Privacy Policy\n" +
    "description: What Gutterpress can access in your Google Drive, where your credentials are stored, and how to revoke access.\n" +
    "---\n\n" + privacy,
);

console.log("gen.mjs: wrote blog.html, latest-posts.html (" + posts.length + " post(s)) and privacy/index.md");
