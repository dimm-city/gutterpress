/**
 * Generic globalThis-backed service-locator factory.
 *
 * Through SFE-P5c3, the SvelteKit handler that used to share this process
 * (deleted SFE-P5d) ran in a separate Vite bundle from main.ts, so live
 * references were shared through globalThis rather than a plain import. That
 * constraint is gone now that every consumer is an `electron/api/*.ts`
 * module in main's own bundle, but the shared-globalThis shape survives as
 * the established pattern. Every `server-bridge/*-hooks.ts` module used to
 * call this directly, one `createHostBridge(uniqueKey)` per domain (11
 * independent globalThis keys —
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
