/**
 * Shared service-locator factory for the server-bridge/*-hooks.ts modules.
 *
 * The SvelteKit handler and main.ts run in the same Node.js process but in
 * separate Vite bundles, so live references are shared through globalThis.
 * Every hooks module used to hand-roll the same register/get pair plus a
 * `declare global` augmentation; createHostBridge encapsulates that pattern
 * with a typed string-keyed record on globalThis (no `declare global`).
 *
 * main.ts calls register(hooks) once at startup; server routes call get() to
 * retrieve them. get() returns null (never undefined) before registration.
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
