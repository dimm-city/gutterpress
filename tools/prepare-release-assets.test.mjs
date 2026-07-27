import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "prepare-release-assets.mjs");
let failures = 0;

function check(name, condition, detail = "") {
  if (condition) console.log(`ok - ${name}`);
  else {
    failures++;
    console.error(`NOT OK - ${name}${detail ? `: ${detail}` : ""}`);
  }
}

function run(input, output) {
  return spawnSync(process.execPath, [SCRIPT, input, output], { encoding: "utf8" });
}

const root = mkdtempSync(join(tmpdir(), "release-assets-"));
try {
  const input = join(root, "downloads");
  const output = join(root, "release");
  mkdirSync(join(input, "cli-linux"), { recursive: true });
  mkdirSync(join(input, "viewer", "nested"), { recursive: true });
  writeFileSync(join(input, "cli-linux", "print-md"), "cli payload\n");
  writeFileSync(join(input, "viewer", "nested", "viewer.dmg"), "viewer payload\n");

  const result = run(input, output);
  check("nested artifact directories are staged", result.status === 0, result.stderr);
  check(
    "release directory contains flat files and checksum",
    JSON.stringify(readdirSync(output).sort()) ===
      JSON.stringify(["SHA256SUMS.txt", "print-md", "viewer.dmg"]),
  );

  const cliHash = createHash("sha256").update("cli payload\n").digest("hex");
  const viewerHash = createHash("sha256").update("viewer payload\n").digest("hex");
  const checksums = readFileSync(join(output, "SHA256SUMS.txt"), "utf8");
  check("checksum covers staged CLI file", checksums.includes(`${cliHash}  print-md\n`));
  check("checksum covers staged viewer file", checksums.includes(`${viewerHash}  viewer.dmg\n`));
  check("checksum file does not attempt to hash itself", !checksums.includes("SHA256SUMS.txt"));

  const duplicateInput = join(root, "duplicates");
  mkdirSync(join(duplicateInput, "one"), { recursive: true });
  mkdirSync(join(duplicateInput, "two"), { recursive: true });
  writeFileSync(join(duplicateInput, "one", "same.bin"), "one");
  writeFileSync(join(duplicateInput, "two", "same.bin"), "two");
  const duplicateResult = run(duplicateInput, join(root, "duplicate-output"));
  check("duplicate basenames fail instead of overwriting", duplicateResult.status === 1);
  check("duplicate failure identifies the filename", duplicateResult.stderr.includes("same.bin"));
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall tests passed");
