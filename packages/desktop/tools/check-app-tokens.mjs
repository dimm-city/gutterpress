#!/usr/bin/env node
/**
 * App-token inventory checker — enforces theme.css's admission rule.
 *
 * Fails when:
 *  1. any `var(--app-…)` in the SPA references a token that theme.css does
 *     not define (the "phantom token" class of bug: the var() fallback wins
 *     silently and the element opts out of theming — this shipped a real
 *     light-theme bug in EditorToolbar before this check existed);
 *  2. any token defined in theme.css has zero consumers (dead inventory —
 *     delete the token when removing its last consumer);
 *  3. any `var(--app-…, fallback)` exists. Fallbacks on app tokens are dead
 *     code by construction — theme.css loads unconditionally in +layout and
 *     rule 1 guarantees the token exists — while masking the phantom-token
 *     bug class and duplicating palette values that drift. (No SPA code
 *     renders outside the app document: zero --app-* references exist in
 *     iframe/srcdoc-injected CSS or electron/; verified 2026-07-20.)
 *
 * Component-private values (single consumer, no shared semantics) should not
 * be tokens at all — use `light-dark(lightValue, darkValue)` locally instead;
 * see theme.css's header for the full rule.
 *
 * Scanning is comment-aware and string-aware (a `/*` inside a JS string must
 * not swallow following code), and matches whole-file text (a multi-line
 * `var(…)` cannot evade it). Known accepted gap: `//` line comments in
 * script code are not stripped (stripping them naively would mangle bare
 * URLs in markup text); a token name mentioned in a `//` comment would count
 * as usage — harmless for rules 1/3, and for rule 2 it can only under-report
 * dead tokens, never break the build falsely.
 *
 * Usage: node tools/check-app-tokens.mjs   (run from packages/desktop)
 */
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const themeCss = join(desktopRoot, "src", "lib", "theme.css");
const srcRoot = join(desktopRoot, "src");

/**
 * Blank out /* … *\/ comments (and, for JS-bearing files, skip string/template
 * literals while doing so, so a "/*" inside a string can't pair with a later
 * real terminator). Line structure is preserved so reported line numbers stay
 * true. Returns the blanked text.
 */
function stripComments(source, jsAware) {
  let out = "";
  let i = 0;
  let mode = "code"; // code | block | '"' | "'" | '`'
  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "*") {
        mode = "block";
        out += "  ";
        i += 2;
      } else if (jsAware && (c === '"' || c === "'" || c === "`")) {
        mode = c;
        out += c;
        i += 1;
      } else {
        out += c;
        i += 1;
      }
    } else if (mode === "block") {
      if (c === "*" && n === "/") {
        mode = "code";
        out += "  ";
        i += 2;
      } else {
        out += c === "\n" ? "\n" : " ";
        i += 1;
      }
    } else {
      // inside a string/template literal — copy verbatim, honor escapes
      if (c === "\\") {
        out += c + (n ?? "");
        i += 2;
      } else {
        if (c === mode) mode = "code";
        out += c;
        i += 1;
      }
    }
  }
  return out;
}

/** 1-based line number of a character offset. */
function lineOf(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i += 1) if (text[i] === "\n") line += 1;
  return line;
}

/** Tokens defined in theme.css — from comment-stripped text only, so a token
 *  merely mentioned in a comment never counts as a real declaration. */
const themeSource = stripComments(readFileSync(themeCss, "utf8"), false);
const defined = new Set(
  [...themeSource.matchAll(/(--app-[a-z0-9-]+)\s*:/g)].map((m) => m[1])
);

/** Recursively collect scannable source files (symlinks skipped, not statted-through). */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(p, out);
    else if (/\.(svelte|css|ts|js)$/.test(entry)) out.push(p);
  }
  return out;
}

const used = new Map(); // token -> [file:line, …]
const fallbacks = []; // file:line of var(--app-…, fallback) sites
for (const file of walk(srcRoot)) {
  const jsAware = /\.(ts|js)$/.test(file);
  const source = stripComments(readFileSync(file, "utf8"), jsAware);
  const rel = relative(desktopRoot, file);
  // Whole-text matching: a var( spanning lines cannot evade the scan.
  for (const m of source.matchAll(/var\(\s*(--app-[a-z0-9-]+)\s*(,)?/g)) {
    const token = m[1];
    if (!used.has(token)) used.set(token, []);
    used.get(token).push(`${rel}:${lineOf(source, m.index)}`);
    if (m[2]) fallbacks.push(`${rel}:${lineOf(source, m.index)}`);
  }
}

let failed = false;

if (fallbacks.length) {
  failed = true;
  console.error(
    "✖ var(--app-…, fallback) found — app-token fallbacks are dead code that masks missing tokens:"
  );
  for (const loc of fallbacks) console.error(`    ${loc}`);
}

const phantoms = [...used.keys()].filter((t) => !defined.has(t)).sort();
if (phantoms.length) {
  failed = true;
  console.error(
    "✖ Undefined app tokens referenced (fallbacks silently win — the element never themes):"
  );
  for (const t of phantoms)
    console.error(`    ${t}\n      ${used.get(t).join("\n      ")}`);
}

const dead = [...defined].filter((t) => !used.has(t)).sort();
if (dead.length) {
  failed = true;
  console.error(
    "✖ Tokens defined in theme.css with zero consumers (delete them, or use them):"
  );
  for (const t of dead) console.error(`    ${t}`);
}

if (failed) {
  console.error("\nSee the admission rule in src/lib/theme.css's header.");
  process.exit(1);
}
console.log(
  `✓ app tokens OK — ${defined.size} defined, all consumed; no phantom references; no fallbacks.`
);
