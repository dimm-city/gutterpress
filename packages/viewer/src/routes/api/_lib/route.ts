import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { jsonRoute, requireAbsolute, type ErrorClassifier } from './handler';
import { requireWithinProjectRoot } from './fs-guard';

// The declarative route factory (#35/#36/#38). Composes `jsonRoute` with the
// three pieces of boilerplate that used to be hand-copied into every one of
// the ~91 `+server.ts` files: a hooks-bag lookup + its 503, request-body
// validation, and (via `jsonRoute`'s `onError`) friendly error reclassification.
//
// `requireAbsolute` and `requireWithinProjectRoot` (#37 — the fs-route
// project-scoping guard) are re-exported here so a route only needs one
// import line from `../../_lib/route` to reach `defineRoute` +
// `loadLib`/`loadApiLib` + both path checks together.
export { requireAbsolute, requireWithinProjectRoot };

// ── One canonical lib accessor (#35) ─────────────────────────────────────────
//
// Previously the lib was reached three incompatible ways: 23 routes
// bare-imported `@dimm-city/print-md` directly in the handler, others went
// through `getPrefsHooks().loadLib()`, others through `getRemoteHooks().loadLib()`
// — historical drift, not a functional difference (theme/apply direct-imported
// the exact module doctor loaded via hooks). This module is now the one
// `loadLib()` any route reaches for when it needs *only* the lib. Routes that
// also need a specific hooks bag's other host state (tokenStore, readPrefs,
// operationLogPath, …) keep calling `getPrefsHooks()`/`getRemoteHooks()`/
// `getVcsHooks()` for that — but reach for the lib itself through this same
// cached accessor, not `hooks.loadLib()`.
export type LibModule = typeof import('@dimm-city/print-md');

let libPromise: Promise<LibModule> | null = null;

/** Load (and cache) the `@dimm-city/print-md` lib. Never re-imports once resolved. */
export function loadLib(): Promise<LibModule> {
  if (!libPromise) libPromise = import('@dimm-city/print-md');
  return libPromise;
}

/**
 * The narrower `@dimm-city/print-md/api` surface (manifest/style config
 * mutation) used by manifest/* and style/set-active — a distinct package
 * export, not an alternate way to reach the same module as {@link loadLib}.
 */
export type ApiLibModule = typeof import('@dimm-city/print-md/api');

let apiLibPromise: Promise<ApiLibModule> | null = null;

/** Load (and cache) the `@dimm-city/print-md/api` surface. */
export function loadApiLib(): Promise<ApiLibModule> {
  if (!apiLibPromise) apiLibPromise = import('@dimm-city/print-md/api');
  return apiLibPromise;
}

export interface DefineRouteArgs<Body, Hooks> {
  body: Body;
  event: RequestEvent;
  hooks: Hooks;
}

export interface DefineRouteOptions<Body, Hooks> {
  /**
   * Retrieve the route's host hooks bag (e.g. `getPrefsHooks`, `getRemoteHooks`).
   * Called once per request; a falsy return throws the standard 503 with
   * {@link DefineRouteOptions.hooksUnavailableMessage}. Omit for routes that need
   * no host hooks bag (e.g. ones that only call {@link loadLib}).
   */
  hooks?: () => Hooks | null | undefined;
  /** 503 message when `hooks()` is falsy. Defaults to "Hooks not registered". */
  hooksUnavailableMessage?: string;
  /**
   * Validate + narrow the raw parsed body before `call` runs. Throw
   * `error(400, …)` (directly, or via {@link requireAbsolute}) to reject.
   * Omit to pass the parsed body through unchanged.
   */
  validate?: (body: unknown, event: RequestEvent) => Body;
  /** Do the route's actual work. Its return value is serialized with `json()`. */
  call: (args: DefineRouteArgs<Body, Hooks>) => unknown | Promise<unknown>;
  /** See {@link ErrorClassifier} — reclassify a caught error into a specific status. */
  onError?: ErrorClassifier;
}

/**
 * Declarative route factory: owns body parsing (via `jsonRoute`), the
 * hooks-not-registered 503, request validation, and error-envelope mapping,
 * so a route body is just the validation + the one lib/hooks call.
 */
export function defineRoute<Body = unknown, Hooks = undefined>(
  options: DefineRouteOptions<Body, Hooks>,
) {
  return jsonRoute<unknown>(
    async (rawBody, event) => {
      let hooks: Hooks | undefined;
      if (options.hooks) {
        const resolved = options.hooks();
        if (!resolved) error(503, options.hooksUnavailableMessage ?? 'Hooks not registered');
        hooks = resolved;
      }
      const body = options.validate ? options.validate(rawBody, event) : (rawBody as Body);
      return options.call({ body, event, hooks: hooks as Hooks });
    },
    { onError: options.onError },
  );
}
