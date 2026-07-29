/**
 * web-store — a NARROW async key/value-per-object-store abstraction over
 * IndexedDB, for the PWA WebAdapter's persistence (#33, Phase 3).
 *
 * §8 / ADR 0004: this is RENDERER/BROWSER code. It uses ONLY browser globals
 * (`indexedDB`) — NO `node:*`, NO `fs`/`path`/`url`, NO value import from
 * `gutterpress`. It stays PWA-clean.
 *
 * ── Why a narrow store seam ───────────────────────────────────────────────────
 * The WebAdapter persists FOUR kinds of thing across a page reload:
 *   - `handles`       — the structured-cloneable FSA `FileSystemDirectoryHandle`
 *                       (localStorage CANNOT store these; IndexedDB CAN).
 *   - `recents`       — RecentFolderEntry-shaped rows keyed by FolderRef.key.
 *   - `favorites`     — FavoriteEntry-shaped rows keyed by FolderRef.key.
 *   - `prefs`         — a single DesktopPrefs blob (key "singleton").
 *   - `projectStates` — ProjectState rows keyed by FolderRef.key.
 *   - `meta`          — small singletons (e.g. the last-opened key).
 * All of these reduce to "get/put/delete/list a value under a (store, key)" — so
 * the interface is exactly that. Keeping it this narrow lets the WebAdapter be
 * unit-tested against {@link InMemoryWebStore} with NO real IndexedDB
 * (dependency injection — the production adapter is handed an
 * {@link IndexedDbWebStore}; tests inject the in-memory fake).
 */

/** One {key, value} row returned by {@link WebStore.list}. */
export interface WebStoreRow {
  key: string;
  value: unknown;
}

/**
 * The narrow persistence contract the WebAdapter depends on. `storeName` is one
 * of the fixed object-store names ("handles" | "recents" | …); `key` is the
 * primary key within that store. Values are arbitrary structured-cloneable data.
 */
export interface WebStore {
  get(storeName: string, key: string): Promise<unknown>;
  put(storeName: string, key: string, value: unknown): Promise<void>;
  delete(storeName: string, key: string): Promise<void>;
  list(storeName: string): Promise<WebStoreRow[]>;
}

/** The object-store names the WebAdapter uses (also the IndexedDB store list). */
export const WEB_STORE_NAMES = [
  "handles",
  "recents",
  "favorites",
  "prefs",
  "projectStates",
  "meta",
] as const;

const DB_NAME = "gutterpress";
const DB_VERSION = 1;

/**
 * In-memory {@link WebStore} for unit tests — no IndexedDB. Behaviour matches
 * {@link IndexedDbWebStore}: per-store isolation, undefined on miss, overwrite
 * on re-put, structured-clone-by-identity (we keep the object reference, which
 * is sufficient for the FSA-handle round-trip the adapter needs).
 */
export class InMemoryWebStore implements WebStore {
  private stores = new Map<string, Map<string, unknown>>();

  private storeMap(storeName: string): Map<string, unknown> {
    let m = this.stores.get(storeName);
    if (!m) {
      m = new Map();
      this.stores.set(storeName, m);
    }
    return m;
  }

  get(storeName: string, key: string): Promise<unknown> {
    return Promise.resolve(this.storeMap(storeName).get(key));
  }

  put(storeName: string, key: string, value: unknown): Promise<void> {
    this.storeMap(storeName).set(key, value);
    return Promise.resolve();
  }

  delete(storeName: string, key: string): Promise<void> {
    this.storeMap(storeName).delete(key);
    return Promise.resolve();
  }

  list(storeName: string): Promise<WebStoreRow[]> {
    const rows: WebStoreRow[] = [];
    for (const [key, value] of this.storeMap(storeName)) rows.push({ key, value });
    return Promise.resolve(rows);
  }
}

/** Wrap an IDBRequest in a promise. */
function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * IndexedDB-backed {@link WebStore} (the production implementation). The DB is
 * opened lazily on first use and memoised. All six object stores are created in
 * `onupgradeneeded` with `key` as the in-line-less out-of-line primary key
 * (we pass the key explicitly to `put`/`get`, so no `keyPath`).
 */
export class IndexedDbWebStore implements WebStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is not available in this environment."));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of WEB_STORE_NAMES) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  }

  private async tx(storeName: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.open();
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  async get(storeName: string, key: string): Promise<unknown> {
    const store = await this.tx(storeName, "readonly");
    return reqAsPromise(store.get(key));
  }

  async put(storeName: string, key: string, value: unknown): Promise<void> {
    const store = await this.tx(storeName, "readwrite");
    await reqAsPromise(store.put(value, key));
  }

  async delete(storeName: string, key: string): Promise<void> {
    const store = await this.tx(storeName, "readwrite");
    await reqAsPromise(store.delete(key));
  }

  async list(storeName: string): Promise<WebStoreRow[]> {
    // IDB footgun: an IDBTransaction auto-commits once its request queue drains
    // with no outstanding sync requests. `list` needs TWO requests, so they must
    // be fired SYNCHRONOUSLY (before any await) on the same live transaction —
    // awaiting the first before issuing the second commits the txn underneath us
    // and the second throws TransactionInactiveError. (get/put/delete each issue
    // a single request, so they're fine via tx().)
    const db = await this.open();
    const store = db.transaction(storeName, "readonly").objectStore(storeName);
    const keysReq = store.getAllKeys();
    const valuesReq = store.getAll();
    const keys = (await reqAsPromise(keysReq)) as IDBValidKey[];
    const values = (await reqAsPromise(valuesReq)) as unknown[];
    return keys.map((k, i) => ({ key: String(k), value: values[i] }));
  }
}
