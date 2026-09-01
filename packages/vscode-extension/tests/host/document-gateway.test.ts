// Unit tests for src/host/document-gateway.ts (SFE-P3c run spec DETAILS #2,
// behavior table "Document gateway"/"Convergence"/"Host disconnection" rows).
//
// document-gateway.ts imports "vscode" as `import type * as vscode` ONLY
// (erased at compile time — see its header), so this suite needs NO
// `mock.module("vscode", ...)`: it builds a real `DocumentGatewayVscodeApi`
// backed by `../support/fidelity-vscode.ts`'s FIDELITY mock (real
// positionAt/offsetAt/getText/version/applyEdit semantics — see that
// module's own fidelity checklist) plus a `postMessage` spy that records
// every `HostToWebviewMessage` this gateway ever sends.

import { beforeEach, describe, expect, test } from "bun:test";
import type * as vscode from "vscode";
import { DocumentGateway, type DocumentGatewayVscodeApi } from "../../src/host/document-gateway.ts";
import type { HostToWebviewMessage } from "../../src/protocol/messages.ts";
import {
  createFidelityUri,
  FidelityRange,
  FidelitySimulatedWorkspace,
  type FidelityPosition,
  type FidelityWorkspaceEdit,
} from "../support/fidelity-vscode.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wires one `DocumentGateway` over a fresh `FidelitySimulatedWorkspace` and
 *  one document, recording every outbound message and every `log()` call. */
function setup(initialText: string, workspace: FidelitySimulatedWorkspace = new FidelitySimulatedWorkspace()) {
  const sent: HostToWebviewMessage[] = [];
  const logCalls: Array<{ event: string; detail?: Record<string, unknown> }> = [];
  const handle = workspace.createDocument(initialText);

  const api: DocumentGatewayVscodeApi = {
    document: handle.document,
    createWorkspaceEdit: () => workspace.createWorkspaceEdit() as unknown as vscode.WorkspaceEdit,
    createRange: (start, end) =>
      new FidelityRange(
        start as unknown as FidelityPosition,
        end as unknown as FidelityPosition,
      ) as unknown as vscode.Range,
    applyWorkspaceEdit: (edit) => workspace.applyEdit(edit as unknown as FidelityWorkspaceEdit),
    onDidChangeTextDocument: (listener) => workspace.onDidChangeTextDocument(listener),
    onDidCloseTextDocument: (listener) => workspace.onDidCloseTextDocument(listener),
    postMessage: async (message) => {
      sent.push(message);
      return true;
    },
  };

  const gateway = new DocumentGateway(api, (event, detail) => {
    logCalls.push({ event, detail: detail as Record<string, unknown> | undefined });
  });

  return { gateway, handle, workspace, sent, logCalls };
}

describe("DocumentGateway — accepted edit", () => {
  test("applyEdit success: exactly one snapshot reply with the new text/version, document actually mutated", async () => {
    const { gateway, handle, sent } = setup("hello world");
    await gateway.applyEdit({ from: 6, to: 11, insert: "there", expectedVersion: 0 }, 0);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      type: "snapshot",
      protocolVersion: 1,
      snapshot: { text: "hello there", version: 1 },
      baseStamp: 1,
    });
    expect(handle.document.getText()).toBe("hello there");
    expect(handle.document.version).toBe(1);
  });

  test("uses document.positionAt for the offset->Range conversion (proven on multi-line content)", async () => {
    // A hand-rolled/buggy line-arithmetic conversion would splice the wrong
    // substring on multi-line text; a correct positionAt-based conversion
    // replaces exactly the targeted "line2" span on the second line.
    const text = "line0\nline1\nline2\nline3";
    const { gateway, handle } = setup(text);
    const from = text.indexOf("line2");
    const to = from + "line2".length;
    await gateway.applyEdit({ from, to, insert: "REPLACED", expectedVersion: 0 }, 0);
    expect(handle.document.getText()).toBe("line0\nline1\nREPLACED\nline3");
  });
});

describe("DocumentGateway — rejected applyEdit", () => {
  test("workspace.applyEdit returning false: exactly one snapshot reply with the UNCHANGED text, nothing mutated", async () => {
    const { gateway, handle, workspace, sent } = setup("unchanged");
    workspace.rejectNextApply = true;
    await gateway.applyEdit({ from: 0, to: 9, insert: "gone", expectedVersion: 0 }, 0);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      type: "snapshot",
      protocolVersion: 1,
      snapshot: { text: "unchanged", version: 0 },
      baseStamp: 1,
    });
    expect(handle.document.getText()).toBe("unchanged");
    expect(handle.document.version).toBe(0);
  });
});

describe("DocumentGateway — concurrent change (stale base) and invalid-range dry-run rejection", () => {
  test("stale base: exactly one snapshot reply with the CURRENT text; workspace.applyEdit never attempted", async () => {
    const { gateway, handle, workspace, sent } = setup("current text");
    let applyEditCalls = 0;
    const originalApplyEdit = workspace.applyEdit.bind(workspace);
    workspace.applyEdit = async (edit) => {
      applyEditCalls += 1;
      return originalApplyEdit(edit);
    };

    // base 99 does not match the gateway's real current stamp (0) —
    // reconciliation addendum: this, not edit.expectedVersion, is what
    // DocumentGateway.applyEdit uses to detect a concurrent change; see
    // "base stamp bookkeeping" below for the dedicated proof.
    await gateway.applyEdit({ from: 0, to: 7, insert: "X", expectedVersion: 0 }, 99);

    expect(applyEditCalls).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      type: "snapshot",
      protocolVersion: 1,
      snapshot: { text: "current text", version: 0 },
      baseStamp: 1,
    });
    expect(handle.document.getText()).toBe("current text");
  });

  test("invalid-range against the CURRENT live text (to > length): exactly one snapshot reply, nothing mutated", async () => {
    const { gateway, handle, sent } = setup("short");
    await gateway.applyEdit({ from: 0, to: 999, insert: "X", expectedVersion: 0 }, 0);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      type: "snapshot",
      protocolVersion: 1,
      snapshot: { text: "short", version: 0 },
      baseStamp: 1,
    });
    expect(handle.document.getText()).toBe("short");
  });
});

describe("DocumentGateway — base stamp bookkeeping (reconciliation addendum's fix)", () => {
  test("the base stamp starts at 0 and advances by exactly 1 per authoritative snapshot", async () => {
    const { gateway, sent } = setup("abc");
    await gateway.applyEdit({ from: 3, to: 3, insert: "d", expectedVersion: 0 }, 0);
    expect(sent).toHaveLength(1);
    expect((sent[0] as { baseStamp: number }).baseStamp).toBe(1);

    await gateway.applyEdit({ from: 4, to: 4, insert: "e", expectedVersion: 1 }, 1);
    expect(sent).toHaveLength(2);
    expect((sent[1] as { baseStamp: number }).baseStamp).toBe(2);
  });

  test("a base that does not match the CURRENT stamp is rejected without ever calling workspace.applyEdit, even though its own edit range/version would otherwise be valid", async () => {
    const { gateway, handle, workspace, sent } = setup("abc");
    let applyEditCalls = 0;
    const originalApplyEdit = workspace.applyEdit.bind(workspace);
    workspace.applyEdit = async (edit) => {
      applyEditCalls += 1;
      return originalApplyEdit(edit);
    };

    // base 7 has no relationship to the gateway's real stamp (0) — this is
    // exactly the class of bug the addendum fixes: the wire's `base` must
    // be the gateway's OWN stamp space, never conflated with the mirror's
    // local counter or vscode's own TextDocument.version.
    await gateway.applyEdit({ from: 0, to: 3, insert: "X", expectedVersion: 0 }, 7);

    expect(applyEditCalls).toBe(0);
    expect(handle.document.getText()).toBe("abc");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      type: "snapshot",
      protocolVersion: 1,
      snapshot: { text: "abc", version: 0 },
      baseStamp: 1,
    });
  });

  test("expectedVersion is irrelevant to the gateway's own accept/reject decision — only the base stamp is; a real vscode.TextDocument.version is never compared against it", async () => {
    const { gateway, handle, sent } = setup("abc");
    // A wildly wrong expectedVersion (vscode's own document.version is 0,
    // this claims 12345) — with a MATCHING base, the edit still succeeds:
    // exactly what the addendum's "never vscode's TextDocument.version
    // exposed raw, never the mirror's counter" rule requires.
    await gateway.applyEdit({ from: 3, to: 3, insert: "!", expectedVersion: 12345 }, 0);
    expect(handle.document.getText()).toBe("abc!");
    expect(sent).toHaveLength(1);
    expect((sent[0] as { type: string }).type).toBe("snapshot");
  });
});

describe("DocumentGateway — closed document", () => {
  test("applyEdit against an already-closed document: exactly one disconnect reply, no workspace.applyEdit attempted", async () => {
    const { gateway, handle, workspace, sent } = setup("doc text");
    handle.close();
    let applyEditCalls = 0;
    const originalApplyEdit = workspace.applyEdit.bind(workspace);
    workspace.applyEdit = async (edit) => {
      applyEditCalls += 1;
      return originalApplyEdit(edit);
    };

    await gateway.applyEdit({ from: 0, to: 3, insert: "X", expectedVersion: 0 }, 0);

    expect(applyEditCalls).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe("disconnect");
    if (sent[0]?.type === "disconnect") {
      expect(sent[0].diagnostic.category).toBe("EDITOR_HOST_DISCONNECTED");
    }
  });

  test("a second applyEdit after disconnect sends NO further message (idempotent, not silent — no NEW reply, but no throw either)", async () => {
    const { gateway, handle, sent } = setup("doc text");
    handle.close();
    await gateway.applyEdit({ from: 0, to: 3, insert: "X", expectedVersion: 0 }, 0);
    expect(sent).toHaveLength(1);

    await gateway.applyEdit({ from: 0, to: 3, insert: "Y", expectedVersion: 0 }, 0);
    expect(sent).toHaveLength(1); // no second disconnect message — already announced once
  });
});

describe("DocumentGateway — external change broadcast (workspace.onDidChangeTextDocument)", () => {
  test("an external change to THIS document broadcasts exactly one snapshot with the new text", () => {
    const { handle, sent } = setup("before");
    expect(sent).toHaveLength(0);
    handle.externalChange("after");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      type: "snapshot",
      protocolVersion: 1,
      snapshot: { text: "after", version: 1 },
      baseStamp: 1,
    });
  });

  test("closing THIS document while the panel is alive broadcasts exactly one disconnect message", () => {
    const { handle, sent } = setup("doc");
    handle.close();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe("disconnect");
  });
});

describe("DocumentGateway — filters events to THIS document only (sabotage-provable)", () => {
  test("a change to a DIFFERENT document on the same workspace produces NO message for this gateway", () => {
    const workspace = new FidelitySimulatedWorkspace();
    const { sent } = setup("document A text", workspace);
    const otherDocument = workspace.createDocument("document B text", createFidelityUri("/other.md"));

    otherDocument.externalChange("document B changed");

    // If DocumentGateway's `event.document !== this.#api.document` guard
    // were ever deleted, this assertion would fail — see
    // ../support/fidelity-vscode.ts's header for the sabotage record.
    expect(sent).toHaveLength(0);
  });

  test("closing a DIFFERENT document on the same workspace does not disconnect this gateway", () => {
    const workspace = new FidelitySimulatedWorkspace();
    const { sent } = setup("document A text", workspace);
    const otherDocument = workspace.createDocument("document B text", createFidelityUri("/other.md"));

    otherDocument.close();

    expect(sent).toHaveLength(0);
  });
});

describe("DocumentGateway — dispose (sabotage-provable)", () => {
  test("after dispose, an external change to the document no longer broadcasts", () => {
    const { gateway, handle, sent } = setup("before");
    gateway.dispose();
    handle.externalChange("after dispose");
    // If `dispose()` ever stopped calling `this.#changeSubscription.dispose()`,
    // this assertion would fail.
    expect(sent).toHaveLength(0);
  });

  test("after dispose, closing the document no longer broadcasts", () => {
    const { gateway, handle, sent } = setup("before");
    gateway.dispose();
    handle.close();
    expect(sent).toHaveLength(0);
  });

  test("dispose is idempotent — calling it twice does not throw", () => {
    const { gateway } = setup("text");
    expect(() => {
      gateway.dispose();
      gateway.dispose();
    }).not.toThrow();
  });
});

describe("DocumentGateway — order-independent echo suppression (repair round 1, finding \"the gateway's echo suppression depends on an uncited applyEdit/onDidChangeTextDocument ordering\")", () => {
  // `@types/vscode`'s applyEdit doc block does not specify whether
  // onDidChangeTextDocument fires before or after the returned thenable
  // resolves — see fidelity-vscode.ts's own "ORDERING CAVEAT" header. Every
  // assertion below runs under BOTH orderings; PRE-repair, the
  // "after-resolve" runs would have observed a SECOND, spurious snapshot
  // reply for the same accepted edit (verified locally while authoring this
  // fix — reverting document-gateway.ts's #ownChangeAlreadyReported/
  // #lastReportedVersion fix back to the old #applyInProgress-only guard
  // reproduces exactly that: `sent` grows to 2, not 1, under
  // "after-resolve").
  for (const changeEventTiming of ["before-resolve", "after-resolve"] as const) {
    test(`a single accepted edit produces EXACTLY ONE snapshot reply — changeEventTiming="${changeEventTiming}"`, async () => {
      const workspace = new FidelitySimulatedWorkspace({ changeEventTiming });
      const { gateway, handle, sent } = setup("hello world", workspace);

      await gateway.applyEdit({ from: 6, to: 11, insert: "there", expectedVersion: 0 }, 0);
      // For "after-resolve", the deferred onDidChangeTextDocument firing
      // happens on a LATER macrotask than applyEdit's own await chain —
      // give it a turn to run before asserting no second message arrived.
      await sleep(20);

      expect(sent).toHaveLength(1);
      expect(sent[0]).toEqual({
        type: "snapshot",
        protocolVersion: 1,
        snapshot: { text: "hello there", version: 1 },
        baseStamp: 1,
      });
      expect(handle.document.getText()).toBe("hello there");
    });

    test(`two consecutive accepted edits each still produce exactly one reply, with the stamp advancing by exactly 1 each time — changeEventTiming="${changeEventTiming}"`, async () => {
      const workspace = new FidelitySimulatedWorkspace({ changeEventTiming });
      const { gateway, sent } = setup("abc", workspace);

      await gateway.applyEdit({ from: 3, to: 3, insert: "d", expectedVersion: 0 }, 0);
      await sleep(20);
      await gateway.applyEdit({ from: 4, to: 4, insert: "e", expectedVersion: 1 }, 1);
      await sleep(20);

      expect(sent).toHaveLength(2);
      expect((sent[0] as { baseStamp: number }).baseStamp).toBe(1);
      expect((sent[1] as { baseStamp: number }).baseStamp).toBe(2);
    });

    test(`a REJECTED edit (stale base) still replies exactly once — changeEventTiming="${changeEventTiming}"`, async () => {
      const workspace = new FidelitySimulatedWorkspace({ changeEventTiming });
      const { gateway, handle, sent } = setup("current text", workspace);

      await gateway.applyEdit({ from: 0, to: 7, insert: "X", expectedVersion: 0 }, 99);
      await sleep(20);

      expect(sent).toHaveLength(1);
      expect(sent[0]).toEqual({
        type: "snapshot",
        protocolVersion: 1,
        snapshot: { text: "current text", version: 0 },
        baseStamp: 1,
      });
      expect(handle.document.getText()).toBe("current text"); // never mutated
    });
  }
});

describe("DocumentGateway — D15: never logs document text", () => {
  let marker: string;
  beforeEach(() => {
    marker = `UNIQUE_MARKER_${Math.random().toString(36).slice(2)}`;
  });

  test("no log() call's detail ever contains the document's own content", async () => {
    const { gateway, handle, logCalls } = setup(`before ${marker} content`);
    await gateway.applyEdit({ from: 0, to: 6, insert: "AFTER ", expectedVersion: 0 }, 0);
    handle.externalChange(`external ${marker} change`);

    const serialized = JSON.stringify(logCalls);
    expect(serialized.includes(marker)).toBe(false);
  });
});
