import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { listProjectStyles } from "./style-resolver";

const TMP_ROOT = join(process.cwd(), ".tmp", `style-resolver-tests-${Date.now()}`);

let counter = 0;
function projectDir(): string {
  const dir = join(TMP_ROOT, `proj-${counter++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function write(dir: string, rel: string, body = ""): void {
  const full = join(dir, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body, "utf8");
}

describe("listProjectStyles", () => {
  beforeEach(() => {
    mkdirSync(TMP_ROOT, { recursive: true });
  });
  afterEach(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  test("manifest styles[] entry is returned active, in manifest order", async () => {
    const dir = projectDir();
    write(dir, "themes/dark/theme.css", "/* dark */");
    write(dir, "style.css", "/* root */");
    write(
      dir,
      "manifest.yaml",
      "title: T\nstyles:\n  - themes/dark/theme.css\n",
    );

    const styles = await listProjectStyles(dir);
    const active = styles.filter((s) => s.active);
    expect(active.length).toBe(1);
    expect(active[0]!.path).toBe(join(dir, "themes/dark/theme.css"));
    expect(active[0]!.active).toBe(true);
  });

  test("active manifest styles are sorted first", async () => {
    const dir = projectDir();
    write(dir, "themes/dark/theme.css", "");
    write(dir, "a-style.css", "");
    write(dir, "z-style.css", "");
    write(dir, "manifest.yaml", "styles:\n  - themes/dark/theme.css\n");

    const styles = await listProjectStyles(dir);
    expect(styles[0]!.path).toBe(join(dir, "themes/dark/theme.css"));
    expect(styles[0]!.active).toBe(true);
  });

  test("discovers root, styles/ and themes/*/theme.css CSS files", async () => {
    const dir = projectDir();
    write(dir, "style.css", "");
    write(dir, "styles/print.css", "");
    write(dir, "styles/screen.css", "");
    write(dir, "themes/dark/theme.css", "");
    write(dir, "manifest.yaml", "styles:\n  - style.css\n");

    const styles = await listProjectStyles(dir);
    const paths = styles.map((s) => s.path).sort();
    expect(paths).toContain(join(dir, "style.css"));
    expect(paths).toContain(join(dir, "styles/print.css"));
    expect(paths).toContain(join(dir, "styles/screen.css"));
    expect(paths).toContain(join(dir, "themes/dark/theme.css"));
    // each entry has a displayName
    for (const s of styles) {
      expect(typeof s.displayName).toBe("string");
      expect(s.displayName.length).toBeGreaterThan(0);
    }
  });

  test("multiple manifest styles[] all marked active in order", async () => {
    const dir = projectDir();
    write(dir, "base.css", "");
    write(dir, "overrides.css", "");
    write(dir, "manifest.yaml", "styles:\n  - base.css\n  - overrides.css\n");

    const styles = await listProjectStyles(dir);
    expect(styles[0]!.path).toBe(join(dir, "base.css"));
    expect(styles[0]!.active).toBe(true);
    expect(styles[1]!.path).toBe(join(dir, "overrides.css"));
    expect(styles[1]!.active).toBe(true);
  });

  test("no manifest styles → alphabetical fallback, none marked active", async () => {
    const dir = projectDir();
    write(dir, "z.css", "");
    write(dir, "a.css", "");
    write(dir, "manifest.yaml", "title: NoStyles\n");

    const styles = await listProjectStyles(dir);
    expect(styles.length).toBe(2);
    expect(styles.every((s) => !s.active)).toBe(true);
    expect(styles[0]!.path).toBe(join(dir, "a.css"));
    expect(styles[1]!.path).toBe(join(dir, "z.css"));
  });

  test("no manifest at all → discovered files, none active", async () => {
    const dir = projectDir();
    write(dir, "main.css", "");
    const styles = await listProjectStyles(dir);
    expect(styles.length).toBe(1);
    expect(styles[0]!.active).toBe(false);
    expect(styles[0]!.path).toBe(join(dir, "main.css"));
  });

  test("empty project → empty array", async () => {
    const dir = projectDir();
    const styles = await listProjectStyles(dir);
    expect(styles).toEqual([]);
  });

  test("manifest styles[] entry whose file is missing is still listed active", async () => {
    const dir = projectDir();
    write(dir, "manifest.yaml", "styles:\n  - themes/ghost/theme.css\n");
    const styles = await listProjectStyles(dir);
    expect(styles.length).toBe(1);
    expect(styles[0]!.active).toBe(true);
    expect(styles[0]!.path).toBe(join(dir, "themes/ghost/theme.css"));
  });

  test("no duplicate entries when a manifest style is also discovered", async () => {
    const dir = projectDir();
    write(dir, "style.css", "");
    write(dir, "manifest.yaml", "styles:\n  - style.css\n");
    const styles = await listProjectStyles(dir);
    const matches = styles.filter((s) => s.path === join(dir, "style.css"));
    expect(matches.length).toBe(1);
    expect(matches[0]!.active).toBe(true);
  });
});
