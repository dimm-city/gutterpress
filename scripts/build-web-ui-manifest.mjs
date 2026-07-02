#!/usr/bin/env node
/**
 * build-web-ui-manifest.mjs
 *
 * Generates update-manifest.json and update-manifest.json.sig next to the
 * provided zip file.
 *
 * Usage:
 *   node scripts/build-web-ui-manifest.mjs <zip-path> [version]
 *
 * Environment variables:
 *   WEB_UI_VERSION     - semver string (e.g. "0.2.1"). Can also be passed as
 *                        the second CLI argument.
 *   WEB_UI_SIGNING_KEY - Ed25519 private key in PKCS8 PEM format.
 *                        Generate with:
 *                          openssl genpkey -algorithm ed25519 -out signing-key.pem
 *                        The corresponding public key (for verifier):
 *                          openssl pkey -in signing-key.pem -pubout -out signing-key.pub.pem
 *
 * GitHub Actions secret required:
 *   WEB_UI_SIGNING_KEY  (set via repo Settings → Secrets → Actions)
 *
 * Outputs (written next to the zip):
 *   update-manifest.json      - manifest contract (see schema below)
 *   update-manifest.json.sig  - raw Ed25519 signature of manifest bytes,
 *                               base64-encoded (standard, no line breaks)
 *
 * Manifest schema (schemaVersion: 1):
 * {
 *   "schemaVersion": 1,
 *   "kind": "web-ui-bundle",
 *   "version": "<semver>",
 *   "requiresDesktopApi": 1,
 *   "assets": {
 *     "bundle": {
 *       "name": "web-ui-bundle.zip",
 *       "sha256": "<lowercase hex>",
 *       "size": <bytes>
 *     }
 *   },
 *   "releasedAt": "<ISO 8601 UTC>"
 * }
 */

import { createHash, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Single source of truth for the IPC contract version: read DESKTOP_API from
// contract.ts so a bump there propagates into requiresDesktopApi automatically.
// (A drift here would let an incompatible bundle reach an older shell.)
function readDesktopApi() {
  const here = dirname(fileURLToPath(import.meta.url));
  const contractPath = resolve(
    here,
    '../packages/viewer/electron/updater/contract.ts'
  );
  const src = readFileSync(contractPath, 'utf8');
  const m = /export\s+const\s+DESKTOP_API\s*=\s*(\d+)/.exec(src);
  if (!m) {
    console.error(`ERROR: could not parse DESKTOP_API from ${contractPath}`);
    process.exit(1);
  }
  return Number(m[1]);
}

export function writeSignedManifestForZip({ zipPath, version, signingKeyPem }) {
  const resolvedZipPath = resolve(zipPath);

  let zipBytes;
  try {
    zipBytes = readFileSync(resolvedZipPath);
  } catch (err) {
    throw new Error(`Cannot read zip file at ${resolvedZipPath}: ${err.message}`);
  }

  const sha256 = createHash('sha256').update(zipBytes).digest('hex');
  const size = zipBytes.length;

  const manifest = {
    schemaVersion: 1,
    kind: 'web-ui-bundle',
    version,
    requiresDesktopApi: readDesktopApi(),
    assets: {
      bundle: {
        name: 'web-ui-bundle.zip',
        sha256,
        size,
      },
    },
    releasedAt: new Date().toISOString(),
  };

  const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
  const manifestBytes = Buffer.from(manifestJson, 'utf8');

  let sigBytes;
  try {
    sigBytes = sign(null, manifestBytes, signingKeyPem);
  } catch (err) {
    throw new Error(`Signing failed: ${err.message}`);
  }

  const sigBase64 = sigBytes.toString('base64');
  const outDir = dirname(resolvedZipPath);
  const manifestPath = join(outDir, 'update-manifest.json');
  const sigPath = join(outDir, 'update-manifest.json.sig');

  writeFileSync(manifestPath, manifestJson, 'utf8');
  writeFileSync(sigPath, sigBase64, 'utf8');

  return {
    manifest,
    manifestJson,
    manifestPath,
    sigPath,
    sigBase64,
    sigBytes,
  };
}

function isDirectRun() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: node scripts/build-web-ui-manifest.mjs <zip-path> [version]');
    console.error('       WEB_UI_VERSION and WEB_UI_SIGNING_KEY must be set in env.');
    process.exit(1);
  }

  const zipPath = args[0];
  const version = args[1] ?? process.env.WEB_UI_VERSION;
  if (!version) {
    console.error('ERROR: version must be provided as the second argument or via WEB_UI_VERSION env var.');
    process.exit(1);
  }

  const signingKeyPem = process.env.WEB_UI_SIGNING_KEY;
  if (!signingKeyPem) {
    console.error('ERROR: WEB_UI_SIGNING_KEY env var is required (Ed25519 PKCS8 PEM private key).');
    process.exit(1);
  }

  try {
    const result = writeSignedManifestForZip({ zipPath, version, signingKeyPem });
    console.log(`update-manifest.json written to: ${result.manifestPath}`);
    console.log(`update-manifest.json.sig written to: ${result.sigPath}`);
    console.log('');
    console.log('Manifest contents:');
    console.log(result.manifestJson);
    console.log(`Signature (base64, ${result.sigBytes.length} raw bytes): ${result.sigBase64.slice(0, 32)}…`);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    if (String(err.message).includes('Signing failed')) {
      console.error('Ensure WEB_UI_SIGNING_KEY is a valid Ed25519 PKCS8 PEM private key.');
    }
    process.exit(1);
  }
}
