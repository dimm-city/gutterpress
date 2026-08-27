/**
 * Minimal hand-rolled DOM stand-ins for tests/web/**.
 *
 * packages/editor has zero runtime dependencies by design (D3/D4), and this
 * run's lane instructions say to write a hand-rolled stub rather than add
 * one merely to get a browser DOM inside `bun:test` — which runs under Bun,
 * not a real browser or a full DOM implementation (`typeof document` is
 * `"undefined"` under `bun test`; verified against Bun 1.3.11 while writing
 * this file). `happy-dom` is already a workspace devDependency (declared in
 * `packages/desktop/package.json`, so present in the hoisted root
 * `node_modules`), but this package's own `package.json` does not declare
 * it, this run's write ownership does not include `packages/editor/package.json`
 * (Lane A/integrator-owned), and the run spec is explicit: "do NOT add
 * dependencies." So: a stub, not a real DOM.
 *
 * This file implements ONLY the handful of members
 * `packages/editor/src/web/mount.ts` actually touches on `Element`/
 * `Document`, each documented below with why mount.ts needs it. It is NOT a
 * general-purpose DOM polyfill, must never be imported by production code
 * (`src/web/**`), and does not attempt to satisfy the real `lib.dom.d.ts`
 * `Element`/`Document`/`HTMLTextAreaElement` interfaces structurally —
 * `mountEditor`'s `container` parameter is typed against those REAL DOM
 * types (via `../../../src/web.tsconfig.json`'s DOM lib) precisely so
 * production code stays honest about what a real browser DOM provides.
 * Tests hand a `FakeElement` to `mountEditor` through exactly ONE
 * `as unknown as Element` cast at that boundary (see `createTestContainer`'s
 * doc comment); every OTHER interaction in a test file uses this stub's own,
 * simpler, test-only surface (e.g. `fireEvent("input")` instead of
 * constructing a real `Event`, `listenerCount()` instead of reaching into
 * private host state).
 */

type Listener = () => void;

/**
 * Stubs `EventTarget.addEventListener` / `removeEventListener` for exactly
 * the one thing mount.ts registers: an unparameterized "input" listener
 * (mount.ts never reads the `Event` object itself — it only reacts to the
 * notification and re-reads `surface.value` — so listeners here are plain
 * no-argument callbacks, not full DOM `EventListener`s taking an `Event`).
 */
class FakeEventTarget {
  readonly #listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener): void {
    let set = this.#listeners.get(type);
    if (!set) {
      set = new Set();
      this.#listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.#listeners.get(type)?.delete(listener);
  }

  /**
   * Test-only: synchronously invokes every listener currently registered
   * for `type`, simulating a real DOM event dispatch without needing a real
   * `Event` object (mount.ts's handlers never read one — see class doc).
   */
  fireEvent(type: string): void {
    for (const listener of this.#listeners.get(type) ?? []) listener();
  }

  /**
   * Test-only: total listener count across every event type this target has
   * ever seen `addEventListener` for — used by dispose/leak assertions
   * (mount.dispose() must bring this back to 0 for "input").
   */
  listenerCount(): number {
    let total = 0;
    for (const set of this.#listeners.values()) total += set.size;
    return total;
  }
}

/** Stubs the handful of `DOMTokenList` members mount.ts calls (`.add` only). */
class FakeClassList {
  readonly #names = new Set<string>();

  add(...names: readonly string[]): void {
    for (const name of names) this.#names.add(name);
  }

  contains(name: string): boolean {
    return this.#names.has(name);
  }
}

/**
 * Stubs the `Element`/`HTMLTextAreaElement` members mount.ts touches:
 * `ownerDocument` (to reach `createElement`), `value` (the textarea's
 * content — mount.ts both reads it, in `handleInput`, and writes it, in
 * `render`), `classList.add` (the shell's styling hook), `appendChild` /
 * `remove` (mount / dispose), and the inherited `addEventListener` /
 * `removeEventListener`. `querySelector` and `children` are test-only
 * convenience — mount.ts itself never calls them — so a test can retrieve
 * the mounted surface from the container it handed to `mountEditor`.
 */
class FakeElement extends FakeEventTarget {
  readonly tagName: string;
  readonly ownerDocument: FakeDocument;
  readonly classList = new FakeClassList();
  readonly children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  value = "";

  constructor(tagName: string, ownerDocument: FakeDocument) {
    super();
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
  }

  appendChild(child: FakeElement): void {
    child.parentNode = this;
    this.children.push(child);
  }

  removeChild(child: FakeElement): void {
    const index = this.children.indexOf(child);
    if (index !== -1) this.children.splice(index, 1);
    if (child.parentNode === this) child.parentNode = null;
  }

  /** Stubs `Element.remove()`, which mount.ts's `dispose()` calls directly. */
  remove(): void {
    this.parentNode?.removeChild(this);
  }

  /**
   * Test-only: first descendant (depth-first) whose tagName matches
   * `tagName`, case-insensitively — enough to fetch the mounted `<textarea>`
   * from a container in a test, without implementing real CSS selectors.
   */
  querySelector(tagName: string): FakeElement | null {
    const wanted = tagName.toUpperCase();
    for (const child of this.children) {
      if (child.tagName === wanted) return child;
      const nested = child.querySelector(tagName);
      if (nested) return nested;
    }
    return null;
  }
}

/** Stubs `Document.createElement` — the only `Document` member mount.ts calls. */
class FakeDocument {
  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }
}

/**
 * Builds a fresh, detached container element with its own owner document —
 * the starting point for every tests/web/** case. Pass the result to
 * `mountEditor` through a single boundary cast:
 *
 *   const stub = createTestContainer();
 *   const mount = mountEditor(stub as unknown as Element, host, options);
 *
 * `mountEditor`'s parameter type is the REAL `lib.dom.d.ts` `Element` (see
 * this file's header doc); the cast is the one deliberate seam where a test
 * asserts "this stub implements enough of Element for mount.ts's actual
 * calls to work," without claiming structural compatibility with the full
 * real interface.
 */
export function createTestContainer(): FakeElement {
  const doc = new FakeDocument();
  return doc.createElement("div");
}

export type { FakeElement, FakeDocument };
