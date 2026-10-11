/**
 * SFE-P1b Lane A — bundles a browser test entry into a self-contained ESM
 * module (harness requirement 1: "bun-builds a self-contained ESM bundle of
 * a test entry"). Test-only; the no-bundler rule (CLAUDE.md #1) governs
 * `packages/cli`'s RUNTIME, not test harnesses — this uses `Bun.build`
 * exactly the way the run spec's harness requirements name it.
 */
export interface BuiltBrowserBundle {
  /** The bundled ESM JavaScript source, ready to serve as-is. */
  readonly code: string;
}

/**
 * Builds `entryPath` (an absolute path to a `.ts`/`.tsx` entry file) into
 * one browser-target ESM bundle. Throws with every `Bun.build` log message
 * on failure — a harness that silently produced an empty or broken bundle
 * would violate this run's "fail loudly, never silently" requirement
 * (AP-20/G-12) just as surely as a skipped browser test would.
 */
export async function buildBrowserEntry(entryPath: string): Promise<BuiltBrowserBundle> {
  const result = await Bun.build({
    entrypoints: [entryPath],
    target: "browser",
    format: "esm",
    sourcemap: "inline",
  });

  if (!result.success || result.outputs.length === 0) {
    const messages = result.logs.map((log) => String(log)).join("\n");
    throw new Error(
      `browser harness: bundling failed for entry ${entryPath}` +
        (messages ? `:\n${messages}` : " (no diagnostic logs were produced)."),
    );
  }

  const [entryOutput] = result.outputs;
  const code = await entryOutput!.text();
  return { code };
}
