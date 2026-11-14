/**
 * Send the main process's own faults to the app log: an error nothing caught,
 * and a rejected promise nothing handled. A packaged app has no console, so
 * these otherwise leave no trace.
 *
 * It only watches. "uncaughtExceptionMonitor" does not count as a listener for
 * "uncaughtException", so Electron's own handling (its error dialog) stays.
 */
import { redactUrlCredentials } from "./server-bridge/friendly-errors";

const describe = (reason: unknown): string =>
  redactUrlCredentials(reason instanceof Error ? (reason.stack ?? String(reason)) : String(reason));

export function logMainProcessFaults(proc: NodeJS.Process, log: (line: string) => void): void {
  proc.on("uncaughtExceptionMonitor", (error: unknown) => log(`[main] uncaught error: ${describe(error)}`));
  proc.on("unhandledRejection", (reason: unknown) => log(`[main] unhandled rejection: ${describe(reason)}`));
}
