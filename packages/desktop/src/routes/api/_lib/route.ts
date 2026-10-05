import type { RequestEvent } from '@sveltejs/kit';
import { jsonRoute, requireAbsolute, type ErrorClassifier } from './handler';
import { requireContainedOrPicked, requireProjectDir, requireWithinProjectRoot } from './fs-guard';
import { getHostServices } from '../../../../electron/server-bridge/host-services';

// The declarative route factory (#35/#36/#38). Composes `jsonRoute` with the
// boilerplate that used to be hand-copied into every `+server.ts` file:
// request-body validation and (via `jsonRoute`'s `onError`) friendly error
// reclassification.
//
// `requireAbsolute`, `requireWithinProjectRoot`, `requireProjectDir` and
// `requireContainedOrPicked` (#37 — the fs-route project-scoping guard) and
// `getHostServices` (the host seam, `electron/server-bridge/host-services.ts`)
// are re-exported here so a route only needs one import line from
// `../../_lib/route` to reach `defineRoute` + `loadLib`/`loadApiLib` + the host
// + the path checks together. `requireProjectDir` is the one to reach for when
// the parameter is a `projectDir` (absolute AND inside the open project);
// `requireContainedOrPicked` for a path that may be in-project OR dialog-picked
// (an upload artifact, a reveal target).
export { getHostServices, requireAbsolute, requireContainedOrPicked, requireProjectDir, requireWithinProjectRoot };

// ── One canonical lib accessor (#35) ─────────────────────────────────────────
//
// Routes and main.ts load the same workspace `gutterpress` package (it is
// `ssr.external` in vite.config.ts), so this is the ONE `loadLib()` any route
// reaches for, typed as the real module.
export type LibModule = typeof import('gutterpress');

let libPromise: Promise<LibModule> | null = null;
let libLoader: () => Promise<LibModule> = () => import('gutterpress');

/** Load (and cache) the `gutterpress` lib. Never re-imports once resolved. */
export function loadLib(): Promise<LibModule> {
  if (!libPromise) libPromise = libLoader();
  return libPromise;
}

/**
 * Test seam: make {@link loadLib} resolve `lib` (a partial module of fakes)
 * instead of the real package; `null` restores the real import. Route suites
 * use it to fake the lib the routes under test reach for.
 */
export function setLibForTests(lib: Partial<LibModule> | (() => Promise<Partial<LibModule>>) | null): void {
  libPromise = null;
  libLoader = lib === null
    ? () => import('gutterpress')
    : typeof lib === 'function'
      ? () => lib().then((m) => m as LibModule)
      : () => Promise.resolve(lib as LibModule);
}

/**
 * The narrower `gutterpress/api` surface (manifest/style config
 * mutation) used by manifest/* and style/set-active — a distinct package
 * export, not an alternate way to reach the same module as {@link loadLib}.
 */
export type ApiLibModule = typeof import('gutterpress/api');

let apiLibPromise: Promise<ApiLibModule> | null = null;

/** Load (and cache) the `gutterpress/api` surface. */
export function loadApiLib(): Promise<ApiLibModule> {
  if (!apiLibPromise) apiLibPromise = import('gutterpress/api');
  return apiLibPromise;
}

interface DefineRouteArgs<Body> {
  body: Body;
  event: RequestEvent;
}

export interface DefineRouteOptions<Body> {
  /**
   * Validate + narrow the raw parsed body before `call` runs. Throw
   * `error(400, …)` (directly, or via {@link requireAbsolute}) to reject.
   * Omit to pass the parsed body through unchanged. May return `Body`
   * directly or `Promise<Body>` — routes whose validation calls the async
   * `requireWithinProjectRoot` (symlink-safe containment, P1 review) need
   * `async`; the factory `await`s either shape the same way.
   */
  validate?: (body: unknown, event: RequestEvent) => Body | Promise<Body>;
  /** Do the route's actual work. Its return value is serialized with `json()`. */
  call: (args: DefineRouteArgs<Body>) => unknown | Promise<unknown>;
  /** See {@link ErrorClassifier} — reclassify a caught error into a specific status. */
  onError?: ErrorClassifier;
}

/**
 * Declarative route factory: owns body parsing (via `jsonRoute`), request
 * validation, and error-envelope mapping, so a route body is just the
 * validation + the one lib/host call.
 */
export function defineRoute<Body = unknown>(options: DefineRouteOptions<Body>) {
  return jsonRoute<unknown>(
    async (rawBody, event) => {
      const body = options.validate ? await options.validate(rawBody, event) : (rawBody as Body);
      return options.call({ body, event });
    },
    { onError: options.onError },
  );
}
