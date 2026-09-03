import { createHash } from "node:crypto";
import { existsSync, lstatSync, realpathSync, rmSync, statSync, unlinkSync } from "node:fs";
import { cp, link, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, dirname, basename, extname, relative, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Module, { builtinModules, createRequire } from "node:module";
import { parse as parseJavaScript } from "acorn";
import { parse as parseModuleImports } from "es-module-lexer/js";
import { imports as resolvePackageImports } from "resolve.exports";
import type { ResolvedPluginConfig } from "../../schema/manifest.types";
import {
  assertWindowsSafeRelativePath,
  isExactNpmVersion,
  isValidNpmPackageName,
  packageResolutionTargets,
  resolvePackageEntry,
  resolveVendoredPluginInstallRoot,
  verifyVendoredPlugin,
  vendoredNpmPluginRoot,
  type VerifiedVendorPackage,
  type VerifiedVendorPlugin,
} from "../plugin-vendor";
// #239: the SAME declared-stylesheet resolver a theme's `styles`/
// `engineStyles.native` resolve through (theme-manager.ts) — see
// resolvePluginStyles's doc comment below for why this is the literal
// convergence point, not a parallel re-implementation.
import { resolveDeclaredStyles } from "../style-declarations";
// #241 — a `plugins:` entry's `path` may now name an EXTENSION FOLDER (a
// gutterpress.json/theme.json package) instead of a bare JS file. See
// loadExtensionFromDir below, the ONE new branch this issue adds to the
// loader; everything else in this file is unchanged.
import {
  type ExtensionMetadata,
  readExtensionMeta,
  assertExtensionContained,
  resolveExtension,
} from "../extension-manifest";

// The plugin author API + the markdown-it factory now live in the node-free
// `renderer.ts` so the browser/PWA WebAdapter can import the pure render core
// (#33). This node-coupled module is the plugin *loader* (`node:fs`/`node:path`/
// `node:url`/`node:module`). The types/values are re-exported below so existing
// callers (`import { applyPlugins, ... } from "./plugins"`) are unaffected.
import type {
  GutterpressMarkerTable,
  GutterpressPlugin,
  GutterpressPluginMetadata,
  LoadedPlugin,
} from "./renderer";
export type {
  GutterpressMarkerDeclaration,
  GutterpressMarkerLabel,
  GutterpressMarkerTable,
  GutterpressPlugin,
  GutterpressPluginMetadata,
  GutterpressPluginExport,
  LoadedPlugin,
} from "./renderer";
export { applyPlugins, collectPluginCss, collectPluginStylePaths } from "./renderer";
import { BUILTIN_OPTIONAL_PLUGINS, collectPluginCss, collectPluginStylePaths } from "./renderer";

interface VendorCjsTree {
  sourceRoot: string;
  previousKey?: string;
  packages: VerifiedVendorPackage[];
  byPath: Map<string, VerifiedVendorPackage>;
}

interface IsolatedVendorTree {
  loadRoot: string;
  entryPath: string;
  packages: VerifiedVendorPackage[];
}

interface IsolatedVerifiedVendorPlugin extends VerifiedVendorPlugin {
  loadRoot: string;
}

type ResolveFilename = (
  request: string,
  parent: { filename?: string } | undefined,
  isMain: boolean,
  options?: unknown,
) => string;

const moduleInternals = Module as unknown as { _resolveFilename: ResolveFilename };
const vendorCjsTrees = new Map<string, VendorCjsTree>();
const latestVendorCjsTree = new Map<string, string>();
const isolatedVendorTrees = new Map<string, Promise<IsolatedVendorTree>>();
const nodeBuiltins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const needsNativeCjsResolver = !process.versions.bun;
let cjsResolverInstalled = false;
let isolatedVendorBase: Promise<string> | undefined;
let isolatedVendorBasePath: string | null = null;
let vendorSnapshotHook: ((sourceRoot: string, snapshotRoot: string) => void | Promise<void>) | undefined;

function pathContains(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function barePackageRequest(request: string): { name: string; subpath: string } | null {
  if (
    !request ||
    request.startsWith(".") ||
    request.startsWith("/") ||
    request.startsWith("#") ||
    isAbsolute(request) ||
    /^[a-zA-Z][a-zA-Z+.-]*:/.test(request)
  ) {
    return null;
  }
  const parts = request.split("/");
  if (request.startsWith("@")) {
    if (parts.length < 2) return null;
    return { name: `${parts[0]}/${parts[1]}`, subpath: parts.slice(2).join("/") };
  }
  return { name: parts[0]!, subpath: parts.slice(1).join("/") };
}

function resolveVerifiedTarget(
  pkg: VerifiedVendorPackage,
  resolution: { target: string; exact: boolean },
): string | null {
  const target = resolution.target.startsWith("./")
    ? resolution.target.slice(2)
    : resolution.target;
  if (
    !target ||
    target.includes("\\") ||
    target.includes("*") ||
    target.includes("?") ||
    target.includes("#")
  ) {
    return null;
  }
  try {
    assertWindowsSafeRelativePath(target);
  } catch {
    return null;
  }
  if (
    target
      .normalize("NFKC")
      .split("/")
      .some((part) => part.toLowerCase() === "node_modules")
  ) {
    return null;
  }
  const base = resolve(pkg.packageDir, ...target.split("/"));
  if (!pathContains(pkg.packageDir, base)) return null;
  const candidates = resolution.exact
    ? [base]
    : [
        base,
        `${base}.js`,
        `${base}.cjs`,
        `${base}.mjs`,
        `${base}.json`,
        join(base, "index.js"),
        join(base, "index.cjs"),
        join(base, "index.mjs"),
        join(base, "index.json"),
      ];
  for (const candidate of candidates) {
    try {
      const info = lstatSync(candidate);
      const extension = extname(candidate);
      if (
        info.isFile() &&
        !info.isSymbolicLink() &&
        (!extension || [".js", ".cjs", ".mjs", ".json"].includes(extension))
      ) {
        return candidate;
      }
    } catch {
      // Try the next deterministic file candidate.
    }
  }
  return null;
}

function resolveVerifiedRequest(
  pkg: VerifiedVendorPackage,
  subpath: string,
  condition: "import" | "require",
): string | null {
  for (const resolution of packageResolutionTargets(pkg.manifest, subpath, condition)) {
    const resolved = resolveVerifiedTarget(pkg, resolution);
    if (resolved) return resolved;
  }
  return null;
}

function resolveApprovedPackageRequest(
  owner: VerifiedVendorPackage,
  request: string,
  condition: "import" | "require",
  tree: VendorCjsTree,
  depth = 0,
): string | null {
  if (depth > 8) return null;
  if (nodeBuiltins.has(request)) {
    return request.startsWith("node:") ? request : `node:${request}`;
  }
  if (request.startsWith("#")) {
    let targets: string[];
    try {
      targets = resolvePackageImports(owner.manifest, request, {
        require: condition === "require",
      }) ?? [];
    } catch {
      return null;
    }
    for (const target of targets) {
      if (target.startsWith("./")) {
        const resolved = resolveVerifiedTarget(owner, { target, exact: true });
        if (resolved) return resolved;
      } else {
        const resolved = resolveApprovedPackageRequest(owner, target, condition, tree, depth + 1);
        if (resolved) return resolved;
      }
    }
    return null;
  }

  const parsed = barePackageRequest(request);
  if (!parsed) return null;
  const targetPath = parsed.name === owner.name
    ? owner.path
    : owner.dependencies[parsed.name];
  const target = targetPath ? tree.byPath.get(targetPath) : undefined;
  if (!target) return null;
  if (parsed.subpath) return resolveVerifiedRequest(target, parsed.subpath, condition);
  return condition === "require" ? target.requireEntryPath ?? null : target.entryPath ?? null;
}

function unresolvedVendorRequest(request: string, parent: string): NodeJS.ErrnoException {
  const error = new Error(
    `Cannot resolve undeclared or unexported package request "${request}" from ${parent}.`,
  ) as NodeJS.ErrnoException;
  error.code = "MODULE_NOT_FOUND";
  return error;
}

function ensureVendorCjsResolver(): void {
  if (!needsNativeCjsResolver || cjsResolverInstalled) return;
  cjsResolverInstalled = true;
  const original = moduleInternals._resolveFilename;
  moduleInternals._resolveFilename = function resolveVendorRequest(
    request,
    parent,
    isMain,
    options,
  ): string {
    if (parent?.filename && (request.startsWith("#") || barePackageRequest(request))) {
      for (const tree of vendorCjsTrees.values()) {
        const owner = tree.packages.find((pkg) => pathContains(pkg.packageDir, parent.filename!));
        if (!owner) continue;
        const resolved = resolveApprovedPackageRequest(owner, request, "require", tree);
        if (resolved) return resolved;
        if (!nodeBuiltins.has(request)) {
          throw unresolvedVendorRequest(request, parent.filename);
        }
      }
    }
    return Reflect.apply(original, this, [request, parent, isMain, options]) as string;
  };
}

async function getIsolatedVendorBase(): Promise<string> {
  isolatedVendorBase ??= mkdtemp(join(tmpdir(), "gutterpress-plugin-loads-"));
  const base = await isolatedVendorBase;
  isolatedVendorBasePath = base;
  ensureExitCleanupRegistered();
  return base;
}

function isolatedPackageCopyFilter(packageDir: string, candidate: string): boolean {
  const candidateRelative = relative(packageDir, candidate);
  if (!candidateRelative) return true;
  const parts = candidateRelative.split(/[\\/]/);
  const nodeModulesAt = parts.findIndex(
    (part) => part.normalize("NFKC").toLowerCase() === "node_modules",
  );
  if (nodeModulesAt < 0) return true;
  if (nodeModulesAt === 0 && parts[0] === "node_modules") return false;
  throw new Error(`Package contains bundled node_modules content: ${candidateRelative}`);
}

interface RewrittenSpecifier {
  replacement: string;
  targetPath?: string;
}

function rewrittenSpecifier(
  owner: VerifiedVendorPackage,
  specifier: string,
  condition: "import" | "require",
  tree: VendorCjsTree,
): RewrittenSpecifier | null {
  if (!specifier.startsWith("#") && !barePackageRequest(specifier) && !nodeBuiltins.has(specifier)) {
    return null;
  }
  const resolved = resolveApprovedPackageRequest(owner, specifier, condition, tree);
  if (!resolved) {
    throw new Error(
      `Package request "${specifier}" from ${owner.name} is not a receipt-approved dependency.`,
    );
  }
  if (resolved.startsWith("node:")) return { replacement: resolved };
  return {
    replacement: condition === "require" ? resolved : pathToFileURL(resolved).href,
    targetPath: resolved,
  };
}

function localModuleTarget(
  absolute: string,
  specifier: string,
  condition: "import" | "require",
): string | null {
  if (!specifier.startsWith(".") && !specifier.startsWith("file:") && !isAbsolute(specifier)) {
    return null;
  }
  try {
    if (condition === "require" && !specifier.startsWith("file:")) {
      return createRequire(absolute).resolve(specifier);
    }
    const url = specifier.startsWith("file:")
      ? new URL(specifier)
      : isAbsolute(specifier)
        ? pathToFileURL(specifier)
        : new URL(specifier, pathToFileURL(absolute));
    const target = fileURLToPath(url);
    return lstatSync(target).isFile() ? target : null;
  } catch {
    return null;
  }
}

function packageOwningFile(tree: VendorCjsTree, file: string): VerifiedVendorPackage | undefined {
  return tree.packages.find((pkg) => pathContains(pkg.packageDir, file));
}

function addReachableTarget(
  targets: Set<string>,
  target: string | undefined,
  specifier: string,
  absolute: string,
  tree: VendorCjsTree,
): void {
  if (!target) return;
  if (!packageOwningFile(tree, target)) {
    throw new Error(`Module "${specifier}" from ${absolute} resolves outside the verified package tree.`);
  }
  targets.add(target);
}

interface SyntaxNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

function visitSyntax(node: SyntaxNode, visitor: (node: SyntaxNode) => void): void {
  visitor(node);
  for (const [key, value] of Object.entries(node)) {
    if (["type", "start", "end", "loc", "range"].includes(key) || !value) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && typeof (item as SyntaxNode).type === "string") {
          visitSyntax(item as SyntaxNode, visitor);
        }
      }
    } else if (typeof value === "object" && typeof (value as SyntaxNode).type === "string") {
      visitSyntax(value as SyntaxNode, visitor);
    }
  }
}

function memberName(node: SyntaxNode): string | null {
  if (node.type !== "MemberExpression") return null;
  const property = node.property as SyntaxNode | undefined;
  if (!property) return null;
  if (property.type === "Identifier") return property.name as string;
  if (property.type === "Literal" && typeof property.value === "string") return property.value;
  return null;
}

function isReceiptBoundRequireCall(node: SyntaxNode): boolean {
  if (node.type !== "CallExpression") return false;
  const callee = node.callee as SyntaxNode | undefined;
  if (!callee) return false;
  if (callee.type === "Identifier" && callee.name === "require") return true;
  if (callee.type !== "MemberExpression") return false;
  const object = callee.object as SyntaxNode | undefined;
  const property = memberName(callee);
  return Boolean(
    object &&
    ((object.type === "Identifier" && object.name === "module" && property === "require") ||
      (object.type === "Identifier" && object.name === "require" && property === "resolve")),
  );
}

function rewriteCommonJsRequires(
  source: string,
  absolute: string,
  pkg: VerifiedVendorPackage,
  tree: VendorCjsTree,
): {
  replacements: Array<{ start: number; end: number; value: string }>;
  targets: Set<string>;
} {
  const ast = parseJavaScript(source, {
    ecmaVersion: "latest",
    sourceType: "script",
    allowHashBang: true,
    allowReturnOutsideFunction: true,
  }) as unknown as SyntaxNode;
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const targets = new Set<string>();
  visitSyntax(ast, (node) => {
    if (!isReceiptBoundRequireCall(node)) return;
    const args = node.arguments as SyntaxNode[] | undefined;
    const argument = args?.[0];
    if (!argument || argument.type !== "Literal" || typeof argument.value !== "string") {
      throw new Error(
        `Dynamic require in ${pkg.name}/${relative(pkg.packageDir, absolute)} must use a string literal.`,
      );
    }
    const rewritten = rewrittenSpecifier(pkg, argument.value, "require", tree);
    if (rewritten) {
      replacements.push({
        start: argument.start,
        end: argument.end,
        value: JSON.stringify(rewritten.replacement),
      });
      addReachableTarget(targets, rewritten.targetPath, argument.value, absolute, tree);
    } else {
      const target = localModuleTarget(absolute, argument.value, "require");
      if (!target) {
        throw new Error(
          `CommonJS module "${argument.value}" from ${pkg.name}/${relative(pkg.packageDir, absolute)} could not be resolved.`,
        );
      }
      addReachableTarget(targets, target, argument.value, absolute, tree);
    }
  });
  return { replacements, targets };
}

async function rewriteReachableModuleImports(
  entryPath: string,
  tree: VendorCjsTree,
): Promise<void> {
  const pending = [entryPath];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const absolute = pending.pop()!;
    if (visited.has(absolute)) continue;
    visited.add(absolute);
    const extension = extname(absolute);
    if (![".js", ".mjs", ".cjs"].includes(extension)) continue;
    const pkg = packageOwningFile(tree, absolute);
    if (!pkg) throw new Error(`Reachable plugin module is outside the verified package tree: ${absolute}`);

    const source = await readFile(absolute, "utf8");
    const [imports] = parseModuleImports(source, absolute);
    const replacements: Array<{ start: number; end: number; value: string }> = [];
    const targets = new Set<string>();
    for (const imported of imports) {
      if (imported.d === -2) continue;
      if (imported.n === undefined) {
        throw new Error(
          `Dynamic import in ${pkg.name}/${relative(pkg.packageDir, absolute)} must use a string literal.`,
        );
      }
      const rewritten = rewrittenSpecifier(pkg, imported.n, "import", tree);
      if (rewritten) {
        addReachableTarget(targets, rewritten.targetPath, imported.n, absolute, tree);
        if (imported.d === -1) {
          const quote = source[imported.s - 1];
          if ((quote !== "\"" && quote !== "'") || source[imported.e] !== quote) {
            throw new Error(`Could not safely rewrite an import in ${absolute}.`);
          }
          replacements.push({
            start: imported.s - 1,
            end: imported.e + 1,
            value: JSON.stringify(rewritten.replacement),
          });
        } else {
          replacements.push({
            start: imported.s,
            end: imported.e,
            value: JSON.stringify(rewritten.replacement),
          });
        }
      } else {
        const target = localModuleTarget(absolute, imported.n, "import");
        if (target) {
          addReachableTarget(targets, target, imported.n, absolute, tree);
        } else if (
          imported.n.startsWith(".") ||
          imported.n.startsWith("file:") ||
          isAbsolute(imported.n)
        ) {
          throw new Error(
            `ESM module "${imported.n}" from ${pkg.name}/${relative(pkg.packageDir, absolute)} could not be resolved.`,
          );
        }
      }
    }
    if (extension === ".cjs" || (extension === ".js" && pkg.manifest.type !== "module")) {
      const commonJs = rewriteCommonJsRequires(source, absolute, pkg, tree);
      replacements.push(...commonJs.replacements);
      for (const target of commonJs.targets) targets.add(target);
    }
    replacements.sort((a, b) => b.start - a.start);
    let rewritten = source;
    for (const replacement of replacements) {
      rewritten =
        rewritten.slice(0, replacement.start) +
        replacement.value +
        rewritten.slice(replacement.end);
    }
    if (replacements.length > 0) await writeFile(absolute, rewritten, "utf8");
    pending.push(...targets);
  }
}

function remapPackageEntry(
  source: VerifiedVendorPackage,
  destination: string,
  entry: string | undefined,
): string | undefined {
  if (!entry) return undefined;
  const entryRelative = relative(source.packageDir, entry);
  if (!pathContains(source.packageDir, entry) || !entryRelative) {
    throw new Error(`Verified entry for ${source.name} is outside its package.`);
  }
  return resolve(destination, entryRelative);
}

async function createIsolatedVendorTree(
  verified: VerifiedVendorPlugin,
  address: string,
): Promise<IsolatedVendorTree> {
  const base = await getIsolatedVendorBase();
  const loadRoot = join(base, address);
  await mkdir(loadRoot);
  try {
    const packageMap = new Map<string, VerifiedVendorPackage>();
    const sorted = [...verified.packages].sort((a, b) => a.path.localeCompare(b.path));
    for (let index = 0; index < sorted.length; index++) {
      const source = sorted[index]!;
      const destination = join(loadRoot, "packages", String(index), "package");
      await mkdir(dirname(destination), { recursive: true });
      await cp(source.packageDir, destination, {
        recursive: true,
        filter: (candidate) => isolatedPackageCopyFilter(source.packageDir, candidate),
      });
      packageMap.set(source.path, {
        ...source,
        packageDir: destination,
        entryPath: remapPackageEntry(source, destination, source.entryPath),
        requireEntryPath: remapPackageEntry(source, destination, source.requireEntryPath),
      });
    }

    const packages = [...packageMap.values()];
    const tree: VendorCjsTree = {
      sourceRoot: verified.installRoot,
      packages,
      byPath: new Map(packages.map((pkg) => [pkg.path, pkg])),
    };
    const rootPackage = packageMap.get(verified.receipt.root.packagePath);
    if (!rootPackage) throw new Error("Verified root package is missing from the isolated tree.");
    const sourceRoot = verified.packages.find(
      (pkg) => pkg.path === verified.receipt.root.packagePath,
    )!;
    const entryPath = remapPackageEntry(sourceRoot, rootPackage.packageDir, verified.entryPath);
    if (!entryPath) throw new Error("Verified plugin entry is missing from the isolated tree.");
    await rewriteReachableModuleImports(entryPath, tree);
    return { loadRoot, entryPath, packages };
  } catch (error) {
    await rm(loadRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function isolateVendoredPlugin(
  verified: VerifiedVendorPlugin,
): Promise<IsolatedVerifiedVendorPlugin> {
  const address = createHash("sha256")
    .update(verified.receipt.tree.digest)
    .update("\0")
    .update(JSON.stringify(verified.receipt))
    .digest("hex");
  let pending = isolatedVendorTrees.get(address);
  if (!pending) {
    pending = createIsolatedVendorTree(verified, address).catch((error) => {
      isolatedVendorTrees.delete(address);
      throw error;
    });
    isolatedVendorTrees.set(address, pending);
  }
  const isolated = await pending;
  return {
    ...verified,
    loadRoot: isolated.loadRoot,
    entryPath: isolated.entryPath,
    packages: isolated.packages,
  };
}

/** Test-only mutation seam between snapshot completion and snapshot verification. */
export function __setVendorSnapshotHookForTests(
  hook?: (sourceRoot: string, snapshotRoot: string) => void | Promise<void>,
): void {
  vendorSnapshotHook = hook;
}

async function snapshotAndIsolateVendoredPlugin(
  baseDir: string,
  packageName: string,
  version: string,
): Promise<IsolatedVerifiedVendorPlugin | null> {
  const sourceRoot = await resolveVendoredPluginInstallRoot(baseDir, packageName, version);
  if (!sourceRoot) return null;

  const base = await getIsolatedVendorBase();
  const container = await mkdtemp(join(base, "snapshot-"));
  const snapshotProject = join(container, "project");
  const snapshotRoot = vendoredNpmPluginRoot(snapshotProject, packageName, version);
  try {
    await mkdir(dirname(snapshotRoot), { recursive: true });
    await cp(sourceRoot, snapshotRoot, {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
    });
    await vendorSnapshotHook?.(sourceRoot, snapshotRoot);
    const verifiedSnapshot = await verifyVendoredPlugin(snapshotProject, packageName, version);
    if (!verifiedSnapshot) return null;
    const isolated = await isolateVendoredPlugin(verifiedSnapshot);
    return { ...isolated, installRoot: sourceRoot };
  } finally {
    await rm(container, { recursive: true, force: true }).catch(() => {});
  }
}

function registerVendorCjsTree(verified: IsolatedVerifiedVendorPlugin): () => void {
  ensureVendorCjsResolver();
  const key = `${verified.installRoot}\0${verified.loadRoot}`;
  const previousKey = latestVendorCjsTree.get(verified.installRoot);
  if (vendorCjsTrees.has(key)) {
    latestVendorCjsTree.set(verified.installRoot, key);
    return () => {};
  }
  const packages = [...verified.packages].sort(
    (a, b) => b.packageDir.length - a.packageDir.length,
  );
  vendorCjsTrees.set(key, {
    sourceRoot: verified.installRoot,
    ...(previousKey ? { previousKey } : {}),
    packages,
    byPath: new Map(packages.map((pkg) => [pkg.path, pkg])),
  });
  latestVendorCjsTree.set(verified.installRoot, key);
  return () => {
    vendorCjsTrees.delete(key);
    if (latestVendorCjsTree.get(verified.installRoot) === key) {
      if (previousKey) latestVendorCjsTree.set(verified.installRoot, previousKey);
      else latestVendorCjsTree.delete(verified.installRoot);
    }
  };
}

export function clearVendoredPluginResolver(
  baseDir: string,
  packageName: string,
  version: string,
): void {
  let projectDir = baseDir;
  try {
    projectDir = realpathSync(baseDir);
  } catch {
    // A rollback may remove the path before resolver cleanup.
  }
  const sourceRoot = vendoredNpmPluginRoot(projectDir, packageName, version);
  const key = latestVendorCjsTree.get(sourceRoot);
  if (!key) return;
  const tree = vendorCjsTrees.get(key);
  vendorCjsTrees.delete(key);
  if (tree?.previousKey) latestVendorCjsTree.set(sourceRoot, tree.previousKey);
  else latestVendorCjsTree.delete(sourceRoot);
}

/** An imported npm plugin module, plus the directory `styles` (#238) should
 * resolve relative to — `null` when no reliable module directory exists (the
 * bare gutterpress-own-dependency fallback below), in which case a plugin
 * declaring `styles` fails loudly rather than resolving against a guess. */
interface LoadedNpmPackage {
  module: unknown;
  moduleDir: string | null;
}

/**
 * Resolve and import an npm plugin package.
 *
 * Resolution order:
 *   1. Receipt-verified project-local vendor tree, when one exists
 *   2. User's project node_modules (legacy unpinned entries)
 *   3. gutterpress's own dependencies — for built-in/legacy plugins
 *
 * Loading never performs network access. Installation is an explicit
 * `addNpmPlugin` action which vendors first and records an exact version.
 */
async function loadNpmPackage(
  packageName: string,
  baseDir: string,
  version?: string,
): Promise<LoadedNpmPackage> {
  // Exact versions predate the vendor installer and used to be informational.
  // Only a valid schema-v2 receipt activates the pinned path. A missing marker
  // falls through to legacy resolution; a present but corrupt marker throws
  // from verifyVendoredPlugin and must never fall back to ancestor caches.
  if (
    version &&
    isValidNpmPackageName(packageName) &&
    isExactNpmVersion(version)
  ) {
    const verified = await snapshotAndIsolateVendoredPlugin(baseDir, packageName, version);
    if (verified) {
      const restoreRegistration = registerVendorCjsTree(verified);
      try {
        // The isolated tree copies each vendored package's FULL contents
        // (isolatedPackageCopyFilter excludes only nested node_modules), so a
        // plugin's own `./styles/*.css` sits right beside its entry file here
        // — moduleDir is real and stable for the isolated copy's lifetime.
        const moduleDir = dirname(verified.entryPath);
        if (verified.format === "commonjs") {
          return { module: createRequire(verified.entryPath)(verified.entryPath), moduleDir };
        }
        return { module: await import(pathToFileURL(verified.entryPath).href), moduleDir };
      } catch (error) {
        restoreRegistration();
        throw error;
      }
    }
  }

  // Legacy unpinned entry: user's project (manifest dir).
  try {
    const packageDir = join(baseDir, "node_modules", ...packageName.split("/"));
    const packagePath = join(packageDir, ...(await resolvePackageEntry(packageDir)).split("/"));
    return { module: await import(pathToFileURL(packagePath).href), moduleDir: dirname(packagePath) };
  } catch {
    // Not in user's project — fall through
  }

  // gutterpress's own dependencies. No on-disk path is retained here (a bare
  // specifier import), so `moduleDir: null` — see LoadedNpmPackage's doc.
  try {
    return { module: await import(packageName), moduleDir: null };
  } catch {
    // Not found — fall through to error
  }

  // A bare filename that already ends in a JS extension but has no path
  // separator (e.g. `my-plugin.js`) doesn't trip isFilePath's separator+
  // extension heuristic (manifest.ts, ARCH finding #57) and so still reaches
  // here as a "package name". Templating the generic `./plugins/<name>.js`
  // suggestion onto a name that ALREADY has an extension produces a mangled
  // `my-plugin.js.js` double-extension path that can never work — suggest
  // the working fix (just add `./`) instead.
  const looksLikeJsFilename = /\.(m?js|cjs)$/i.test(packageName);
  const suggestedPath = looksLikeJsFilename
    ? `./${packageName}`
    : `./plugins/${packageName}.js`;

  throw new Error(
    `Plugin "${packageName}" not found. Install it from ` +
      `Project settings > Plugins > Install npm plugin,\n` +
      `or reference a local file:\n` +
      `  plugins:\n` +
      `    - path: ${suggestedPath}`
  );
}

/**
 * Validate a plugin's raw `styles` export shape (#238). `undefined` (not
 * declared) and a non-empty string array both pass through unremarkable; a
 * declared-but-empty array normalizes to `undefined` so downstream code has
 * one "nothing here" value to check. Anything else is an author mistake
 * caught at load time — a final artifact must never silently drop a
 * malformed `styles` export instead of erroring on it.
 */
function validateStylesExport(value: unknown, pluginRef: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((s) => typeof s === "string")) {
    throw new Error(
      `Plugin "${pluginRef}" exports \`styles\` that is not an array of strings.`,
    );
  }
  return value.length > 0 ? (value as string[]) : undefined;
}

/**
 * Validate a plugin's raw `markers` export shape (#240) — a LIGHT, top-level
 * check only: "is this a plain object at all?" The per-declaration shape
 * (tag/class/variants/label/autoCloseAt/alias/preset/deprecated) and every
 * cross-plugin collision are validated centrally by
 * `buildDeclaredMarkerRegistry` (markers.js), once every loaded plugin's
 * table is available — this function only guards against handing that
 * function something it cannot even iterate (`Object.entries` on a string or
 * an array would silently produce nonsense keys). Mirrors
 * {@link validateStylesExport}'s "undefined/empty both pass through as
 * undefined, anything malformed throws now" shape.
 */
function validateMarkersExport(value: unknown, pluginRef: string): GutterpressMarkerTable | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      `Plugin "${pluginRef}" exports \`markers\` that is not a plain object.`,
    );
  }
  const table = value as GutterpressMarkerTable;
  return Object.keys(table).length > 0 ? table : undefined;
}

/**
 * Extract the plugin function from a loaded module, handling the various
 * shapes Node/Bun produce for ESM/CJS interop:
 *
 *   - ESM default export:           module.default
 *   - CJS `module.exports = fn`:    module.default (via interop) or module itself
 *   - Double-wrapped (rare):        module.default.default
 */
function extractPluginExports(
  pluginModule: unknown,
  pluginRef: string,
  exportName?: string,
): {
  plugin: GutterpressPlugin;
  metadata?: GutterpressPluginMetadata;
  css?: string;
  /** Author-declared, module-relative paths (#238) — NOT YET resolved to
   * absolute paths; the caller (`loadPlugin`) does that. */
  styles?: string[];
  /** Author-declared marker table (#240), unresolved — `createMarkdownRenderer`
   * (renderer.ts) merges it with every other loaded plugin's table. */
  markers?: GutterpressMarkerTable;
} {
  const mod = pluginModule !== null && (typeof pluginModule === "object" || typeof pluginModule === "function")
    ? pluginModule as Record<string, unknown>
    : {};
  let plugin: GutterpressPlugin | undefined;
  let metadata = mod.metadata as GutterpressPluginMetadata | undefined;
  let css = mod.css as string | undefined;
  let styles = validateStylesExport(mod.styles, pluginRef);
  let markers = validateMarkersExport(mod.markers, pluginRef);

  if (exportName && typeof mod[exportName] === "function") {
    plugin = mod[exportName] as GutterpressPlugin;
  } else if (exportName) {
    const available = Object.entries(mod)
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name)
      .sort();
    throw new Error(
      `Plugin "${pluginRef}" does not export a plugin function named "${exportName}".` +
        (available.length > 0 ? ` Available function exports: ${available.join(", ")}.` : ""),
    );
  } else if (typeof mod.default === "function") {
    plugin = mod.default as GutterpressPlugin;
  } else if (typeof pluginModule === "function") {
    plugin = pluginModule as GutterpressPlugin;
  } else if (
    typeof mod.default === "object" &&
    mod.default !== null &&
    typeof (mod.default as Record<string, unknown>).default === "function"
  ) {
    const inner = mod.default as Record<string, unknown>;
    plugin = inner.default as GutterpressPlugin;
    metadata = (inner.metadata as GutterpressPluginMetadata | undefined) ?? metadata;
    css = (inner.css as string | undefined) ?? css;
    styles = validateStylesExport(inner.styles, pluginRef) ?? styles;
    markers = validateMarkersExport(inner.markers, pluginRef) ?? markers;
  }

  if (typeof plugin !== "function") {
    throw new Error(
      `Plugin "${pluginRef}" does not export a valid plugin function. ` +
        `Expected \`export default function (md, options) { ... }\` ` +
        `or CommonJS \`module.exports = function (md, options) { ... }\`.`
    );
  }

  return { plugin, metadata, css, styles, markers };
}

/**
 * Path-plugin ESM cache — keyed by resolved absolute file path, and only
 * reused while the file's mtime matches the cached entry. Bun/Node never
 * evict ESM module-map entries, so unconditionally busting on every load (the
 * previous `?v=${Date.now()}` behavior) reloaded every path-plugin on every
 * preview render and leaked a fresh module instance forever in the
 * long-lived Electron host (ARCH finding #5). Keying on mtime means an
 * untouched file is served from cache (bounded growth, proportional to
 * distinct plugin paths — not load count) while an edited file is still
 * always reloaded (the stale-plugin bug the original bust existed to fix
 * stays fixed).
 */
interface CachedPathPlugin {
  mtimeMs: number;
  module: unknown;
  /** The hard-linked shadow file this module was loaded from, if any. */
  shadowPath: string | null;
}
const pathPluginCache = new Map<string, CachedPathPlugin>();

/** Test-only: reset the path-plugin cache between test cases. */
export function __resetPathPluginCacheForTests(): void {
  pathPluginCache.clear();
}

// A query string is NOT a reliable cache-buster here: Node keys its ESM
// module registry by the full URL (query included), but Bun's local `file://`
// loader resolves the cache key by REAL PATH and ignores query/hash strings
// entirely — confirmed empirically: neither a `?v=` query nor a symlink
// pointing at the edited file busts it (Bun follows symlinks to their
// realpath before the registry lookup). Since the standalone CLI binary
// (`bun build --compile`, §1) runs on Bun's own embedded runtime for real
// end users of `gutterpress preview`, a query-only bust would silently never
// take effect there. A hard link IS a distinct realpath (unlike a symlink, it
// has no "target" to resolve through), so importing a same-directory shadow
// hard link named by mtime forces a genuinely fresh module on BOTH runtimes,
// with zero content duplication, while same-directory placement preserves
// the plugin's own relative imports (resolved against the importing
// module's real directory, which the shadow link shares with the original).
const liveShadowPaths = new Set<string>();
let exitCleanupRegistered = false;
function ensureExitCleanupRegistered(): void {
  if (exitCleanupRegistered) return;
  exitCleanupRegistered = true;
  process.on("exit", () => {
    for (const shadowPath of liveShadowPaths) {
      try {
        unlinkSync(shadowPath);
      } catch {
        // best effort — nothing to do if it's already gone
      }
    }
    if (isolatedVendorBasePath) {
      try {
        rmSync(isolatedVendorBasePath, { recursive: true, force: true });
      } catch {
        // best effort — the OS temp reaper is the final fallback
      }
    }
  });
}

/**
 * The shadow-link name carries the PROCESS id, not just the plugin's mtime.
 *
 * With an mtime-only name (2026-07-29 audit) the path was fully deterministic, so
 * two preview processes rendering different books that SHARE one authored plugin
 * — `path: ../../shared/plugins/x.js`, the normative multi-book layout — computed
 * the SAME shadow path. The first `link()` won; the loser hit EEXIST and fell
 * through to a plain `import(pluginPath)`, then cached whatever that returned
 * under the NEW mtime so it was never retried. The ESM registry never evicts, so
 * from the second collision onward that fallback answers with the PREVIOUS
 * module: the author edits a shared plugin and one of their two open books keeps
 * rendering the old one, silently and permanently.
 */
function shadowPathFor(pluginPath: string, mtimeMs: number): string {
  const ext = extname(pluginPath);
  const stem = basename(pluginPath, ext);
  const token = String(mtimeMs).replace(/\./g, "-");
  return join(
    dirname(pluginPath),
    `.${stem}.gutterpress-reload-${process.pid}-${token}${ext}`,
  );
}

/**
 * Import a file-based plugin module, reusing a previous import when the file
 * is unchanged (resolved path + mtime) and forcing a genuinely fresh import
 * (via a same-directory hard-link shadow file, see above) only when the
 * file's mtime has moved since the last load. The previous shadow link is
 * removed once the new one has loaded successfully.
 */
async function loadCachedPathPluginModule(pluginPath: string): Promise<unknown> {
  const mtimeMs = statSync(pluginPath).mtimeMs;
  const cached = pathPluginCache.get(pluginPath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.module;
  }

  const shadowPath = shadowPathFor(pluginPath, mtimeMs);
  let pluginModule: unknown;
  let shadowActive = false;
  try {
    await link(pluginPath, shadowPath);
    shadowActive = true;
    ensureExitCleanupRegistered();
    liveShadowPaths.add(shadowPath);
    pluginModule = await import(pathToFileURL(shadowPath).href);
  } catch (error) {
    if (shadowActive) {
      // The shadow link was created but the import itself failed (e.g. a
      // syntax error in the edited plugin) — clean up and propagate the real
      // error rather than silently falling back.
      liveShadowPaths.delete(shadowPath);
      await unlink(shadowPath).catch(() => {});
      throw error;
    }
    // Could not even create the shadow link (read-only directory, or a stale
    // link of the same name left by a crashed prior process) — fall back to
    // a plain, uncached import so the load still succeeds when possible.
    pluginModule = await import(pathToFileURL(pluginPath).href);
  }

  const previousShadow = cached?.shadowPath;
  pathPluginCache.set(pluginPath, {
    mtimeMs,
    module: pluginModule,
    shadowPath: shadowActive ? shadowPath : null,
  });
  if (previousShadow) {
    liveShadowPaths.delete(previousShadow);
    await unlink(previousShadow).catch(() => {});
  }
  return pluginModule;
}

/**
 * Load a single plugin from a file path or npm package.
 *
 * Throws if the plugin cannot be resolved, imported, or doesn't export a
 * valid plugin function. The error message identifies which manifest entry
 * failed so users can find it.
 *
 * Path plugins always go through the mtime cache (see the call below): it is
 * correct in both a one-shot CLI build and the long-lived Electron host that
 * runs `runBuild` in-process, so no caller-selected cache mode is needed.
 */
/**
 * Resolve a plugin's declared `styles` (#238) to absolute, existence-checked
 * paths, relative to `moduleDir` (the plugin's own file/package directory).
 * `undefined`/`[]` input returns `undefined` — a plugin with no `styles`
 * export pays zero cost here. A `moduleDir` of `null` (the bare
 * gutterpress-own-dependency npm fallback — see `LoadedNpmPackage`) is a
 * plugin-specific failure checked here; the existence check on each declared
 * file is NOT plugin-specific — that half is
 * {@link resolveDeclaredStyles} (`style-declarations.ts`), the SAME function
 * `theme-manager.ts`'s `applyTheme`/`importThemeFromFolder` resolve a
 * theme's `styles`/`engineStyles.native` through (#239). This is the literal
 * code-sharing that makes a theme and a styles-carrying plugin resolve their
 * declared stylesheets identically, not through two parallel
 * implementations that could drift.
 */
function resolvePluginStyles(
  rawStyles: string[] | undefined,
  moduleDir: string | null,
  pluginRef: string,
): string[] | undefined {
  if (!rawStyles || rawStyles.length === 0) return undefined;
  if (!moduleDir) {
    throw new Error(
      `Plugin "${pluginRef}" exports \`styles\` but its module directory could not be resolved.`,
    );
  }
  return resolveDeclaredStyles(rawStyles, moduleDir, `Plugin "${pluginRef}"`);
}

/** A `plugins:` entry whose `path` names a directory rather than a bare JS
 *  file loads no markdown-it function of its own — every author-visible
 *  effect of loading it is its declared styles (#241's "theme ≡ extension
 *  with only styles" realized through the `plugins:` array: a folder with
 *  NO `markdown` is functionally indistinguishable from a theme applied
 *  through `gutterpress theme apply`, right down to reusing the same
 *  metadata reader). `md.use()` on a no-op is harmless — every consumer of
 *  `LoadedPlugin` (`applyPlugins`, `collectPluginCss`,
 *  `collectPluginStylePaths`) keeps working unmodified. */
function noopPlugin(): void {}

/** Build a `LoadedPlugin.metadata` object from a `gutterpress.json`'s own
 *  `name`/`description`/`author` — `undefined` when none are set, matching
 *  every other optional-metadata contract in this file. */
function extensionMetadata(meta: ExtensionMetadata): GutterpressPluginMetadata | undefined {
  if (!meta.name && !meta.description && !meta.author) return undefined;
  return {
    ...(meta.name ? { name: meta.name } : {}),
    ...(meta.description ? { description: meta.description } : {}),
    ...(meta.author ? { author: meta.author } : {}),
  };
}

/**
 * Load a `plugins:` entry whose `path` (#241) names a DIRECTORY instead of a
 * bare JS file — an extension package: a `gutterpress.json` (or a plain
 * `theme.json`, read through the exact same {@link readExtensionMeta}
 * declaring any mix of `markdown` (a markdown-it entry, loaded exactly like a
 * bare-file plugin — same cache, same export extraction, same `styles`
 * export handling) and `styles`/`engineStyles.native` (resolved through the
 * SAME {@link resolveExtension} → `resolveDeclaredStyles` chain a theme's own
 * declared sheets and a plain plugin's `styles` export already go through).
 *
 * `markdown` absent is the "styles only" case — see {@link noopPlugin}.
 * `markdown` present is "plugin ≡ extension with only markdown" PLUS
 * whatever styles the SAME `gutterpress.json` also declares: the extension's
 * own styles are ordered BEFORE the loaded module's own `styles` export (an
 * author who wants the module's own styles to win at equal specificity
 * should rely on cascade order within that module's CSS itself, exactly as
 * they would for two files in one plain `styles` export).
 *
 * `tokensFile`/`components`/`snippets` are parsed and validated (existence +
 * containment, via `resolveExtension`) but not otherwise consumed here —
 * #240/#242 are where a component registry / snippet picker would read them
 * off a future "list installed extensions" surface.
 */
async function loadExtensionFromDir(
  extensionDir: string,
  config: ResolvedPluginConfig,
  pluginRef: string,
): Promise<LoadedPlugin> {
  const meta = await readExtensionMeta(extensionDir);
  assertExtensionContained(meta);
  const resolved = resolveExtension(extensionDir, meta, `Plugin "${pluginRef}"`);
  const extensionStyles = [...(resolved.styles ?? []), ...(resolved.engineStyles ?? [])];
  const name = config.name ?? meta.name ?? pluginRef;

  // A folder with NEITHER markdown NOR any styles declares nothing at all —
  // almost certainly a mistake (a `path:` meant for a bare JS file, pointed
  // at a folder instead; or a package with no gutterpress.json/theme.json
  // that was never meant to be referenced this way). Fail loudly here rather
  // than silently succeeding as a no-op with no observable effect, matching
  // this loader's fail-fast doctrine everywhere else (CLAUDE.md §5).
  if (!resolved.markdown && extensionStyles.length === 0) {
    throw new Error(
      `Extension folder "${pluginRef}" declares neither \`markdown\` nor \`styles\`/` +
        "`engineStyles` (in its gutterpress.json or theme.json) — there is nothing to " +
        "load. Point `path` at a JS file directly for a plain plugin, or add a metadata " +
        "file declaring at least one.",
    );
  }

  if (!resolved.markdown) {
    return {
      name,
      plugin: noopPlugin,
      ...(extensionMetadata(meta) ? { metadata: extensionMetadata(meta) } : {}),
      ...(extensionStyles.length > 0 ? { styles: extensionStyles } : {}),
      options: config.options,
    };
  }

  const pluginModule = await loadCachedPathPluginModule(resolved.markdown);
  const { plugin, metadata, css, styles: rawStyles } = extractPluginExports(
    pluginModule,
    pluginRef,
    config.export,
  );
  const ownStyles = resolvePluginStyles(rawStyles, dirname(resolved.markdown), pluginRef);
  const styles = [...extensionStyles, ...(ownStyles ?? [])];

  return {
    name,
    plugin,
    // The plugin module's OWN `metadata` export wins when present (it is
    // more specific — describing the exact code that loaded); the folder's
    // gutterpress.json name/description/author is the fallback, not an
    // override, so a component library's package-level metadata still
    // surfaces for a `plugin.js` that exports none of its own.
    metadata: metadata ?? extensionMetadata(meta),
    css,
    ...(styles.length > 0 ? { styles } : {}),
    options: config.options,
  };
}

export async function loadPlugin(
  config: ResolvedPluginConfig,
  baseDir: string,
): Promise<LoadedPlugin> {
  const pluginRef = config.path ?? config.name ?? "(unspecified)";
  let pluginModule: unknown;
  let pluginName: string;
  /** Directory `styles` (#238) resolves relative to — see resolvePluginStyles. */
  let moduleDir: string | null = null;

  if (!config.path && !config.name) {
    throw new Error(
      "Plugin manifest entry must specify either `path` or `name`. " +
        "Got an empty plugin config."
    );
  }

  // Built-in opt-in plugins resolve from the bundled registry — no project
  // install, no network, works offline and in the compiled binary. This is the
  // happy path for the desktop's recommended plugins.
  if (
    !config.path &&
    !config.version &&
    config.name &&
    BUILTIN_OPTIONAL_PLUGINS[config.name]
  ) {
    return {
      name: config.name,
      plugin: BUILTIN_OPTIONAL_PLUGINS[config.name]!,
      options: config.options,
    };
  }

  // #241 — a `path` entry may name an EXTENSION FOLDER (a gutterpress.json/
  // theme.json package) instead of a bare JS file. Dispatched here, before
  // the generic file-load try/catch below, because a folder produces a
  // structurally different LoadedPlugin (see loadExtensionFromDir) rather
  // than participating in the shared pluginModule/moduleDir plumbing that
  // follows. A path that does not exist at all, or exists as a plain file,
  // falls through unchanged to that existing code — this branch changes
  // behavior ONLY for a `path` that resolves to a real directory.
  if (config.path) {
    const candidatePath = resolve(baseDir, config.path);
    if (existsSync(candidatePath) && statSync(candidatePath).isDirectory()) {
      try {
        return await loadExtensionFromDir(candidatePath, config, pluginRef);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to load plugin "${pluginRef}": ${errorMsg}`);
      }
    }
  }

  try {
    if (config.path) {
      const pluginPath = resolve(baseDir, config.path);

      if (!existsSync(pluginPath)) {
        throw new Error(
          `Plugin file not found: ${pluginPath} ` +
            `(resolved from manifest entry path="${config.path}")`
        );
      }

      // Always route through the mtime cache. A bare
      // `import(pathToFileURL(...).href)` is NOT freshness-safe when the
      // process outlives one build: the desktop runs `runBuild` in-process in
      // the long-lived Electron host (a memoized lib import, never a child
      // process), so a second build/export in the same session would serve the
      // FIRST build's plugin module from Node's ESM registry (which never
      // evicts) — a stale-plugin regression. The mtime cache reloads on any
      // edit and reuses an untouched file, correct in both a one-shot CLI
      // build and the long-lived host.
      pluginModule = await loadCachedPathPluginModule(pluginPath);
      pluginName = config.name ?? config.path;
      // #238: `styles` resolves relative to the plugin's OWN file, wherever
      // that lives (in-project, or a multi-book repo's shared `plugins/`).
      moduleDir = dirname(pluginPath);
    } else {
      const loaded = await loadNpmPackage(config.name!, baseDir, config.version);
      pluginModule = loaded.module;
      moduleDir = loaded.moduleDir;
      pluginName = config.name!;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load plugin "${pluginRef}": ${errorMsg}`);
  }

  const { plugin, metadata, css, styles: rawStyles, markers } = extractPluginExports(
    pluginModule,
    pluginRef,
    config.export,
  );
  const styles = resolvePluginStyles(rawStyles, moduleDir, pluginRef);

  return {
    name: pluginName,
    plugin,
    metadata,
    css,
    styles,
    markers,
    options: config.options,
  };
}

/**
 * Load all plugins from the resolved configuration.
 *
 * Two failure modes, selected by whether `onError` is supplied:
 *
 *   - **Fail-fast (no `onError`)** — the default for build/export/validate. If
 *     any plugin fails to load, the whole operation aborts with the underlying
 *     error. A final artifact must never silently omit author-configured
 *     formatting.
 *   - **Degrade-and-report (`onError` supplied)** — for the LIVE PREVIEW. A
 *     plugin that can't load (e.g. a vendored folder was omitted when a
 *     project was copied) is skipped, `onError` is invoked with the
 *     offending ref + error, and the rest of the document still renders. This
 *     is NOT silent skipping (the failure mode §5 warns against): the caller
 *     surfaces every skip loudly (preview warns in its log; the Plugins panel
 *     shows the plugin error with fix instructions).
 *
 * Path plugins are loaded through the mtime cache in `loadPlugin` regardless
 * of mode (finding #5): an edited plugin reloads across renders while an
 * unedited one is never re-imported, correct in both a one-shot CLI build and
 * the long-lived Electron host.
 */
export async function loadPlugins(
  configs: ResolvedPluginConfig[],
  baseDir: string,
  onError?: (pluginRef: string, error: Error) => void
): Promise<LoadedPlugin[]> {
  const plugins: LoadedPlugin[] = [];
  for (const config of configs) {
    if (!onError) {
      plugins.push(await loadPlugin(config, baseDir));
      continue;
    }
    try {
      plugins.push(await loadPlugin(config, baseDir));
    } catch (error) {
      onError(
        config.path ?? config.name ?? "(unspecified)",
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
  return plugins;
}

/** Result of {@link loadPluginsWithCss}: loaded plugins ready for `applyPlugins`
 * plus their concatenated CSS ready for injection into the rendered document. */
export interface LoadedPluginsWithCss {
  /** `undefined` (not `[]`) when there were no configs to load — matches the
   * `plugins?:` field the renderer options expect, so callers can pass this
   * straight through without an `?? []` at every call site. */
  plugins: LoadedPlugin[] | undefined;
  pluginCss: string;
  /**
   * #238 — absolute paths of every plugin-declared `styles` file, flattened
   * in plugin load order. `[]` when no loaded plugin declares any (including
   * when `configs` was empty), so callers can pass this straight through to
   * `renderChapters`'s `pluginStylePaths` without an `?? []` guard.
   */
  pluginStylePaths: string[];
}

/**
 * Shared "load plugins -> collect their CSS" preamble (ARCH finding #53).
 * Both real render paths — build/export's fail-fast `renderBook`
 * (build-runner.ts) and the live preview's degrade-and-report
 * `renderPreviewBook` (preview/file-watcher.ts) — did this in lockstep,
 * differing ONLY in whether `onError` was supplied. `onError` presence still
 * selects fail-fast vs degrade-and-report (see {@link loadPlugins}) and the
 * matching path-plugin cache mode; this helper just removes the duplicated
 * wiring around it.
 *
 * A `configs` of `undefined`/empty short-circuits WITHOUT calling
 * `loadPlugins` at all (`plugins: undefined`, `pluginCss: ""`) — matching
 * both call sites' prior behavior of never plugin-loading when the manifest
 * declares no plugins.
 */
export async function loadPluginsWithCss(
  configs: ResolvedPluginConfig[] | undefined | null,
  baseDir: string,
  onError?: (pluginRef: string, error: Error) => void
): Promise<LoadedPluginsWithCss> {
  if (!configs || configs.length === 0) {
    return { plugins: undefined, pluginCss: "", pluginStylePaths: [] };
  }
  const plugins = await loadPlugins(configs, baseDir, onError);
  return {
    plugins,
    pluginCss: collectPluginCss(plugins),
    pluginStylePaths: collectPluginStylePaths(plugins),
  };
}
