/**
 * Faults in the app's own main process reach the app log (electron/fault-log.ts).
 * A packaged app has no console, so without this an uncaught error or a
 * rejected promise nobody handled leaves no trace anywhere.
 */
import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { logMainProcessFaults } from "../../electron/fault-log";

function harness() {
  const proc = new EventEmitter();
  const lines: string[] = [];
  logMainProcessFaults(proc as unknown as NodeJS.Process, (line) => lines.push(line));
  return { proc, lines };
}

test("an uncaught error is logged with its stack", () => {
  const { proc, lines } = harness();
  proc.emit("uncaughtExceptionMonitor", new Error("render window vanished"), "uncaughtException");
  expect(lines).toHaveLength(1);
  expect(lines[0]).toStartWith("[main] uncaught error: Error: render window vanished");
  expect(lines[0]).toContain("fault-log.test.ts");
});

test("a rejection nobody handled is logged, whatever was rejected", () => {
  const { proc, lines } = harness();
  proc.emit("unhandledRejection", new Error("upload socket closed"));
  proc.emit("unhandledRejection", "plain text reason");
  expect(lines[0]).toStartWith("[main] unhandled rejection: Error: upload socket closed");
  expect(lines[1]).toBe("[main] unhandled rejection: plain text reason");
});

test("it only watches: Electron's own handling of an uncaught error is left in place", () => {
  const { proc } = harness();
  // Electron shows its error dialog only while nothing listens for
  // "uncaughtException"; the monitor event does not count as a listener.
  expect(proc.listenerCount("uncaughtException")).toBe(0);
});

test("a sign-in carried in a URL never reaches the log", () => {
  const { proc, lines } = harness();
  proc.emit("unhandledRejection", new Error("push to https://me:ghp_secret@github.com/a/b failed"));
  expect(lines.join("\n")).not.toContain("ghp_secret");
});
