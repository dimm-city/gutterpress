/**
 * The person's own stores, shared with the terminal (ADR 0012 §4): saved
 * accounts and their publishing choices per book, in the lib's one Gutterpress
 * folder (`FileTokenStore`, `PublishSelectionsStore`). The app keeps no copy
 * of its own.
 *
 * Before first use, what older versions of the app kept in its own folder is
 * moved there once (the lib's `moveAppStores`); accounts are decrypted with the
 * OS keychain they were saved with. A failed move is logged and retried on the
 * next launch; the stores work either way.
 *
 * SECURITY INVARIANT: token values never appear in logs, errors, or IPC
 * responses (`status` and `listRedacted` never carry the token).
 */
import type { FileTokenStore, HostCredential, PublishSelectionsStore } from "gutterpress";

type LibModule = typeof import("gutterpress");

export interface UserStoreDeps {
  loadLib: () => Promise<LibModule>;
  /** Resolves once the OS keychain can be used (Electron's `app.whenReady`). */
  whenReady: () => Promise<unknown>;
  /** The app's own folder, where older versions kept their copies. */
  appDir: () => string;
  /** Decrypt a token an older version saved (base64 keychain ciphertext). */
  decrypt: (cipherBase64: string) => string;
  log: { event: (line: string) => unknown; error: (line: string) => unknown };
}

export function createUserStores(deps: UserStoreDeps) {
  let ready: Promise<{ tokens: FileTokenStore; selections: PublishSelectionsStore }> | null = null;
  const listeners = new Set<(key: string) => void>();

  function stores() {
    ready ??= (async () => {
      const lib = await deps.loadLib();
      const tokens = new lib.FileTokenStore();
      const selections = new lib.PublishSelectionsStore();
      await deps.whenReady();
      try {
        const moved = await lib.moveAppStores(deps.appDir(), deps.decrypt, { tokenStore: tokens, selections });
        if (moved.accounts || moved.unreadable || moved.choices) {
          void deps.log.event(
            `[accounts] moved to ${lib.defaultConfigDir()}: ${moved.accounts} account(s), ` +
              `${moved.choices} publishing choice(s); ${moved.unreadable} account(s) could not be read and need signing in again`,
          );
        }
      } catch (e) {
        void deps.log.error(`[accounts] could not move this app's saved accounts (will retry next launch): ${String(e)}`);
      }
      tokens.onChange((key) => {
        for (const listener of listeners) listener(key);
      });
      return { tokens, selections };
    })().catch((e) => {
      ready = null;
      throw e;
    });
    return ready;
  }

  const tokenStore = {
    get: async (host: string): Promise<HostCredential | null> => (await stores()).tokens.get(host),
    set: async (host: string, credential: HostCredential) => (await stores()).tokens.set(host, credential),
    delete: async (host: string) => (await stores()).tokens.delete(host),
    list: async () => (await stores()).tokens.list(),
    listRedacted: async () => (await stores()).tokens.listRedacted(),
    status: async (host: string) => (await stores()).tokens.status(host),
  };

  return {
    tokenStore,
    selections: async () => (await stores()).selections,
    /** Be told when an account is saved or removed in the app. Returns an unsubscribe. */
    onCredentialChange(listener: (key: string) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The app's account store: the lib's `TokenStore` plus its redacted views. */
export type SharedTokenStore = ReturnType<typeof createUserStores>["tokenStore"];
