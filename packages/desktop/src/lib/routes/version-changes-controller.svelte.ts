/**
 * VersionChangesController — what each version in Version history changed
 * (#484): the files every card lists, and the selected version's Changed
 * files.
 *
 * A card's changes load when the card scrolls into view (`show`), never a
 * whole history page up front: listing versions stays as cheap as it was
 * made in #461. A few load at a time, and a card that leaves the view before
 * its turn is dropped (`hide`), so scrolling past a long history asks for
 * nothing on the way. The selected version (`load`) goes ahead of every card,
 * so selecting stays instant, and a page of versions being listed
 * (`listFirst`, Show older versions) holds the cards back until it is shown.
 * A version's changes never change: each is asked for once and kept while
 * the screen is open.
 *
 * Host-free (§8): the host is reached through the `fetchChanges` it is given
 * (`api.vcs.versionChanges`, one version per call).
 */
import type { VersionChanges } from "../api";

/** How many cards' changes load at once. */
export const CARDS_AT_ONCE = 2;

export class VersionChangesController {
  /** What each version changed, by id, once loaded. */
  loaded = $state<Record<string, VersionChanges>>({});

  #queue: string[] = [];
  #running = new Map<string, Promise<VersionChanges>>();
  #cardsRunning = 0;
  /** Pages of versions being listed: no card starts loading meanwhile. */
  #listing = 0;

  constructor(
    private readonly fetchChanges: (id: string) => Promise<VersionChanges>,
    private readonly atOnce = CARDS_AT_ONCE,
  ) {}

  /** A card came into view: list its changes when its turn comes. */
  show(id: string): void {
    if (this.loaded[id] || this.#running.has(id) || this.#queue.includes(id)) return;
    this.#queue.push(id);
    this.#next();
  }

  /** A card left the view before its turn: nothing is asked for it until it is shown again. */
  hide(id: string): void {
    const at = this.#queue.indexOf(id);
    if (at >= 0) this.#queue.splice(at, 1);
  }

  /**
   * The selected version's changes: what is loaded, the load already running,
   * or a load started now, ahead of every card waiting its turn.
   */
  load(id: string): Promise<VersionChanges> {
    const done = this.loaded[id];
    if (done) return Promise.resolve(done);
    this.hide(id);
    return this.#running.get(id) ?? this.#start(id);
  }

  /** List a page of versions (`listing`) before any more cards load: an author waits for the page. */
  async listFirst<T>(listing: Promise<T>): Promise<T> {
    this.#listing++;
    try {
      return await listing;
    } finally {
      this.#listing--;
      this.#next();
    }
  }

  #start(id: string): Promise<VersionChanges> {
    const run = this.fetchChanges(id)
      .then((changes) => (this.loaded[id] = changes))
      .finally(() => this.#running.delete(id));
    this.#running.set(id, run);
    return run;
  }

  #next(): void {
    while (this.#listing === 0 && this.#cardsRunning < this.atOnce && this.#queue.length > 0) {
      const id = this.#queue.shift()!;
      this.#cardsRunning++;
      // A card whose changes could not be listed shows none; showing it again asks again.
      this.#start(id)
        .catch(() => {})
        .finally(() => {
          this.#cardsRunning--;
          this.#next();
        });
    }
  }
}
