#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────
// PWA-clean gate (CLAUDE.md §8): the client SPA bundle must contain no host
// code. This automates the verification the docs previously prescribed as a
// manual grep —
//   grep -rlE "fileURLToPath|node:module|createRequire|node:fs|node:url|isomorphic-git" build/client/_app/
// — so every `npm run build` fails loudly instead of shipping a renderer that
// crashes at runtime (the 0.4.0-beta.4 `fileURLToPath is not a function`
// regression). Scope is build/client only: build/server + the +server.ts
// routes compiled into it are host Node code by design.
// ──────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const clientDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "build",
  "client",
  "_app",
);

// The named identifiers catch the historical lib-chunk leaks (0.4.0-beta.4,
// 2026-07); the QUOTED `node:` specifier catches ANY builtin import vite
// externalizes into a client chunk (node:path, node:os, … — quoted, because
// a bare `node:x` also matches minified object properties like `{node:t}`);
// and the bare require() form catches un-prefixed builtin requires surviving
// in CJS interop output.
const BANNED =
  /fileURLToPath|createRequire|isomorphic-git|["'`]node:[a-z_/]+["'`]|require\(["'](?:fs|path|os|url|module|process|child_process|crypto|stream|net|tls|http|https|zlib|util|tty|readline)["']\)/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

let scanned = 0;
const hits = [];
try {
  for (const file of walk(clientDir)) {
    if (!/\.(js|mjs|cjs)$/.test(file)) continue;
    scanned += 1;
    const m = BANNED.exec(readFileSync(file, "utf8"));
    if (m) hits.push(`${file}: contains "${m[0]}"`);
  }
} catch (err) {
  console.error(`✖ cannot scan ${clientDir}: ${err?.message ?? err}`);
  process.exit(1);
}

if (scanned === 0) {
  console.error(
    `✖ no JS files found under ${clientDir} — the client bundle moved and ` +
      "this gate is scanning nothing. Update the path so it guards again.",
  );
  process.exit(1);
}

if (hits.length > 0) {
  console.error(
    "✖ Host code leaked into the client SPA bundle (CLAUDE.md §8 — the " +
      "renderer must stay PWA-clean). A value import is dragging Node-target " +
      "code into the browser build:",
  );
  for (const h of hits) console.error("  - " + h);
  console.error(
    "Move the Node work into an api/**/+server.ts route (or the IPC bridge) " +
      "and call it through the platform adapter; use `import type` for types.",
  );
  process.exit(1);
}

console.log(`✓ client bundle is PWA-clean (${scanned} file(s) scanned)`);
