/**
 * IPC-handler contract for the AppImage application-menu integration (#119):
 * `app:appImageIntegrationStatus`/`Install`/`Remove` (SFE-P5c1 — migrated off
 * `GET`/`POST /api/app/appimage-integration`, which took NO path input, only
 * a fixed `action` string, so a renderer could never redirect the install;
 * the IPC migration goes further — each operation is now its own channel
 * with zero renderer-suppliable arguments at all, not even an `action`
 * string to validate). These tests exercise `electron/api/app.ts`'s
 * `appImageIntegrationStatus`/`Install`/`Remove` functions directly (hooks
 * wiring + the not-registered/friendly-error envelopes), not
 * electron/main.ts's secureHandle registration.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  registerHostServices,
  type HostServices,
} from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import type { AppImageStatus } from "../../electron/appimage-integration";
import {
  appImageIntegrationInstall,
  appImageIntegrationRemove,
  appImageIntegrationStatus,
} from "../../electron/api/app";

async function caught(p: Promise<unknown>): Promise<{ message: unknown }> {
  try {
    await p;
    throw new Error("expected the promise to reject, but it resolved");
  } catch (e) {
    return { message: e instanceof Error ? e.message : String(e) };
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

describe("app:appImageIntegrationStatus", () => {
  test("rejects (host-disconnected) when the hooks are not registered", async () => {
    registerHostServices(makeHostServices({ appImage: undefined }));
    const { message } = await caught(appImageIntegrationStatus());
    expect(message).toBe("AppImage integration hooks not registered");
  });

  test("returns the host status verbatim", async () => {
    registerHostServices(
      makeHostServices({ appImage: { getStatus: async () => supportedStatus } }),
    );
    expect(await appImageIntegrationStatus()).toEqual(supportedStatus);
  });
});

describe("app:appImageIntegrationInstall / app:appImageIntegrationRemove", () => {
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

  test("routes each action to its own hook — no renderer-suppliable argument at all (stronger than the deleted route's action-string validation)", async () => {
    calls.length = 0;
    registerHostServices(services());
    const installResult = await appImageIntegrationInstall();
    const removeResult = await appImageIntegrationRemove();
    expect(installResult).toMatchObject({ ok: true, message: "added" });
    expect(removeResult).toMatchObject({ ok: true, message: "removed" });
    expect(calls).toEqual(["install", "remove"]);
  });

  test("rejects (host-disconnected) when the hooks are not registered", async () => {
    registerHostServices(makeHostServices({ appImage: undefined }));
    const { message } = await caught(appImageIntegrationInstall());
    expect(message).toBe("AppImage integration hooks not registered");
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
    const { message } = await caught(appImageIntegrationInstall());
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
    const { message } = await caught(appImageIntegrationRemove());
    expect(message).toBe("The application menu entry could not be updated. See the app log for details.");
    expect(String(message)).not.toContain("secret-path");
  });

  test("the service's own environment guard passes through with its friendly text (path-invalid equivalent)", async () => {
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
    const { message } = await caught(appImageIntegrationInstall());
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
    expect(view).toContain("appImageIntegration");
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
