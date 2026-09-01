/**
 * System diagnostics capability (SFE-P5c4) — replaces `api.doctor()`.
 *
 * Consumed by `HelpContent.svelte` (Help & About system-info panel),
 * `NewProjectWizard.svelte` (qpdf/Ghostscript availability for the
 * publish-target compliance note), and `+page.svelte` (Help tab tool list +
 * app version). Typed IPC through the shared bridge — no fetch plumbing.
 */
import { bridge } from "$lib/platform/bridge";
import type { DoctorDiagnostics } from "$lib/platform/dtos";

/** System + tool diagnostics (tool paths, versions, Chromium/Electron info). */
export function getDoctorDiagnostics(): Promise<DoctorDiagnostics> {
  return bridge().doctor.getDiagnostics();
}
