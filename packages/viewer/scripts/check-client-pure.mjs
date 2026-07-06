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

const BANNED = /fileURLToPath|node:module|createRequire|node:fs|node:url|isomorphic-git/;

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
