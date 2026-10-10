/**
 * gen.mjs — the derived half of this site, run by unify through
 * `generate: scripts/gen.mjs` in unify.yaml (the same shape as unify's own
 * documentation site, examples/unify-docs in the unify repository).
 *
 * The Gutterpress user guide (examples/gutterpress-user-guide) is the
 * documentation; this script publishes it at every build through the docs
 * template's importer, so the site cannot drift from it. What it writes into
 * the overlay unify hands it (argv[3]):
 *
 *   docs/**                the guide's chapters, by the importer
 *   docs/index.md          every chapter, in reading order, with its description
 *   _includes/docnav.html  the sidebar, replacing the template's
 *   privacy/index.md       the repository's PRIVACY.md
 *
 * The guide is written to be a printed book, so two things about it only make
 * sense in one PDF, and `transform` adapts them for separate web pages:
 * Gutterpress layout markers (`@section .lede`, `@end-section`, `@page …`)
 * are dropped, and the `{#id}` heading anchors its cross-references use
 * become links to the page and heading unify publishes.
 *
 * The privacy policy is why the site exists: Google's OAuth consent screen
 * needs it at a stable public URL, https://gutterpress.dimm.city/privacy/
 * (ADR 0011). The root PRIVACY.md stays its one source.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { importDocs } from "unify-docs-template/scripts/import-docs.mjs";

const [, , , overlay] = process.argv;
if (!overlay) throw new Error("gen.mjs: unify runs this (generate: scripts/gen.mjs in unify.yaml); run unify build");

const GUIDE = new URL("../../examples/gutterpress-user-guide/", import.meta.url);
const CHAPTER = /^\d\d-(.+\.md)$/; // 01-getting-started.md → getting-started.md

// The book's cover, table of contents, README, manifest and stylesheet are
// not web pages: move them under an underscore folder, which unify never
// publishes.
const rename = (path) => {
  const m = path.match(CHAPTER);
  return m && !path.startsWith("00-") ? m[1] : `_book/${path}`;
};

// ── {#id} anchors → the page and heading unify publishes ──────────────────

const isFence = (line) => /^\s*(`{3,}|~{3,})/.test(line);
const slugify = (text) =>
  text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/^-+|-+$/g, "");

/** Every chapter's `{#id}` heading anchors: id → { page, slug }. */
const anchors = new Map();
for (const file of readdirSync(GUIDE).filter((f) => CHAPTER.test(f) && !f.startsWith("00-"))) {
  let fence = false;
  for (const line of readFileSync(new URL(file, GUIDE), "utf8").split("\n")) {
    if (isFence(line)) fence = !fence;
    const m = !fence && line.match(/^(#{1,6})\s+(.*?)\s*\{#([\w-]+)\}\s*$/);
    if (m) anchors.set(m[3], { page: rename(file), slug: m[1] === "#" ? "" : slugify(m[2]) });
  }
}

function transform(path, text) {
  if (!CHAPTER.test(path) || path.startsWith("00-")) return text;
  const page = rename(path);
  let fence = false;
  return text
    .split("\n")
    .flatMap((line) => {
      if (isFence(line)) fence = !fence;
      if (fence) return [line];
      if (/^@[\w-]+/.test(line)) return []; // a layout marker
      return [
        line
          .replace(/^(#{1,6}\s+.*?)\s*\{#[\w-]+\}\s*$/, "$1")
          .replace(/\]\(#([\w-]+)\)/g, (whole, id) => {
            const to = anchors.get(id);
            if (!to) return whole;
            const hash = to.slug ? `#${to.slug}` : "";
            return to.page === page ? `](${hash || "#"})` : `](${to.page}${hash})`;
          }),
      ];
    })
    .join("\n");
}

const pages = importDocs({
  from: GUIDE,
  into: overlay,
  github: "https://github.com/dimm-city/gutterpress/blob/main/examples/gutterpress-user-guide",
  rename,
  transform,
}).filter((p) => !p.path.startsWith("docs/_book/"));

// ── docs index and sidebar ────────────────────────────────────────────────

/** The sidebar's short label for each chapter; the index keeps the full title. */
const SHORT = {
  "getting-started.md": "Getting started",
  "writing-content.md": "Writing content",
  "visual-elements.md": "Visual elements",
  "styling-theming.md": "Styling & theming",
  "plugins.md": "Plugins",
  "validation.md": "Validation",
  "system-setup.md": "System setup",
  "publishing.md": "Publishing",
};

// Reading order is the book's: the source files' number prefixes.
const chapters = pages.slice().sort((a, b) => (a.source < b.source ? -1 : 1));

const href = (p) => `/${p.path}`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const write = (rel, body) => {
  const abs = join(overlay, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
};

write(
  "docs/index.md",
  [
    "---",
    'title: "User guide"',
    'description: "The Gutterpress user guide, chapter by chapter, rendered from the guide the repository builds as a book."',
    "---",
    "",
    "# User guide",
    "",
    "Every chapter below is published from `examples/gutterpress-user-guide/` at build time, the same files Gutterpress builds into the printed guide, so this site cannot drift from it.",
    "",
    ...chapters.map((p) => `- **[${p.title}](${href(p)})**: ${p.description}`),
    "",
  ].join("\n"),
);

const group = (label, links) => [
  "  <div>",
  `    <p class="docnav-label">${esc(label)}</p>`,
  "    <ul>",
  ...links.map(([url, text]) => `      <li><a href="${url}">${esc(text)}</a></li>`),
  "    </ul>",
  "  </div>",
];

write(
  "_includes/docnav.html",
  [
    '<nav class="docnav" id="docnav" aria-label="Documentation">',
    ...group("User guide", chapters.map((p) => [href(p), SHORT[p.path.slice("docs/".length)] ?? p.title])),
    ...group("Releases", [
      ["/releases/0.11.16.html", "0.11.16"],
      ["/releases/0.11.15.html", "0.11.15"],
      ["/releases/0.11.14.html", "0.11.14"],
      ["https://github.com/dimm-city/gutterpress/blob/main/CHANGELOG.md", "Full changelog"],
    ]),
    ...group("Project", [
      ["/install.html", "Install"],
      ["/plugins.html", "Plugins"],
      ["/about.html", "About"],
      ["/privacy/index.html", "Privacy policy"],
      ["https://github.com/dimm-city/gutterpress/issues", "Issues"],
    ]),
    '  <p class="docnav-all"><a href="/docs/index.html">All documentation →</a></p>',
    "</nav>",
    "",
  ].join("\n"),
);

// ── privacy policy ────────────────────────────────────────────────────────

write(
  "privacy/index.md",
  "---\ntitle: Privacy Policy\n" +
    "description: What Gutterpress can access in your Google Drive, where your credentials are stored, and how to revoke access.\n" +
    "---\n\n" +
    readFileSync(new URL("../../PRIVACY.md", import.meta.url), "utf8"),
);

console.log(`gen.mjs: ${chapters.length} chapters, an index, the sidebar and the privacy policy`);
