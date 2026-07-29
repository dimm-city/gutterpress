/**
 * Route-level contract for the AppImage application-menu integration (#119):
 * `GET /api/app/appimage-integration` and its validated `POST` action.
 *
 * The route must accept NO path input — only a fixed `action` string — so a
 * renderer can never redirect the install. These tests exercise the route
 * factory (validate() + hooks wiring + the 503/400 envelopes), not
 * electron/main.ts.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isHttpError } from "@sveltejs/kit";
import {
  registerHostServices,
  type HostServices,
} from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import type { AppImageStatus } from "../../electron/appimage-integration";
import {
  GET as statusRoute,
  POST as actionRoute,
} from "../../src/routes/api/app/appimage-integration/+server";

function request(body?: unknown): Request {
  return body === undefined
    ? new Request("http://local.test")
    : new Request("http://local.test", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      });
}

async function caught(p: Promise<unknown>): Promise<{ status: number; message: unknown }> {
  try {
    await p;
    throw new Error("expected the promise to reject, but it resolved");
  } catch (e) {
    if (!isHttpError(e)) throw e;
    return { status: e.status, message: (e.body as { message?: unknown }).message };
  }
}

const supportedStatus: AppImageStatus = {
  supported: true,
  reason: null,
  installed: false,
  needsRepair: false,
  runningManagedCopy: false,
  paths: {
    appImage: "/home/w/.local/bin/gutterpress.AppImage",
    desktopEntry: "/home/w/.local/share/applications/city.dimm.gutterpress.desktop",
    icon: "/home/w/.local/share/icons/hicolor/512x512/apps/city.dimm.gutterpress.png",
  },
};

afterEach(() => {
  // Fully UN-register — `__gutterpressHost__` is one process-wide globalThis key
  // and bun's file execution order is not deterministic (see
  // migrated-ipc-routes.test.ts's identical note).
  registerHostServices(undefined as unknown as HostServices);
});

describe("GET /api/app/appimage-integration", () => {
  test("503 when the hooks are not registered", async () => {
    registerHostServices(makeHostServices({ appImage: undefined }));
    const { status, message } = await caught(statusRoute({ request: request() } as never));
    expect(status).toBe(503);
    expect(message).toBe("AppImage integration hooks not registered");
  });

  test("returns the host status verbatim", async () => {
    registerHostServices(
      makeHostServices({ appImage: { getStatus: async () => supportedStatus } }),
    );
    const res = await statusRoute({ request: request() } as never);
    expect(await res.json()).toEqual(supportedStatus);
  });
});

describe("POST /api/app/appimage-integration", () => {
  const calls: string[] = [];

  function services(): HostServices {
    return makeHostServices({
      appImage: {
        getStatus: async () => supportedStatus,
        install: async () => {
          calls.push("install");
          return { ok: true as const, runningManagedCopy: false, message: "added", status: supportedStatus };
        },
        remove: async () => {
          calls.push("remove");
          return { ok: true as const, removed: [], message: "removed", status: supportedStatus };
        },
      },
    });
  }

  test("400 on a missing, unknown, or non-string action", async () => {
    registerHostServices(services());
    for (const body of [{}, { action: "uninstall" }, { action: 7 }, { action: null }]) {
      const { status, message } = await caught(actionRoute({ request: request(body) } as never));
      expect(status).toBe(400);
      expect(message).toBe("action must be one of: install, remove");
    }
  });

  test("ignores any renderer-supplied path — only the action is read", async () => {
    calls.length = 0;
    registerHostServices(services());
    const res = await actionRoute({
      request: request({ action: "install", appImage: "/etc/evil", paths: { icon: "/etc/evil" } }),
    } as never);
    expect(await res.json()).toMatchObject({ ok: true, message: "added" });
    expect(calls).toEqual(["install"]);
  });

  test("routes each valid action to its hook", async () => {
    calls.length = 0;
    registerHostServices(services());
    await actionRoute({ request: request({ action: "install" }) } as never);
    await actionRoute({ request: request({ action: "remove" }) } as never);
    expect(calls).toEqual(["install", "remove"]);
  });

  test("503 when the hooks are not registered", async () => {
    registerHostServices(makeHostServices({ appImage: undefined }));
    const { status } = await caught(actionRoute({ request: request({ action: "install" }) } as never));
    expect(status).toBe(503);
  });

  // Every realistic failure here is a raw node:fs error. A non-technical
  // author must never see "EACCES: permission denied, copyfile '/home/…'".
  test("a raw fs error is replaced with plain-language guidance, never leaked verbatim", async () => {
    const fsError = Object.assign(
      new Error("EACCES: permission denied, copyfile '/tmp/a.AppImage' -> '/home/w/.local/bin/x.tmp'"),
      { code: "EACCES" },
    );
    registerHostServices(
      makeHostServices({
        appImage: { getStatus: async () => supportedStatus, install: async () => { throw fsError; } },
      }),
    );
    const { status, message } = await caught(actionRoute({ request: request({ action: "install" }) } as never));
    expect(status).toBe(500);
    expect(message).toBe(
      "Gutterpress doesn't have permission to write to your home folder, so it couldn't add the menu entry.",
    );
    expect(String(message)).not.toContain("EACCES");
    expect(String(message)).not.toContain("/home/w");
  });

  test("an unclassifiable failure becomes a terse safe message, not the raw error text", async () => {
    registerHostServices(
      makeHostServices({
        appImage: {
          getStatus: async () => supportedStatus,
          remove: async () => { throw new Error("internal detail /home/w/secret-path exploded"); },
        },
      }),
    );
    const { status, message } = await caught(actionRoute({ request: request({ action: "remove" }) } as never));
    expect(status).toBe(500);
    expect(message).toBe("The application menu entry could not be updated. See the app log for details.");
    expect(String(message)).not.toContain("secret-path");
  });

  test("the service's own environment guard passes through as a 409 with its friendly text", async () => {
    registerHostServices(
      makeHostServices({
        appImage: {
          getStatus: async () => supportedStatus,
          install: async () => {
            throw new Error("Application-menu integration is only available on Linux.");
          },
        },
      }),
    );
    const { status, message } = await caught(actionRoute({ request: request({ action: "install" }) } as never));
    expect(status).toBe(409);
    expect(message).toBe("Application-menu integration is only available on Linux.");
  });
});

// ── UI wiring (source pins, per the repo convention — see settings-connections.test.ts) ──

describe("Settings → App — the action is supported-only", () => {
  const view = readFileSync(
    path.join(import.meta.dir, "../../src/lib/components/SettingsView.svelte"),
    "utf8",
  );

  test("the whole section is gated on the host's `supported` flag, inside the App tab", () => {
    expect(view).toContain("{#if appImage?.supported}");
    // Nested inside the App tab's block, so it can never leak into another tab.
    expect(view.indexOf("{#if appImage?.supported}")).toBeGreaterThan(
      view.indexOf('{#if activeTab === "app"}'),
    );
  });

  test("status is fetched once on mount (no $effect — banned in this SPA) and never blocks on failure", () => {
    expect(view).toContain("onMount(");
    expect(view).not.toContain("$effect(");
    expect(view).toContain("api.app.appImageIntegration");
    expect(view).toMatch(/\.catch\(\(\) => \{[\s\S]*?appImage = null;/);
  });

  test("both actions render busy, success, and inline error states", () => {
    expect(view).toContain("appImageBusy");
    expect(view).toContain('disabled={appImageBusy}');
    expect(view).toContain('runAppImageAction("install")');
    expect(view).toContain('runAppImageAction("remove")');
    expect(view).toContain('class="row-notice"');
    expect(view).toContain('class="row-error"');
    expect(view).toContain('role="alert"');
  });

  test("the repair affordance is surfaced when the host reports stale managed files", () => {
    expect(view).toContain("appImage.needsRepair");
    expect(view).toContain("Repair menu entry");
  });

  test("the row title is NOT a `label for` the action button — that would click-forward into a silent install", () => {
    // A <label for> synthesizes a click on its control, so labelling the row
    // heading would run the install when a user clicks what reads as a title.
    expect(view).not.toMatch(/<label for="appimage/);
    expect(view).toContain('<span class="row-title">Application menu</span>');
    // The hint is still tied to the button for assistive tech.
    expect(view).toContain('aria-describedby="appimage-hint"');
  });
});
