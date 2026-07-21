import { expect, test } from "bun:test";
import {
  mapRecoveryResultToEmit,
  type RecoveryEmit,
} from "../../electron/auto-sync/recovery-emit";
import type { RecoveryResult } from "@dimm-city/print-md";

const ARGS = {
  projectDir: "/book",
  lastSyncAt: "2024-01-01T00:00:00.000Z",
  logFile: "/logs/book.log",
  authlessNeedsUserAs: "auth" as const,
};

const guidance = { title: "t", body: "b" } as unknown as RecoveryResult extends {
  guidance: infer G;
}
  ? G
  : never;

test("recovered maps to a recovered status carrying backupZipPath + logFile", () => {
  const em: RecoveryEmit = mapRecoveryResultToEmit(
    { status: "recovered", message: "ok", backupZipPath: "/b.zip" },
    ARGS,
  );
  expect(em.kind).toBe("recovered");
  expect(em.status.state).toBe("recovered");
  expect(em.status.projectDir).toBe("/book");
  expect(em.status.lastSyncAt).toBe(ARGS.lastSyncAt);
  expect(em.status.backupZipPath).toBe("/b.zip");
  expect(em.status.logFile).toBe("/logs/book.log");
  expect(em.retryAfterMs).toBeUndefined();
});

test("retry_later maps to an offline status and surfaces the requested delay", () => {
  const em = mapRecoveryResultToEmit(
    { status: "retry_later", message: "later", retryAfterMs: 5000 },
    ARGS,
  );
  expect(em.kind).toBe("retry_later");
  expect(em.status.state).toBe("offline");
  expect(em.status.projectDir).toBe("/book");
  expect(em.status.lastSyncAt).toBe(ARGS.lastSyncAt);
  expect(em.retryAfterMs).toBe(5000);
  // offline payload never carries a logFile
  expect(em.status.logFile).toBeUndefined();
});

test("retry_later defaults the delay to 60s when the handler omits it", () => {
  const em = mapRecoveryResultToEmit(
    { status: "retry_later", message: "later" } as unknown as RecoveryResult,
    ARGS,
  );
  expect(em.retryAfterMs).toBe(60_000);
});

test("needs_user WITH conflict files (text-merge shape, no ids) maps to a conflict status with ids absent", () => {
  const files = [{ path: "a.md" }] as unknown as RecoveryResult extends {
    files?: infer F;
  }
    ? F
    : never;
  const em = mapRecoveryResultToEmit(
    { status: "needs_user", message: "m", guidance, files },
    ARGS,
  );
  expect(em.kind).toBe("conflict");
  expect(em.status.state).toBe("conflict");
  // L12: isBinary is attached per file using the host-authoritative extension
  // classifier (isConflictFileBinary) — ".md" is not binary.
  expect(em.status.files).toEqual([{ path: "a.md", isBinary: false }]);
  expect(em.status.logFile).toBe("/logs/book.log");
  // M13: the text-merge conflict builder (outcome-mapping.ts) doesn't compute
  // a local/remote tip pair, so this RecoveryResult genuinely has none to
  // forward — ids stay absent and the renderer's fallback fetch path handles
  // it (conflictPending/conflictFetchFailed in sync-controller.svelte.ts).
  expect(em.status.localId).toBeUndefined();
  expect(em.status.remoteId).toBeUndefined();
});

test("needs_user WITH conflict files (binary-conflict shape, with ids) forwards localId/remoteId", () => {
  const files = [{ path: "a.docx" }] as unknown as RecoveryResult extends {
    files?: infer F;
  }
    ? F
    : never;
  const em = mapRecoveryResultToEmit(
    {
      status: "needs_user",
      message: "m",
      guidance,
      files,
      localId: "local-oid-1",
      remoteId: "remote-oid-1",
    },
    ARGS,
  );
  expect(em.kind).toBe("conflict");
  expect(em.status.state).toBe("conflict");
  expect(em.status.files).toEqual([{ path: "a.docx", isBinary: true }]);
  // M13: the binary-conflict recovery producer (recover-binary-conflict.ts)
  // threads its conflict tip OIDs onto the RecoveryResult — recovery-emit
  // must forward them so ConflictChoicesDialog gets the fast path instead of
  // an unnecessary second syncChanges round-trip.
  expect(em.status.localId).toBe("local-oid-1");
  expect(em.status.remoteId).toBe("remote-oid-1");
});

test("needs_user WITH conflict files and only ONE id present forwards just that one", () => {
  const files = [{ path: "a.docx" }] as unknown as RecoveryResult extends {
    files?: infer F;
  }
    ? F
    : never;
  const em = mapRecoveryResultToEmit(
    { status: "needs_user", message: "m", guidance, files, localId: "local-oid-only" },
    ARGS,
  );
  expect(em.status.localId).toBe("local-oid-only");
  expect(em.status.remoteId).toBeUndefined();
});

test("needs_user WITHOUT files maps to auth when authlessNeedsUserAs='auth' (orchestrator)", () => {
  const em = mapRecoveryResultToEmit(
    { status: "needs_user", message: "m", guidance },
    { ...ARGS, authlessNeedsUserAs: "auth" },
  );
  expect(em.kind).toBe("auth");
  expect(em.status.state).toBe("auth");
  expect(em.status.projectDir).toBe("/book");
  expect(em.status.lastSyncAt).toBe(ARGS.lastSyncAt);
});

test("needs_user WITHOUT files maps to error when authlessNeedsUserAs='error' (preview preflight)", () => {
  const em = mapRecoveryResultToEmit(
    { status: "needs_user", message: "m", guidance },
    { ...ARGS, authlessNeedsUserAs: "error" },
  );
  expect(em.kind).toBe("error");
  expect(em.status.state).toBe("error");
  expect(em.status.guidance).toBe(guidance);
  expect(em.status.logFile).toBe("/logs/book.log");
});

test("blocked maps to an error status with guidance", () => {
  const em = mapRecoveryResultToEmit(
    { status: "blocked", message: "m", guidance, backupZipPath: "/b.zip" },
    ARGS,
  );
  expect(em.kind).toBe("error");
  expect(em.status.state).toBe("error");
  // The plain-language recovery message rides the payload so the renderer can
  // show it (the ambient pill's tooltip), not just the guidance dialog.
  expect(em.status.message).toBe("m");
  expect(em.status.guidance).toBe(guidance);
  expect(em.status.backupZipPath).toBe("/b.zip");
  expect(em.status.logFile).toBe("/logs/book.log");
});

test("failed_backup_available maps to error carrying the backup zip", () => {
  const em = mapRecoveryResultToEmit(
    { status: "failed_backup_available", message: "m", guidance, backupZipPath: "/z.zip" },
    ARGS,
  );
  expect(em.kind).toBe("error");
  expect(em.status.backupZipPath).toBe("/z.zip");
});

test("failed_no_changes_made maps to error with no backup zip", () => {
  const em = mapRecoveryResultToEmit(
    { status: "failed_no_changes_made", message: "m", guidance },
    ARGS,
  );
  expect(em.kind).toBe("error");
  expect(em.status.backupZipPath).toBeUndefined();
});
