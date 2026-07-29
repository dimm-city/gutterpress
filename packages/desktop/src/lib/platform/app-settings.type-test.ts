/**
 * Type-level regression guard (ARCH #29): the Electron host and the
 * SvelteKit renderer must see the IDENTICAL `AppSettings` shape.
 *
 * Both sides used to hand-declare their own `AppSettings` interface
 * (`electron/settings-store.ts` and `src/lib/platform/contract.ts`, "kept in
 * sync manually") — a ~40-field structure that could (and once did) drift.
 * Both now `import type` the single canonical declaration from
 * `src/lib/platform/shared-types.ts` (the renderer directly; the host via
 * `electron/bridge-types.ts`'s type-only re-export). This file fails
 * `svelte-check` if either side ever reintroduces a local, independently-
 * editable `AppSettings` declaration that stops matching the other.
 *
 * Types only: fully erased at build (`import type`), zero runtime, no
 * `gutterpress` value import (§8 renderer purity). Importing a TYPE
 * from `electron/bridge-types.ts` produces zero bundle output — `import type`
 * is erased under `verbatimModuleSyntax`/`isolatedModules`, so this crosses
 * the host/renderer folder boundary at zero cost, purely for the compiler.
 */
import type { AppSettings as RendererAppSettings } from "./contract";
import type { AppSettings as HostAppSettings } from "../../../electron/bridge-types";

/** Resolves to `true` only for the `any` type (catches a silent `any` drift). */
type IsAny<T> = 0 extends 1 & T ? true : false;

// Neither side's AppSettings may have decayed to `any`.
export const _rendererAppSettingsIsNotAny: IsAny<RendererAppSettings> extends true
  ? never
  : true = true;
export const _hostAppSettingsIsNotAny: IsAny<HostAppSettings> extends true
  ? never
  : true = true;

// Mutual assignability: the host and renderer AppSettings must be exactly
// the same shape, not just overlapping supersets of each other.
export const _appSettingsIdenticalAcrossHostAndRenderer: [
  RendererAppSettings,
] extends [HostAppSettings]
  ? [HostAppSettings] extends [RendererAppSettings]
    ? true
    : never
  : never = true;
