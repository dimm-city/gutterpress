/**
 * `RichModeController` tests (SFE-P3ab, Lane A).
 *
 * Bun imports the rune-bearing `.svelte.ts` module without Svelte's
 * compiler in these unit tests. The production compiler replaces `$state`;
 * the class only needs plain values for this behavior test — same shim
 * `buffer-state.test.ts` uses.
 */
import { expect, test, describe } from "bun:test";
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

import {
  RichModeController,
  createRichModeController,
  trackSurfaceMount,
  type EditorSurface,
} from "../../src/lib/editor/rich-mode.svelte";
import { MemoryDocumentHost } from "@dimm-city/gutterpress-editor";

describe("RichModeController — mode selection", () => {
  test("defaults to source", () => {
    const controller = new RichModeController();
    expect(controller.mode).toBe("source");
    expect(controller.epoch).toBe(0);
  });

  test("an explicit initialSurface is honored", () => {
    const controller = createRichModeController({ initialSurface: "rich" });
    expect(controller.mode).toBe("rich");
  });

  test("switchTo changes mode and bumps epoch", () => {
    const controller = new RichModeController();
    controller.switchTo("rich");
    expect(controller.mode).toBe("rich");
    expect(controller.epoch).toBe(1);

    controller.switchTo("source");
    expect(controller.mode).toBe("source");
    expect(controller.epoch).toBe(2);
  });

  test("switching to the already-active surface is a no-op (no epoch bump)", () => {
    const controller = new RichModeController();
    controller.switchTo("source");
    expect(controller.mode).toBe("source");
    expect(controller.epoch).toBe(0);

    controller.switchTo("rich");
    controller.switchTo("rich");
    expect(controller.epoch).toBe(1);
  });
});

describe("RichModeController — switching never alters source", () => {
  test("switchTo leaves the shared document host's snapshot byte-identical", () => {
    const host = new MemoryDocumentHost({ text: "# Chapter One\n\nOriginal words.", version: 0 });
    const controller = new RichModeController();

    const before = host.getSnapshot();
    controller.switchTo("rich");
    controller.switchTo("source");
    controller.switchTo("rich");
    const after = host.getSnapshot();

    expect(after.text).toBe(before.text);
    expect(after.version).toBe(before.version);
  });

  test("onFileSwitch also leaves the host untouched", () => {
    const host = new MemoryDocumentHost({ text: "content", version: 0 });
    const controller = new RichModeController({ initialSurface: "rich" });

    const before = host.getSnapshot();
    controller.onFileSwitch();
    const after = host.getSnapshot();

    expect(after).toEqual(before);
  });
});

describe("RichModeController — file switches", () => {
  test("onFileSwitch bumps the epoch and preserves the current mode by default", () => {
    const controller = new RichModeController({ initialSurface: "rich" });
    controller.onFileSwitch();
    expect(controller.mode).toBe("rich");
    expect(controller.epoch).toBe(1);

    controller.onFileSwitch();
    expect(controller.epoch).toBe(2);
  });

  test("onFileSwitch can reset the mode explicitly", () => {
    const controller = new RichModeController({ initialSurface: "rich" });
    controller.onFileSwitch("source");
    expect(controller.mode).toBe("source");
    expect(controller.epoch).toBe(1);
  });
});

describe("RichModeController — exactly one surface mounted at a time", () => {
  test("registerMount succeeds for the first surface and records it", () => {
    const controller = new RichModeController();
    controller.registerMount("source");
    expect(controller.mountedSurface).toBe("source");
  });

  test("registerMount throws when a DIFFERENT surface is already mounted (the race the review asks about)", () => {
    const controller = new RichModeController();
    controller.registerMount("source");
    expect(() => controller.registerMount("rich")).toThrow();
    // The throw must not have clobbered the existing registration.
    expect(controller.mountedSurface).toBe("source");
  });

  test("registerMount for the SAME surface twice is a harmless no-op", () => {
    const controller = new RichModeController();
    controller.registerMount("rich");
    expect(() => controller.registerMount("rich")).not.toThrow();
    expect(controller.mountedSurface).toBe("rich");
  });

  test("registerUnmount clears only a matching registration", () => {
    const controller = new RichModeController();
    controller.registerMount("source");
    // A stale/superseded dispose for a DIFFERENT surface must not clobber
    // the real registration.
    controller.registerUnmount("rich");
    expect(controller.mountedSurface).toBe("source");

    controller.registerUnmount("source");
    expect(controller.mountedSurface).toBeNull();
  });

  test("a full mount → unmount → mount cycle for the OTHER surface succeeds", () => {
    const controller = new RichModeController();
    controller.registerMount("source");
    controller.registerUnmount("source");
    expect(() => controller.registerMount("rich")).not.toThrow();
    expect(controller.mountedSurface).toBe("rich");
  });

  test("mount/dispose counters modeling a rapid toggle: unmount-then-mount never double-mounts", () => {
    // Models what two real surface components' mount/dispose lifecycle
    // would report during a rapid toggle, without needing either component
    // instantiated.
    let sourceMounts = 0;
    let sourceUnmounts = 0;
    let richMounts = 0;
    let richUnmounts = 0;
    const controller = new RichModeController();

    function mount(surface: EditorSurface): void {
      controller.registerMount(surface);
      if (surface === "source") sourceMounts++;
      else richMounts++;
    }
    function unmount(surface: EditorSurface): void {
      controller.registerUnmount(surface);
      if (surface === "source") sourceUnmounts++;
      else richUnmounts++;
    }

    mount("source");
    unmount("source");
    mount("rich");
    unmount("rich");
    mount("source");

    expect(sourceMounts).toBe(2);
    expect(sourceUnmounts).toBe(1);
    expect(richMounts).toBe(1);
    expect(richUnmounts).toBe(1);
    expect(controller.mountedSurface).toBe("source");
  });

  test("a mount attempted WITHOUT unmounting the other surface first is rejected, not silently tolerated", () => {
    const controller = new RichModeController();
    function mount(surface: EditorSurface): void {
      controller.registerMount(surface);
    }

    mount("source");
    // Simulates a bug (or a genuine race) where "rich" tries to come up
    // before "source" reports its own teardown.
    expect(() => mount("rich")).toThrow();
    expect(controller.mountedSurface).toBe("source");
  });
});

describe("trackSurfaceMount action", () => {
  test("registers on attach and unregisters on destroy", () => {
    const controller = new RichModeController();
    const node = {} as Element;

    const action = trackSurfaceMount(node, { controller, surface: "rich" });
    expect(controller.mountedSurface).toBe("rich");

    action.destroy();
    expect(controller.mountedSurface).toBeNull();
  });

  test("two sequential attach/destroy cycles for different surfaces do not conflict", () => {
    const controller = new RichModeController();
    const sourceNode = {} as Element;
    const richNode = {} as Element;

    const sourceAction = trackSurfaceMount(sourceNode, { controller, surface: "source" });
    expect(controller.mountedSurface).toBe("source");
    sourceAction.destroy();
    expect(controller.mountedSurface).toBeNull();

    const richAction = trackSurfaceMount(richNode, { controller, surface: "rich" });
    expect(controller.mountedSurface).toBe("rich");
    richAction.destroy();
    expect(controller.mountedSurface).toBeNull();
  });
});
