#!/usr/bin/env node
// Copy the engine's viewer bundle from the CLI package into static/engine/ so
// SvelteKit serves it at /engine/gutterpress-viewer.js (the web target's
// WebAdapter injects a <script src> for it and the service worker precaches
// it). The CLI's src/assets/engine/gutterpress-viewer.js is the ONE committed
// original; this copy is a build product (static/engine/ is ignored by git)
// and is refreshed by the `dev`, `build` and `electron:hmr` scripts.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(desktopRoot, "..", "cli", "src", "assets", "engine", "gutterpress-viewer.js");
const outDir = join(desktopRoot, "static", "engine");

mkdirSync(outDir, { recursive: true });
copyFileSync(src, join(outDir, "gutterpress-viewer.js"));
