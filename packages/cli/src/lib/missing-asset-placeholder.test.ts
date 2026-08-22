import { test, expect, describe } from "bun:test";
import {
  placeholderOutputPath,
  placeholderPng,
  rewriteMissingImageReferences,
} from "./missing-asset-placeholder";
import { collectHtmlImageRefs } from "./markdown/images";

/**
 * The placeholder stands in for an image the book references but does not
 * have, so that one stale path cannot make a whole book unbuildable. It is
 * hand-encoded, which means nothing but a test proves it is a real PNG —
 * an invalid one would trade a build failure for a broken-image box, which
 * is strictly worse than what it replaced.
 */
describe("missing-asset placeholder", () => {
  const png = placeholderPng();

  test("carries the PNG signature", () => {
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  test("declares the requested dimensions in IHDR", () => {
    const custom = placeholderPng(64, 32);
    const view = new DataView(custom.buffer, custom.byteOffset);
    // 8-byte signature + 4 length + 4 type, then width/height
    expect(view.getUint32(16)).toBe(64);
    expect(view.getUint32(20)).toBe(32);
    expect(custom[24]).toBe(8); // bit depth
    expect(custom[25]).toBe(2); // truecolor
  });

  test("chunks are ordered IHDR, IDAT, IEND", () => {
    const s = Buffer.from(png).toString("latin1");
    expect(s.indexOf("IHDR")).toBeGreaterThan(-1);
    expect(s.indexOf("IDAT")).toBeGreaterThan(s.indexOf("IHDR"));
    expect(s.indexOf("IEND")).toBeGreaterThan(s.indexOf("IDAT"));
  });

  test("is a checkerboard, not a flat fill — the point is to be unmissable", () => {
    // Two different cells must differ; a uniform image would read as art.
    const a = placeholderPng(64, 64, 32);
    const b = placeholderPng(64, 64, 64); // one cell covers the whole image
    expect(a).not.toEqual(b);
  });

  test("every chunk's CRC validates", () => {
    // Walk the chunk list and recompute each CRC exactly as a decoder would.
    const crcTable = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    const crc = (buf: Uint8Array) => {
      let c = ~0;
      for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
      return ~c >>> 0;
    };

    const view = new DataView(png.buffer, png.byteOffset);
    let off = 8;
    let seen = 0;
    while (off < png.length) {
      const len = view.getUint32(off);
      const declared = view.getUint32(off + 8 + len);
      expect(crc(png.subarray(off + 4, off + 8 + len))).toBe(declared);
      off += 12 + len;
      seen++;
    }
    expect(seen).toBe(3);
    expect(off).toBe(png.length);
  });

  test("uses a deterministic engine-owned .png path without preserving the missing extension", () => {
    const first = placeholderOutputPath("images/cover.jpg");
    expect(first).toMatch(/^assets\/gutterpress-missing\/[a-f0-9]{16}\.png$/);
    expect(first).toBe(placeholderOutputPath("images/cover.jpg"));
    expect(first).not.toBe(placeholderOutputPath("images/cover.webp"));
  });

  test("rewrites src, srcset, and mirrored shape URLs while leaving unrelated URLs alone", () => {
    const replacements = new Map([
      ["images/missing.jpg", "assets/gutterpress-missing/a.png"],
      ["images/wide.webp", "assets/gutterpress-missing/b.png"],
    ]);
    const html = `<style>.plate{background:url("images/missing.jpg")}</style>
      <img src='images/missing.jpg' srcset="images/missing.jpg 1x, images/wide.webp 2x, ok.png 3x"
        style="--gp-shape:url(&quot;images/missing.jpg&quot;)">
      <img data-src="images/missing.jpg" src="ok.png">`;
    const out = rewriteMissingImageReferences(html, replacements);

    expect(out).toContain(`src='assets/gutterpress-missing/a.png'`);
    expect(out).toContain(
      `srcset="assets/gutterpress-missing/a.png 1x, assets/gutterpress-missing/b.png 2x, ok.png 3x"`,
    );
    expect(out).toContain(`url(&quot;assets/gutterpress-missing/a.png&quot;)`);
    expect(out).toContain(`background:url("assets/gutterpress-missing/a.png")`);
    expect(out).toContain(`<img data-src="images/missing.jpg" src="ok.png">`);
  });

  test("rewrites an unquoted srcset to the staged placeholder URL", () => {
    const html = `<picture><source srcset=images/missing.jpg><img src=images/missing.jpg></picture>`;
    const collected = collectHtmlImageRefs(html);
    expect(collected).toEqual(["images/missing.jpg", "images/missing.jpg"]);
    const out = rewriteMissingImageReferences(
      html,
      new Map(collected.map((ref) => [ref, "assets/gutterpress-missing/a.png"])),
    );
    expect(out).toContain(`srcset=assets/gutterpress-missing/a.png`);
    expect(out).toContain(`src=assets/gutterpress-missing/a.png`);
    expect(out).not.toContain(`srcset=images/missing.jpg`);
  });

  test("shares srcset comma boundaries between collection and rewriting", () => {
    const localHtml = `<img srcset="images/a,b.png, images/plain.png">`;
    const localRefs = collectHtmlImageRefs(localHtml);
    expect(localRefs).toEqual(["images/a,b.png", "images/plain.png"]);
    const localOut = rewriteMissingImageReferences(
      localHtml,
      new Map([
        [localRefs[0]!, "assets/gutterpress-missing/comma.png"],
        [localRefs[1]!, "assets/gutterpress-missing/plain.png"],
      ]),
    );
    expect(localOut).toBe(
      `<img srcset="assets/gutterpress-missing/comma.png, assets/gutterpress-missing/plain.png">`,
    );

    const dataHtml = `<img srcset="data:image/png;base64,AAAA, missing.png">`;
    const dataRefs = collectHtmlImageRefs(dataHtml);
    expect(dataRefs).toEqual(["data:image/png;base64,AAAA", "missing.png"]);
    const dataOut = rewriteMissingImageReferences(
      dataHtml,
      new Map([[dataRefs[1]!, "assets/gutterpress-missing/missing.png"]]),
    );
    expect(dataOut).toBe(
      `<img srcset="data:image/png;base64,AAAA, assets/gutterpress-missing/missing.png">`,
    );
  });

  test("rewrites only real tags and CSS, leaving code/pre/script literals untouched", () => {
    const replacements = new Map([
      ["images/missing.jpg", "assets/gutterpress-missing/a.png"],
    ]);
    const literal = `url("images/missing.jpg")`;
    const html = `<style>.real{background:${literal}}</style>
      <div style='background:${literal}'></div>
      <pre>${literal} &lt;img src="images/missing.jpg"&gt;</pre>
      <code>${literal}</code>
      <script>const example = '${literal}'; const tag = '<img src="images/missing.jpg">';</script>
      <img src="images/missing.jpg" style="--gp-shape:url(&quot;images/missing.jpg&quot;)">`;

    const out = rewriteMissingImageReferences(html, replacements);

    expect(out).toContain(`<style>.real{background:url("assets/gutterpress-missing/a.png")}</style>`);
    expect(out).toContain(`<div style='background:url("assets/gutterpress-missing/a.png")'></div>`);
    expect(out).toContain(`<pre>${literal} &lt;img src="images/missing.jpg"&gt;</pre>`);
    expect(out).toContain(`<code>${literal}</code>`);
    expect(out).toContain(
      `<script>const example = '${literal}'; const tag = '<img src="images/missing.jpg">';</script>`,
    );
    expect(out).toContain(`src="assets/gutterpress-missing/a.png"`);
    expect(out).toContain(`--gp-shape:url(&quot;assets/gutterpress-missing/a.png&quot;)`);
  });

  test("does not treat tag-looking CSS strings or comments as real HTML", () => {
    const replacements = new Map([
      ["images/missing.jpg", "assets/gutterpress-missing/a.png"],
      ["images/wide.webp", "assets/gutterpress-missing/b.png"],
    ]);
    const html = `<style>.real{background:url("images/missing.jpg")}
      .demo::before{content:"<img src='images/missing.jpg'>"}
      /* <img src="images/missing.jpg"> */</style>
      <img src="images/missing.jpg"
        srcset="images/missing.jpg 1x, images/wide.webp 2x">
      <div style="--gp-shape:url(&quot;images/missing.jpg&quot;)"></div>`;

    const out = rewriteMissingImageReferences(html, replacements);

    expect(out).toContain(`.real{background:url("assets/gutterpress-missing/a.png")}`);
    expect(out).toContain(`.demo::before{content:"<img src='images/missing.jpg'>"}`);
    expect(out).toContain(`/* <img src="images/missing.jpg"> */`);
    expect(out).toContain(`<img src="assets/gutterpress-missing/a.png"`);
    expect(out).toContain(
      `srcset="assets/gutterpress-missing/a.png 1x, assets/gutterpress-missing/b.png 2x"`,
    );
    expect(out).toContain(`--gp-shape:url(&quot;assets/gutterpress-missing/a.png&quot;)`);
  });

  test("rewrites CSS URL tokens but preserves url-looking strings and comments", () => {
    const replacement = "assets/gutterpress-missing/a.png";
    const html = `<style>
      .real{background:url("images/missing.jpg")}
      .single::before{content:'url("images/missing.jpg")'}
      .double::before{content:"url('images/missing.jpg')"}
      /* url("images/missing.jpg") */
    </style>
    <div style="background:url(&quot;images/missing.jpg&quot;);content:'url(images/missing.jpg)'"></div>`;
    const out = rewriteMissingImageReferences(
      html,
      new Map([["images/missing.jpg", replacement]]),
    );

    expect(out).toContain(`.real{background:url("${replacement}")}`);
    expect(out).toContain(`.single::before{content:'url("images/missing.jpg")'}`);
    expect(out).toContain(`.double::before{content:"url('images/missing.jpg')"}`);
    expect(out).toContain(`/* url("images/missing.jpg") */`);
    expect(out).toContain(`background:url(&quot;${replacement}&quot;)`);
    expect(out).toContain(`content:'url(images/missing.jpg)'`);
  });
});
