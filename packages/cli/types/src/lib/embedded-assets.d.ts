/**
 * Embedded preview assets (favicon, manifest schema, paged.js polyfill,
 * iframe interface + cross-origin bridge).
 *
 * The repo holds these in `src/assets/`. In dev (`bun src/cli.ts`) we could
 * read them straight off the filesystem, but for the standalone binary
 * (`bun build --compile`) we have to embed them — the binary's
 * `import.meta.url` points inside `/$bunfs/` and the original `src/assets/`
 * tree is no longer reachable.
 *
 * Each asset is statically imported with `with { type: "file" }`, which
 * gives us a path string that resolves correctly in both dev (real disk
 * path) and compiled (a bunfs path inside the binary). On first use we copy
 * everything into a per-process temp directory and return that as the
 * "assets dir", letting existing call sites keep using plain
 * `readFile`/`cp` without caring whether the source lives on disk or inside
 * the executable.
 *
 * Viewer chrome (toolbar HTML, preview.js, preview.css, toast.*) was
 * removed 2026-05-18; lives in packages/viewer.
 */
/**
 * Resolve the assets directory, extracting embedded copies on first use.
 */
export declare function getAssetsDir(): Promise<string>;
/**
 * Resolve a single asset path within the extracted assets dir.
 */
export declare function getAssetPath(relPath: string): Promise<string>;
