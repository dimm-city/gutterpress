/**
 * Canonical per-tool install-hint copy — the text a stuck non-technical
 * author actually reads when a build fails because gs/qpdf/Chromium isn't
 * installed.
 *
 * This is the single source of truth. `build-preflight.ts` (preflight error),
 * `diagnostics.ts` (desktop Help/About dialog + `gutterpress doctor`), and
 * `chromium.ts` (`requireChromiumExecutable`'s thrown error) all import
 * from here instead of hand-copying the per-platform install commands —
 * previously three diverging copies existed (see
 * docs/reviews/2026-07-10-architecture-critical-review.md, finding #15).
 */

export interface InstallHint {
  /** Human label for the tool, used in "Install <label>:" headers. */
  label: string;
  /** Indented, per-platform install commands. No header, no trailing newline. */
  body: string;
}

export const INSTALL_HINTS: Record<"chromium" | "gs" | "qpdf", InstallHint> = {
  chromium: {
    label: "Google Chrome, Chromium, or Microsoft Edge",
    body:
      "  macOS:   brew install --cask google-chrome\n" +
      "  Ubuntu:  sudo apt install -y chromium-browser\n" +
      "  Windows: https://www.google.com/chrome/  (Edge is auto-detected if pre-installed)",
  },
  gs: {
    label: "Ghostscript",
    body:
      "  macOS:   brew install ghostscript\n" +
      "  Ubuntu:  sudo apt install -y ghostscript\n" +
      "  Windows: https://www.ghostscript.com/releases/gsdnld.html  (standard installs are auto-detected; or: choco install ghostscript)",
  },
  qpdf: {
    label: "qpdf",
    body:
      "  macOS:   brew install qpdf\n" +
      "  Ubuntu:  sudo apt install -y qpdf\n" +
      "  Windows: choco install qpdf  (or: https://github.com/qpdf/qpdf/releases)",
  },
};

/** "Install <label>:\n<body>" — the full standalone hint (diagnostics/doctor). */
export function fullInstallHint(tool: keyof typeof INSTALL_HINTS): string {
  const hint = INSTALL_HINTS[tool];
  return `Install ${hint.label}:\n${hint.body}`;
}
