/**
 * Where an npm extension lives once `gutterpress ext add` has vendored it, and
 * the small path/identity helpers the installer (`npm-plugin-installer.ts`)
 * and the loader (`markdown/plugins.ts`) share.
 *
 * Layout: `<project>/plugins/npm/<name>/<version>/node_modules/<name>/…` — a
 * plain nested npm tree. Node's (and Bun's) own module resolution walks it, so
 * the loader simply `import()`s the package entry and every `import`/`require`
 * inside the package resolves the ordinary way. There is no receipt, no
 * digest, and no per-load re-verification: integrity is checked once, at
 * install time, against the registry's SRI hash.
 */
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { exports as resolveExports } from "resolve.exports";

/** Project-relative folder shared by local and vendored npm plugins. */
export const PLUGINS_DIR = "plugins";
export const VENDORED_NPM_DIR = "npm";

const NPM_SEGMENT = /^[a-z0-9][a-z0-9._~-]*$/;
const EXACT_VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const WINDOWS_RESERVED =
  /^(con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i;

export interface ParsedNpmPluginSpec {
  name: string;
  /** Exact version, semver range, or dist-tag requested after the package name. */
  selector?: string;
}

export interface PackageResolutionTarget {
  target: string;
  /** Export-map targets are exact; legacy targets use Node-style fallbacks. */
  exact: boolean;
}

export function isValidNpmPackageName(name: string): boolean {
  if (!name || name.length > 214 || name !== name.toLowerCase()) return false;
  if (name.startsWith("@")) {
    const parts = name.slice(1).split("/");
    return parts.length === 2 && parts.every((part) => NPM_SEGMENT.test(part));
  }
  return !name.includes("/") && NPM_SEGMENT.test(name);
}

/** Parse `name`, `name@selector`, `@scope/name`, or `@scope/name@selector`. */
export function parseNpmPluginSpec(input: string): ParsedNpmPluginSpec {
  const spec = input.trim();
  if (!spec) throw new Error("An npm package name is required.");

  let name = spec;
  let selector: string | undefined;
  if (spec.startsWith("@")) {
    const slash = spec.indexOf("/");
    const versionAt = spec.lastIndexOf("@");
    if (slash > 1 && versionAt > slash) {
      name = spec.slice(0, versionAt);
      selector = spec.slice(versionAt + 1);
    }
  } else {
    const versionAt = spec.lastIndexOf("@");
    if (versionAt > 0) {
      name = spec.slice(0, versionAt);
      selector = spec.slice(versionAt + 1);
    }
  }

  if (!isValidNpmPackageName(name)) {
    throw new Error(
      `"${name}" is not a valid npm package name. Use a name like ` +
        "markdown-it-highlightjs or @scope/markdown-it-plugin.",
    );
  }
  if (selector !== undefined && !selector) {
    throw new Error(`The package spec "${spec}" is missing a selector after @.`);
  }
  return selector === undefined ? { name } : { name, selector };
}

export function isExactNpmVersion(version: string): boolean {
  return EXACT_VERSION.test(version);
}

function encodePathPart(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Root containing one pinned package's private `node_modules` tree. */
export function vendoredNpmPluginRoot(
  projectDir: string,
  name: string,
  version: string,
): string {
  return path.join(
    projectDir,
    PLUGINS_DIR,
    VENDORED_NPM_DIR,
    encodePathPart(name),
    encodePathPart(version),
  );
}

/** npm-compatible package location within a versioned vendor root. */
export function vendoredNpmPluginPackageDir(
  installRoot: string,
  name: string,
): string {
  return path.join(installRoot, "node_modules", ...name.split("/"));
}

export function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

/** Reject names that alias, fail, or escape on supported Windows filesystems. */
export function assertWindowsSafeRelativePath(relative: string): void {
  if (!relative || relative.includes("\\") || relative.startsWith("/") || /^[a-zA-Z]:/.test(relative)) {
    throw new Error(`Unsafe package path: ${relative || "(empty)"}`);
  }
  const normalized = relative.normalize("NFKC");
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe package path: ${relative}`);
  }
  for (const part of parts) {
    if (
      part.length > 255 ||
      /[\u0000-\u001f<>:"|?*]/.test(part) ||
      part.endsWith(".") ||
      part.endsWith(" ") ||
      WINDOWS_RESERVED.test(part)
    ) {
      throw new Error(`Package path is invalid on Windows: ${relative}`);
    }
  }
}

/** Canonical key for case-insensitive, Unicode-normalizing Windows aliases. */
export function windowsPathKey(relative: string): string {
  return relative.normalize("NFKC").toLowerCase();
}

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function readPackageJson(packageDir: string): Promise<Record<string, unknown>> {
  const packageJsonPath = path.join(packageDir, "package.json");
  const info = await lstat(packageJsonPath);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`Package metadata is not a regular file: ${packageJsonPath}`);
  }
  const parsed = object(JSON.parse(await readFile(packageJsonPath, "utf8")));
  if (!parsed) throw new Error(`Package metadata is not an object: ${packageJsonPath}`);
  return parsed;
}

function packageResolutionTargets(
  manifest: Record<string, unknown>,
  subpath: string,
  condition: "import" | "require",
): PackageResolutionTarget[] {
  if (manifest.exports !== undefined) {
    try {
      const targets = resolveExports(
        manifest,
        subpath ? `./${subpath}` : ".",
        { require: condition === "require" },
      ) ?? [];
      return targets.map((target) => ({ target, exact: true }));
    } catch {
      return [];
    }
  }
  if (subpath) return [{ target: subpath, exact: false }];

  const targets = [
    ...(condition === "import" && typeof manifest.module === "string" ? [manifest.module] : []),
    ...(typeof manifest.main === "string" ? [manifest.main] : []),
    "index.mjs",
    "index.js",
    "index.cjs",
  ];
  return [...new Set(targets)].map((target) => ({ target, exact: false }));
}

function safePackageTarget(target: string): string | null {
  if (
    !target ||
    target.includes("\\") ||
    target.includes("*") ||
    target.includes("?") ||
    target.includes("#")
  ) {
    return null;
  }
  const relative = target.startsWith("./") ? target.slice(2) : target;
  if (!relative || path.isAbsolute(relative)) return null;
  assertWindowsSafeRelativePath(relative);
  if (
    relative
      .normalize("NFKC")
      .split("/")
      .some((part) => part.toLowerCase() === "node_modules")
  ) {
    return null;
  }
  return relative;
}

async function resolveEntryCandidate(
  packageDir: string,
  resolution: PackageResolutionTarget,
): Promise<string | null> {
  const relative = safePackageTarget(resolution.target);
  if (!relative) return null;
  const base = path.resolve(packageDir, ...relative.split("/"));
  if (!isContained(packageDir, base)) return null;

  const candidates = resolution.exact
    ? [base]
    : [
        base,
        `${base}.mjs`,
        `${base}.js`,
        `${base}.cjs`,
        `${base}.json`,
        path.join(base, "index.mjs"),
        path.join(base, "index.js"),
        path.join(base, "index.cjs"),
        path.join(base, "index.json"),
      ];
  for (const candidate of candidates) {
    try {
      const info = await lstat(candidate);
      if (!info.isFile() || info.isSymbolicLink()) continue;
      const extension = path.extname(candidate);
      if (extension && ![".js", ".mjs", ".cjs", ".json"].includes(extension)) continue;
      const [realRoot, realCandidate] = await Promise.all([realpath(packageDir), realpath(candidate)]);
      if (!isContained(realRoot, realCandidate)) continue;
      return toPosixPath(path.relative(packageDir, realCandidate));
    } catch {
      // Try the next deterministic candidate.
    }
  }
  return null;
}

/**
 * Resolve a package's entry module (POSIX path relative to `packageDir`) from
 * its own `package.json` — `exports` (the `import` condition, else `require`:
 * a dynamic `import()` loads a CommonJS entry just as well), else `module`/
 * `main`, else the `index.*` fallbacks — without consulting Node/Bun
 * package-name resolution, so it works on a folder that is not on any module
 * path. The entry must be a regular file contained in the package.
 */
export async function resolvePackageEntry(
  packageDir: string,
  packageJson?: Record<string, unknown>,
): Promise<string> {
  const manifest = packageJson ?? (await readPackageJson(packageDir));
  for (const condition of ["import", "require"] as const) {
    for (const target of packageResolutionTargets(manifest, "", condition)) {
      const resolved = await resolveEntryCandidate(packageDir, target);
      if (resolved) return resolved;
    }
  }
  throw new Error("Package has no contained JavaScript entry point.");
}

/** Resolve a vendor root without trusting lexical project containment. */
export async function resolveVendoredPluginInstallRoot(
  projectDir: string,
  expectedName: string,
  expectedVersion: string,
): Promise<string | null> {
  const requestedProjectRoot = path.resolve(projectDir);
  const requestedInstallRoot = vendoredNpmPluginRoot(
    requestedProjectRoot,
    expectedName,
    expectedVersion,
  );
  let installInfo;
  try {
    installInfo = await lstat(requestedInstallRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!installInfo.isDirectory() || installInfo.isSymbolicLink()) {
    throw new Error("Vendor install root is not a normal directory.");
  }
  const [realProjectRoot, installRoot] = await Promise.all([
    realpath(requestedProjectRoot),
    realpath(requestedInstallRoot),
  ]);
  if (!isContained(realProjectRoot, installRoot)) {
    throw new Error("Vendor install root resolves outside the book folder.");
  }
  return installRoot;
}
