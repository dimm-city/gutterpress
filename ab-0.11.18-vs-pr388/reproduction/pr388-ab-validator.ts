import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

// Read-only PDF audit. Outputs only /tmp/pr388-ab-validation/<variant>/.
// Usage: bun /tmp/pr388-ab-validator.ts VARIANT SOURCE BASELINE PR [ADDITIONAL_CONTROL]
const [variant, sourceArg, baselineArg, prArg, defaultArg] = process.argv.slice(2);
const sourceOnly = baselineArg === '--source-only';
if (!variant || !sourceArg || !baselineArg || (!sourceOnly && !prArg) || !/^[a-z0-9-]+$/.test(variant))
  throw Error('Usage: VARIANT SOURCE BASELINE PR [CURRENT_DEFAULT]');
const out = `/tmp/pr388-ab-validation/${variant}`;
const repo = '/tmp/gutterpress-pr388-evidence-head';
const req = createRequire(join(repo, 'packages/cli/package.json'));
const { PDFDocument, PDFName, PDFArray, PDFDict, PDFRawStream } = await import(req.resolve('pdf-lib'));
const { getDocumentProxy } = await import(req.resolve('unpdf'));
const { OPS } = await import(join(repo, 'node_modules/unpdf/dist/pdfjs.mjs'));
const { transparentPages, findPostScriptShadingPages } = await import(join(repo, 'packages/cli/src/lib/ghostscript.ts'));
const { unsplittableTextReasons } = await import(join(repo, 'packages/cli/src/lib/pdf-inspect.ts'));
await mkdir(out, { recursive: true });
const hash = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
function cmd(name: string, args: string[], allowWhitespace = false) {
  const r = spawnSync(name, args, { encoding: 'utf8', maxBuffer: 50e6 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw Error(`${name} exited ${r.status}: ${r.stderr}`);
  if (!r.stdout || (!allowWhitespace && !r.stdout.trim())) throw Error(`${name} returned empty stdout (possible sandbox capture issue)`);
  return r.stdout;
}
const show = new Set([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText].filter(x => x !== undefined));
const names = Object.fromEntries(Object.entries(OPS).map(([k,v]) => [v as number,k]));
async function inspect(label: string, path: string) {
  const bytes = await readFile(path);
  const pdoc = await PDFDocument.load(bytes, { updateMetadata: false });
  const boxes = pdoc.getPages().map(p => ({ media: p.getMediaBox(), crop: p.getCropBox(), trim: p.getTrimBox(), bleed: p.getBleedBox(), rotation: p.getRotation().angle }));
  const transparency = await transparentPages(bytes);
  const metadata: Record<string, unknown> = {};
  const info = pdoc.context.lookup(pdoc.context.trailerInfo.Info);
  if (info instanceof PDFDict) for (const name of ['GTS_PDFXVersion','GTS_PDFXConformance','Trapped','Producer']) metadata[name] = String(info.get(PDFName.of(name)) ?? '');
  const intents = pdoc.catalog.lookup(PDFName.of('OutputIntents'));
  const outputIntents: unknown[] = [];
  if (intents instanceof PDFArray) for (const ref of intents.asArray()) {
    const intent = pdoc.context.lookup(ref);
    if (!(intent instanceof PDFDict)) continue;
    const profile = pdoc.context.lookup(intent.get(PDFName.of('DestOutputProfile')));
    outputIntents.push({ subtype: String(intent.get(PDFName.of('S')) ?? ''), identifier: String(intent.get(PDFName.of('OutputConditionIdentifier')) ?? ''), hasProfile: profile instanceof PDFRawStream, channels: profile instanceof PDFRawStream ? String(profile.dict.get(PDFName.of('N'))) : null });
  }
  const tools: Record<string,string> = {};
  tools.qpdf = cmd('qpdf', ['--check', path]);
  tools.fonts = cmd('pdffonts', [path]);
  tools.images = cmd('pdfimages', ['-list', path]);
  tools.info = cmd('pdfinfo', ['-box', path]);
  const rawText = cmd('pdftotext', ['-layout', path, '-'], true);
  for (const [name, text] of Object.entries(tools)) await writeFile(join(out, `${label}-${name}.txt`), text);
  const fontRows = tools.fonts.split('\n').slice(2).filter(l => l.trim()).map(l => {
    const t = l.trim().split(/\s+/); return { raw: l, name: t[0], embedded: t.at(-5) === 'yes', subset: t.at(-4) === 'yes', toUnicode: t.at(-3) === 'yes' };
  });
  const imageRows = tools.images.split('\n').slice(2).filter(l => /^\s*\d+\s+\d+/.test(l)).map(l => {
    const t = l.trim().split(/\s+/); return { page: +t[0], index: +t[1], type: t[2], width: +t[3], height: +t[4], color: t[5], components: +t[6], bits: +t[7], encoding: t[8], object: `${t[10]} ${t[11]}`, xPpi: +t[12], yPpi: +t[13] };
  });
  const textPages = rawText.split('\f').slice(0, boxes.length).map(t => t.replace(/\s/g, '').length);
  // Skip image decoding only in the glyph/operator audit. Poppler independently
  // measures observed image placements, but can omit tiling-pattern backgrounds.
  // Neither list substitutes for visual renders or a complete source-detail audit.
  const doc = await getDocumentProxy(new Uint8Array(bytes), { maxImageSize: 1, verbosity: 0 });
  const glyphs: string[] = [];
  const rows: unknown[] = [];
  try {
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo);
      const ops = await page.getOperatorList();
      const chars: string[] = [];
      const counts: Record<string,number> = {};
      const walk = (v: any) => { if (Array.isArray(v)) v.forEach(walk); else if(v && typeof v === 'object' && 'unicode' in v) chars.push(v.unicode); };
      for (let i = 0; i < ops.fnArray.length; i++) {
        const op = ops.fnArray[i]; counts[names[op] ?? String(op)] = (counts[names[op] ?? String(op)] ?? 0) + 1;
        if (show.has(op)) walk(ops.argsArray[i]);
      }
      const sequence = chars.join(''); glyphs.push(sequence);
      rows.push({ page: pageNo, glyphs: [...sequence].length, glyphSequenceSha256: hash(sequence), popplerNonWhitespaceChars: textPages[pageNo-1] ?? 0, operators: counts, images: imageRows.filter(x=>x.page===pageNo) });
      page.cleanup();
      if (pageNo % 50 === 0) console.log(`${variant} ${label}: p${pageNo}/${doc.numPages}`);
    }
  } finally { await doc.destroy(); }
  const data = { label, path, bytes: bytes.length, sha256: hash(bytes), pages: boxes.length, boxes, transparency, metadata, outputIntents, fonts: fontRows, unembeddedFonts: fontRows.filter(f=>!f.embedded), images: imageRows, imageAuditScope: 'Poppler pdfimages -list observed placements; tiling-pattern backgrounds can be omitted. This is not an exhaustive source-detail audit.', textPages: textPages.map((n,i)=>n>0?i+1:0).filter(Boolean), glyphPages: glyphs.map((s,i)=>s.length>0?i+1:0).filter(Boolean), glyphAuditOptions: { maxImageSize: 1, reason: 'Skip expensive image decoding; observed image placements independently measured by pdfimages -list.' }, rows };
  await writeFile(join(out, `${label}-audit.json`), JSON.stringify(data,null,2));
  console.log(JSON.stringify({variant,label,pages:data.pages,bytes:data.bytes,textPages:data.textPages.length,transparentPages:transparency.length,fonts:fontRows.length,unembedded:data.unembeddedFonts.length}));
  return { data, glyphs };
}

const source = await inspect('source', resolve(sourceArg));
const sourceBytes = await readFile(resolve(sourceArg));
const reasons = await unsplittableTextReasons(sourceBytes);
const gradients = await findPostScriptShadingPages(sourceBytes);
for (const n of gradients) if (!reasons.has(n)) reasons.set(n,'gradient');
const fallback = source.data.transparency.filter((p:number)=>reasons.has(p));
const eligible = source.data.transparency.filter((p:number)=>!reasons.has(p));
if (sourceOnly) {
  const summary = { variant, source: source.data.path, sha256: source.data.sha256, pages: source.data.pages, textPages: source.data.textPages, glyphPages: source.data.glyphPages, transparentPages: source.data.transparency, eligible, fallback, reasons: Object.fromEntries(reasons), gradients, eligibleWithGlyphs: eligible.filter((p:number)=>source.data.glyphPages.includes(p)), fallbackWithGlyphs: fallback.filter((p:number)=>source.data.glyphPages.includes(p)) };
  await writeFile(join(out,'source-eligibility.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify({variant,pages:summary.pages,textPages:summary.textPages.length,transparentPages:summary.transparentPages.length,eligible:eligible.length,fallback:fallback.length,eligibleWithGlyphs:summary.eligibleWithGlyphs,fallbackWithGlyphs:summary.fallbackWithGlyphs.length}));
  process.exit(0);
}
const outputs: Record<string,any> = {};
const extraLabel = defaultArg?.includes('/v0.11.18-r300/') ? 'baseline-r300' : 'current-default';
for (const [label, path] of [['baseline',baselineArg],['preserve',prArg],...(defaultArg ? [[extraLabel,defaultArg]] : [])]) {
  const result = await inspect(label, resolve(path));
  const mismatches = source.glyphs.flatMap((s,i)=>s !== result.glyphs[i] ? [{ page:i+1, sourceGlyphs:[...s].length, finalGlyphs:[...(result.glyphs[i]??'')].length, expectedFallback:fallback.includes(i+1) }] : []);
  const inventoryMismatch = (a:string,b:string) => { const f=(s:string)=>{const c:Record<string,number>={};for(const x of s)c[x]=(c[x]??0)+1;return c;};const ac=f(a),bc=f(b);return Object.keys({...ac,...bc}).some(k=>ac[k]!==bc[k]); };
  const retainedMismatch = mismatches.filter(r=>r.sourceGlyphs>0 && r.finalGlyphs>0).map(r=>({...r, inventoryMismatch: inventoryMismatch(source.glyphs[r.page-1],result.glyphs[r.page-1])}));
  const boxMismatches = source.data.boxes.flatMap((b:any,i:number)=>JSON.stringify(b)!==JSON.stringify(result.data.boxes[i])?[i+1]:[]);
  outputs[label] = { path:result.data.path, bytes:result.data.bytes, sha256:result.data.sha256, pages:result.data.pages, sourcePagesEqual:result.data.pages===source.data.pages, boxMismatches, textPages:result.data.textPages, glyphPages:result.data.glyphPages, lostGlyphPages:source.data.glyphPages.filter((p:number)=>!result.data.glyphPages.includes(p)), finalTransparency:result.data.transparency, unembeddedFonts:result.data.unembeddedFonts, exactGlyphSequencePages:source.data.pages-mismatches.length, mismatches, retainedMismatch, nonFallbackExactGlyphPages:source.data.pages-fallback.length-mismatches.filter(r=>!fallback.includes(r.page)).length, nonFallbackMismatch:mismatches.filter(r=>!fallback.includes(r.page)), fullPageImagePpiHistogram: {}, imagePpiHistogram: {} };
  for (const img of result.data.images.filter((x:any)=>x.type==='image')) {
    const k=`${img.xPpi}x${img.yPpi}`;outputs[label].imagePpiHistogram[k]=(outputs[label].imagePpiHistogram[k]??0)+1;
    const box=result.data.boxes[img.page-1].media;
    if (Math.abs(img.width/img.xPpi*72-box.width)<box.width*.03 && Math.abs(img.height/img.yPpi*72-box.height)<box.height*.03) outputs[label].fullPageImagePpiHistogram[k]=(outputs[label].fullPageImagePpiHistogram[k]??0)+1;
  }
}
const gained = outputs.preserve.glyphPages.filter((p:number)=>!outputs.baseline.glyphPages.includes(p));
const lost = outputs.baseline.glyphPages.filter((p:number)=>!outputs.preserve.glyphPages.includes(p));
const summary = { variant, inspectorCommit:cmd('git',['-C',repo,'rev-parse','HEAD']).trim(), source:{path:source.data.path,bytes:source.data.bytes,sha256:source.data.sha256,pages:source.data.pages,textPages:source.data.textPages,glyphPages:source.data.glyphPages,transparentPages:source.data.transparency}, expectedPreserve:{eligible,fallback,reasons:Object.fromEntries(reasons),gradients}, outputs, comparison:{ gainedGlyphPages:gained, lostGlyphPages:lost, bytesDelta:outputs.preserve.bytes-outputs.baseline.bytes, bytesRatio:outputs.preserve.bytes/outputs.baseline.bytes }, scope:'Technical audit of identical source PDFs. Glyph retention does not prove correct visual compositing. No physical press proof, peak-TAC measurement, or full PDF/X certification.' };
await writeFile(join(out,'summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify({variant,gained:gained.length,lost:lost.length,bytesRatio:summary.comparison.bytesRatio,summary:join(out,'summary.json')}));
