/**
 * System diagnostics capability (SFE-P5c4) — replaces `api.doctor()`.
 *
 * Consumed by `HelpContent.svelte` (Help & About system-info panel),
 * `NewProjectWizard.svelte` (qpdf/Ghostscript availability for the
 * publish-target compliance note), and `+page.svelte` (Help tab tool list +
 * app version). Typed IPC through the shared bridge — no fetch plumbing.
 *
 * Error semantics (run rule 2, repair round 1): scrubs the Electron IPC
 * transport prefix (`friendlyHostError`) off a rejection before re-throwing
 * — the same discipline every other capability module uses, so
 * `HelpContent.svelte`'s `e instanceof Error ? e.message : …` never shows an
 * author `Error invoking remote method 'doctor:getDiagnostics': …`.
 * `async function` (not a plain function returning the bridge call) also
 * turns `bridge()`'s SYNCHRONOUS off-host throw into a rejected promise, so
 * `+page.svelte`'s `getDoctorDiagnostics().then().catch(() => {})` — which
 * has no surrounding `try` — actually catches the off-host case.
 */
import { bridge } from "$lib/platform/bridge";
import { hostCall } from "$lib/errors";
import type { DoctorDiagnostics } from "$lib/platform/dtos";

/** System + tool diagnostics (tool paths, versions, Chromium/Electron info). */
export async function getDoctorDiagnostics(): Promise<DoctorDiagnostics> {
  return hostCall(bridge().doctor.getDiagnostics());
}
