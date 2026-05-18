#!/usr/bin/env bun
/**
 * Debug script to inspect manifest loading and config resolution
 * Usage: bun tools/debug-manifest.ts <input-dir-or-manifest-path>
 */

import { loadManifest, resolveConfig } from "../src/lib/manifest";
import { resolve } from "path";

async function debugManifest(pathArg: string) {
  const resolvedPath = resolve(pathArg);
  console.log(`\n📋 Debugging manifest from: ${resolvedPath}\n`);

  try {
    // Load the manifest
    const manifest = await loadManifest(pathArg);
    console.log("✅ Manifest loaded successfully\n");

    console.log("📄 Raw manifest content:");
    console.log(JSON.stringify(manifest, null, 2));

    // Resolve config
    const config = resolveConfig({}, manifest);
    console.log("\n✅ Config resolved successfully\n");

    console.log("⚙️  Resolved configuration:");
    console.log(JSON.stringify(config, null, 2));

    // Detailed source analysis
    console.log("\n🔍 Source configuration analysis:");
    console.log(`  files: ${config.source.files ? "✅ Specified" : "❌ Not specified"}`);

    if (config.source.files && config.source.files.length > 0) {
      console.log(`  file count: ${config.source.files.length}`);
      console.log(`  files in order:`);
      config.source.files.forEach((f, i) => {
        console.log(`    ${i + 1}. ${f}`);
      });
    } else {
      console.log(`  fallback behavior: All .md files in alphabetical order`);
    }

    console.log(`\n  assets directories: ${config.source.assets.join(", ")}`);

    console.log("\n✨ Manifest configuration looks correct!");
  } catch (err) {
    console.error("\n❌ Error loading/resolving manifest:");
    console.error(err);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const pathArg = args[0];

  if (!pathArg) {
    console.log("Usage: bun tools/debug-manifest.ts <input-dir-or-manifest-path>\n");
    console.log("Examples:");
    console.log("  bun tools/debug-manifest.ts .");
    console.log("  bun tools/debug-manifest.ts ./field-guide");
    console.log("  bun tools/debug-manifest.ts ./field-guide/manifest.yaml");
    process.exit(1);
  }

  await debugManifest(pathArg);
}

if (import.meta.main) {
  await main();
}
