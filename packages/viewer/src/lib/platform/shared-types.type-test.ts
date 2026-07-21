/**
 * Type-level drift guard (audit D8).
 *
 * `shared-types.ts` hand-mirrors the lib's `ProjectSource` /
 * `ProjectCapabilities` so the SPA never value-imports `@dimm-city/print-md`
 * (§8). But `contract.ts` type-imports those two shapes straight FROM the lib,
 * so the mirror and the lib are two independently-editable copies of the same
 * structure. Nothing forced them to stay identical — this file does: it fails
 * `svelte-check` the moment either shape stops being mutually assignable with
 * the other. The same guard now also pins the `RemoteAccessFailureReason`
 * mirrors (see the section below).
 *
 * Types only: `import type` is fully erased at build (zero runtime, no
 * `@dimm-city/print-md` value import, §8-clean), exactly like the sibling
 * `app-settings.type-test.ts`. It reaches into the lib's TYPE surface purely
 * for the compiler.
 */
import type {
  ProjectSource as LibProjectSource,
  ProjectCapabilities as LibProjectCapabilities,
  RemoteAccessFailureReason as LibRemoteAccessFailureReason,
} from "@dimm-city/print-md";
import type {
  ProjectSource as MirrorProjectSource,
  ProjectCapabilities as MirrorProjectCapabilities,
  RemoteAccessResult as MirrorRemoteAccessResult,
} from "./shared-types";
import type { RemoteAccessFailureReason as MirrorRemoteAccessFailureReason } from "./dtos";

/** Resolves to `true` only for `any` (catches a silent decay to `any`). */
type IsAny<T> = 0 extends 1 & T ? true : false;

export const _mirrorProjectSourceIsNotAny: IsAny<MirrorProjectSource> extends true
  ? never
  : true = true;
export const _mirrorProjectCapabilitiesIsNotAny: IsAny<MirrorProjectCapabilities> extends true
  ? never
  : true = true;

// Mutual assignability: a REQUIRED field added to one side and not the other
// fails here before it can produce a runtime DTO mismatch. KNOWN LIMIT (review
// finding): assignability alone cannot catch a drift in OPTIONAL properties
// (missing vs extra optional props are assignable both ways) — the key-set
// checks below close that hole where the shapes allow it.
export const _projectSourceMirrorsLib: [LibProjectSource] extends [MirrorProjectSource]
  ? [MirrorProjectSource] extends [LibProjectSource]
    ? true
    : never
  : never = true;

export const _projectCapabilitiesMirrorsLib: [LibProjectCapabilities] extends [
  MirrorProjectCapabilities,
]
  ? [MirrorProjectCapabilities] extends [LibProjectCapabilities]
    ? true
    : never
  : never = true;

// Exact key sets — catches optional-property drift that mutual assignability
// misses. For the ProjectSource union, `keyof` distributes over each variant
// via the mapped-union helper so a new optional field on ANY variant of either
// side breaks the corresponding check.
type KeysMatch<A, B> = [Exclude<keyof A, keyof B>] extends [never]
  ? [Exclude<keyof B, keyof A>] extends [never]
    ? true
    : never
  : never;
type VariantKeyUnion<T> = T extends unknown ? keyof T : never;

export const _projectCapabilitiesKeysMatch: KeysMatch<
  LibProjectCapabilities,
  MirrorProjectCapabilities
> = true;

// ── RemoteAccessFailureReason (audit follow-up) ──────────────────────────────
// Two hand-mirrored copies of the lib's failure-reason union exist in the
// viewer: `dtos.ts`'s named `RemoteAccessFailureReason` alias and the inline
// `reason` union inside `shared-types.ts`'s `RemoteAccessResult`. Both drifted
// when the lib gained "insecure-transport" — these pins make the NEXT added
// (or removed) member fail typecheck instead. For a pure string-literal union,
// mutual assignability alone is exact: any member present on one side only
// breaks one direction.
export const _remoteAccessFailureReasonIsNotAny: IsAny<MirrorRemoteAccessFailureReason> extends true
  ? never
  : true = true;

export const _remoteAccessFailureReasonMirrorsLib: [
  LibRemoteAccessFailureReason,
] extends [MirrorRemoteAccessFailureReason]
  ? [MirrorRemoteAccessFailureReason] extends [LibRemoteAccessFailureReason]
    ? true
    : never
  : never = true;

/** The `reason` union inside the failure arm of shared-types' RemoteAccessResult. */
type MirrorRemoteAccessResultReason = Extract<MirrorRemoteAccessResult, { ok: false }>["reason"];

export const _remoteAccessResultReasonMirrorsLib: [LibRemoteAccessFailureReason] extends [
  MirrorRemoteAccessResultReason,
]
  ? [MirrorRemoteAccessResultReason] extends [LibRemoteAccessFailureReason]
    ? true
    : never
  : never = true;

export const _projectSourceVariantKeysMatch: [
  Exclude<VariantKeyUnion<LibProjectSource>, VariantKeyUnion<MirrorProjectSource>>,
] extends [never]
  ? [Exclude<VariantKeyUnion<MirrorProjectSource>, VariantKeyUnion<LibProjectSource>>] extends [
      never,
    ]
    ? true
    : never
  : never = true;
