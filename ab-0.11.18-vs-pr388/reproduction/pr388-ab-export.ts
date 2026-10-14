import { readFile, writeFile, copyFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const [version, source, out, css] = process.argv.slice(2);
if (!['v0.11.18', 'pr388'].includes(version) || !source || !out || !css) throw Error('version source out css required');
const root = version === 'v0.11.18' ? '/tmp/gutterpress-v0.11.18-ab' : '/tmp/gutterpress-pr388-evidence-head';
const gs = await import(join(root,'packages/cli/src/lib/ghostscript.ts'));
const { blackTextToGray } = await import(join(root,'packages/cli/src/lib/black-text-gray.ts'));
const { checkCss } = await import(join(root,'packages/cli/src/lib/printsafe.ts'));
await mkdir(out,{recursive:true});
// Other task-owned workers may request a case already being exported.
// A completed export is immutable; use an atomic directory as the per-output lock.
const complete=join(out,'export.json');
try { await stat(complete); console.log('Reusing completed export',out); process.exit(0); } catch {}
try { await mkdir(join(out,'running')); }
catch {
 while(true){
  try {await stat(complete);console.log('Concurrent export completed',out);process.exit(0);}catch{}
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
}
const stage=join(out,'stage'); await mkdir(stage,{recursive:true});
const working=join(stage,'working.pdf'), final=join(out,'book.pdf');
const bytes=await readFile(source), cssText=await readFile(css,'utf8');
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
await writeFile(join(out,'lint-findings.json'),JSON.stringify(checkCss(cssText,css),null,2));
await copyFile(source,working);
const times:Record<string,number>={};
const measure=async(name:string,fn:()=>Promise<unknown>)=>{const t=performance.now();await fn();times[name]=(performance.now()-t)/1000;};
let transparent:number[]|undefined, split:number[]|undefined, fallback:number[]|undefined, reasons:Map<number,string>|undefined;
let detectedTransparency:boolean|undefined;
const started=performance.now();
await measure('inspection',async()=>{
 if(version==='pr388'){
  transparent=await gs.transparentPages(bytes);
  const {unsplittableTextReasons}=await import(join(root,'packages/cli/src/lib/pdf-inspect.ts'));
  reasons=await unsplittableTextReasons(bytes);
  const gradients=await gs.findPostScriptShadingPages(bytes);
  for(const n of gradients)if(!reasons!.has(n))reasons!.set(n,'gradient');
  split=transparent!.filter(n=>!reasons!.has(n));fallback=transparent!.filter(n=>reasons!.has(n));
 }else detectedTransparency=await gs.hasLiveTransparency(bytes);
});
if(version==='pr388')await measure('split',()=>gs.flattenTransparentPages(working,split!,stage));
await measure('stripAnnotations',()=>gs.stripAnnotations(working,stage));
await measure('blackText',async()=>writeFile(working,await blackTextToGray(await readFile(working))));
await measure('cmyk',()=>gs.convertToPdfxCmyk(working,final,{iccPath:join(root,'packages/cli/profiles/CGATS21_CRPC1.icc'),pdfx:'x1a',title:'Dimm City Field Guide',maxTac:240,stagingDir:stage}));
times.total=(performance.now()-started)/1000;
const metadata={version,commit:version==='v0.11.18'?'dfc3645781d5917eb16894d58a691ccd1d87745c':'42091eccba9111df036e440a247830e0e7d84fb8',source,sourceSha256:hash(bytes),sourceBytes:bytes.length,css,cssSha256:hash(Buffer.from(cssText)),output:final,outputBytes:(await stat(final)).size,outputSha256:hash(await readFile(final)),detectedTransparency,transparent,split,fallback,reasons:reasons?Object.fromEntries(reasons):undefined,times};
await writeFile(join(out,'export.json'),JSON.stringify(metadata,null,2));
console.log(JSON.stringify(metadata));
