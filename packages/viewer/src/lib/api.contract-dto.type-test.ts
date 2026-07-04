/**
 * Type-level regression guard (work item P1 / api-dto-import-type).
 *
 * `src/lib/api.ts` must consume the shared contract DTOs, not local
 * re-declarations that can silently drift from the host/renderer source of
 * truth. This file fails `svelte-check` if `ProjectRemoteDiagnosis.classification`
 * regresses back to `any` — the exact drift this work item fixed — or if the
 * api-exported DTO stops matching the shared `ProjectSource`.
 *
 * Types only: fully erased at build, no runtime, no `@dimm-city/print-md` value
 * import (§8 renderer purity).
 */
import type { ProjectRemoteDiagnosis } from "./api";
import type { ProjectSource } from "./platform/shared-types";

/** Resolves to `true` only for the `any` type. */
type IsAny<T> = 0 extends 1 & T ? true : false;

type ClassificationT = ProjectRemoteDiagnosis["classification"];

// RED when `classification` is `any` (IsAny → true → the annotation is `never`,
// and `true` is not assignable to `never`); GREEN once it is `ProjectSource`.
export const _classificationIsNotAny: IsAny<ClassificationT> extends true
  ? never
  : true = true;

// `classification` must be exactly `ProjectSource` (mutual assignability).
export const _classificationIsProjectSource: [ClassificationT] extends [ProjectSource]
  ? [ProjectSource] extends [ClassificationT]
    ? true
    : never
  : never = true;
