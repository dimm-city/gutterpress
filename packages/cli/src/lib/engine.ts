/**
 * Thin bridge from `packages/cli`'s PDF build to the Gutterpress engine at
 * `src/engine/`. The engine is an ordinary in-package module, not a relative
 * cross-directory import, and it ships in both the source checkout and the
 * compiled binary.
 *
 * This module calls the engine directly on the plain `book.html` FILE — no
 * HTTP staging, no overlay, no pagination polyfill of any kind — using the
 * engine `Browser` its caller hands it. It never launches, verifies or closes
 * a browser: `build-runner.ts`'s `runBuild` owns that lifecycle (it launches
 * through `engine/shared/cdp.ts`'s `launchChromium()` — or calls the host's
 * injected factory, the desktop's Electron `BrowserWindow` — in parallel with
 * the quality gates, and closes it in its `finally`), and the compiler's
 * `build()` never closes a browser it was given (`opts.browser`). One owner,
 * one launcher, no attach-to-a-pool path.
 */
import { writeFile } from "node:fs/promises";
import { build, type BuildDiagnostic } from "../engine/compiler/build.ts";
import type { Browser as EngineBrowser } from "../engine/shared/cdp.ts";
import { BuildError } from "./build-error.ts";

export type { EngineBrowser };

/** The subset of `BuildOptions` that has a manifest/CLI source today (B.12). */
export interface NativePdfOptions {
  title?: string;
  author?: string;
  signature?: number;
  reserveLastPage?: boolean;
  /**
   * Downgrade the engine's over-wide-content hard error to a warning +
   * diagnostic. The engine's message tells the author to "pass allowShrink to
   * build anyway"; without this the advice is unreachable from every product
   * path (only a test and the parity gate could set it). The book still prints
   * at Chromium's mystery shrink scale, which is why this is opt-in per build
   * and never a config default.
   */
  allowShrink?: boolean;
}

/**
 * Render `htmlFile` to `outPdf` via the Gutterpress engine on `browser`.
 *
 * Returns the build's author-facing diagnostics so the caller can surface
 * them (the desktop Problems panel, the CLI's own output). Dropping them here
 * would make the engine's print-quality audits invisible in every real build
 * path.
 */
export async function buildNativePdf(
  htmlFile: string,
  outPdf: string,
  options: NativePdfOptions,
  browser: EngineBrowser,
): Promise<BuildDiagnostic[]> {
  let result: Awaited<ReturnType<typeof build>>;
  try {
    result = await build({ input: htmlFile, browser, ...options });
  } catch (err) {
    throw new BuildError(
      `PDF build failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  await writeFile(outPdf, result.bytes);
  return result.diagnostics;
}
