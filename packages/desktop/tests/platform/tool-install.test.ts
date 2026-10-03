import { describe, test, expect } from "bun:test";
import { planToolInstall } from "../../src/lib/server/tool-install";

const only = (...bins: string[]) => (b: string) => bins.includes(b);

describe("planToolInstall", () => {
  test("linux package managers, in apt > dnf > pacman order, via pkexec", () => {
    expect(planToolInstall("gs", "linux", only("apt-get", "dnf"))).toEqual({
      command: "pkexec", args: ["apt-get", "install", "-y", "ghostscript"], label: "Install with apt",
    });
    expect(planToolInstall("qpdf", "linux", only("dnf"))).toEqual({
      command: "pkexec", args: ["dnf", "install", "-y", "qpdf"], label: "Install with dnf",
    });
    expect(planToolInstall("gs", "linux", only("pacman"))).toEqual({
      command: "pkexec", args: ["pacman", "-S", "--noconfirm", "ghostscript"], label: "Install with pacman",
    });
  });

  test("macOS uses Homebrew", () => {
    expect(planToolInstall("qpdf", "darwin", only("brew"))).toEqual({
      command: "brew", args: ["install", "qpdf"], label: "Install with Homebrew",
    });
  });

  test("Windows uses winget with the package ids", () => {
    const gs = planToolInstall("gs", "win32", only("winget"));
    expect(gs?.args).toEqual([
      "install", "--id", "ArtifexSoftware.GhostScript", "-e",
      "--accept-source-agreements", "--accept-package-agreements",
    ]);
    expect(planToolInstall("qpdf", "win32", only("winget"))?.args).toContain("QPDF.QPDF");
    expect(gs?.label).toBe("Install with winget");
  });

  test("null when no manager is available or the platform is unsupported", () => {
    expect(planToolInstall("gs", "linux", only())).toBeNull();
    expect(planToolInstall("gs", "darwin", only())).toBeNull();
    expect(planToolInstall("gs", "win32", only())).toBeNull();
    expect(planToolInstall("gs", "freebsd", only("apt-get", "brew", "winget"))).toBeNull();
  });
});

