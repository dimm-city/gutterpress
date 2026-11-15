/**
 * Electron keeps only an Error's message when a host call rejects: its `code`
 * is dropped and the message gains an "Error invoking remote method" prefix.
 * `ipc-result` carries a failure across as plain data instead, so the reason
 * and the code the renderer branches on both arrive.
 */
import { expect, test } from "bun:test";
import { fromIpcResult, toIpcResult } from "../../src/lib/platform/ipc-result";

/** What survives the trip: IPC copies plain data, nothing else. */
const overTheWire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

test("a failure arrives with its code and its whole message", async () => {
  const failure = Object.assign(
    new Error("Missing ICC profile at press.icc.\nPlace the ICC profile in the book or name one in the manifest."),
    { code: "BUILD_ERROR" },
  );
  const wire = overTheWire(await toIpcResult(Promise.reject(failure)));
  let caught: (Error & { code?: string }) | undefined;
  try {
    fromIpcResult(wire);
  } catch (e) {
    caught = e as Error & { code?: string };
  }
  expect(caught).toBeInstanceOf(Error);
  expect(caught!.message).toBe(failure.message);
  expect(caught!.code).toBe("BUILD_ERROR");
});

test("a failure with no code, or one that is not an Error, still carries its text", async () => {
  const plain = overTheWire(await toIpcResult(Promise.reject(new Error("gs exited with code 1"))));
  expect(() => fromIpcResult(plain)).toThrow("gs exited with code 1");
  const text = overTheWire(await toIpcResult(Promise.reject("disk full")));
  expect(() => fromIpcResult(text)).toThrow("disk full");
});

test("a success hands its value through unchanged", async () => {
  const wire = overTheWire(await toIpcResult(Promise.resolve({ pdfPath: "/book/dist/book.pdf" })));
  expect(fromIpcResult(wire)).toEqual({ pdfPath: "/book/dist/book.pdf" });
});

test("a failure's original text, kept as its detail, arrives too", async () => {
  const failure = Object.assign(new Error("The PDF could not be made."), {
    code: "BUILD_FAILED",
    detail: "gs exited with code 1",
  });
  const wire = overTheWire(await toIpcResult(Promise.reject(failure)));
  let caught: (Error & { detail?: string }) | undefined;
  try {
    fromIpcResult(wire);
  } catch (e) {
    caught = e as Error & { detail?: string };
  }
  expect(caught!.detail).toBe("gs exited with code 1");
});
