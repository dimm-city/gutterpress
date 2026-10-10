/**
 * gen.mjs — the derived half of this site, run by unify through
 * `generate: scripts/gen.mjs` in unify.yaml (the same shape as unify's own
 * documentation site, examples/unify-docs in the unify repository).
 *
 * The documentation lives in the repository and this script publishes it at
 * every build, so the site cannot drift from it. The docs are split the way a
 * writer meets Gutterpress: the desktop app, the command line, and the
 * writing-and-design chapters both share. What it writes into the overlay
 * unify hands it (argv[3]):
 *
 *   docs/desktop/**        docs/desktop-guide/ — how-to guides for the app
 *   docs/cli/**            the user guide's command-line chapters
 *   docs/cli/reference.md  packages/cli/README.md, the CLI reference
 *   docs/*.md              the user guide's writing-and-design chapters
 *   docs/index.md          every page, grouped, with its description
 *   _includes/docnav.html  the sidebar, replacing the template's
 *   _includes/downloads-*.html  real download links from the latest release
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

/** The user guide's chapters that are about the command line and the
 *  manifest; the rest (writing, visuals, styling, plugins) apply to both. */
const CLI_CHAPTERS = new Set(["getting-started.md", "validation.md", "system-setup.md", "publishing.md"]);

// The book's cover, table of contents, README, manifest and stylesheet are
// not web pages: move them under an underscore folder, which unify never
// publishes.
const rename = (path) => {
  const m = path.match(CHAPTER);
  if (!m || path.startsWith("00-")) return `_book/${path}`;
  return CLI_CHAPTERS.has(m[1]) ? `cli/${m[1]}` : m[1];
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
    if (m) anchors.set(m[3], { file, slug: m[1] === "#" ? "" : slugify(m[2]) });
  }
}

function transform(path, text) {
  if (!CHAPTER.test(path) || path.startsWith("00-")) return text;
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
            // Link the source file: the importer turns it into the page's
            // published address, wherever the rename put it.
            return to.file === path ? `](${hash || "#"})` : `](${to.file}${hash})`;
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

// ── the desktop guide and the CLI reference ─────────────────────────────

// docs/desktop-guide/: one how-to per file, numbered for reading order like
// the book's chapters; README.md is its overview.
const desktop = importDocs({
  from: new URL("../../docs/desktop-guide/", import.meta.url),
  into: overlay,
  base: "docs/desktop",
  github: "https://github.com/dimm-city/gutterpress/blob/main/docs/desktop-guide",
  rename: (path) => (path === "README.md" ? "index.md" : path.replace(/^\d\d-/, "")),
}).sort((a, b) => (a.source === "README.md" ? -1 : b.source === "README.md" ? 1 : a.source < b.source ? -1 : 1));

const write = (rel, body) => {
  const abs = join(overlay, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
};

// packages/cli/README.md is the CLI's reference, the page npm shows too.
// Its one relative link leaves the package, so it goes to GitHub.
const CLI_REFERENCE = {
  path: "docs/cli/reference.md",
  title: "CLI reference",
  description: "Every gutterpress command and option, the manifest, extensions, exit codes, and scripting in CI.",
};
write(
  CLI_REFERENCE.path,
  `---\ntitle: "${CLI_REFERENCE.title}"\ndescription: "${CLI_REFERENCE.description}"\n---\n\n` +
    readFileSync(new URL("../../packages/cli/README.md", import.meta.url), "utf8")
      .replace(/^# .*$/m, `# ${CLI_REFERENCE.title}`)
      .replace(/\]\(\.\.\/\.\.\/([^)]+)\)/g, "](https://github.com/dimm-city/gutterpress/blob/main/$1)"),
);

// ── docs index and sidebar ────────────────────────────────────────────────

/** The sidebar's short label for each chapter; the index keeps the full title. */
const SHORT = {
  "cli/getting-started.md": "Getting started",
  "writing-content.md": "Writing content",
  "visual-elements.md": "Visual elements",
  "styling-theming.md": "Styling & theming",
  "plugins.md": "Plugins",
  "cli/validation.md": "Validation",
  "cli/system-setup.md": "System setup",
  "cli/publishing.md": "Publishing",
};

// Reading order is the book's: the source files' number prefixes.
const chapters = pages.slice().sort((a, b) => (a.source < b.source ? -1 : 1));
const cli = [...chapters.filter((p) => p.path.startsWith("docs/cli/")), CLI_REFERENCE];
const writing = chapters.filter((p) => !p.path.startsWith("docs/cli/"));

const GROUPS = [
  { label: "Desktop app", intro: "How to do things in the Gutterpress app: open or create a book, write and preview it, add plugins, export a PDF, publish and keep your work safe.", pages: desktop },
  { label: "Command line", intro: "The `gutterpress` CLI: projects and the manifest, building and validating PDFs, publishing, and the full command reference.", pages: cli },
  { label: "Writing & design", intro: "How a book is written and styled, the same in the app and on the command line: markdown and layout markers, images, CSS custom properties and plugins.", pages: writing },
];

const href = (p) => `/${p.path}`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const label = (p) => SHORT[p.path.slice("docs/".length)] ?? p.title;

write(
  "docs/index.md",
  [
    "---",
    'title: "Documentation"',
    'description: "The Gutterpress documentation: the desktop app, the command line, and writing and designing a book."',
    "---",
    "",
    "# Documentation",
    "",
    "Start with the **desktop app** if you want an editor, a live preview and one-click PDFs. The **command line** runs the same engine in scripts and CI. **Writing & design** applies to both. Every page here is published from the repository at build time, so this site cannot drift from it.",
    "",
    ...GROUPS.flatMap((g) => [`## ${g.label}`, "", g.intro, "", ...g.pages.map((p) => `- **[${p.title}](${href(p)})**: ${p.description}`), ""]),
  ].join("\n"),
);

const group = (name, links) => [
  "  <div>",
  `    <p class="docnav-label">${esc(name)}</p>`,
  "    <ul>",
  ...links.map(([url, text]) => `      <li><a href="${url}">${esc(text)}</a></li>`),
  "    </ul>",
  "  </div>",
];

write(
  "_includes/docnav.html",
  [
    '<nav class="docnav" id="docnav" aria-label="Documentation">',
    ...GROUPS.flatMap((g) => group(g.label, g.pages.map((p) => [href(p), label(p)]))),
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

// ── download links ──────────────────────────────────────────────────────
//
// Real file links, read from the latest stable release when the site builds.
// The release workflow dispatches this site's build after every stable
// release, so the links follow it. In CI the request is authenticated with
// the workflow's GITHUB_TOKEN (shared runners exhaust the anonymous rate
// limit) and a failure fails the build, so the live site keeps its last good
// links. Locally, offline or rate-limited, the tables point at the releases
// page instead, and the build says so.

const RELEASES = "https://github.com/dimm-city/gutterpress/releases/latest";
const DESKTOP = [
  [/^Gutterpress-setup-win-x64\.exe$/, "Windows", "Installer"],
  [/^Gutterpress-.+-win-x64\.zip$/, "Windows", "Portable: extract the zip and run, no install"],
  [/^Gutterpress-.+-arm64\.dmg$/, "macOS, Apple Silicon", "Open the disk image, drag the app to Applications"],
  [/^Gutterpress-.+-x64\.dmg$/, "macOS, Intel", "Open the disk image, drag the app to Applications"],
  [/^Gutterpress-.+\.AppImage$/, "Linux", "<code>chmod +x</code> the file, then run it"],
];
const CLI = [
  [/^gutterpress-cli-windows-x64\.exe$/, "Windows x64"],
  [/^gutterpress-cli-macos-arm64$/, "macOS, Apple Silicon"],
  [/^gutterpress-cli-macos-x64$/, "macOS, Intel"],
  [/^gutterpress-cli-linux-x64$/, "Linux x64"],
  [/^gutterpress-cli-linux-arm64$/, "Linux arm64"],
];

let release = null;
try {
  const res = await fetch("https://api.github.com/repos/dimm-city/gutterpress/releases/latest", {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "gutterpress-website",
      ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  release = await res.json();
} catch (error) {
  if (process.env.GITHUB_ACTIONS) throw new Error(`gen.mjs: could not read the latest release: ${error.message}`);
  console.warn(`gen.mjs: could not read the latest release (${error.message}); download tables link to the releases page`);
}

const mb = (bytes) => `${Math.round(bytes / 1048576)} MB`;
const asset = (pattern) => release?.assets?.find((a) => pattern.test(a.name));
const fileCell = (a) =>
  a ? `<a href="${a.browser_download_url}" download><code>${esc(a.name)}</code></a> <span class="dl-size">${mb(a.size)}</span>` : `<a href="${RELEASES}">Latest release</a>`;
const table = (head, rows) =>
  `<div class="table-scroll"><table class="downloads">\n<thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead>\n<tbody>\n${rows.join("\n")}\n</tbody>\n</table></div>`;
const version = release ? release.tag_name.replace(/^v/, "") : null;
const sums = asset(/^SHA256SUMS\.txt$/);
const caption = release
  ? `<p class="dl-version">Version <strong>${esc(version)}</strong>, released ${release.published_at.slice(0, 10)} · <a href="${esc(release.html_url)}">release notes</a>${sums ? ` · <a href="${sums.browser_download_url}">SHA-256 checksums</a>` : ""}</p>`
  : `<p class="dl-version">Every file, with SHA-256 checksums, is on the <a href="${RELEASES}">latest release</a>.</p>`;

write(
  "_includes/downloads-desktop.html",
  caption + "\n" + table(["Platform", "File", "Notes"], DESKTOP.map(([re, platform, note]) => `<tr><td>${platform}</td><td>${fileCell(asset(re))}</td><td>${note}</td></tr>`)) + "\n",
);
write(
  "_includes/downloads-cli.html",
  table(["Platform", "File"], CLI.map(([re, platform]) => `<tr><td>${platform}</td><td>${fileCell(asset(re))}</td></tr>`)) + "\n",
);

// ── privacy policy ────────────────────────────────────────────────────────

write(
  "privacy/index.md",
  "---\ntitle: Privacy Policy\n" +
    "description: What Gutterpress can access in your Google Drive, where your credentials are stored, and how to revoke access.\n" +
    "---\n\n" +
    readFileSync(new URL("../../PRIVACY.md", import.meta.url), "utf8"),
);

console.log(`gen.mjs: ${desktop.length} desktop guides, ${cli.length} CLI pages, ${writing.length} writing chapters, ${release ? `downloads for ${release.tag_name}` : "no release data"}, the sidebar and the privacy policy`);
