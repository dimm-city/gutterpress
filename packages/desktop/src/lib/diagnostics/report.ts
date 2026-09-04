/**
 * The renderer's way into the app's own log file.
 *
 * The log (`electron/app-log.ts`, shown by the start screen's Logs tab) was
 * written only by the main process, so every fault that happens where the
 * author is actually looking — a mount that throws, a book whose page setup
 * cannot be read, an unhandled rejection — left no trace in it at all. A log
 * that records "the app started" and nothing else cannot be handed to anyone
 * to diagnose a broken editor, which is exactly what it is for.
 *
 * `install()` is called once, as early as the app has a window, and from
 * then on an uncaught error, an unhandled rejection, and every
 * `console.error` reach the file. Individual call sites can also report a
 * handled failure directly with `reportError` — a caught exception that
 * degrades the UI is invisible to the global handlers and is precisely what
 * a log is for.
 *
 * Off-Electron (no bridge) every function here is a no-op that still prints
 * to the console: this module must never be the reason a page fails to load.
 */
import { bridge } from "$lib/platform/bridge";

/** Reentrancy guard: forwarding is itself allowed to fail, and a failure that logged itself would loop. */
let forwarding = false;

function forward(message: string): void {
  if (forwarding) return;
  forwarding = true;
  try {
    void bridge()
      .logRendererError(message)
      .catch(() => {
        // The log is a diagnostic, never a dependency.
      });
  } catch {
    // No host bridge (or it threw synchronously) — the console line stands.
  } finally {
    forwarding = false;
  }
}

/** Report a handled failure that degraded something the author can see. */
export function reportError(message: string): void {
  console.error(`[gutterpress] ${message}`);
  forward(message);
}

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

let installed = false;

/**
 * Route uncaught errors, unhandled rejections and `console.error` into the
 * app log. Idempotent — a second call does nothing.
 */
export function installErrorReporting(target: Window = window): void {
  if (installed) return;
  installed = true;

  target.addEventListener("error", (event: ErrorEvent) => {
    const where = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : "";
    forward(`uncaught ${describe(event.error ?? event.message)}${where}`);
  });

  target.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    forward(`unhandled rejection ${describe(event.reason)}`);
  });

  // Wrap rather than replace: whatever the console already does still
  // happens, and devtools keeps showing the original call site.
  const original = console.error.bind(console);
  console.error = (...args: unknown[]): void => {
    original(...args);
    forward(args.map(describe).join(" "));
  };
}
