/**
 * Explicit npm plugin installer. Every required production dependency is
 * resolved to an exact registry version and extracted into a private nested
 * node_modules tree. Downloads, integrity, archive paths, and total expansion
 * are bounded; package scripts are never run.
 */
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { maxSatisfying, satisfies, validRange } from "semver";

import {
  FetchPassthroughError,
  FetchUnavailableError,
  FriendlyHttpError,
  withFetchTimeout,
} from "./fetch-timeout.ts";
import {
  assertWindowsSafeRelativePath,
  computeVendorTreeDigest,
  isExactNpmVersion,
  packageEntryFormat,
  parseNpmPluginSpec,
  PLUGINS_DIR,
  resolvePackageEntry,
  toPosixPath,
  VENDORED_NPM_DIR,
  VENDOR_RECEIPT_FILE,
  VENDOR_RECEIPT_VERSION,
  vendoredNpmPluginPackageDir,
  vendoredNpmPluginRoot,
  windowsPathKey,
  type VendorPackageReceipt,
  type VendorReceipt,
  type VendorSkippedDependency,
} from "./plugin-vendor.ts";

const NPM_REGISTRY = "https://registry.npmjs.org";

export interface NpmPluginInstallLimits {
  metadataBytes: number;
  packageTarballBytes: number;
  totalNetworkBytes: number;
  packageFileBytes: number;
  totalUnpackedBytes: number;
  totalFiles: number;
  totalPackages: number;
  dependencyDepth: number;
}

const DEFAULT_LIMITS: NpmPluginInstallLimits = {
  metadataBytes: 15 * 1024 * 1024,
  packageTarballBytes: 50 * 1024 * 1024,
  totalNetworkBytes: 250 * 1024 * 1024,
  packageFileBytes: 50 * 1024 * 1024,
  totalUnpackedBytes: 512 * 1024 * 1024,
  totalFiles: 50_000,
  totalPackages: 512,
  dependencyDepth: 64,
};

const METADATA_TIMEOUT_MS = 30_000;
const TARBALL_TIMEOUT_MS = 120_000;

type FetchFn = typeof globalThis.fetch;

export interface NpmPluginInstallOptions {
  /** Dependency injection for focused tests; production uses global fetch. */
  fetch?: FetchFn;
  signal?: AbortSignal;
  /** Test/specialized-host limits; production defaults stay deliberately hard. */
  limits?: Partial<NpmPluginInstallLimits>;
}

export interface InstalledNpmPlugin {
  name: string;
  version: string;
  installRoot: string;
  /** Previous same-version directory held until the manifest commits. */
  backupRoot: string | null;
  warnings: string[];
}

interface Integrity {
  algorithm: "sha512" | "sha384" | "sha256" | "sha1";
  digest: Buffer;
  label: string;
  legacySha1: boolean;
}

interface SelectedPackage {
  name: string;
  version: string;
  tarball: string;
  integrity: Integrity;
}

interface InstalledRecord extends VendorPackageReceipt {
  packageDir: string;
  manifest: Record<string, unknown>;
}

interface InstallContext {
  fetch: FetchFn;
  signal?: AbortSignal;
  limits: NpmPluginInstallLimits;
  stageRoot: string;
  downloadsDir: string;
  packuments: Map<string, Promise<Record<string, unknown>>>;
  records: InstalledRecord[];
  skipped: VendorSkippedDependency[];
  warnings: Set<string>;
  totalNetworkBytes: number;
  totalUnpackedBytes: number;
  totalFiles: number;
  archiveCounter: number;
}

interface InstalledDependency {
  path?: string;
  skipped?: string;
}

class SecurityInstallError extends FetchPassthroughError {}
class PackageUnavailableError extends Error {}

function isOptionalAvailabilityError(error: unknown): boolean {
  return error instanceof PackageUnavailableError ||
    error instanceof FriendlyHttpError ||
    error instanceof FetchUnavailableError;
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

function mb(bytes: number): string {
  return `${Math.ceil(bytes / 1024 / 1024)}MB`;
}

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function mergeLimits(overrides?: Partial<NpmPluginInstallLimits>): NpmPluginInstallLimits {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Invalid npm plugin install limit ${name}: ${value}`);
    }
  }
  return limits;
}

async function streamResponse(
  ctx: InstallContext,
  response: Response,
  maxBytes: number,
  totalLimitMessage: string,
  onChunk: (chunk: Uint8Array) => void | Promise<void>,
): Promise<number> {
  if (!response.body) throw new Error("Registry response had no body.");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new SecurityInstallError(`Registry response is too large (max ${mb(maxBytes)}).`);
  }
  if (
    Number.isFinite(declared) &&
    declared > ctx.limits.totalNetworkBytes - ctx.totalNetworkBytes
  ) {
    throw new SecurityInstallError(totalLimitMessage);
  }
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel("size limit exceeded").catch(() => {});
        throw new SecurityInstallError(`Registry response is too large (max ${mb(maxBytes)}).`);
      }
      if (ctx.totalNetworkBytes + value.length > ctx.limits.totalNetworkBytes) {
        await reader.cancel("total size limit exceeded").catch(() => {});
        throw new SecurityInstallError(totalLimitMessage);
      }
      ctx.totalNetworkBytes += value.length;
      await onChunk(value);
    }
  } finally {
    reader.releaseLock();
  }
  return total;
}

async function fetchPackument(ctx: InstallContext, name: string): Promise<Record<string, unknown>> {
  let pending = ctx.packuments.get(name);
  if (pending) return pending;
  pending = withFetchTimeout(
    {
      timeoutMs: METADATA_TIMEOUT_MS,
      signal: ctx.signal,
      timeoutMessage: `Looking up ${name} on npm timed out. Check your connection and try again.`,
      offlineMessage: (cause) =>
        `Looking up ${name} on npm failed (${cause instanceof Error ? cause.message : String(cause)}).`,
    },
    async (signal) => {
      const response = await ctx.fetch(`${NPM_REGISTRY}/${encodeURIComponent(name)}`, {
        signal,
        redirect: "error",
        headers: { accept: "application/vnd.npm.install-v1+json" },
      });
      if (response.status === 404) {
        throw new FriendlyHttpError(`npm package "${name}" was not found.`);
      }
      if (!response.ok) {
        throw new FriendlyHttpError(`Looking up ${name} on npm failed (HTTP ${response.status}).`);
      }
      const chunks: Uint8Array[] = [];
      const size = await streamResponse(
        ctx,
        response,
        ctx.limits.metadataBytes,
        `Plugin dependency metadata exceeds the ${mb(ctx.limits.totalNetworkBytes)} total download limit.`,
        (chunk) => {
          chunks.push(chunk);
        },
      );
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      let metadata: Record<string, unknown> | null = null;
      try {
        metadata = object(JSON.parse(new TextDecoder().decode(bytes)));
      } catch {
        // Mapped below.
      }
      if (!metadata || metadata.name !== name) {
        throw new FriendlyHttpError(`npm returned invalid metadata for "${name}".`);
      }
      return metadata;
    },
  ).catch((error) => {
    ctx.packuments.delete(name);
    throw error;
  });
  ctx.packuments.set(name, pending);
  return pending;
}

function parseIntegrity(dist: Record<string, unknown>): Integrity {
  const integrity = typeof dist.integrity === "string" ? dist.integrity.trim() : "";
  const parsed = integrity
    .split(/\s+/)
    .map((token) => token.match(/^(sha512|sha384|sha256|sha1)-([A-Za-z0-9+/]+={0,2})(?:\?.*)?$/))
    .filter((match): match is RegExpMatchArray => Boolean(match?.[1] && match[2]));

  for (const algorithm of ["sha512", "sha384", "sha256"] as const) {
    const match = parsed.find((candidate) => candidate[1] === algorithm);
    if (!match) continue;
    const digest = Buffer.from(match[2]!, "base64");
    if (digest.length > 0) {
      return { algorithm, digest, label: `${algorithm}-${match[2]}`, legacySha1: false };
    }
  }

  const sha1 = parsed.find((candidate) => candidate[1] === "sha1");
  if (sha1) {
    return {
      algorithm: "sha1",
      digest: Buffer.from(sha1[2]!, "base64"),
      label: `sha1-${sha1[2]}`,
      legacySha1: true,
    };
  }
  if (integrity) {
    throw new SecurityInstallError(
      "The npm registry supplied integrity data, but no supported SHA-256-or-stronger hash.",
    );
  }

  const shasum = typeof dist.shasum === "string" ? dist.shasum.trim().toLowerCase() : "";
  if (/^[a-f0-9]{40}$/.test(shasum)) {
    return {
      algorithm: "sha1",
      digest: Buffer.from(shasum, "hex"),
      label: `sha1-hex-${shasum}`,
      legacySha1: true,
    };
  }
  throw new SecurityInstallError(
    "The npm registry provided no usable integrity hash, so the package was not installed.",
  );
}

function unsupportedSelector(selector: string): boolean {
  return /^(?:file:|git\+|https?:|ssh:|github:|workspace:|link:|npm:)/i.test(selector);
}

async function selectPackage(
  ctx: InstallContext,
  name: string,
  selector: string | undefined,
): Promise<SelectedPackage> {
  if (selector && unsupportedSelector(selector)) {
    throw new PackageUnavailableError(
      `Dependency selector "${selector}" for ${name} is not a registry semver range or dist-tag.`,
    );
  }
  const metadata = await fetchPackument(ctx, name);
  const versions = object(metadata.versions);
  const tags = object(metadata["dist-tags"]);
  if (!versions || !tags) throw new PackageUnavailableError(`npm metadata for "${name}" has no versions.`);

  let version: string | undefined;
  if (!selector) {
    if (typeof tags.latest === "string") version = tags.latest;
  } else if (object(versions[selector])) {
    version = selector;
  } else if (typeof tags[selector] === "string") {
    version = tags[selector] as string;
  } else if (validRange(selector)) {
    version = maxSatisfying(Object.keys(versions), selector) ?? undefined;
  }
  if (!version || !isExactNpmVersion(version)) {
    throw new PackageUnavailableError(
      `No exact npm version of "${name}" satisfies "${selector ?? "latest"}".`,
    );
  }

  const selected = object(versions[version]);
  if (!selected || selected.name !== name || selected.version !== version) {
    throw new SecurityInstallError(`npm metadata identity failed for "${name}@${version}".`);
  }
  const dist = object(selected.dist);
  if (!dist || typeof dist.tarball !== "string") {
    throw new PackageUnavailableError(`npm metadata for "${name}@${version}" has no tarball.`);
  }
  let tarball: URL;
  try {
    tarball = new URL(dist.tarball);
  } catch {
    throw new SecurityInstallError(`npm returned an invalid tarball URL for "${name}@${version}".`);
  }
  if (
    tarball.origin !== NPM_REGISTRY ||
    tarball.protocol !== "https:" ||
    tarball.username ||
    tarball.password
  ) {
    throw new SecurityInstallError(`npm returned an unexpected tarball host for "${name}@${version}".`);
  }
  return { name, version, tarball: tarball.href, integrity: parseIntegrity(dist) };
}

async function downloadTarball(
  ctx: InstallContext,
  pkg: SelectedPackage,
  archivePath: string,
): Promise<void> {
  const file = await open(archivePath, "wx");
  const hash = createHash(pkg.integrity.algorithm);
  try {
    await withFetchTimeout(
      {
        timeoutMs: TARBALL_TIMEOUT_MS,
        signal: ctx.signal,
        timeoutMessage: `Downloading ${pkg.name}@${pkg.version} timed out.`,
        offlineMessage: (cause) =>
          `Downloading ${pkg.name}@${pkg.version} failed (${cause instanceof Error ? cause.message : String(cause)}).`,
      },
      async (signal) => {
        const response = await ctx.fetch(pkg.tarball, { signal, redirect: "error" });
        if (!response.ok) {
          throw new FriendlyHttpError(
            `Downloading ${pkg.name}@${pkg.version} failed (HTTP ${response.status}).`,
          );
        }
        await streamResponse(
          ctx,
          response,
          ctx.limits.packageTarballBytes,
          `Plugin dependency downloads exceed the ${mb(ctx.limits.totalNetworkBytes)} total limit.`,
          async (chunk) => {
            hash.update(chunk);
            try {
              await file.write(chunk);
            } catch (cause) {
              throw new SecurityInstallError(
                `Could not store ${pkg.name}@${pkg.version} while downloading.`,
                { cause },
              );
            }
          },
        );
      },
    );
  } finally {
    await file.close();
  }
  const actual = hash.digest();
  if (
    actual.length !== pkg.integrity.digest.length ||
    !timingSafeEqual(actual, pkg.integrity.digest)
  ) {
    throw new SecurityInstallError(
      `The tarball for ${pkg.name}@${pkg.version} failed its registry integrity check.`,
    );
  }
}

function safeTarRelative(entryPath: string, packageName: string): { relative: string; key: string } {
  if (!entryPath || entryPath.includes("\\") || entryPath.startsWith("/") || /^[a-zA-Z]:/.test(entryPath)) {
    throw new SecurityInstallError(`The npm tarball contains an unsafe path: ${entryPath || "(empty)"}`);
  }
  const parts = entryPath.split("/");
  if (parts.at(-1) === "") parts.pop();
  const legacyTypesRoot = packageName.startsWith("@types/")
    ? packageName.slice("@types/".length)
    : null;
  if (
    parts.some((part) => !part || part === "." || part === "..") ||
    (parts[0] !== "package" && parts[0] !== legacyTypesRoot)
  ) {
    throw new SecurityInstallError(`The npm tarball contains an unsafe path: ${entryPath}`);
  }
  const relative = parts.slice(1).join("/");
  if (!relative) return { relative, key: "" };
  assertWindowsSafeRelativePath(relative);
  if (
    relative
      .normalize("NFKC")
      .split("/")
      .some((part) => part.toLowerCase() === "node_modules")
  ) {
    throw new SecurityInstallError(
      `The npm tarball contains bundled node_modules (${entryPath}); bundled dependencies are not accepted.`,
    );
  }
  return { relative, key: windowsPathKey(relative) };
}

async function extractTarball(
  ctx: InstallContext,
  archivePath: string,
  packageDir: string,
  packageName: string,
): Promise<void> {
  const { extract } = await import("tar");
  let rejected: Error | null = null;
  const seen = new Set<string>();
  const metadataTypes = new Set([
    "GlobalExtendedHeader",
    "ExtendedHeader",
    "NextFileHasLongLinkpath",
    "NextFileHasLongPath",
    "OldGnuLongPath",
    "OldExtendedHeader",
  ]);
  await mkdir(packageDir, { recursive: true });
  const unpack = extract({
    cwd: packageDir,
    strip: 1,
    strict: true,
    preservePaths: false,
    preserveOwner: false,
    noMtime: true,
    chmod: false,
    maxDepth: ctx.limits.dependencyDepth * 4,
    filter: (entryPath, rawEntry) => {
      if (rejected) return false;
      const entry = rawEntry as { type: string; size: number };
      if (metadataTypes.has(entry.type)) return true;
      if (entry.type === "Link" || entry.type === "SymbolicLink") {
        rejected = new SecurityInstallError(`The npm tarball contains an unsafe link: ${entryPath}`);
        return false;
      }
      if (entry.type !== "File" && entry.type !== "OldFile" && entry.type !== "Directory") {
        rejected = new SecurityInstallError(
          `The npm tarball contains unsupported entry type ${entry.type}: ${entryPath}`,
        );
        return false;
      }
      try {
        const { relative, key } = safeTarRelative(entryPath, packageName);
        if (!relative) {
          if (entry.type === "Directory") return true;
          throw new SecurityInstallError(`The npm tarball uses package/ as a file.`);
        }
        if (seen.has(key)) {
          throw new SecurityInstallError(`The npm tarball has a Windows-colliding path: ${entryPath}`);
        }
        seen.add(key);
        ctx.totalFiles++;
        if (ctx.totalFiles > ctx.limits.totalFiles) {
          throw new SecurityInstallError(`Plugin graph exceeds ${ctx.limits.totalFiles} files.`);
        }
        if (entry.type !== "Directory") {
          if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > ctx.limits.packageFileBytes) {
            throw new SecurityInstallError(
              `Package file exceeds the ${mb(ctx.limits.packageFileBytes)} limit: ${entryPath}`,
            );
          }
        }
        return true;
      } catch (error) {
        rejected = error instanceof Error ? error : new SecurityInstallError(String(error));
        return false;
      }
    },
  });
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      ctx.totalUnpackedBytes += chunk.length;
      if (ctx.totalUnpackedBytes > ctx.limits.totalUnpackedBytes) {
        callback(
          new SecurityInstallError(
            `Plugin graph expands beyond the ${mb(ctx.limits.totalUnpackedBytes)} limit.`,
          ),
        );
      } else callback(null, chunk);
    },
  });
  try {
    await pipeline(createReadStream(archivePath), createGunzip(), limiter, unpack);
  } catch (error) {
    if (rejected) throw rejected;
    if (error instanceof SecurityInstallError) throw error;
    throw new SecurityInstallError(
      `The npm tarball could not be safely extracted (${error instanceof Error ? error.message : String(error)}).`,
      { cause: error },
    );
  }
  if (rejected) throw rejected;
}

async function readInstalledManifest(
  packageDir: string,
  selected: SelectedPackage,
): Promise<Record<string, unknown>> {
  const packageJsonPath = path.join(packageDir, "package.json");
  let manifest: Record<string, unknown> | null = null;
  try {
    const info = await lstat(packageJsonPath);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("not a regular file");
    manifest = object(JSON.parse(await readFile(packageJsonPath, "utf8")));
  } catch (error) {
    throw new SecurityInstallError(
      `Downloaded ${selected.name}@${selected.version} has no valid package.json ` +
        `(${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  if (manifest?.name !== selected.name || manifest.version !== selected.version) {
    throw new SecurityInstallError(
      `Downloaded ${String(manifest?.name)}@${String(manifest?.version)} instead of ` +
        `${selected.name}@${selected.version}.`,
    );
  }
  return manifest;
}

async function optionalPackageEntry(
  packageDir: string,
  manifest: Record<string, unknown>,
  condition: "import" | "require",
): Promise<string | undefined> {
  try {
    return await resolvePackageEntry(packageDir, manifest, condition);
  } catch (error) {
    if (error instanceof Error && error.message.includes("no contained JavaScript entry point")) {
      return undefined;
    }
    throw error;
  }
}

function platformAllowed(rule: unknown, current: string): boolean {
  if (!Array.isArray(rule) || rule.some((item) => typeof item !== "string")) return true;
  const values = rule as string[];
  if (values.includes(`!${current}`)) return false;
  const positives = values.filter((value) => !value.startsWith("!"));
  return positives.length === 0 || positives.includes(current);
}

function relativePackagePath(parentPackagePath: string | null, name: string): string {
  const segments = name.split("/");
  return parentPackagePath
    ? `${parentPackagePath}/node_modules/${segments.join("/")}`
    : `node_modules/${segments.join("/")}`;
}

async function installPackage(
  ctx: InstallContext,
  name: string,
  selector: string | undefined,
  parentPackagePath: string | null,
  ancestors: InstalledRecord[],
  depth: number,
  optional: boolean,
): Promise<InstalledDependency> {
  const recordStart = ctx.records.length;
  const skippedStart = ctx.skipped.length;
  const warningsBefore = new Set(ctx.warnings);
  const discardOptionalSubtree = (): void => {
    ctx.records.splice(recordStart);
    ctx.skipped.splice(skippedStart);
    ctx.warnings = warningsBefore;
  };
  if (depth > ctx.limits.dependencyDepth) {
    throw new SecurityInstallError(`Dependency graph exceeds depth ${ctx.limits.dependencyDepth}.`);
  }
  let selected: SelectedPackage;
  try {
    selected = await selectPackage(ctx, name, selector);
  } catch (error) {
    if (optional && isOptionalAvailabilityError(error)) {
      discardOptionalSubtree();
      return { skipped: error instanceof Error ? error.message : String(error) };
    }
    throw error;
  }
  const ancestor = ancestors.find(
    (candidate) =>
      candidate.name === name &&
      (candidate.version === selected.version || (selector ? satisfies(candidate.version, selector) : false)),
  );
  if (ancestor) return { path: ancestor.path };
  if (ctx.records.length >= ctx.limits.totalPackages) {
    throw new SecurityInstallError(`Dependency graph exceeds ${ctx.limits.totalPackages} packages.`);
  }

  const relativePath = relativePackagePath(parentPackagePath, name);
  const packageDir = path.join(ctx.stageRoot, ...relativePath.split("/"));
  const archivePath = path.join(ctx.downloadsDir, `${ctx.archiveCounter++}.tgz`);
  try {
    await mkdir(path.dirname(packageDir), { recursive: true });
    await downloadTarball(ctx, selected, archivePath);
    await extractTarball(ctx, archivePath, packageDir, selected.name);
    const manifest = await readInstalledManifest(packageDir, selected);
    if (!platformAllowed(manifest.os, process.platform) || !platformAllowed(manifest.cpu, process.arch)) {
      const reason = `${name}@${selected.version} does not support ${process.platform}/${process.arch}`;
      if (optional) {
        await rm(packageDir, { recursive: true, force: true });
        return { skipped: reason };
      }
      throw new PackageUnavailableError(reason);
    }

    const importEntry = await optionalPackageEntry(packageDir, manifest, "import");
    const requireEntry = await optionalPackageEntry(packageDir, manifest, "require");
    if (parentPackagePath === null && !importEntry && !requireEntry) {
      throw new SecurityInstallError(`${name}@${selected.version} has no JavaScript plugin entry.`);
    }
    const record: InstalledRecord = {
      path: relativePath,
      name,
      version: selected.version,
      tarball: selected.tarball,
      integrity: selected.integrity.label,
      legacySha1: selected.integrity.legacySha1,
      ...(importEntry ? { entry: `${relativePath}/${importEntry}` } : {}),
      ...(requireEntry ? { requireEntry: `${relativePath}/${requireEntry}` } : {}),
      dependencies: {},
      packageDir,
      manifest,
    };
    ctx.records.push(record);
    if (selected.integrity.legacySha1) {
      ctx.warnings.add(
        `${name}@${selected.version} is an old npm release with only SHA-1 registry integrity. ` +
          "It was accepted for compatibility and recorded as legacy SHA-1 in the vendor receipt.",
      );
    }

    const dependencies = stringMap(manifest.dependencies);
    const optionalDependencies = stringMap(manifest.optionalDependencies);
    for (const optionalName of Object.keys(optionalDependencies)) delete dependencies[optionalName];
    const peerDependencies = stringMap(manifest.peerDependencies);
    const peerMeta = object(manifest.peerDependenciesMeta) ?? {};
    for (const existing of [...Object.keys(dependencies), ...Object.keys(optionalDependencies)]) {
      delete peerDependencies[existing];
    }

    const nextAncestors = [...ancestors, record];
    const requiredEntries = [
      ...Object.entries(dependencies).map(([dependency, range]) => ({ dependency, range, kind: "required" as const })),
      ...Object.entries(peerDependencies)
        .filter(([dependency]) => object(peerMeta[dependency])?.optional !== true)
        .map(([dependency, range]) => ({ dependency, range, kind: "peer" as const })),
    ].sort((a, b) => a.dependency.localeCompare(b.dependency));
    for (const { dependency, range } of requiredEntries) {
      const child = await installPackage(
        ctx,
        dependency,
        range,
        relativePath,
        nextAncestors,
        depth + 1,
        false,
      );
      if (!child.path) throw new Error(`Required dependency ${dependency} was unexpectedly skipped.`);
      record.dependencies[dependency] = child.path;
    }

    const optionalEntries = Object.entries(optionalDependencies).sort(([a], [b]) => a.localeCompare(b));
    for (const [dependency, range] of optionalEntries) {
      const child = await installPackage(
        ctx,
        dependency,
        range,
        relativePath,
        nextAncestors,
        depth + 1,
        true,
      );
      if (child.path) record.dependencies[dependency] = child.path;
      else if (child.skipped) {
        ctx.skipped.push({ from: relativePath, name: dependency, selector: range, kind: "optional", reason: child.skipped });
      }
    }
    for (const [dependency, range] of Object.entries(peerDependencies)) {
      if (object(peerMeta[dependency])?.optional === true) {
        ctx.skipped.push({
          from: relativePath,
          name: dependency,
          selector: range,
          kind: "optional-peer",
          reason: "Optional peer dependencies are not auto-installed.",
        });
      }
    }
    return { path: relativePath };
  } catch (error) {
    await rm(packageDir, { recursive: true, force: true });
    if (
      optional &&
      isOptionalAvailabilityError(error)
    ) {
      discardOptionalSubtree();
      return { skipped: error instanceof Error ? error.message : String(error) };
    }
    throw error;
  } finally {
    await rm(archivePath, { force: true });
  }
}

async function ensureDirectory(pathname: string): Promise<void> {
  try {
    const info = await lstat(pathname);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`Plugin install path is not a normal directory: ${pathname}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(pathname);
  }
}

async function prepareVendorParent(projectDir: string, name: string): Promise<string> {
  const plugins = path.join(projectDir, PLUGINS_DIR);
  const npm = path.join(plugins, VENDORED_NPM_DIR);
  const packageParent = path.dirname(vendoredNpmPluginRoot(projectDir, name, "0.0.0"));
  await mkdir(projectDir, { recursive: true });
  await ensureDirectory(plugins);
  await ensureDirectory(npm);
  await ensureDirectory(packageParent);
  const [realNpm, realPackageParent] = await Promise.all([
    realpath(npm),
    realpath(packageParent),
  ]);
  if (!isContained(projectDir, realNpm) || !isContained(projectDir, realPackageParent)) {
    throw new Error("Plugin install path resolves outside the project.");
  }
  return realNpm;
}

function publicReceipt(record: InstalledRecord): VendorPackageReceipt {
  return {
    path: record.path,
    name: record.name,
    version: record.version,
    tarball: record.tarball,
    integrity: record.integrity,
    legacySha1: record.legacySha1,
    ...(record.entry ? { entry: record.entry } : {}),
    ...(record.requireEntry ? { requireEntry: record.requireEntry } : {}),
    dependencies: record.dependencies,
  };
}

/** Download and publish a fresh, receipt-backed vendor tree. Never reuses bytes. */
export async function installNpmPlugin(
  projectDirInput: string,
  packageSpec: string,
  options: NpmPluginInstallOptions = {},
): Promise<InstalledNpmPlugin> {
  const requestedProjectDir = path.resolve(projectDirInput);
  await mkdir(requestedProjectDir, { recursive: true });
  const projectDir = await realpath(requestedProjectDir);
  const requested = parseNpmPluginSpec(packageSpec);
  const npmRoot = await prepareVendorParent(projectDir, requested.name);
  const container = await mkdtemp(path.join(npmRoot, ".install-"));
  const stageRoot = path.join(container, "root");
  const downloadsDir = path.join(container, "downloads");
  await Promise.all([mkdir(stageRoot), mkdir(downloadsDir)]);
  const ctx: InstallContext = {
    fetch: options.fetch ?? globalThis.fetch,
    signal: options.signal,
    limits: mergeLimits(options.limits),
    stageRoot,
    downloadsDir,
    packuments: new Map(),
    records: [],
    skipped: [],
    warnings: new Set(),
    totalNetworkBytes: 0,
    totalUnpackedBytes: 0,
    totalFiles: 0,
    archiveCounter: 0,
  };

  let finalRoot = "";
  let backupRoot: string | null = null;
  try {
    const rootResult = await installPackage(
      ctx,
      requested.name,
      requested.selector,
      null,
      [],
      0,
      false,
    );
    if (!rootResult.path) throw new Error("Root plugin package was unexpectedly skipped.");
    const rootRecord = ctx.records.find((record) => record.path === rootResult.path);
    if (!rootRecord) throw new Error("Root plugin package is missing from the dependency graph.");
    const importEntry = rootRecord.entry ?? rootRecord.requireEntry;
    if (!importEntry) throw new Error("Root plugin package has no recorded JavaScript entry.");
    const importFormat = packageEntryFormat(rootRecord.manifest, importEntry);
    const entry = importFormat === "commonjs"
      ? rootRecord.requireEntry ?? importEntry
      : importEntry;
    const format = packageEntryFormat(rootRecord.manifest, entry);
    const tree = await computeVendorTreeDigest(stageRoot);
    const receipt: VendorReceipt = {
      schemaVersion: VENDOR_RECEIPT_VERSION,
      root: {
        name: rootRecord.name,
        version: rootRecord.version,
        packagePath: rootRecord.path,
        entry,
        format,
      },
      packages: ctx.records.map(publicReceipt).sort((a, b) => a.path.localeCompare(b.path)),
      skipped: ctx.skipped,
      tree: { algorithm: "sha256", ...tree },
    };
    const receiptFile = await open(path.join(stageRoot, VENDOR_RECEIPT_FILE), "wx");
    try {
      await receiptFile.writeFile(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
      await receiptFile.sync();
    } finally {
      await receiptFile.close();
    }

    finalRoot = vendoredNpmPluginRoot(projectDir, rootRecord.name, rootRecord.version);
    const realFinalParent = await realpath(path.dirname(finalRoot));
    if (!isContained(projectDir, realFinalParent)) {
      throw new Error("Plugin install destination resolves outside the project.");
    }
    try {
      await lstat(finalRoot);
      backupRoot = `${finalRoot}.backup-${randomUUID()}`;
      await rename(finalRoot, backupRoot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      await rename(stageRoot, finalRoot);
    } catch (error) {
      if (backupRoot) {
        try {
          await rename(backupRoot, finalRoot);
        } catch (restoreError) {
          throw new Error(
            `Could not publish the new plugin tree or restore the previous tree: ` +
              `${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
            { cause: error },
          );
        }
      }
      throw error;
    }
    return {
      name: rootRecord.name,
      version: rootRecord.version,
      installRoot: finalRoot,
      backupRoot,
      warnings: [...ctx.warnings],
    };
  } finally {
    await rm(container, { recursive: true, force: true }).catch(() => {});
  }
}

/** Finish a successful vendor+manifest transaction. */
export async function finalizeNpmPluginInstall(installed: InstalledNpmPlugin): Promise<void> {
  if (installed.backupRoot) {
    await rm(installed.backupRoot, { recursive: true, force: true });
  }
}

/** Restore the previous same-version tree (or remove a new one) after failure. */
export async function rollbackNpmPluginInstall(installed: InstalledNpmPlugin): Promise<void> {
  await rm(installed.installRoot, { recursive: true, force: true });
  if (installed.backupRoot) await rename(installed.backupRoot, installed.installRoot);
}
