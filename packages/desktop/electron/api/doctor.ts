/**
 * System diagnostics IPC handler for the "doctor" capability (SFE-P5c4).
 * Ports `src/routes/api/doctor/+server.ts` verbatim: same bundled-Chromium
 * synthetic entry (filtered by the stable `id`, not the human-readable `bin`
 * label — L10), same `desktopVersion`/`electronVersion`/`chromeVersion`
 * fields layered onto the lib's own `getSystemDiagnostics()` result.
 *
 * `getDoctorHooks()` was never wrapped in a `hooks:` gate by the route (no
 * 503 branch) — a missing hooks bag degrades `desktopVersion` to "unknown"
 * instead of failing the whole call, preserved here unchanged.
 */
import { getDoctorHooks } from "../server-bridge/host-hooks";
import { loadLib } from "./lib-loader";
import type { DoctorDiagnostics, DoctorToolStatus } from "../../src/lib/platform/dtos";
import type { SecureHandle } from "../server-bridge/secure-handle";

interface LibSystemDiagnostics {
  libVersion: string;
  platform: { os: string; arch: string; release: string; node: string };
  tools: DoctorToolStatus[];
  configDir: string;
  docsUrl: string;
}

interface DoctorLibModule {
  getSystemDiagnostics: () => Promise<LibSystemDiagnostics>;
}

/** System + tool diagnostics for the Help dialog and New Project wizard. */
export async function doctorGetDiagnostics(): Promise<DoctorDiagnostics> {
  const lib = (await loadLib()) as unknown as DoctorLibModule;
  const diag = await lib.getSystemDiagnostics();

  const doctorHooks = getDoctorHooks();

  // Filter on the stable machine id, not the human-readable `bin` display
  // string — rewording the label must not silently stop excluding the
  // bundled-Chromium entry from the "external tools" list (UX L10).
  const externalTools = diag.tools.filter((tool) => tool.id !== "chromium");

  return {
    ...diag,
    tools: [
      {
        id: "electron-chromium",
        name: "Chromium (built-in via Electron)",
        bin: "electron",
        found: true,
        path: "Bundled with the desktop app",
        version: process.versions.chrome,
        usedBy: [{ feature: "Preview rendering and Save PDF", severity: "required" as const }],
        installHint: "No setup required in the desktop app.",
      },
      ...externalTools,
    ],
    desktopVersion: doctorHooks ? doctorHooks.getDesktopVersion() : "unknown",
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
  };
}

/** Register the doctor:* IPC channels (SFE-P6b). */
export function registerDoctorHandlers(secureHandle: SecureHandle): void {
  secureHandle("doctor:getDiagnostics", () => doctorGetDiagnostics());
}
