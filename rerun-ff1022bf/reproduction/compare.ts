/** Run with bun: compare.ts PR_ROOT SOURCE_PDF OUTPUT_DIR 1,2,4,7,...
 * Runs the exact PR functions on real pages; originals are never mutated.
 * Outputs source, split RGB, preserve PDF/X and default PDF/X for comparison.
 */
import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
const [prArg,inputArg,outArg,pageArg]=process.argv.slice(2);
if(!prArg||!inputArg||!outArg||!pageArg)throw Error('Usage: compare.ts PR_ROOT SOURCE_PDF OUTPUT_DIR 1,2,...');
const pr=resolve(prArg), input=resolve(inputArg),out=resolve(outArg);
const req=createRequire(join(pr,'packages/cli/package.json'));
const {PDFDocument}=await import(req.resolve('pdf-lib'));
const {transparentPages,findPostScriptShadingPages,flattenTransparentPages,stripAnnotations,convertToPdfxCmyk}=await import(join(pr,'packages/cli/src/lib/ghostscript.ts'));
const {pagesWithUnsplittableText}=await import(join(pr,'packages/cli/src/lib/pdf-inspect.ts'));
const {blackTextToGray}=await import(join(pr,'packages/cli/src/lib/black-text-gray.ts'));
await mkdir(out,{recursive:true});
const selected=pageArg.split(',').map(Number);const original=await PDFDocument.load(await readFile(input));
const sample=await PDFDocument.create();for(const p of await sample.copyPages(original,selected.map(n=>n-1)))sample.addPage(p);
const source=join(out,'source.pdf');await writeFile(source,await sample.save());
const bytes=await readFile(source),transparent=await transparentPages(bytes);
const textBlocked=await pagesWithUnsplittableText(bytes);
const gradientBlocked=findPostScriptShadingPages ? await findPostScriptShadingPages(bytes) : [];
const blocked=[...new Set([...textBlocked,...gradientBlocked])].sort((a,b)=>a-b),split=transparent.filter((n:number)=>!blocked.includes(n));
await writeFile(join(out,'pages.json'),JSON.stringify({selected,transparent,textBlocked,gradientBlocked,blocked,split},null,2));
const rgb=join(out,'split-rgb.pdf');await copyFile(source,rgb);
const stage=join(out,'stage');await mkdir(stage,{recursive:true});await flattenTransparentPages(rgb,split,stage);
for(const [mode,path] of [['preserve',rgb],['default',source]]){
 const working=join(stage,mode+'.pdf');await copyFile(path,working);
 await stripAnnotations(working,stage);await writeFile(working,await blackTextToGray(await readFile(working)));
 await convertToPdfxCmyk(working,join(out,mode+'.pdf'),{iccPath:join(pr,'packages/cli/profiles/CGATS21_CRPC1.icc'),pdfx:'x1a',title:'Dimm City Field Guide CSS stress test',maxTac:240,stagingDir:stage});
}
console.log(JSON.stringify({out,selected,blocked,split}));
