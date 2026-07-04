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

test("needs_user WITH conflict files maps to a conflict status", () => {
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
  expect(em.status.files).toEqual([{ path: "a.md" }]);
  expect(em.status.logFile).toBe("/logs/book.log");
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
