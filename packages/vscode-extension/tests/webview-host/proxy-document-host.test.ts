// Unit tests for src/webview-host/proxy-document-host.ts (SFE-P3c run spec
// DETAILS #3, "Authority and reconciliation model", and the behavior
// table's "Contract substitutability"/"Convergence"/"Host disconnection"
// rows).
//
// proxy-document-host.ts is browser-safe (no "vscode", no node builtin —
// see its own header), so this suite needs no mock.module at all; it wires
// a real ProxyDocumentHost to the in-memory SimulatedExtensionHost/transport
// pairing in ../support/simulated-extension-host.ts.

import { describe, expect, test } from "bun:test";
import {
  runDocumentHostContractTests,
  type DocumentSnapshot,
  type EditorDocumentHost,
} from "@dimm-city/gutterpress-editor/core";
import { ProxyDocumentHost } from "../../src/webview-host/proxy-document-host.ts";
import { createSimulatedProxyPair } from "../support/simulated-extension-host.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Shared EditorDocumentHost contract, against a LATENT simulated host ────
// Run spec: "The shared runDocumentHostContractTests suite passes against
// ProxyDocumentHost wired to a simulated host with latency and out-of-order
// replies, exactly as it passes for MemoryDocumentHost and
// DesktopDocumentHost." Every assertion in this shared suite is SYNCHRONOUS
// (checked immediately after applyEdit/getSnapshot/subscribe) — it never
// waits on the async host round trip, which is exactly what proves
// ProxyDocumentHost's synchronous, optimistic-local-mirror design (binding
// point 2) actually satisfies the contract without needing the simulated
// host to reply instantly.

function makeHost(initialText: string, opts?: { readonly?: boolean }): EditorDocumentHost {
  const { transport } = createSimulatedProxyPair(initialText);
  return new ProxyDocumentHost({ text: initialText, version: 0 }, transport, { initialReadonly: opts?.readonly });
}

describe("ProxyDocumentHost — shared EditorDocumentHost contract (simulated host, latency)", () => {
  runDocumentHostContractTests(describe, test, expect, makeHost);
});

// ── Convergence — the four bespoke cases the run spec names by letter ─────

describe("ProxyDocumentHost — convergence (run spec DETAILS #3 a-d)", () => {
  test("(a) an accepted edit produces no spurious external replacement", async () => {
    const { transport } = createSimulatedProxyPair("hello");
    const proxy = new ProxyDocumentHost({ text: "hello", version: 0 }, transport);
    const seen: DocumentSnapshot[] = [];
    proxy.subscribe((s) => seen.push(s));

    const result = proxy.applyEdit({ from: 0, to: 5, insert: "goodbye", expectedVersion: 0 });
    expect(result).toEqual({ ok: true, snapshot: { text: "goodbye", version: 1 } });
    expect(seen).toEqual([{ text: "goodbye", version: 1 }]);

    await sleep(60); // let the simulated host's (accepting) reply arrive
    expect(seen).toEqual([{ text: "goodbye", version: 1 }]); // still just the one optimistic notify
    expect(proxy.getSnapshot()).toEqual({ text: "goodbye", version: 1 });
  });

  test("(b) a host-rejected edit converges the mirror in exactly one replacement", async () => {
    const { host: simHost, transport } = createSimulatedProxyPair("original");
    const proxy = new ProxyDocumentHost({ text: "original", version: 0 }, transport);

    // A concurrent external change reaches the host BEFORE our edit does —
    // its OWN reply bumps the host's base stamp, so once our edit arrives,
    // its `base` (captured before that change) no longer matches the
    // host's CURRENT stamp, and the host rejects it without ever applying
    // it for real (reconciliation addendum: `base`, not
    // `edit.expectedVersion`, is what decides this now).
    simHost.externalChange("changed elsewhere");
    const result = proxy.applyEdit({ from: 0, to: 8, insert: "MINE", expectedVersion: 0 });
    expect(result.ok).toBe(true); // accepted LOCALLY/optimistically — the mirror does not know yet

    await sleep(80);

    // Text converges to the host's true state...
    expect(proxy.getSnapshot().text).toBe(simHost.currentSnapshot().text);
    expect(proxy.getSnapshot().text).toBe("changed elsewhere");
    // ...and the mirror's own LOCAL version advanced by exactly 1 beyond
    // the optimistic bump (0 -> 1 optimistic -> 2 the one convergence),
    // regardless of how many wire messages happened to carry that same
    // content (the host's own external-change broadcast and its rejection
    // reply to our edit both report the same post-change state).
    expect(proxy.getSnapshot().version).toBe(2);
  });

  test("(c) an external change while a local edit is in flight leaves the mirror byte-identical to the host, even out of order", async () => {
    // The edit's OWN accept-reply is delayed MORE than the external
    // change's reply, so the external change's reply arrives FIRST — and
    // because it bumps the host's base stamp before the edit's own
    // (delayed) processing checks it, the edit is itself rejected as
    // stale-based once its turn comes (reconciliation addendum): the
    // proxy hears the external change's reply BEFORE the edit's own
    // rejection reply, genuinely out of the order the two were triggered
    // in.
    let replyCount = 0;
    const delays = [30, 5];
    const { host: simHost, transport } = createSimulatedProxyPair("original", {
      latencyMs: () => delays[replyCount++] ?? 5,
    });
    const proxy = new ProxyDocumentHost({ text: "original", version: 0 }, transport);

    const result = proxy.applyEdit({ from: 0, to: 8, insert: "mine", expectedVersion: 0 });
    expect(result.ok).toBe(true); // schedules reply #1 (30ms) via the transport's synchronous postMessage

    simHost.externalChange("changed after my edit"); // schedules reply #2 (5ms) — arrives first

    await sleep(90);

    expect(proxy.getSnapshot().text).toBe(simHost.currentSnapshot().text);
    expect(simHost.currentSnapshot().text).toBe("changed after my edit");
  });

  test("(d) a local edit after disconnect is refused, not silently accepted", () => {
    const { host: simHost, transport } = createSimulatedProxyPair("text");
    const proxy = new ProxyDocumentHost({ text: "text", version: 0 }, transport);

    simHost.disconnect();

    const result = proxy.applyEdit({ from: 0, to: 4, insert: "XXXX", expectedVersion: 0 });
    expect(result).toEqual({ ok: false, reason: "readonly", snapshot: { text: "text", version: 0 } });
    expect(proxy.getSnapshot()).toEqual({ text: "text", version: 0 });
  });
});

// ── Beyond the shared suite: protocol validation, callbacks, disposal ─────

describe("ProxyDocumentHost — inbound message validation (D12)", () => {
  test("posts 'ready' immediately on construction", () => {
    const sentToHost: unknown[] = [];
    const transport = {
      postMessage: (m: unknown) => sentToHost.push(m),
      onMessage: () => () => {},
    };
    // eslint-disable-next-line no-new -- constructing for its side effect
    new ProxyDocumentHost({ text: "x", version: 0 }, transport);
    expect(sentToHost).toEqual([{ type: "ready", protocolVersion: 1 }]);
  });

  test("a malformed inbound message is dropped and reported back via diagnostic-report, not dispatched", () => {
    let deliver: ((message: unknown) => void) | undefined;
    const sentToHost: unknown[] = [];
    const transport = {
      postMessage: (m: unknown) => sentToHost.push(m),
      onMessage: (listener: (message: unknown) => void) => {
        deliver = listener;
        return () => {};
      },
    };
    const diagnostics: Array<{ category: string }> = [];
    const proxy = new ProxyDocumentHost({ text: "x", version: 0 }, transport, {
      onDiagnostic: (d) => diagnostics.push(d),
    });

    deliver?.({ type: "snapshot", protocolVersion: 999, snapshot: { text: "y", version: 1 } });

    expect(proxy.getSnapshot()).toEqual({ text: "x", version: 0 }); // never applied
    // Repair round 1 (finding "One malformed inbound message permanently
    // destroys the editing surface"): a rejected MESSAGE no longer fires
    // onDiagnostic at all — see the dedicated onProtocolRejection tests
    // below for where this signal now goes, and why.
    expect(diagnostics).toHaveLength(0);
    const reportCalls = sentToHost.filter((m): m is { type: string } => (m as { type?: string }).type === "diagnostic-report");
    expect(reportCalls).toHaveLength(1);
    // The wire payload back to the host is unchanged — still the closest
    // existing D14 category, for the host's own dev-log line only (the
    // host never acts on it — DiagnosticReportMessage's own doc comment).
    expect((reportCalls[0] as unknown as { diagnostic: { category: string } }).diagnostic.category).toBe(
      "EDITOR_HOST_DISCONNECTED",
    );
  });
});

describe("ProxyDocumentHost — onProtocolRejection: the session SURVIVES a malformed/unrelated message (repair round 1)", () => {
  test("onProtocolRejection fires with the specific rejection reason; onDiagnostic does not fire", () => {
    let deliver: ((message: unknown) => void) | undefined;
    const transport = {
      postMessage: () => {},
      onMessage: (listener: (message: unknown) => void) => {
        deliver = listener;
        return () => {};
      },
    };
    const rejections: Array<{ reason: string }> = [];
    const diagnostics: unknown[] = [];
    // eslint-disable-next-line no-new -- constructing for its side effect below
    new ProxyDocumentHost({ text: "x", version: 0 }, transport, {
      onProtocolRejection: (failure) => rejections.push(failure),
      onDiagnostic: (d) => diagnostics.push(d),
    });

    deliver?.({ type: "not-a-real-type", protocolVersion: 1 });

    expect(rejections).toHaveLength(1);
    expect(rejections[0]?.reason).toBe("unknown-message-type");
    expect(diagnostics).toHaveLength(0);
  });

  test("the mirror stays fully writable after a rejected message — applyEdit still succeeds", () => {
    let deliver: ((message: unknown) => void) | undefined;
    const transport = {
      postMessage: () => {},
      onMessage: (listener: (message: unknown) => void) => {
        deliver = listener;
        return () => {};
      },
    };
    const proxy = new ProxyDocumentHost({ text: "hello", version: 0 }, transport, {
      onProtocolRejection: () => {},
    });

    deliver?.({ type: "snapshot" }); // missing protocolVersion — malformed
    deliver?.("not even an object"); // arbitrary unrelated window-message noise
    deliver?.(null);

    const result = proxy.applyEdit({ from: 0, to: 5, insert: "world", expectedVersion: 0 });
    expect(result).toEqual({ ok: true, snapshot: { text: "world", version: 1 } });
    expect(proxy.getSnapshot()).toEqual({ text: "world", version: 1 });
  });

  test("SABOTAGE-PROVABLE: a real EDITOR_HOST_DISCONNECTED (via #handleDisconnect) still fires onDiagnostic and IS terminal — distinguishing the two paths is the point of this fix, not a relaxation of the real one", () => {
    let deliver: ((message: unknown) => void) | undefined;
    const transport = {
      postMessage: () => {},
      onMessage: (listener: (message: unknown) => void) => {
        deliver = listener;
        return () => {};
      },
    };
    const diagnostics: Array<{ category: string }> = [];
    const proxy = new ProxyDocumentHost({ text: "x", version: 0 }, transport, {
      onDiagnostic: (d) => diagnostics.push(d),
      onProtocolRejection: () => {},
    });

    deliver?.({
      type: "disconnect",
      protocolVersion: 1,
      diagnostic: { category: "EDITOR_HOST_DISCONNECTED", message: "closed" },
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.category).toBe("EDITOR_HOST_DISCONNECTED");

    const result = proxy.applyEdit({ from: 0, to: 1, insert: "y", expectedVersion: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("readonly"); // genuinely terminal, unlike a protocol rejection
  });
});

describe("ProxyDocumentHost — trust-state / presentation-input callbacks", () => {
  test("forwards trust-state to onTrustChange", () => {
    let deliver: ((message: unknown) => void) | undefined;
    const transport = {
      postMessage: () => {},
      onMessage: (listener: (message: unknown) => void) => {
        deliver = listener;
        return () => {};
      },
    };
    const trustEvents: boolean[] = [];
    // eslint-disable-next-line no-new -- constructing for its side effect below
    new ProxyDocumentHost({ text: "x", version: 0 }, transport, { onTrustChange: (t) => trustEvents.push(t) });

    deliver?.({ type: "trust-state", protocolVersion: 1, trusted: true });
    expect(trustEvents).toEqual([true]);
  });

  test("forwards presentation-input to onPresentationInput", () => {
    let deliver: ((message: unknown) => void) | undefined;
    const transport = {
      postMessage: () => {},
      onMessage: (listener: (message: unknown) => void) => {
        deliver = listener;
        return () => {};
      },
    };
    const inputs: Array<{ mode: string }> = [];
    // eslint-disable-next-line no-new -- constructing for its side effect below
    new ProxyDocumentHost({ text: "x", version: 0 }, transport, { onPresentationInput: (i) => inputs.push(i) });

    deliver?.({ type: "presentation-input", protocolVersion: 1, mode: "source-fallback" });
    expect(inputs).toEqual([{ mode: "source-fallback" }]);
  });
});

describe("ProxyDocumentHost — reply timeout (host-fidelity: 'a reply that never arrives')", () => {
  test("self-diagnoses EDITOR_HOST_DISCONNECTED and goes read-only if no snapshot reply arrives in time", async () => {
    // A transport whose host side never replies at all.
    const transport = { postMessage: () => {}, onMessage: () => () => {} };
    const diagnostics: Array<{ category: string }> = [];
    const proxy = new ProxyDocumentHost({ text: "x", version: 0 }, transport, {
      replyTimeoutMs: 20,
      onDiagnostic: (d) => diagnostics.push(d),
    });

    const applied = proxy.applyEdit({ from: 0, to: 1, insert: "y", expectedVersion: 0 });
    expect(applied.ok).toBe(true); // accepted optimistically

    await sleep(40);

    expect(diagnostics.some((d) => d.category === "EDITOR_HOST_DISCONNECTED")).toBe(true);
    const after = proxy.applyEdit({ from: 0, to: 1, insert: "z", expectedVersion: proxy.getSnapshot().version });
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.reason).toBe("readonly");
  });

  test("does NOT time out if a reply arrives before the deadline", async () => {
    const { transport } = createSimulatedProxyPair("x", { latencyMs: () => 5 });
    const diagnostics: Array<{ category: string }> = [];
    const proxy = new ProxyDocumentHost({ text: "x", version: 0 }, transport, {
      replyTimeoutMs: 30,
      onDiagnostic: (d) => diagnostics.push(d),
    });

    proxy.applyEdit({ from: 0, to: 1, insert: "y", expectedVersion: 0 });
    await sleep(60);

    expect(diagnostics.some((d) => d.category === "EDITOR_HOST_DISCONNECTED")).toBe(false);
  });
});

describe("ProxyDocumentHost — dispose", () => {
  test("dispose unsubscribes from the transport (sabotage-provable)", () => {
    let unsubscribeCalls = 0;
    let deliver: ((message: unknown) => void) | undefined;
    const transport = {
      postMessage: () => {},
      onMessage: (listener: (message: unknown) => void) => {
        deliver = listener;
        return () => {
          unsubscribeCalls += 1;
        };
      },
    };
    const proxy = new ProxyDocumentHost({ text: "x", version: 0 }, transport);
    proxy.dispose();
    expect(unsubscribeCalls).toBe(1);

    // Deliveries after dispose must not throw even though nothing is
    // listening internally anymore (the real webview entry also stops
    // calling deliver once it tears down its own message listener; this
    // proves ProxyDocumentHost itself does not choke if one still arrives).
    expect(() => deliver?.({ type: "snapshot", protocolVersion: 1, snapshot: { text: "y", version: 1 } })).not.toThrow();
  });

  test("dispose is idempotent", () => {
    const { transport } = createSimulatedProxyPair("x");
    const proxy = new ProxyDocumentHost({ text: "x", version: 0 }, transport);
    expect(() => {
      proxy.dispose();
      proxy.dispose();
    }).not.toThrow();
  });
});
