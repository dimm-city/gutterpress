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

/**
 * Load a small version of an image: an object URL of it, the URL itself for SVG
 * (already small), or null for a type the window cannot decode (TIFF), which is
 * not worth fetching. Rejects when the load or decode fails, so the caller can
 * try again later.
 *
 * It decodes with WebCodecs `ImageDecoder`, closing everything afterwards. Two
 * simpler paths were measured on 200 full-size plates and rejected:
 * `response.blob()` on this streamed route failed intermittently
 * (net::ERR_FAILED) and parks the bytes in Electron's main process (a ~1-2 GB
 * peak there); decoding through an <img> leaves Blink's purgeable decoded-image
 * cache holding about 870 MB (renderer peak 955 MB, some loads failing), which
 * is only released under a memory-pressure signal Linux Electron may never send.
 * ImageDecoder: renderer peak about 590 MB, about 490 MB held and falling, 200/200 loaded.
 */
export async function loadThumbnail(url: string): Promise<string | null> {
  const path = new URL(url, "http://local").searchParams.get("path") ?? "";
  if (/\.tiff?$/i.test(path)) return null;
  if (/\.svg$/i.test(path)) return url;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`thumbnail: ${response.status}`);
  const type = response.headers.get("content-type") ?? "";
  if (!(await ImageDecoder.isTypeSupported(type))) return null;
  const decoder = new ImageDecoder({ data: await response.arrayBuffer(), type });
  try {
    const { image } = await decoder.decode();
    try {
      // One dimension only: the other follows the aspect ratio.
      const bitmap = await createImageBitmap(image, { resizeWidth: THUMB_PX, resizeQuality: "medium" });
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
    } finally {
      image.close();
    }
  } finally {
    decoder.close();
  }
}

interface Kept {
  url: string;
  /** The thumbnail's `src`, or null when there is none. */
  src: string | null;
  /** The load failed (as opposed to there being nothing to show); the next `want()` tries again. */
  failed: boolean;
}

export class ThumbCache {
  #kept = $state<Record<string, Kept>>({});
  /** Key → the URL being waited on (queued or loading). */
  #wanted = new Map<string, string>();
  #queue: { key: string; url: string }[] = [];
  #running = 0;

  constructor(
    private readonly load: (url: string) => Promise<string | null> = loadThumbnail,
    private readonly concurrency = 2,
  ) {}

  /** The tile's thumbnail `src`; null when it cannot be shown; undefined until loaded. A changed file keeps showing its old thumbnail until the new one arrives. */
  src(key: string): string | null | undefined {
    return this.#kept[key]?.src;
  }

  /** Ask for `key`'s thumbnail of the file at `url` (a new URL means the file changed). Safe to repeat. */
  want(key: string, url: string): void {
    const kept = this.#kept[key];
    if ((kept?.url === url && !kept.failed) || this.#wanted.get(key) === url) return;
    this.#queue = this.#queue.filter((q) => q.key !== key);
    this.#wanted.set(key, url);
    this.#queue.push({ key, url });
    this.#pump();
  }

  /** Stop waiting for a tile that scrolled away before its turn. A load already running finishes and is kept. */
  unwant(key: string): void {
    if (this.#queue.some((q) => q.key === key)) {
      this.#queue = this.#queue.filter((q) => q.key !== key);
      this.#wanted.delete(key);
    }
  }

  /** Keep thumbnails only for `keys` (the images still in the list); free the rest. */
  retainOnly(keys: ReadonlySet<string>): void {
    for (const key of [...Object.keys(this.#kept), ...this.#wanted.keys()]) {
      if (!keys.has(key)) this.drop(key);
    }
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
        (src) => this.#done(key, url, src, false),
        () => this.#done(key, url, null, true),
      );
    }
  }

  #done(key: string, url: string, src: string | null, failed: boolean): void {
    this.#running--;
    if (this.#wanted.get(key) === url) {
      this.#wanted.delete(key);
      this.#release(this.#kept[key]?.src);
      this.#kept[key] = { url, src, failed };
    } else {
      this.#release(src); // dropped or superseded while loading
    }
    this.#pump();
  }
}
