#!/usr/bin/env node

import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { writeSignedManifestForZip } from '../../../scripts/build-web-ui-manifest.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const viewerDir = resolve(here, '..');
const buildDir = join(viewerDir, 'build');
const zipPath = join(viewerDir, 'web-ui-bundle.zip');
const manifestPath = join(viewerDir, 'update-manifest.json');
const sigPath = join(viewerDir, 'update-manifest.json.sig');

const signingKeyPem = process.env.WEB_UI_SIGNING_KEY;
if (!signingKeyPem) {
  console.error('ERROR: WEB_UI_SIGNING_KEY env var is required to prepare the UI runtime package.');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(viewerDir, 'package.json'), 'utf8'));
if (typeof pkg.version !== 'string' || pkg.version.trim() === '') {
  console.error('ERROR: package.json is missing a version.');
  process.exit(1);
}

function collectFiles(rootDir, currentDir, out) {
  for (const entry of readdirSync(currentDir)) {
    const fullPath = join(currentDir, entry);
    const st = statSync(fullPath);
    if (st.isDirectory()) {
      collectFiles(rootDir, fullPath, out);
      continue;
    }
    if (!st.isFile()) continue;
    const rel = relative(rootDir, fullPath).split('\\').join('/');
    out[rel] = readFileSync(fullPath);
  }
}

try {
  rmSync(zipPath, { force: true });
  rmSync(manifestPath, { force: true });
  rmSync(sigPath, { force: true });

  const files = {};
  collectFiles(buildDir, buildDir, files);
  if (!Object.prototype.hasOwnProperty.call(files, 'handler.js')) {
    throw new Error('build/handler.js is missing; run the viewer build before packaging.');
  }
  if (!Object.keys(files).some((name) => name.startsWith('client/'))) {
    throw new Error('build/client/ is missing; run the viewer build before packaging.');
  }
  if (!Object.keys(files).some((name) => name.startsWith('server/'))) {
    throw new Error('build/server/ is missing; run the viewer build before packaging.');
  }

  writeFileSync(zipPath, Buffer.from(zipSync(files)));
  const result = writeSignedManifestForZip({
    zipPath,
    version: pkg.version,
    signingKeyPem,
  });

  console.log(`Prepared UI runtime package payload in ${viewerDir}`);
  console.log(`- ${relative(viewerDir, zipPath)}`);
  console.log(`- ${relative(viewerDir, result.manifestPath)}`);
  console.log(`- ${relative(viewerDir, result.sigPath)}`);
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
}
