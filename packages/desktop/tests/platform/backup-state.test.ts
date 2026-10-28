import { describe, expect, test } from "bun:test";
import { backupState, onlineCopyName } from "../../src/lib/backup-state";
import type { ProjectRemoteDiagnosis } from "../../src/lib/platform/contract";

type Diag = Pick<ProjectRemoteDiagnosis, "classification" | "guidance" | "remoteUrl">;
const git = { type: "local-git-folder", path: "/b", repoRoot: "/b", subPath: "", hasRemote: true } as const;

describe("backupState", () => {
  test("a plain folder has no versions, whatever else is true", () => {
    const d: Diag = { classification: { type: "local-folder", path: "/b" }, guidance: "local-only" };
    expect(backupState(d)).toBe("no-versions");
  });

  test("versions with no online copy is the set-up state", () => {
    expect(backupState({ classification: { ...git, hasRemote: false }, guidance: "local-only" })).toBe("local-only");
  });

  test("each remote guidance maps to its state", () => {
    const at = (guidance: Diag["guidance"]) =>
      backupState({ classification: git, guidance, remoteUrl: "https://example.com/a/b.git" });
    expect(at("connect-github-to-sync")).toBe("connect-github");
    expect(at("https-connect-server")).toBe("connect-server");
    expect(at("ready-to-sync")).toBe("ready");
    expect(at("ssh-use-own-tools")).toBe("own-tools");
  });

  test("a remote that is neither https nor SSH is never offered a new online copy", () => {
    expect(backupState({ classification: git, guidance: "local-only", remoteUrl: "/srv/git/book.git" })).toBe("own-tools");
  });
});

describe("onlineCopyName", () => {
  test("drops the scheme and the .git suffix", () => {
    expect(onlineCopyName("https://github.com/ada/harbor-lights.git")).toBe("github.com/ada/harbor-lights");
    expect(onlineCopyName("https://git.example.com/team/book/")).toBe("git.example.com/team/book");
  });

  test("drops a user name in the address", () => {
    expect(onlineCopyName("https://ada@dev.azure.com/org/proj/_git/book")).toBe("dev.azure.com/org/proj/_git/book");
  });
});
