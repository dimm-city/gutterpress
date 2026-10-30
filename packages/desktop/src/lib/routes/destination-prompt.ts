/**
 * The Google Drive step's words, and where a pick is saved (#452), from the
 * host's `destinations/status` answer. The book's folder is the team's: the
 * first pick, and a change while it is reachable, go to the manifest
 * (`folderId`/`folder`). A person who can't reach it, whose own folder is gone,
 * or who asks for a folder just for them, picks one saved in their private
 * settings only (`myFolderId`/`myFolder`). PublishSectionController holds the
 * state and calls these.
 */
import type { PublishDestination, PublishDestinationStatus } from "#lib/platform/contract.ts";

/** What a destination step says and where a pick is saved (#452). */
export interface DestinationPrompt {
  /** The plain-words status line, "" for none. */
  message: string;
  /** The destination the picker shows as chosen, "" when the person must choose. */
  selected: string;
  /** "book": a pick is the book's folder, saved in the manifest. "mine": it is
   *  this person's own, saved in their private settings only. */
  saveTo: "book" | "mine";
  /** Offer "Use the book's folder" (drops this person's own). */
  canUseBook: boolean;
  /** Offer "Use a different folder just for me". */
  canChooseOwn: boolean;
}

const SAVED_FOR_YOU = "It is saved for you only; the book keeps its folder for everyone else.";

/** The host's status, or, until it has answered, what the card's settings
 *  imply (so a pick never replaces an existing book folder unasked). */
export function statusFromCard(
  loaded: PublishDestinationStatus | undefined,
  config: Record<string, string>,
): PublishDestinationStatus {
  if (loaded) return loaded;
  if (config.folderId) {
    return { state: "book", destination: { id: config.folderId, title: config.folder || config.folderId } };
  }
  return config.folder ? { state: "by-name", name: config.folder, several: false } : { state: "unset" };
}

/** What the step says for `status`; `justForMe` is "Use a different folder
 *  just for me" having been chosen while the book's folder is reachable. */
export function promptFor(status: PublishDestinationStatus, justForMe: boolean): DestinationPrompt {
  const book = { saveTo: "book" as const, canUseBook: false };
  const mine = { saveTo: "mine" as const, canChooseOwn: false };
  switch (status.state) {
    case "unset":
      return { ...book, message: "Saved with the book, so everyone publishes here.", selected: "", canChooseOwn: false };
    case "mine": {
      const own = status.destination.title;
      const reach = status.book.reachable ? "." : ", which your Google account can't reach.";
      return {
        ...mine,
        selected: status.destination.id,
        canUseBook: status.book.reachable,
        message:
          own === status.book.title
            ? `You publish to the folder '${own}' you chose for yourself.`
            : `You publish to your own folder '${own}' instead of the book's '${status.book.title}'${reach}`,
      };
    }
    case "unreachable": {
      const why = status.mine
        ? `Your own folder '${status.mine}' for this book can't be reached any more.`
        : `This book publishes to the Drive folder '${status.book.title}', which your Google account can't reach.`;
      return {
        ...mine,
        selected: "",
        canUseBook: status.book.reachable,
        message: `${why} Choose a folder you can reach. ${SAVED_FOR_YOU}`,
      };
    }
  }
  // The book's folder is reachable.
  if (justForMe) {
    return { ...mine, selected: "", canUseBook: true, message: `Choose a folder just for you. ${SAVED_FOR_YOU}` };
  }
  if (status.state === "book") {
    return { ...book, message: "", selected: status.destination.id, canChooseOwn: true };
  }
  const byName = `Each person publishes to a folder named '${status.name}' in their own Drive.`;
  return status.several
    ? {
        ...mine,
        selected: "",
        canUseBook: false,
        message: `${byName} Several of yours have that name: choose the one you publish to. It is saved for you only.`,
      }
    : { ...book, message: byName, selected: status.destination?.id ?? "", canChooseOwn: true };
}

/** The settings a pick saves: this person's own folder or the book's, or `null`
 *  when it would change the book's folder for everyone and must be confirmed
 *  first (then {@link bookValues}). */
export function pickValues(
  status: PublishDestinationStatus,
  justForMe: boolean,
  destination: PublishDestination,
): Record<string, string> | null {
  if (promptFor(status, justForMe).saveTo === "mine") {
    return { myFolderId: destination.id, myFolder: destination.title };
  }
  return status.state !== "unset" ? null : bookValues(destination);
}

/** The book's folder, as the manifest records it. */
export function bookValues(destination: PublishDestination): Record<string, string> {
  return { folderId: destination.id, folder: destination.title };
}

/** This person has a folder of their own for the book ("Use the book's folder" clears it). */
export function hasOwnFolder(status: PublishDestinationStatus): boolean {
  return status.state === "mine" || (status.state === "unreachable" && !!status.mine);
}
