import { test, expect } from "bun:test";
import { execCapture } from "./exec";

test("execCapture rejects with a signal-named message when child is killed by a signal", async () => {
  // The shell kills itself with SIGTERM; node reports code=null, signal="SIGTERM".
  let err: Error | undefined;
  try {
    await execCapture("sh", ["-c", "kill -TERM $$"]);
  } catch (e) {
    err = e as Error;
  }

  expect(err).toBeDefined();
  expect(err!.message).not.toContain("exited null");
  expect(err!.message).toContain("SIGTERM");
});
