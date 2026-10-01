import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dir, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("LogsPanel actions", () => {
  const panel = read("src/lib/components/LogsPanel.svelte");

  test("Open folder and Clear logs call the host routes", () => {
    expect(panel).toContain("api.log.openFolder()");
    expect(panel).toContain("api.log.prune()");
  });

  test("Clear logs is a two-click inline confirm", () => {
    expect(panel).toContain("requestInlineConfirm(clearConfirm");
    expect(panel).toContain("Really clear all logs?");
  });
});

describe("log/prune route", () => {
  const route = read("src/routes/api/log/prune/+server.ts");

  test("only deletes regular .log files inside the read-only roots", () => {
    expect(route).toContain("readOnlyRoots()");
    expect(route).toContain("if (!name.endsWith('.log')) continue;");
    expect(route).toContain(".isFile()");
    expect(route).not.toContain("recursive");
  });
});
