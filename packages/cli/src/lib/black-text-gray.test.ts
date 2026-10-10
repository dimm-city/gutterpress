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

describe("24pt threshold (#336)", () => {
  // Chromium page prologue: `cm` flips and scales px → pt (0.24 × 3.125 = 0.75).
  const wrap = (body: string) => `.24 0 0 -.24 0 792 cm\nq\n3.125 0 0 3.125 0 0 cm\n0 0 0 RG 0 0 0 rg\n${body}\nQ\n`;
  const text = (size: number) => wrap(`BT\n/F5 ${size} Tf\n1 0 0 -1 8 26 Tm\n<0025> Tj\nET`);

  test("text at 24pt and below goes K-only, text above stays rich", () => {
    expect(rewriteBlackText(text(16))).toContain("BT 0 g 0 G");
    expect(rewriteBlackText(text(32))).toContain("BT 0 g 0 G"); // 32px = 24pt exactly
    expect(rewriteBlackText(text(33.3))).toBe(text(33.3)); // 24.98pt
    expect(rewriteBlackText(text(53.33))).toBe(text(53.33)); // 40pt
  });

  test("the text matrix scales the size too (Tf 1 + Tm 24 = 24pt, Tm 26 = 26pt)", () => {
    const tm = (n: number) => `0 0 0 rg BT /F1 1 Tf ${n} 0 0 -${n} 10 10 Tm <01> Tj ET`;
    expect(rewriteBlackText(tm(24))).toContain("BT 0 g");
    expect(rewriteBlackText(tm(26))).toBe(tm(26));
    // rotation and flips do not change the size
    expect(rewriteBlackText("0 0 0 rg BT /F1 1 Tf 0 30 -30 0 10 10 Tm <01> Tj ET")).toBe(
      "0 0 0 rg BT /F1 1 Tf 0 30 -30 0 10 10 Tm <01> Tj ET"
    );
  });

  test("a cm inside q/Q applies only until Q", () => {
    const src = "0 0 0 rg q 3 0 0 3 0 0 cm BT /F1 10 Tf <01> Tj ET Q BT /F1 10 Tf <02> Tj ET";
    const out = rewriteBlackText(src);
    // 30pt stays rich; after Q the 10pt run goes gray
    expect(out).toBe(
      "0 0 0 rg q 3 0 0 3 0 0 cm BT /F1 10 Tf <01> Tj ET Q BT 0 g /F1 10 Tf <02> Tj 0 0 0 rg ET"
    );
  });

  test("a Tf inside one BT switches between K-only and rich and back", () => {
    const out = rewriteBlackText("0 0 0 rg BT /F1 10 Tf <01> Tj /F1 40 Tf <02> Tj /F1 10 Tf <03> Tj ET");
    expect(out).toBe(
      "0 0 0 rg BT 0 g /F1 10 Tf <01> Tj /F1 40 Tf 0 0 0 rg <02> Tj /F1 10 Tf 0 g <03> Tj 0 0 0 rg ET"
    );
  });

  test("a near-black rg set after a large Tf stays rich", () => {
    const src = "BT /F1 40 Tf 0 0 0 rg <01> Tj ET";
    expect(rewriteBlackText(src)).toBe(src);
  });
});

describe("underline / strike-through (#336)", () => {
  // Verbatim shape of Chromium's tagged output: one marked-content span holds a
  // text run and its decoration, before or after the BT…ET.
  const doc = (body: string) =>
    `.24 0 0 -.24 0 792 cm\nq\n3.125 0 0 3.125 0 0 cm\n0 0 0 RG 0 0 0 rg\n${body}\nQ\n`;
  const run = (size: number) => `BT\n/F5 ${size} Tf\n1 0 0 -1 66 93 Tm\n<0058> Tj\nET`;
  const span = (mcid: number, inner: string) => `/NonStruct <</MCID ${mcid} >>BDC\n${inner}\nEMC\n`;

  test("a thin rect before small text in its span prints K-only", () => {
    const out = rewriteBlackText(doc(span(3, `66 94 36 1 re\nf\n${run(16)}`)));
    expect(out).toContain("q 0 g 66 94 36 1 re\nf Q");
  });

  test("a thin rect after small text in its span prints K-only", () => {
    const out = rewriteBlackText(doc(span(5, `${run(16)}\n134 88 35 1 re\nf`)));
    expect(out).toContain("q 0 g 134 88 35 1 re\nf Q");
  });

  test("the decoration of large text stays rich", () => {
    const src = doc(span(6, `8 169 199 3 re\nf\n${run(33.33)}`));
    expect(rewriteBlackText(src)).toBe(src);
  });

  test("a rule in a span with no text, or outside any span, stays rich", () => {
    const rule = doc(span(0, "0 70 480 1 re\nf") + span(1, run(16)));
    expect(rewriteBlackText(rule)).not.toContain("q 0 g");
    const bare = doc(`${run(16)}\n10 10 50 1 re\nf`); // untagged stream: nothing to anchor on
    expect(rewriteBlackText(bare)).not.toContain("q 0 g");
  });

  test("a rect too thick to be a decoration of that text stays rich", () => {
    const src = doc(span(2, `66 94 36 20 re\nf\n${run(16)}`));
    expect(rewriteBlackText(src)).not.toContain("q 0 g");
  });

  test("only a bare `re f` counts: a path or a stroke between them disqualifies", () => {
    const src = doc(span(2, `66 94 36 1 re\n10 10 m\nf\n${run(16)}`));
    expect(rewriteBlackText(src)).not.toContain("q 0 g");
  });

  test("a rect nested in an outer span still finds its text in the parent", () => {
    const out = rewriteBlackText(
      doc(`/P <</MCID 1 >>BDC\n${span(2, "66 94 36 1 re\nf")}${run(16)}\nEMC`)
    );
    expect(out).toContain("q 0 g 66 94 36 1 re\nf Q");
  });
});

describe("form XObject size context (#336)", () => {
  const mk = (formContent: string, pageContent: string) =>
    pdfOf((ctx, page, { PDFName }) => {
      const form = ctx.register(
        ctx.flateStream(formContent, { Type: "XObject", Subtype: "Form", BBox: [0, 0, 100, 100] })
      );
      page.node.set(PDFName.of("Contents"), ctx.register(ctx.flateStream(pageContent)));
      page.node.set(PDFName.of("Resources"), ctx.obj({ XObject: { Fm0: form } }));
    });
  const FORM = "0 0 0 rg BT /F1 40 Tf <01> Tj ET";

  test("a form drawn under a 0.5 CTM is 20pt: K-only; under 1.0 it is 40pt: rich", async () => {
    const small = await streamsOf(await blackTextToGray(await mk(FORM, "q .5 0 0 .5 0 0 cm /Fm0 Do Q")), "Form");
    expect(small[0]).toContain("BT 0 g");
    const big = await mk(FORM, "q 1 0 0 1 5 5 cm /Fm0 Do Q");
    expect(await blackTextToGray(big)).toBe(big);
  });

  test("drawn at two sizes, the smaller wins; never drawn means unknown, so K-only", async () => {
    const twice = await streamsOf(
      await blackTextToGray(await mk(FORM, "q 1 0 0 1 0 0 cm /Fm0 Do Q q .5 0 0 .5 0 0 cm /Fm0 Do Q")),
      "Form"
    );
    expect(twice[0]).toContain("BT 0 g");
    const never = await streamsOf(await blackTextToGray(await mk(FORM, "")), "Form");
    expect(never[0]).toContain("BT 0 g");
  });
});
