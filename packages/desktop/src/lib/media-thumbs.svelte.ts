/**
 * Media panel thumbnails, with bounded memory.
 *
 * A tile never shows the original: a full-size plate decoded for a 90 px tile
 * costs tens of megabytes of renderer memory each, and a book has hundreds.
 * Instead each tile's image is fetched, decoded ONCE at thumbnail size and thrown
 * away, and only the small result is kept. At most `concurrency` images are in
 * flight, and the panel asks only for tiles near the viewport.
 */

/** Longest edge a kept thumbnail is scaled to (tiles are about 90 px wide). */
const THUMB_PX = 192;

/** Fetch an image and return a small object URL of it, or the URL itself for SVG (already small). Rejects when the image cannot be decoded (e.g. TIFF). */
export async function loadThumbnail(url: string): Promise<string> {
  const path = new URL(url, "http://local").searchParams.get("path") ?? "";
  if (/\.svg$/i.test(path)) return url;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`thumbnail: ${response.status}`);
  // One dimension only: the other follows the aspect ratio.
  const bitmap = await createImageBitmap(await response.blob(), { resizeWidth: THUMB_PX, resizeQuality: "medium" });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.8));
    if (!blob) throw new Error("thumbnail: could not encode");
    return URL.createObjectURL(blob);
  } finally {
    bitmap.close();
  }
}

interface Kept {
  url: string;
  /** The thumbnail's `src`, or null when the image could not be loaded. */
  src: string | null;
}

export class ThumbCache {
  #kept = $state<Record<string, Kept>>({});
  /** Key → the URL being waited on (queued or loading). */
  #wanted = new Map<string, string>();
  #queue: { key: string; url: string }[] = [];
  #running = 0;

  constructor(
    private readonly load: (url: string) => Promise<string> = loadThumbnail,
    private readonly concurrency = 2,
  ) {}

  /** The tile's thumbnail `src`; null when it cannot be shown; undefined until loaded. A changed file keeps showing its old thumbnail until the new one arrives. */
  src(key: string): string | null | undefined {
    return this.#kept[key]?.src;
  }

  /** Ask for `key`'s thumbnail of the file at `url` (a new URL means the file changed). Safe to repeat. */
  want(key: string, url: string): void {
    if (this.#kept[key]?.url === url || this.#wanted.get(key) === url) return;
    this.#queue = this.#queue.filter((q) => q.key !== key);
    this.#wanted.set(key, url);
    this.#queue.push({ key, url });
    this.#pump();
  }

  /** Forget a tile (it left the list or the panel closed) and free its thumbnail. */
  drop(key: string): void {
    this.#queue = this.#queue.filter((q) => q.key !== key);
    this.#wanted.delete(key);
    this.#release(this.#kept[key]?.src);
    delete this.#kept[key];
  }

  #release(src: string | null | undefined): void {
    if (src?.startsWith("blob:")) URL.revokeObjectURL(src);
  }

  #pump(): void {
    while (this.#running < this.concurrency && this.#queue.length) {
      const { key, url } = this.#queue.shift()!;
      this.#running++;
      this.load(url).then(
        (src) => this.#done(key, url, src),
        () => this.#done(key, url, null),
      );
    }
  }

  #done(key: string, url: string, src: string | null): void {
    this.#running--;
    if (this.#wanted.get(key) === url) {
      this.#wanted.delete(key);
      this.#release(this.#kept[key]?.src);
      this.#kept[key] = { url, src };
    } else {
      this.#release(src); // dropped or superseded while loading
    }
    this.#pump();
  }
}
