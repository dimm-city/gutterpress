/**
 * Type-level regression guard (work item P1 / api-dto-import-type; extended
 * for ARCH review #40).
 *
 * `src/lib/api.ts` must consume the shared contract DTOs, not local
 * re-declarations that can silently drift from the host/renderer source of
 * truth, and must not re-loosen a server route's return type to `unknown`/
 * `Record<string, unknown>`/an inline object literal that happens to
 * structurally match today. This file fails `svelte-check` if
 * `ProjectRemoteDiagnosis.classification` regresses back to `any` — the exact
 * drift work item P1 fixed — or if any of the endpoints below drifts away
 * from its DTO (loosens to `any`/`unknown`, or stops matching exactly).
 *
 * Types only: fully erased at build, no runtime, no `@dimm-city/print-md` value
 * import (§8 renderer purity). `import type { api }` binds `api` for use only
 * in type positions (`typeof api.…`) — no value import, no bundle cost.
 */
import type { api, ProjectRemoteDiagnosis } from "./api";
import type { ProjectSource } from "./platform/shared-types";
import type { ViewerPrefs, ProjectState, CreateProjectResult } from "./platform/contract";
import type { ProjectClassification, DoctorDiagnostics } from "./platform/dtos";

/** Resolves to `true` only for the `any` type. */
type IsAny<T> = 0 extends 1 & T ? true : false;

/** `true` only when `A` and `B` are mutually assignable (structurally identical). */
type IsExactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Fails to compile unless `T` is neither `any` NOR bare `unknown`, and is
 * exactly `Want` (mutual assignability — `IsExactly` already rejects bare
 * `unknown` against any concrete `Want`, so the `IsAny` check only needs to
 * additionally rule out the `any` decay `IsExactly` can't see).
 */
type AssertDto<T, Want> = IsAny<T> extends true
  ? never
  : IsExactly<T, Want> extends true
    ? true
    : never;

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

// ── ARCH review #40: endpoints that used to return `unknown` /
// `Record<string, unknown>` / a hand-inlined literal must stay pinned to
// their real DTO. ─────────────────────────────────────────────────────────

type ClassifyProjectT = Awaited<ReturnType<typeof api.app.classifyProject>>;
export const _classifyProjectIsProjectClassification: AssertDto<
  ClassifyProjectT,
  ProjectClassification
> = true;

type GetViewerPrefsT = Awaited<ReturnType<typeof api.app.getViewerPrefs>>;
export const _getViewerPrefsIsViewerPrefs: AssertDto<GetViewerPrefsT, ViewerPrefs> = true;

type GetViewerProjectStateT = Awaited<ReturnType<typeof api.app.getViewerProjectState>>;
export const _getViewerProjectStateIsProjectStateOrNull: AssertDto<
  GetViewerProjectStateT,
  ProjectState | null
> = true;

type CreateProjectT = Awaited<ReturnType<typeof api.app.createProject>>;
export const _createProjectIsCreateProjectResult: AssertDto<
  CreateProjectT,
  CreateProjectResult
> = true;

type AdoptFolderT = Awaited<ReturnType<typeof api.app.adoptFolder>>;
export const _adoptFolderIsCreateProjectResult: AssertDto<
  AdoptFolderT,
  CreateProjectResult
> = true;

type DoctorT = Awaited<ReturnType<typeof api.doctor>>;
export const _doctorIsDoctorDiagnostics: AssertDto<DoctorT, DoctorDiagnostics> = true;
