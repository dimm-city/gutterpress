// Writes privacy/index.md into the overlay directory unify hands it before
// every build (generate: scripts/gen.mjs in unify.yaml); unify renders it.
//
// The privacy policy is why the site exists: Google's OAuth consent screen
// needs it at a stable public URL, https://dimm-city.github.io/gutterpress/privacy/
// (ADR 0011). The root PRIVACY.md stays its ONE source — this script reads it
// on every build, so the published page can never drift from the file the
// repository, README and changelog all link to.
//
// unify passes argv[2] the source root and argv[3] the overlay directory.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [, , sourceRoot, outDir] = process.argv;
if (!sourceRoot || !outDir) {
  throw new Error("gen.mjs: unify runs this (generate: scripts/gen.mjs in unify.yaml); run unify build");
}

const privacy = readFileSync(join(sourceRoot, "..", "..", "PRIVACY.md"), "utf8");
mkdirSync(join(outDir, "privacy"), { recursive: true });
writeFileSync(
  join(outDir, "privacy", "index.md"),
  "---\ntitle: Privacy Policy\n" +
    "description: What Gutterpress can access in your Google Drive, where your credentials are stored, and how to revoke access.\n" +
    "---\n\n" + privacy,
);
console.log("gen.mjs: wrote privacy/index.md");
