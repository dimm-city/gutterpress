/**
 * Shared CLI argument parsers for the `build` and `preview` commands.
 *
 * These are pure and testable: invalid input throws a typed {@link UsageError}
 * (carrying the exit code) rather than calling `process.exit`. The command
 * boundary maps a thrown `UsageError` to `log.error` + `process.exit`, so real
 * invocations keep their historical exit code (2) and messages.
 */
import { NETWORK } from "../constants.ts";
import type { BuildFormat, PdfxFlavor } from "./build-runner.ts";

/** A recoverable "bad CLI usage" error carrying the process exit code. */
export class UsageError extends Error {
  exitCode: number;
  constructor(message: string, exitCode = 2) {
    super(message);
    this.name = "UsageError";
    this.exitCode = exitCode;
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
