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

interface CliArgumentDefinition {
  type?: "boolean" | "string" | "enum" | "positional";
  alias?: string | readonly string[];
}

type CliArgumentDefinitions = Readonly<
  Record<string, CliArgumentDefinition>
>;

function camelCaseFlag(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, char: string) =>
    char.toUpperCase()
  );
}

function kebabCaseFlag(name: string): string {
  return name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function takesValue(definition: CliArgumentDefinition): boolean {
  return definition.type === "string" || definition.type === "enum";
}

/**
 * Reject option names citty would otherwise retain and silently ignore, and
 * reject value-taking options whose value is absent.
 *
 * This scans raw argv rather than the parsed object so a positional name used
 * as an option (for example, `build --input`) cannot masquerade as a declared
 * flag. Citty parses in non-strict mode and turns a valueless string option
 * into `""`; catching that from raw argv is the only way to distinguish an
 * omitted option from a typo. A dash-prefixed token is still a legitimate
 * string value unless it names an option declared by this command.
 */
export function rejectUnknownFlags(
  rawArgs: readonly string[],
  declared: CliArgumentDefinitions,
  commandName: string
): void {
  const longFlags = new Map<string, CliArgumentDefinition>();
  const shortFlags = new Map<string, CliArgumentDefinition>();

  for (const [name, definition] of Object.entries(declared)) {
    if (definition.type === "positional") continue;

    for (const variant of new Set([
      name,
      camelCaseFlag(name),
      kebabCaseFlag(name),
    ])) {
      longFlags.set(variant, definition);
    }

    const aliases = Array.isArray(definition.alias)
      ? definition.alias
      : definition.alias
        ? [definition.alias]
        : [];
    for (const alias of aliases) {
      longFlags.set(alias, definition);
      if (alias.length === 1) shortFlags.set(alias, definition);
    }
    if (name.length === 1) shortFlags.set(name, definition);
  }

  const reject = (option: string): never => {
    throw new UsageError(
      `gutterpress ${commandName}: unknown option ${option}`
    );
  };
  const missingValue = (option: string): never => {
    throw new UsageError(
      `gutterpress ${commandName}: option ${option} requires a value`
    );
  };
  const isDeclaredOptionBoundary = (token: string): boolean => {
    if (token === "--" || token === "--help" || token === "-h") return true;
    if (token.startsWith("--")) {
      const rawName = token.slice(2).split("=", 1)[0]!;
      const directDefinition = longFlags.get(rawName);
      if (directDefinition) return true;
      if (!rawName.startsWith("no-")) return false;
      return longFlags.get(rawName.slice(3))?.type === "boolean";
    }
    return token.startsWith("-") && token.length > 1 && shortFlags.has(token[1]!);
  };
  const consumeValue = (index: number, option: string): number => {
    const value = rawArgs[index + 1];
    if (value === undefined || isDeclaredOptionBoundary(value)) {
      missingValue(option);
    }
    return index + 1;
  };

  for (let i = 0; i < rawArgs.length; i++) {
    const token = rawArgs[i]!;
    if (token === "--") break;
    if (token === "--help" || token === "-h" || token === "-") continue;

    if (token.startsWith("--")) {
      const equalsAt = token.indexOf("=");
      const option = equalsAt === -1 ? token : token.slice(0, equalsAt);
      const rawName = option.slice(2);
      const directDefinition = longFlags.get(rawName);
      const negated = !directDefinition && rawName.startsWith("no-");
      const name = negated ? rawName.slice(3) : rawName;
      const definition = directDefinition ?? longFlags.get(name);

      if (!definition) throw new UsageError(
        `gutterpress ${commandName}: unknown option ${option}`
      );
      if (
        negated &&
        (definition.type !== "boolean" || equalsAt !== -1)
      ) reject(option);

      if (!negated && takesValue(definition)) {
        if (equalsAt === -1) {
          i = consumeValue(i, option);
        } else if (token.slice(equalsAt + 1).length === 0) {
          missingValue(option);
        }
      }
      continue;
    }

    if (!token.startsWith("-") || token.length === 1) continue;

    const body = token.slice(1);
    for (let j = 0; j < body.length; j++) {
      const alias = body[j]!;
      const definition = shortFlags.get(alias);
      if (!definition) throw new UsageError(
        `gutterpress ${commandName}: unknown option ${token}`
      );
      if (takesValue(definition)) {
        const attached = body.slice(j + 1);
        if (attached.length === 0) {
          i = consumeValue(i, `-${alias}`);
        } else if (attached === "=") {
          missingValue(`-${alias}`);
        }
        break;
      }
    }
  }
}

/**
 * Reject CLI positionals beyond the ones a command declares (UX finding M46).
 *
 * Citty's parser keeps every raw positional token in `args._` even after
 * `type: "positional"` args have claimed their share — it shifts values off a
 * COPY of `_` for each declared positional arg, but never trims the original
 * array. So a command with one declared positional silently drops a second
 * one instead of erroring, e.g. `gutterpress build a b` builds `a` and never
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
      `gutterpress ${commandName}: unexpected extra argument(s): ${extras.join(" ")}`
    );
  }
}

/** Parse `--format`, falling back to the caller-supplied default. */
export function parseFormat(
  raw: unknown,
  opts: { default: BuildFormat }
): BuildFormat {
  if (raw === undefined) return opts.default;
  if (raw === "") throw new UsageError("--format requires a value.");
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
  if (raw === undefined) return undefined;
  if (raw === "") throw new UsageError("--pdfx-flavor requires a value.");
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
  if (raw === undefined) return NETWORK.DEFAULT_PORT;
  if (raw === "" || (typeof raw === "string" && raw.trim() === "")) {
    throw new UsageError("--port requires a value.");
  }
  const n = typeof raw === "number" || typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 65535) {
    throw new UsageError(
      `Invalid --port value: "${raw}". Expected an integer from 0 to 65535 (0 = OS-assigned).`
    );
  }
  return n;
}
