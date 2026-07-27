import { afterEach, expect, test } from "bun:test";
import { isHttpError } from "@sveltejs/kit";
import {
  registerHostServices,
  type HostServices,
} from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { POST } from "../../src/routes/api/app/flush-failure/+server";

function request(body: unknown): Request {
  return new Request("http://local.test", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function prefsHarness(initial: Record<string, unknown> = {}) {
  let prefs = initial;
  let updates = 0;
  registerHostServices(
    makeHostServices({
      prefs: {
        readPrefs: async () => prefs,
        updatePrefs: async (mutate) => {
          updates += 1;
          prefs = mutate(prefs);
          return prefs;
        },
      },
    }),
  );
  return {
    get prefs() {
      return prefs;
    },
    get updates() {
      return updates;
    },
    replace(next: Record<string, unknown>) {
      prefs = next;
    },
  };
}

afterEach(() => {
  registerHostServices(undefined as unknown as HostServices);
});

test("record stores a minimal project/timestamp marker with one atomic prefs update", async () => {
  const h = prefsHarness({ sidebarOpen: true });
  const response = await POST({
    request: request({ action: "record", projectDir: "/books/field-guide" }),
  } as never);
  const marker = await response.json() as { projectDir: string; failedAt: string };

  expect(marker.projectDir).toBe("/books/field-guide");
  expect(Number.isNaN(new Date(marker.failedAt).getTime())).toBe(false);
  expect(h.prefs).toEqual({ sidebarOpen: true, lastFlushFailed: marker });
  expect(h.updates).toBe(1);
});

test("acknowledge clears only the surfaced marker, preserving a newer raced failure", async () => {
  const oldMarker = { projectDir: "/books/old", failedAt: "2026-07-26T10:00:00.000Z" };
  const newMarker = { projectDir: "/books/new", failedAt: "2026-07-26T11:00:00.000Z" };
  const h = prefsHarness({ lastFlushFailed: oldMarker, sidebarOpen: true });

  let response = await POST({
    request: request({ action: "acknowledge", failedAt: oldMarker.failedAt }),
  } as never);
  expect(await response.json()).toEqual({ acknowledged: true });
  expect(h.prefs).toEqual({ sidebarOpen: true });

  h.replace({ lastFlushFailed: newMarker, sidebarOpen: true });
  response = await POST({
    request: request({ action: "acknowledge", failedAt: oldMarker.failedAt }),
  } as never);
  expect(await response.json()).toEqual({ acknowledged: false });
  expect(h.prefs).toEqual({ lastFlushFailed: newMarker, sidebarOpen: true });
});

test("record rejects relative project context", async () => {
  prefsHarness();
  try {
    await POST({
      request: request({ action: "record", projectDir: "relative/book" }),
    } as never);
    throw new Error("expected route rejection");
  } catch (error) {
    if (!isHttpError(error)) throw error;
    expect(error.status).toBe(400);
  }
});
