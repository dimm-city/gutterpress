/**
 * Canonical gutterpress package metadata (version + dependency versions),
 * read via a static `package.json` import.
 *
 * Static JSON imports are inlined by `bun build` at bundle time, so the
 * compiled `--compile` binary never reads package.json off disk at runtime
 * (where `import.meta.dir`/`fileURLToPath` resolution breaks down inside
 * `/$bunfs/` — see CLAUDE.md §3). This is the single source of truth for
 * the lib version: `build-fingerprint.ts` and `diagnostics.ts` (and the
 * desktop's About dialog / `gutterpress doctor` through it) both import from
 * here instead of each doing their own `package.json` read. diagnostics.ts
 * previously had a private `readLibVersion()` that walked directories
 * reading `package.json` off disk at runtime — the exact pattern this file
 * (and build-fingerprint.ts, which documented but didn't share the pattern)
 * exists to avoid — and fell back to the string `"unknown"` inside the
 * compiled binary. That function has been deleted in favor of this constant.
 */
import packageJson from "../../package.json";

type PackageMeta = {
  version: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

export const PACKAGE_META: PackageMeta = {
  version: (packageJson as { version?: string }).version ?? "unknown",
  dependencies:
    (packageJson as { dependencies?: Record<string, string> }).dependencies ??
    {},
  // pagedjs lives here (its runtime artifact is the vendored patched polyfill;
  // the npm entry is only the re-vendoring diff base — see PAGEDJS-PATCHES.md),
  // so build-fingerprint reads its version from devDependencies.
  devDependencies:
    (packageJson as { devDependencies?: Record<string, string> })
      .devDependencies ?? {},
};

/** The gutterpress lib version, e.g. `"0.7.1"`. */
export const PACKAGE_VERSION: string = PACKAGE_META.version;
