/**
 * Generic globalThis-backed service-locator factory.
 *
 * The SvelteKit handler and main.ts run in the same Node.js process but in
 * separate Vite bundles, so live references are shared through globalThis.
 * Every `server-bridge/*-hooks.ts` module used to call this directly, one
 * `createHostBridge(uniqueKey)` per domain (11 independent globalThis keys —
 * ARCH review #31). They now all funnel through ONE shared instance,
 * `./host-services.ts`'s `registerHostServices`/`getHostServices`
 * (`__gutterpressHost__`), and each domain module's `getXHooks()` is a thin
 * selector over that single object instead of its own bridge. This factory
 * itself is unchanged and still generic — reach for it directly only if a
 * genuinely separate globalThis slot is ever needed again.
 *
 * register(hooks) writes; get() reads. get() returns null (never undefined)
 * before the first register() call.
 */
export function createHostBridge<T>(globalKey: string): {
  register(hooks: T): void;
  get(): T | null;
} {
  const store = globalThis as unknown as Record<string, T | undefined>;
  return {
    register(hooks: T): void {
      store[globalKey] = hooks;
    },
    get(): T | null {
      return store[globalKey] ?? null;
    },
  };
}
