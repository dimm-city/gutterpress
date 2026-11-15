/**
 * ADR 0012: a new target is one definition, and it then appears in the
 * terminal and the app with no other change. So neither view names a target:
 * the CLI's commands and the desktop app learn every target from the lib.
 */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { TARGET_IDS } from "../lib/targets.ts";

const packages = path.resolve(import.meta.dir, "../../..");
const VIEWS = [
  path.join(packages, "cli/src/commands"),
  path.join(packages, "desktop/src"),
  path.join(packages, "desktop/electron"),
];

// `local` is also the everyday word for this computer (git, sync, preview)
// in both views, so a quoted "local" proves nothing either way.
const SCANNED = TARGET_IDS.filter((id) => id !== "local");

function sources(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(ts|svelte)$/.test(f) && !/\.test\.ts$/.test(f))
    .map((f) => path.join(dir, f));
}

test("neither view names a target", () => {
  const named: string[] = [];
  for (const file of VIEWS.flatMap(sources)) {
    const rel = path.relative(packages, file).split(path.sep).join("/");
    const text = readFileSync(file, "utf8");
    for (const id of SCANNED) {
      const quoted = new RegExp(`["'\`]${id}["'\`]`);
      if (quoted.test(text)) named.push(`${rel}: ${id}`);
    }
  }
  expect(named).toEqual([]);
});
