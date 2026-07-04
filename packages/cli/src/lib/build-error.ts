/**
 * BuildError — the canonical error type for build/validation failures.
 *
 * Deliberately dependency-free and in its own module: consumers that only need
 * the error type (e.g. `utils/file-utils.ts`, used by the preview server) must
 * NOT drag in `build-runner.ts`'s whole pipeline graph (markdown rendering,
 * ghostscript, paged.js, the browser pool) just to reference an Error class.
 * `build-runner.ts` re-exports this so existing `import { BuildError } from
 * "./build-runner"` call sites keep working.
 */
export class BuildError extends Error {
  exitCode: number;
  constructor(message: string, exitCode = 2) {
    super(message);
    this.name = "BuildError";
    this.exitCode = exitCode;
  }
}
