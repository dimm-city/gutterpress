import { describe, expect, test } from "bun:test";
import { MemoryDocumentHost } from "../../src/core/index.ts";
import type { Diagnostic } from "../../src/core/index.ts";
import { mountEditor } from "../../src/web/mount.ts";
import { createTestContainer, type FakeElement } from "./support/dom-stub.ts";
import { withSubscriberCounting } from "./support/counting-host.ts";
import { wrapWithOneTimeInterleavedReplacement } from "./support/racy-host.ts";
import { withFixedRejection } from "./support/rejecting-host.ts";

/**
 * SFE-P1a Lane B — `mountEditor` integration tests against
 * `MemoryDocumentHost` (and small decorators around it — see
 * tests/web/support/**) and the hand-rolled DOM stub (dom-stub.ts). Covers
 * every "Test owner: B" row of docs/plans/source-first-editor/runs/SFE-P1a.md's
 * behavior table.
 *
 * "Every test asserts liveness (target exists) before behavior" (run spec):
 * `requireTextarea` below both asserts (via `expect`) that the mounted
 * surface exists AND narrows it for TypeScript, so every test's behavioral
 * assertions are provably reached only after confirming their target is
 * real.
 */
function requireTextarea(container: FakeElement): FakeElement {
  const surface = container.querySelector("textarea");
  expect(surface).not.toBeNull();
  if (!surface) throw new Error("unreachable: asserted not-null above");
  return surface;
}

describe("mountEditor — initial render", () => {
  test("renders the host's current snapshot text into the surface", () => {
    const host = new MemoryDocumentHost({ text: "hello world", version: 0 });
    const container = createTestContainer();

    mountEditor(container as unknown as Element, host);

    const surface = requireTextarea(container);
    expect(surface.value).toBe("hello world");
  });

  test("mounts exactly one surface element into the container", () => {
    const host = new MemoryDocumentHost({ text: "x", version: 0 });
    const container = createTestContainer();

    mountEditor(container as unknown as Element, host);

    expect(container.children).toHaveLength(1);
  });
});

describe("mountEditor — accepted edit", () => {
  test("typed input is submitted as a SourceEdit against the current snapshot and applies", () => {
    const host = new MemoryDocumentHost({ text: "hello world", version: 0 });
    const container = createTestContainer();
    mountEditor(container as unknown as Element, host);
    const surface = requireTextarea(container);

    surface.value = "hello brave world";
    surface.fireEvent("input");

    expect(host.getSnapshot()).toEqual({ text: "hello brave world", version: 1 });
  });

  test("a no-op input notification (value unchanged) does not submit an edit or bump the version", () => {
    const host = new MemoryDocumentHost({ text: "same", version: 0 });
    const container = createTestContainer();
    mountEditor(container as unknown as Element, host);
    const surface = requireTextarea(container);

    surface.value = "same"; // unchanged
    surface.fireEvent("input");

    expect(host.getSnapshot()).toEqual({ text: "same", version: 0 });
  });
});

describe("mountEditor — rejected edits surface as diagnostics, never throw", () => {
  test("a stale edit (external replacement between read and submit) surfaces EDITOR_STALE_EDIT and leaves source unchanged", () => {
    const realHost = new MemoryDocumentHost({ text: "hello", version: 0 });
    const host = wrapWithOneTimeInterleavedReplacement(realHost, "concurrent change");
    const diagnostics: Diagnostic[] = [];
    const container = createTestContainer();
    mountEditor(container as unknown as Element, host, {
      onDiagnostic: (d) => diagnostics.push(d),
    });
    const surface = requireTextarea(container);

    expect(() => {
      surface.value = "hello there";
      surface.fireEvent("input");
    }).not.toThrow();

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.category).toBe("EDITOR_STALE_EDIT");
    // Source reflects the interleaved external replacement, never the
    // rejected, stale edit the user typed.
    expect(realHost.getSnapshot()).toEqual({ text: "concurrent change", version: 1 });
    expect(surface.value).toBe("concurrent change");
  });

  test("a readonly host surfaces EDITOR_READONLY and leaves source unchanged", () => {
    const host = new MemoryDocumentHost({ text: "fixed", version: 0 }, { readonly: true });
    const diagnostics: Diagnostic[] = [];
    const container = createTestContainer();
    mountEditor(container as unknown as Element, host, {
      onDiagnostic: (d) => diagnostics.push(d),
    });
    const surface = requireTextarea(container);

    expect(() => {
      surface.value = "changed";
      surface.fireEvent("input");
    }).not.toThrow();

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.category).toBe("EDITOR_READONLY");
    expect(host.getSnapshot()).toEqual({ text: "fixed", version: 0 });
    expect(surface.value).toBe("fixed");
  });

  test("an invalid-range rejection surfaces EDITOR_INVALID_RANGE without throwing", () => {
    const host = withFixedRejection("invalid-range", { text: "abc", version: 0 });
    const diagnostics: Diagnostic[] = [];
    const container = createTestContainer();

    expect(() => {
      mountEditor(container as unknown as Element, host, {
        onDiagnostic: (d) => diagnostics.push(d),
      });
    }).not.toThrow();

    const surface = requireTextarea(container);

    expect(() => {
      surface.value = "abcd";
      surface.fireEvent("input");
    }).not.toThrow();

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.category).toBe("EDITOR_INVALID_RANGE");
  });

  test("mountEditor works with no onDiagnostic supplied: a rejection still does not throw", () => {
    const host = new MemoryDocumentHost({ text: "fixed", version: 0 }, { readonly: true });
    const container = createTestContainer();
    mountEditor(container as unknown as Element, host); // no options at all
    const surface = requireTextarea(container);

    expect(() => {
      surface.value = "changed";
      surface.fireEvent("input");
    }).not.toThrow();
    expect(host.getSnapshot()).toEqual({ text: "fixed", version: 0 });
  });
});

describe("mountEditor — external replacement", () => {
  test("re-renders the surface and subsequent edits use the new version (monotonicity preserved)", () => {
    const host = new MemoryDocumentHost({ text: "a", version: 0 });
    const container = createTestContainer();
    mountEditor(container as unknown as Element, host);
    const surface = requireTextarea(container);

    host.replaceExternal("b");
    expect(surface.value).toBe("b");
    expect(host.getSnapshot()).toEqual({ text: "b", version: 1 });

    surface.value = "bc";
    surface.fireEvent("input");
    expect(host.getSnapshot()).toEqual({ text: "bc", version: 2 });
  });
});

describe("mountEditor — dispose / remount", () => {
  test("dispose unsubscribes from the host and removes the mounted surface", () => {
    const realHost = new MemoryDocumentHost({ text: "x", version: 0 });
    const host = withSubscriberCounting(realHost);
    const container = createTestContainer();
    const mount = mountEditor(container as unknown as Element, host);
    requireTextarea(container); // liveness before behavior
    expect(host.activeSubscriberCount()).toBe(1);

    mount.dispose();

    expect(host.activeSubscriberCount()).toBe(0);
    expect(container.children).toHaveLength(0);
  });

  test("dispose is idempotent", () => {
    const host = new MemoryDocumentHost({ text: "x", version: 0 });
    const container = createTestContainer();
    const mount = mountEditor(container as unknown as Element, host);
    requireTextarea(container);

    expect(() => {
      mount.dispose();
      mount.dispose();
      mount.dispose();
    }).not.toThrow();
    expect(container.children).toHaveLength(0);
  });

  test("remounting after dispose works: a fresh mount on the same host functions normally", () => {
    const realHost = new MemoryDocumentHost({ text: "x", version: 0 });
    const host = withSubscriberCounting(realHost);
    const container = createTestContainer();

    const firstMount = mountEditor(container as unknown as Element, host);
    requireTextarea(container);
    firstMount.dispose();
    expect(container.children).toHaveLength(0);

    const secondMount = mountEditor(container as unknown as Element, host);
    expect(host.activeSubscriberCount()).toBe(1);
    const surface = requireTextarea(container);
    expect(surface.value).toBe("x");

    surface.value = "xy";
    surface.fireEvent("input");
    expect(realHost.getSnapshot()).toEqual({ text: "xy", version: 1 });

    secondMount.dispose();
    expect(host.activeSubscriberCount()).toBe(0);
  });

  test("a late host notification after dispose is ignored: no throw, no DOM resurrection", () => {
    const host = new MemoryDocumentHost({ text: "x", version: 0 });
    const container = createTestContainer();
    const mount = mountEditor(container as unknown as Element, host);
    requireTextarea(container);

    mount.dispose();
    expect(container.children).toHaveLength(0); // liveness: nothing mounted post-dispose

    expect(() => host.replaceExternal("late change")).not.toThrow();
    // The host itself still accepts the replacement (that's the host's own
    // contract, independent of any particular mount) — but nothing
    // reappears in the disposed mount's container.
    expect(container.children).toHaveLength(0);
    expect(host.getSnapshot()).toEqual({ text: "late change", version: 1 });
  });

  test("dispose on one mount does not affect a second, independent mount on the same host", () => {
    const realHost = new MemoryDocumentHost({ text: "shared", version: 0 });
    const host = withSubscriberCounting(realHost);
    const containerA = createTestContainer();
    const containerB = createTestContainer();

    const mountA = mountEditor(containerA as unknown as Element, host);
    const mountB = mountEditor(containerB as unknown as Element, host);
    requireTextarea(containerA);
    requireTextarea(containerB);
    expect(host.activeSubscriberCount()).toBe(2);

    mountA.dispose();
    expect(host.activeSubscriberCount()).toBe(1);
    expect(containerA.children).toHaveLength(0);

    // B is still live: an external replacement still reaches it.
    realHost.replaceExternal("changed");
    const surfaceB = requireTextarea(containerB);
    expect(surfaceB.value).toBe("changed");

    mountB.dispose();
    expect(host.activeSubscriberCount()).toBe(0);
  });
});
