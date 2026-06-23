// ──────────────────────────────────────────────────────────────────────────
// write-baseline-manifest.mjs — stamps packages/viewer/build/update-manifest.json
//
// Run as part of the viewer `build` step (after `vite build`). The in-asar
// bundled SPA carries this manifest so readBaselineVersion() reports the
// shipped version instead of always defaulting to "0.0.0" — which makes the
// downgrade floor (minimumSeenVersion) and the displayed "current version"
// accurate on a fresh install before any web-v* update is applied.
//
// This is just the baked-in baseline version marker. Runtime updates are
// resolved from the npm registry and verified by `dist.integrity` (SSRI) —
// there is no signed local manifest. See docs/runtime-lib-update-plan.md.
// ──────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const viewerDir = join(repoRoot, 'packages', 'viewer');
const buildDir = join(viewerDir, 'build');

if (!existsSync(buildDir)) {
  console.error(
    `ERROR: ${buildDir} not found — run \`vite build\` before this script.`
  );
  process.exit(1);
}

// Version from the viewer package.json.
const pkg = JSON.parse(readFileSync(join(viewerDir, 'package.json'), 'utf8'));
const version = pkg.version;

// DESKTOP_API from contract.ts (single source of truth).
const contractSrc = readFileSync(
  join(viewerDir, 'electron', 'updater', 'contract.ts'),
  'utf8'
);
const m = /export\s+const\s+DESKTOP_API\s*=\s*(\d+)/.exec(contractSrc);
if (!m) {
  console.error('ERROR: could not parse DESKTOP_API from contract.ts');
  process.exit(1);
}
const requiresDesktopApi = Number(m[1]);

// Slim baseline marker: readBaselineVersion() reads `.version`; requiresDesktopApi
// is kept for parity with the published package's `printmd.requiresDesktopApi`.
const manifest = {
  schemaVersion: 1,
  version,
  requiresDesktopApi,
};

const out = join(buildDir, 'update-manifest.json');
writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`baseline update-manifest.json written: ${out} (version ${version})`);
