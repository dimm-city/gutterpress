#!/usr/bin/env node
/**
 * Mark electron-dist/ as a CommonJS scope.
 *
 * The viewer package is `"type": "module"` (required by Vite/SvelteKit), but
 * the compiled Electron main/preload are CommonJS. Node resolves module format
 * from the nearest package.json, so electron-dist/ needs its own marker that
 * overrides the parent's `type: module`. tsc doesn't emit this file, so we
 * write it after the `tsc -p electron/tsconfig.json` step.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "electron-dist");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "package.json"), JSON.stringify({ type: "commonjs" }) + "\n");
