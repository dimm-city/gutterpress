/**
 * Shared CLI argument parsers for the CLI commands.
 *
 * These are pure and testable: invalid input throws a typed {@link UsageError}
 * (carrying the exit code) rather than calling `process.exit`. The command
 * boundary maps a thrown `UsageError` to `log.error` + `process.exit`, so real
 * invocations keep their historical exit code (`EXIT_CODES.USAGE`, 2) and
 * messages. See {@link EXIT_CODES} (re-exported from `./build-error.ts`, the
 * one place the CLI's exit-code contract is defined) for the full contract.
 */
import { NETWORK } from "../constants.ts";
import type { BuildFormat, PdfxFlavor } from "./build-runner.ts";
import { EXIT_CODES } from "./build-error.ts";

export { EXIT_CODES } from "./build-error.ts";

/** A recoverable "bad CLI usage" error carrying the process exit code. */
export class UsageError extends Error {
  exitCode: number;
  constructor(message: string, exitCode: number = EXIT_CODES.USAGE) {
    super(message);
    this.name = "UsageError";
    this.exitCode = exitCode;
  }
}

/**
 * Reject CLI positionals beyond the ones a command declares (UX finding M46).
 *
 * Citty's parser keeps every raw positional token in `args._` even after
 * `type: "positional"` args have claimed their share — it shifts values off a
 * COPY of `_` for each declared positional arg, but never trims the original
 * array. So a command with one declared positional silently drops a second
 * one instead of erroring, e.g. `print-md build a b` builds `a` and never
 * mentions `b`. Call this near the top of a command's `run()`, passing
 * `(args as { _: unknown[] })._` and how many positionals the command itself
 * declares, to turn that into a named `UsageError` instead.
 */
export function rejectExtraPositionals(
  positionals: unknown[] | undefined,
  expectedCount: number,
  commandName: string
): void {
  const extras = (positionals ?? []).slice(expectedCount);
  if (extras.length > 0) {
    throw new UsageError(
      `print-md ${commandName}: unexpected extra argument(s): ${extras.join(" ")}`
    );
  }
}

/** Parse `--format`, falling back to the caller-supplied default. */
export function parseFormat(
  raw: unknown,
  opts: { default: BuildFormat }
): BuildFormat {
  if (raw === undefined || raw === "") return opts.default;
  if (raw === "html" || raw === "pdf" || raw === "pdfx") return raw;
  throw new UsageError(
    `Invalid --format value: "${raw}". Expected "html", "pdf", or "pdfx".`
  );
}

/** Parse `--pdfx-flavor`, which is only valid alongside `--format pdfx`. */
export function parsePdfxFlavor(
  raw: unknown,
  format: BuildFormat
): PdfxFlavor | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (format !== "pdfx") {
    throw new UsageError(
      `--pdfx-flavor is only valid with --format pdfx (got --format ${format}).`
    );
  }
  if (raw === "x1a" || raw === "x3") return raw;
  throw new UsageError(
    `Invalid --pdfx-flavor value: "${raw}". Expected "x1a" or "x3".`
  );
}

/** Parse `--port`, defaulting to {@link NETWORK.DEFAULT_PORT} (0 = OS-assigned). */
export function resolvePort(raw: unknown): number {
  if (raw === undefined || raw === "") return NETWORK.DEFAULT_PORT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new UsageError(
      `Invalid --port value: "${raw}". Expected a non-negative number (0 = OS-assigned).`
    );
  }
  return n;
}
