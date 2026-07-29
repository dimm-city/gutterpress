import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { exports as resolveExports } from "resolve.exports";
import { satisfies, validRange } from "semver";

/** Project-relative folder shared by local and vendored npm plugins. */
export const PLUGINS_DIR = "plugins";
export const VENDORED_NPM_DIR = "npm";
export const VENDOR_RECEIPT_FILE = ".gutterpress-install.json";
export const VENDOR_RECEIPT_VERSION = 2;

const NPM_SEGMENT = /^[a-z0-9][a-z0-9._~-]*$/;
const EXACT_VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const WINDOWS_RESERVED =
  /^(con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i;
const MAX_VERIFIED_FILES = 50_000;
const MAX_VERIFIED_BYTES = 512 * 1024 * 1024;

export interface ParsedNpmPluginSpec {
  name: string;
  /** Exact version, semver range, or dist-tag requested after the package name. */
  selector?: string;
}

export interface VendorPackageReceipt {
  /** POSIX path relative to the versioned install root. */
  path: string;
  name: string;
  version: string;
  tarball: string;
  integrity: string;
  /** True only for old registry entries that offered no SHA-256-or-stronger SRI. */
  legacySha1: boolean;
  /** ESM/import-condition package entry, when the package exposes one. */
  entry?: string;
  /** CommonJS/require-condition package entry, when different or available. */
  requireEntry?: string;
  /** Declared production dependency/required-peer name -> package receipt path. */
  dependencies: Record<string, string>;
}

export interface VendorSkippedDependency {
  from: string;
  name: string;
  selector: string;
  kind: "optional" | "optional-peer";
  reason: string;
}

export interface VendorReceipt {
  schemaVersion: typeof VENDOR_RECEIPT_VERSION;
  root: {
    name: string;
    version: string;
    packagePath: string;
    /** POSIX path relative to the versioned install root. */
    entry: string;
    format: "module" | "commonjs";
  };
  packages: VendorPackageReceipt[];
  skipped: VendorSkippedDependency[];
  tree: {
    algorithm: "sha256";
    digest: string;
    files: number;
    bytes: number;
  };
}

export interface VerifiedVendorPlugin {
  installRoot: string;
  entryPath: string;
  format: "module" | "commonjs";
  packages: VerifiedVendorPackage[];
  receipt: VendorReceipt;
}

export interface VerifiedVendorPackage {
  path: string;
  name: string;
  packageDir: string;
  manifest: Record<string, unknown>;
  entryPath?: string;
  requireEntryPath?: string;
  dependencies: Record<string, string>;
}

export interface PackageResolutionTarget {
  target: string;
  /** Export-map targets are exact; legacy targets use Node-style fallbacks. */
  exact: boolean;
}

export interface VendorTreeDigest {
  digest: string;
  files: number;
  bytes: number;
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

export function packageEntryFormat(
  manifest: Record<string, unknown>,
  relativeEntry: string,
): "module" | "commonjs" {
  const extension = path.posix.extname(relativeEntry);
  return extension === ".cjs" ||
    extension === ".json" ||
    (extension !== ".mjs" && manifest.type !== "module")
    ? "commonjs"
    : "module";
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

function safeReceiptPath(relative: unknown, label: string): string {
  if (typeof relative !== "string") throw new Error(`${label} must be a string.`);
  assertWindowsSafeRelativePath(relative);
  return relative;
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

function stringMap(value: unknown): Record<string, string> {
  const map = object(value);
  if (!map) return {};
  const result: Record<string, string> = {};
  for (const [name, selector] of Object.entries(map)) {
    if (typeof selector === "string" && selector.trim()) result[name] = selector.trim();
  }
  return result;
}

interface DependencyDeclarations {
  required: Record<string, string>;
  optional: Record<string, string>;
  optionalPeers: Record<string, string>;
}

function dependencyDeclarations(manifest: Record<string, unknown>): DependencyDeclarations {
  const required = stringMap(manifest.dependencies);
  const optional = stringMap(manifest.optionalDependencies);
  for (const name of Object.keys(optional)) delete required[name];

  const peers = stringMap(manifest.peerDependencies);
  const peerMeta = object(manifest.peerDependenciesMeta) ?? {};
  const optionalPeers: Record<string, string> = {};
  for (const [name, selector] of Object.entries(peers)) {
    if (name in required || name in optional) continue;
    if (object(peerMeta[name])?.optional === true) optionalPeers[name] = selector;
    else required[name] = selector;
  }
  return { required, optional, optionalPeers };
}

function unsupportedRegistrySelector(selector: string): boolean {
  return /^(?:file:|git\+|https?:|ssh:|github:|workspace:|link:|npm:)/i.test(selector);
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

async function verifyReceiptEntry(
  installRoot: string,
  packagePath: string,
  entry: unknown,
  label: string,
): Promise<string | undefined> {
  if (entry === undefined) return undefined;
  const relative = safeReceiptPath(entry, label);
  if (!relative.startsWith(`${packagePath}/`)) {
    throw new Error(`${label} is outside its package.`);
  }
  const packageDir = path.resolve(installRoot, ...packagePath.split("/"));
  const entryPath = path.resolve(installRoot, ...relative.split("/"));
  const [realPackageDir, realEntry] = await Promise.all([
    realpath(packageDir),
    realpath(entryPath),
  ]);
  if (!isContained(realPackageDir, realEntry)) throw new Error(`${label} escapes its package.`);
  const info = await lstat(realEntry);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} is not a regular file.`);
  return realEntry;
}

/** Resolve export conditions/patterns without consulting any ambient filesystem. */
export function packageResolutionTargets(
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

/** Resolve a package's import entry without Node/Bun package-name resolution. */
export async function resolvePackageEntry(
  packageDir: string,
  packageJson?: Record<string, unknown>,
  condition: "import" | "require" = "import",
): Promise<string> {
  const manifest = packageJson ?? (await readPackageJson(packageDir));
  for (const target of packageResolutionTargets(manifest, "", condition)) {
    const resolved = await resolveEntryCandidate(packageDir, target);
    if (resolved) return resolved;
  }
  throw new Error("Package has no contained JavaScript entry point for ESM import.");
}

interface VendorTreeEntry {
  relative: string;
  directory: boolean;
}

async function listTreeEntries(root: string): Promise<VendorTreeEntry[]> {
  const out: VendorTreeEntry[] = [];
  async function visit(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      const relative = toPosixPath(path.relative(root, absolute));
      if (relative === VENDOR_RECEIPT_FILE) continue;
      if (entry.isSymbolicLink()) throw new Error(`Vendor tree contains a symbolic link: ${relative}`);
      if (entry.isDirectory()) {
        out.push({ relative, directory: true });
        await visit(absolute);
      }
      else if (entry.isFile()) out.push({ relative, directory: false });
      else throw new Error(`Vendor tree contains an unsupported filesystem entry: ${relative}`);
    }
  }
  await visit(root);
  return out;
}

/** SHA-256 every contained regular file and its canonical relative path. */
export async function computeVendorTreeDigest(root: string): Promise<VendorTreeDigest> {
  const entries = await listTreeEntries(root);
  const files = entries.filter((entry) => !entry.directory);
  if (files.length > MAX_VERIFIED_FILES) {
    throw new Error(`Vendor tree contains more than ${MAX_VERIFIED_FILES} files.`);
  }
  const seen = new Set<string>();
  const hash = createHash("sha256");
  let bytes = 0;
  for (const entry of entries) {
    const { relative } = entry;
    assertWindowsSafeRelativePath(relative);
    const key = windowsPathKey(relative);
    if (seen.has(key)) throw new Error(`Vendor tree has a Windows-colliding path: ${relative}`);
    seen.add(key);
    if (entry.directory) continue;

    const absolute = path.join(root, ...relative.split("/"));
    const info = await lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
      throw new Error(`Vendor tree file is not an independent regular file: ${relative}`);
    }
    bytes += info.size;
    if (bytes > MAX_VERIFIED_BYTES) {
      throw new Error(`Vendor tree exceeds ${Math.round(MAX_VERIFIED_BYTES / 1024 / 1024)}MB.`);
    }
    hash.update(`${Buffer.byteLength(relative)}:${relative}:${info.size}\0`);
    for await (const chunk of createReadStream(absolute)) hash.update(chunk as Buffer);
  }
  return { digest: hash.digest("hex"), files: files.length, bytes };
}

async function assertVendorPackageOwnership(
  root: string,
  packagePaths: string[],
): Promise<void> {
  const packages = packagePaths
    .map((relative) => ({
      relative,
      key: windowsPathKey(relative),
      parts: relative.split("/").length,
    }))
    .sort((a, b) => b.key.length - a.key.length);

  for (const entry of await listTreeEntries(root)) {
    const actualParts = entry.relative.split("/");
    for (const part of actualParts) {
      if (part.normalize("NFKC").toLowerCase() === "node_modules" && part !== "node_modules") {
        throw new Error(`Vendor tree contains a non-canonical node_modules path: ${entry.relative}`);
      }
    }

    const key = windowsPathKey(entry.relative);
    const structural = packages.some(
      (pkg) => pkg.key === key || pkg.key.startsWith(`${key}/`),
    );
    if (entry.directory && structural) continue;

    const owner = packages.find((pkg) => key.startsWith(`${pkg.key}/`));
    if (!owner) throw new Error(`Vendor tree path is not owned by a receipt package: ${entry.relative}`);
    const packageRelative = actualParts.slice(owner.parts);
    const nodeModulesAt = packageRelative.findIndex(
      (part) => part.normalize("NFKC").toLowerCase() === "node_modules",
    );
    if (nodeModulesAt < 0) continue;

    const generatedEmptyDirectory =
      entry.directory &&
      nodeModulesAt === 0 &&
      (packageRelative.length === 1 ||
        (packageRelative.length === 2 && packageRelative[1]!.startsWith("@")));
    if (!generatedEmptyDirectory) {
      throw new Error(`Package contains bundled node_modules content: ${entry.relative}`);
    }
  }
}

async function recomputeReceiptEntry(
  packageDir: string,
  packagePath: string,
  manifest: Record<string, unknown>,
  condition: "import" | "require",
): Promise<string | undefined> {
  try {
    const entry = await resolvePackageEntry(packageDir, manifest, condition);
    return `${packagePath}/${entry}`;
  } catch (error) {
    if (error instanceof Error && error.message.includes("no contained JavaScript entry point")) {
      return undefined;
    }
    throw error;
  }
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
    throw new Error("Vendor install root resolves outside the project.");
  }
  return installRoot;
}

function reconcileReceiptGraph(
  receipt: VendorReceipt,
  packages: Map<string, VendorPackageReceipt>,
  manifests: Map<string, Record<string, unknown>>,
): void {
  if (!Array.isArray(receipt.skipped)) throw new Error("Vendor receipt skipped list is invalid.");
  const declarations = new Map<string, DependencyDeclarations>();
  for (const [packagePath, manifest] of manifests) {
    declarations.set(packagePath, dependencyDeclarations(manifest));
  }

  const skippedByEdge = new Map<string, VendorSkippedDependency>();
  for (const skipped of receipt.skipped) {
    if (
      !packages.has(skipped.from) ||
      !isValidNpmPackageName(skipped.name) ||
      typeof skipped.selector !== "string" ||
      !["optional", "optional-peer"].includes(skipped.kind) ||
      typeof skipped.reason !== "string"
    ) {
      throw new Error("Vendor receipt contains an invalid skipped dependency.");
    }
    const declared = declarations.get(skipped.from)!;
    const expectedSelector = skipped.kind === "optional"
      ? declared.optional[skipped.name]
      : declared.optionalPeers[skipped.name];
    if (expectedSelector !== skipped.selector) {
      throw new Error(`Skipped dependency is not declared as ${skipped.kind}: ${skipped.name}`);
    }
    const key = `${skipped.from}\0${skipped.name}`;
    if (skippedByEdge.has(key)) throw new Error(`Duplicate skipped dependency: ${skipped.name}`);
    skippedByEdge.set(key, skipped);
  }

  for (const pkg of receipt.packages) {
    if (!object(pkg.dependencies)) throw new Error(`Invalid dependency map for ${pkg.name}.`);
    const declared = declarations.get(pkg.path)!;
    for (const [dependency, target] of Object.entries(pkg.dependencies)) {
      const targetPackage = packages.get(target);
      if (!isValidNpmPackageName(dependency) || !targetPackage || targetPackage.name !== dependency) {
        throw new Error(`Broken dependency edge ${pkg.name} -> ${dependency}.`);
      }
      const selector = declared.required[dependency] ?? declared.optional[dependency];
      if (!selector) throw new Error(`Undeclared dependency edge ${pkg.name} -> ${dependency}.`);
      if (unsupportedRegistrySelector(selector)) {
        throw new Error(`Unsupported selector on dependency edge ${pkg.name} -> ${dependency}.`);
      }
      const range = validRange(selector);
      if (range && !satisfies(targetPackage.version, range)) {
        throw new Error(
          `Dependency edge ${pkg.name} -> ${dependency}@${targetPackage.version} does not satisfy ${selector}.`,
        );
      }
      if (skippedByEdge.has(`${pkg.path}\0${dependency}`)) {
        throw new Error(`Dependency is both installed and skipped: ${pkg.name} -> ${dependency}.`);
      }
    }

    for (const dependency of Object.keys(declared.required)) {
      if (!(dependency in pkg.dependencies)) {
        throw new Error(`Missing required dependency edge ${pkg.name} -> ${dependency}.`);
      }
    }
    for (const dependency of Object.keys(declared.optional)) {
      if (
        !(dependency in pkg.dependencies) &&
        !skippedByEdge.has(`${pkg.path}\0${dependency}`)
      ) {
        throw new Error(`Optional dependency is neither installed nor skipped: ${pkg.name} -> ${dependency}.`);
      }
    }
    for (const dependency of Object.keys(declared.optionalPeers)) {
      if (!skippedByEdge.has(`${pkg.path}\0${dependency}`)) {
        throw new Error(`Optional peer dependency is not recorded as skipped: ${pkg.name} -> ${dependency}.`);
      }
    }
  }
}

/**
 * Verify a schema-v2 receipt and the complete contained tree. `null` means no
 * new-format marker exists, so an exact version may still be legacy metadata.
 * A present but invalid marker is always a hard failure, never a global-cache
 * fallback.
 */
export async function verifyVendoredPlugin(
  projectDir: string,
  expectedName: string,
  expectedVersion: string,
): Promise<VerifiedVendorPlugin | null> {
  try {
    const installRoot = await resolveVendoredPluginInstallRoot(
      projectDir,
      expectedName,
      expectedVersion,
    );
    if (!installRoot) return null;

    const receiptPath = path.join(installRoot, VENDOR_RECEIPT_FILE);
    let raw: string;
    try {
      const info = await lstat(receiptPath);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 1024 * 1024) {
        throw new Error("Vendor receipt is not a small regular file.");
      }
      raw = await readFile(receiptPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }

    const receipt = JSON.parse(raw) as VendorReceipt;
    if (receipt.schemaVersion !== VENDOR_RECEIPT_VERSION) {
      throw new Error(`Unsupported vendor receipt schema ${String(receipt.schemaVersion)}.`);
    }
    if (receipt.root?.name !== expectedName || receipt.root?.version !== expectedVersion) {
      throw new Error("Vendor receipt identity does not match the manifest entry.");
    }
    if (!Array.isArray(receipt.packages) || receipt.packages.length === 0) {
      throw new Error("Vendor receipt has no package graph.");
    }
    const tree = await computeVendorTreeDigest(installRoot);
    if (
      receipt.tree?.algorithm !== "sha256" ||
      receipt.tree.digest !== tree.digest ||
      receipt.tree.files !== tree.files ||
      receipt.tree.bytes !== tree.bytes
    ) {
      throw new Error("Vendor tree hash does not match its receipt.");
    }

    const packages = new Map<string, VendorPackageReceipt>();
    const manifests = new Map<string, Record<string, unknown>>();
    const verifiedPackages: VerifiedVendorPackage[] = [];
    const pathKeys = new Set<string>();
    for (const pkg of receipt.packages) {
      const relative = safeReceiptPath(pkg.path, "Package receipt path");
      const key = windowsPathKey(relative);
      if (pathKeys.has(key)) throw new Error(`Duplicate package receipt path: ${relative}`);
      pathKeys.add(key);
      if (!isValidNpmPackageName(pkg.name) || !isExactNpmVersion(pkg.version)) {
        throw new Error(`Invalid package identity in receipt: ${pkg.name}@${pkg.version}`);
      }
      const expectedSuffix = `node_modules/${pkg.name}`;
      if (relative !== expectedSuffix && !relative.endsWith(`/${expectedSuffix}`)) {
        throw new Error(`Package receipt path does not match ${pkg.name}: ${relative}`);
      }
      if (
        typeof pkg.integrity !== "string" ||
        !/^(?:sha512|sha384|sha256|sha1)-(?:hex-)?[A-Za-z0-9+/=]+$/.test(pkg.integrity) ||
        typeof pkg.legacySha1 !== "boolean" ||
        pkg.legacySha1 !== pkg.integrity.startsWith("sha1-")
      ) {
        throw new Error(`Package receipt is missing provenance: ${pkg.name}@${pkg.version}`);
      }
      const tarball = new URL(pkg.tarball);
      if (
        tarball.origin !== "https://registry.npmjs.org" ||
        tarball.username ||
        tarball.password
      ) {
        throw new Error(`Package receipt has an invalid tarball URL: ${pkg.name}@${pkg.version}`);
      }
      const packageDir = path.resolve(installRoot, ...relative.split("/"));
      if (!isContained(installRoot, packageDir)) throw new Error(`Package escapes vendor root: ${relative}`);
      const realPackageDir = await realpath(packageDir);
      if (!isContained(installRoot, realPackageDir)) {
        throw new Error(`Package resolves outside the vendor root: ${relative}`);
      }
      const manifest = await readPackageJson(packageDir);
      if (manifest.name !== pkg.name || manifest.version !== pkg.version) {
        throw new Error(`Installed package identity changed: ${pkg.name}@${pkg.version}`);
      }
      const [expectedEntry, expectedRequireEntry] = await Promise.all([
        recomputeReceiptEntry(packageDir, relative, manifest, "import"),
        recomputeReceiptEntry(packageDir, relative, manifest, "require"),
      ]);
      if (pkg.entry !== expectedEntry || pkg.requireEntry !== expectedRequireEntry) {
        throw new Error(`Recorded package entries do not match package.json: ${pkg.name}@${pkg.version}`);
      }
      packages.set(relative, pkg);
      manifests.set(relative, manifest);
      verifiedPackages.push({
        path: relative,
        name: pkg.name,
        packageDir: realPackageDir,
        manifest,
        entryPath: await verifyReceiptEntry(installRoot, relative, pkg.entry, "Package import entry"),
        requireEntryPath: await verifyReceiptEntry(
          installRoot,
          relative,
          pkg.requireEntry,
          "Package require entry",
        ),
        dependencies: pkg.dependencies,
      });
    }

    await assertVendorPackageOwnership(installRoot, receipt.packages.map((pkg) => pkg.path));
    reconcileReceiptGraph(receipt, packages, manifests);

    const rootPackagePath = safeReceiptPath(receipt.root.packagePath, "Root package path");
    const rootPackage = packages.get(rootPackagePath);
    if (!rootPackage || rootPackage.name !== expectedName || rootPackage.version !== expectedVersion) {
      throw new Error("Vendor receipt root package is missing.");
    }
    const reachablePackages = new Set([rootPackagePath]);
    const pendingPackages = [rootPackagePath];
    while (pendingPackages.length > 0) {
      const current = packages.get(pendingPackages.pop()!)!;
      for (const target of Object.values(current.dependencies)) {
        if (reachablePackages.has(target)) continue;
        reachablePackages.add(target);
        pendingPackages.push(target);
      }
    }
    if (reachablePackages.size !== receipt.packages.length) {
      throw new Error("Vendor receipt contains a package that is not reachable from its root.");
    }
    const rootManifest = manifests.get(rootPackagePath)!;
    if (receipt.root.format !== "module" && receipt.root.format !== "commonjs") {
      throw new Error("Vendor receipt root format is invalid.");
    }
    const entryRelative = safeReceiptPath(receipt.root.entry, "Plugin entry path");
    if (!entryRelative.startsWith(`${rootPackagePath}/`)) {
      throw new Error("Plugin entry is outside its package.");
    }
    const expectedRootEntry = receipt.root.format === "commonjs"
      ? rootPackage.requireEntry ?? rootPackage.entry
      : rootPackage.entry;
    if (entryRelative !== expectedRootEntry) {
      throw new Error("Plugin entry does not match the package graph entry.");
    }
    if (packageEntryFormat(rootManifest, entryRelative) !== receipt.root.format) {
      throw new Error("Plugin entry format does not match its package metadata.");
    }
    const entryPath = path.resolve(installRoot, ...entryRelative.split("/"));
    const rootPackageDir = path.resolve(installRoot, ...rootPackagePath.split("/"));
    const [realPackageDir, realEntry] = await Promise.all([
      realpath(rootPackageDir),
      realpath(entryPath),
    ]);
    if (!isContained(installRoot, realEntry) || !isContained(realPackageDir, realEntry)) {
      throw new Error("Plugin entry resolves outside the verified vendor tree.");
    }
    const entryInfo = await lstat(realEntry);
    if (!entryInfo.isFile() || entryInfo.isSymbolicLink()) {
      throw new Error("Plugin entry is not a regular file.");
    }

    return {
      installRoot,
      entryPath: realEntry,
      format: receipt.root.format,
      packages: verifiedPackages,
      receipt,
    };
  } catch (error) {
    throw new Error(
      `Vendored plugin "${expectedName}@${expectedVersion}" failed verification: ` +
        `${error instanceof Error ? error.message : String(error)} Reinstall it before building.`,
      { cause: error },
    );
  }
}
