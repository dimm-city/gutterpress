/**
 * The npm registry Gutterpress talks to (#246) — ONE resolver for the two
 * places that reach it: the installer (`npm-plugin-installer.ts`: metadata,
 * tarballs, and the tarball-origin check) and extension search
 * (`extension-search.ts`).
 *
 * `GUTTERPRESS_NPM_REGISTRY` points both at a private mirror, and is what the
 * CLI's own tests serve a fake registry at. It is validated the same way every
 * other author-supplied URL in this package is — http(s) only — because a
 * `file:`/`data:` registry would turn "install a package" into "read an
 * arbitrary path".
 *
 * Bundle-safe (CLAUDE.md §1/§3): pure string work over `process.env`, no deps.
 */

/** The public registry, used when nothing overrides it. */
export const DEFAULT_NPM_REGISTRY = "https://registry.npmjs.org";

const ENV_OVERRIDE = "GUTTERPRESS_NPM_REGISTRY";

/**
 * The configured registry's base URL, without a trailing slash (every caller
 * builds `${registry}/<path>` and a doubled slash breaks path-sensitive
 * mirrors). Throws on an override that is not an http(s) URL.
 */
export function npmRegistryUrl(): string {
  const configured = process.env[ENV_OVERRIDE]?.trim();
  if (!configured) return DEFAULT_NPM_REGISTRY;
  let scheme: string;
  try {
    scheme = new URL(configured).protocol;
  } catch {
    throw new Error(`Invalid ${ENV_OVERRIDE} URL "${configured}".`);
  }
  if (scheme !== "http:" && scheme !== "https:") {
    throw new Error(`${ENV_OVERRIDE} must be an http(s) URL — got "${scheme}".`);
  }
  return configured.replace(/\/+$/, "");
}
