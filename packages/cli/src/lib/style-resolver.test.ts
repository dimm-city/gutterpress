import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { listProjectStyles, resolveActiveStyles } from "./style-resolver";

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

  test("no manifest styles → first discovered is ACTIVE (matches the renderer)", async () => {
    const dir = projectDir();
    write(dir, "z.css", "");
    write(dir, "a.css", "");
    write(dir, "manifest.yaml", "title: NoStyles\n");

    const styles = await listProjectStyles(dir);
    expect(styles.length).toBe(2);
    // The first discovered (alphabetical) is the one the preview renders, so it
    // is active; the rest are switchable but not active.
    expect(styles[0]!.path).toBe(join(dir, "a.css"));
    expect(styles[0]!.active).toBe(true);
    expect(styles[1]!.path).toBe(join(dir, "z.css"));
    expect(styles[1]!.active).toBe(false);
  });

  test("no manifest at all → the single discovered file is ACTIVE", async () => {
    const dir = projectDir();
    write(dir, "main.css", "");
    const styles = await listProjectStyles(dir);
    expect(styles.length).toBe(1);
    expect(styles[0]!.active).toBe(true);
    expect(styles[0]!.path).toBe(join(dir, "main.css"));
  });

  test("no manifest styles → styles/book.css preferred over other discovered", async () => {
    const dir = projectDir();
    write(dir, "a.css", "");
    write(dir, "styles/book.css", ":root{}");
    const styles = await listProjectStyles(dir);
    const active = styles.find((s) => s.active);
    expect(active!.path).toBe(join(dir, "styles/book.css"));
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

describe("resolveActiveStyles (the one resolver the renderer + editor share)", () => {
  beforeEach(() => { mkdirSync(TMP_ROOT, { recursive: true }); });
  afterEach(() => { rmSync(TMP_ROOT, { recursive: true, force: true }); });

  test("returns the manifest styles verbatim when present", async () => {
    const dir = projectDir();
    expect(await resolveActiveStyles(dir, ["themes/x/theme.css"])).toEqual(["themes/x/theme.css"]);
  });

  test("no manifest → prefers styles/book.css, then css/print.css, then css/index.css", async () => {
    const dir = projectDir();
    write(dir, "css/index.css", "");
    expect(await resolveActiveStyles(dir, [])).toEqual(["css/index.css"]);
    write(dir, "css/print.css", "");
    expect(await resolveActiveStyles(dir, [])).toEqual(["css/print.css"]);
    write(dir, "styles/book.css", "");
    expect(await resolveActiveStyles(dir, [])).toEqual(["styles/book.css"]);
  });

  test("no manifest, no conventional file → first discovered .css", async () => {
    const dir = projectDir();
    write(dir, "weird-name.css", "");
    expect(await resolveActiveStyles(dir, [])).toEqual(["weird-name.css"]);
  });

  test("no stylesheet at all → [] (never a phantom css/print.css link)", async () => {
    const dir = projectDir();
    expect(await resolveActiveStyles(dir, [])).toEqual([]);
  });

  test("the editor's ACTIVE set === resolveActiveStyles (renderer/editor agree)", async () => {
    const dir = projectDir();
    write(dir, "styles/book.css", ":root{}");
    write(dir, "other.css", "");
    const active = (await listProjectStyles(dir)).filter((s) => s.active).map((s) => s.displayName);
    expect(active).toEqual(await resolveActiveStyles(dir, undefined));
  });
});
