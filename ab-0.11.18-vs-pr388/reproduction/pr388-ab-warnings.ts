import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const root='/home/founder3/code/dimm-city/dc-op-manual/.worktrees/pdfx-field-guide-stress';
const old=await import('/tmp/gutterpress-v0.11.18-ab/packages/cli/src/lib/printsafe.ts');
const next=await import('/tmp/gutterpress-pr388-evidence-head/packages/cli/src/lib/printsafe.ts');
const output=join(root,'.print-md/build/pdfx-ab-0.11.18-vs-42091ecc');
const results:Record<string,unknown>={};
for(const name of ['combined','isolated','boundary']){
 const file=join(root,'.print-md/build/pdfx-stress/rerun-ff1022bf',name,'styles.css');
 const css=await readFile(file,'utf8');
 results[name]={source:file,old:old.checkCss(css,file),pr:next.checkCss(css,file)};
}
await writeFile(join(output,'warning-comparison.json'),JSON.stringify(results,null,2));
for(const [name,value] of Object.entries(results)){
 const v=value as {old:unknown[],pr:unknown[]};console.log(name,v.old.length,v.pr.length);
}
