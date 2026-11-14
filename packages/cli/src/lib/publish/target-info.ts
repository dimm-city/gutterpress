/**
 * What a publish provider takes from the target registry (ADR 0012): its id,
 * its name and the file it receives. A provider spreads this into its `info`
 * and adds only how the file gets there, so a target is named and filed in
 * one place.
 */
import { TARGETS } from "../targets.ts";
import type { PublishProviderInfo } from "./types.ts";

export function targetInfo(id: string): Pick<PublishProviderInfo, "id" | "label" | "format" | "formats"> {
  const target = TARGETS[id];
  if (!target) throw new Error(`No publish target "${id}" in the registry (lib/targets.ts).`);
  return {
    id: target.id,
    label: target.label,
    format: target.format,
    ...(target.formats ? { formats: [...target.formats] } : {}),
  };
}
