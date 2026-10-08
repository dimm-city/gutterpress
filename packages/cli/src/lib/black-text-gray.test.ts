import { describe, expect, test } from "bun:test";
import { blackTextToGray, rewriteBlackText } from "./black-text-gray";

describe("rewriteBlackText", () => {
  test("near-black text fill becomes 0 g, original colour restored after ET", () => {
    const out = rewriteBlackText(
      ".102 .0824 .0706 RG .102 .0824 .0706 rg\nBT\n/F5 20 Tf\n<0025> Tj\nET\n10 10 5 2 re\nf\n"
    );
    expect(out).toContain("BT 0 g 0 G\n");
    expect(out).toContain(".102 .0824 .0706 rg .102 .0824 .0706 RG ET");
    // the rect after ET is painted with the restored (original) colour
    expect(out.indexOf("rg .102")).toBeLessThan(out.indexOf("re\nf"));
  });

  test("rg set inside BT is rewritten", () => {
    const out = rewriteBlackText("BT 0 0 0 rg /F1 9 Tf <01> Tj ET");
    expect(out).toBe("BT 0 g /F1 9 Tf <01> Tj 0 0 0 rg ET");
  });

  test("red text is untouched", () => {
    const src = "1 0 0 RG 1 0 0 rg\nBT\n/F7 20 Tf\n<0055> Tj\nET\n";
    expect(rewriteBlackText(src)).toBe(src);
  });

  test("dark but coloured text (spread > 0.04) is untouched", () => {
    const src = "0 0 .12 rg BT <01> Tj ET";
    expect(rewriteBlackText(src)).toBe(src);
  });

  test("black non-text fill outside BT is untouched", () => {
    const src = "0 0 0 rg\n9 52 282 2 re\nf\nq 0 0 0 RG 1 w 0 0 m 5 5 l S Q\n";
    expect(rewriteBlackText(src)).toBe(src);
  });

  test("inherited colour: set outside BT, gray inside, restored after, q/Q respected", () => {
    const out = rewriteBlackText(
      "q 0 0 0 rg BT <01> Tj ET 0 0 5 5 re f Q 0 0 5 5 re f BT <02> Tj ET"
    );
    expect(out).toBe(
      "q 0 0 0 rg BT 0 g <01> Tj 0 0 0 rg ET 0 0 5 5 re f Q 0 0 5 5 re f BT <02> Tj ET"
    );
  });

  test("colour changed to gray/CMYK inside BT is not 'restored' over", () => {
    const out = rewriteBlackText("0 0 0 rg BT 0 g <01> Tj ET");
    expect(out).toBe("0 0 0 rg BT 0 g 0 g <01> Tj ET");
  });

  test("strings containing BT/rg and inline images do not confuse the scanner", () => {
    const src = "0 0 0 rg BT (BT 0 0 0 rg \\) ET) Tj ET BI /W 1 /H 1 ID 0 0 0 rg BT\nEI 0 0 0 rg BT <01> Tj ET";
    const out = rewriteBlackText(src);
    expect(out.match(/BT 0 g/g)?.length).toBe(2);
  });
});

async function pdfOf(build: (ctx: any, page: any, lib: typeof import("pdf-lib")) => void) {
  const lib = await import("pdf-lib");
  const doc = await lib.PDFDocument.create();
  const page = doc.addPage([100, 100]);
  build(doc.context, page, lib);
  return doc.save({ useObjectStreams: false });
}

async function streamsOf(bytes: Uint8Array, subtype?: string): Promise<string[]> {
  const { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } = await import("pdf-lib");
  const doc = await PDFDocument.load(bytes);
  const out: string[] = [];
  for (const [, o] of doc.context.enumerateIndirectObjects()) {
    if (!(o instanceof PDFRawStream)) continue;
    if (subtype && o.dict.get(PDFName.of("Subtype")) !== PDFName.of(subtype)) continue;
    out.push(Buffer.from(decodePDFRawStream(o).decode()).toString("latin1"));
  }
  return out;
}

describe("blackTextToGray", () => {
  test("rewrites a page content stream", async () => {
    const pdf = await pdfOf((ctx, page, { PDFName }) => {
      const s = ctx.flateStream("0 0 0 rg BT <01> Tj ET");
      page.node.set(PDFName.of("Contents"), ctx.register(s));
    });
    const out = await blackTextToGray(pdf);
    expect((await streamsOf(out)).join("\n")).toContain("BT 0 g <01> Tj 0 0 0 rg ET");
  });

  test("rewrites a Form XObject, leaves a red one alone, returns input if unchanged", async () => {
    const mk = (content: string) =>
      pdfOf((ctx, page, { PDFName }) => {
        const form = ctx.register(
          ctx.flateStream(content, { Type: "XObject", Subtype: "Form", BBox: [0, 0, 100, 100] })
        );
        page.node.set(PDFName.of("Contents"), ctx.register(ctx.flateStream("/Fm0 Do")));
        page.node.set(PDFName.of("Resources"), ctx.obj({ XObject: { Fm0: form } }));
      });
    const out = await blackTextToGray(await mk("0 0 0 RG 0 0 0 rg BT <01> Tj ET"));
    const forms = await streamsOf(out, "Form");
    expect(forms[0]).toContain("BT 0 g 0 G <01> Tj");
    expect(forms[0]).toContain("0 0 0 rg 0 0 0 RG ET");
    const red = await mk("1 0 0 rg BT <01> Tj ET");
    expect(await blackTextToGray(red)).toBe(red);
  });
});

// Verbatim content stream from Chromium 141 `Page.printToPDF` (warm-ink body
// text, red span, a black rule, pure-black text): colour is set once before
// each BT and stays in effect after ET.
const CHROMIUM_STREAM = `.23999999 0 0 -.23999999 0 792 cm
q
3.125 0 0 3.125 806.25 1181.25 cm
0 0 0 RG 0 0 0 rg
/G3 gs
9 52 282 2 re
S
.102 .0824 .0706 RG .102 .0824 .0706 rg
BT
/F5 20 Tf
1 0 0 -1 8 26 Tm
<0025004F00440046004E0003> Tj
ET
1 0 0 RG 1 0 0 rg
BT
/F7 20 Tf
1 0 0 -1 137.46875 26 Tm
<005500480047> Tj
ET
0 0 0 RG 0 0 0 rg
BT
/F5 20 Tf
1 0 0 -1 8 136 Tm
<005300580055004800030045004F00440046004E0003> Tj
ET
96.859375 137 85.53125 2 re
f
Q
`;

test("real Chromium stream: black/warm text goes gray; red text, rule and underline keep RGB", () => {
  const out = rewriteBlackText(CHROMIUM_STREAM);
  expect(out.match(/BT 0 g 0 G/g)?.length).toBe(2);
  expect(out).toContain("1 0 0 RG 1 0 0 rg\nBT\n"); // red text untouched
  // the rule before any BT is untouched
  expect(out).toContain("0 0 0 RG 0 0 0 rg\n/G3 gs\n9 52 282 2 re\nS");
  // the underline rect after the last ET is painted with the restored black
  expect(out).toMatch(/0 0 0 rg 0 0 0 RG ET\n96\.859375 137 85\.53125 2 re\nf/);
});
