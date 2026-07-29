/**
 * The CLI's exit-code contract (UX finding M47) — ONE place the numbers are
 * defined. Every command's process exit code means the same thing across
 * `build`/`preview`/`lint`/`validate`/`preflight`/`audit`/`repair`/`publish`/
 * `new`, so CI can branch on it without parsing output:
 *
 *   0  OK        — clean run, nothing to fix.
 *   1  FINDINGS  — the command completed but reported findings/validation
 *                  failures (validate/preflight/audit findings, a build's
 *                  quality-gate rejection). The invocation itself was fine;
 *                  the content wasn't. Standalone `gutterpress lint` uses this
 *                  code for CSS lint failures too, but the `build` pipeline's
 *                  own CSS-lint gate is a documented historical exception
 *                  that exits 2 instead (see build-runner.ts's
 *                  runQualityGates) — not a bug, just an inconsistency kept
 *                  for back-compat.
 *   2  USAGE     — the invocation itself was wrong: a bad flag, positional,
 *                  preset, or value. See {@link UsageError} in ./cli-args.ts.
 *   3  PIPELINE  — the build/render/export pipeline failed for a reason
 *                  unrelated to CLI usage or findings (I/O error, missing
 *                  tool, renderer crash, timeout). See {@link BuildError}.
 *
 * Commands and error classes import from here instead of hardcoding exit-code
 * literals; `build-runner.ts` still passes an explicit code per gate (e.g.
 * pre/post-build validation failures use `EXIT_CODES.FINDINGS`) where a
 * specific stage needs a code other than this class's default.
 */
export const EXIT_CODES = {
  OK: 0,
  FINDINGS: 1,
  USAGE: 2,
  PIPELINE: 3,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

/**
 * BuildError — the canonical error type for build/pipeline failures.
 *
 * Deliberately dependency-free and in its own module: consumers that only need
 * the error type (e.g. `utils/file-utils.ts`, used by the preview server) must
 * NOT drag in `build-runner.ts`'s whole pipeline graph (markdown rendering,
 * ghostscript, paged.js, the browser pool) just to reference an Error class.
 * `build-runner.ts` re-exports this so existing `import { BuildError } from
 * "./build-runner"` call sites keep working.
 *
 * Defaults to `EXIT_CODES.PIPELINE` (3) — distinct from `UsageError`'s
 * `EXIT_CODES.USAGE` (2) default, per the contract above. Call sites that need
 * a different code (findings-style gate failures) still pass one explicitly.
 */
export class BuildError extends Error {
  exitCode: number;
  constructor(
    message: string,
    exitCode: number = EXIT_CODES.PIPELINE,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BuildError";
    this.exitCode = exitCode;
  }
}
