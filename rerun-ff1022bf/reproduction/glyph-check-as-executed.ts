import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { getDocumentProxy } from '/tmp/gutterpress-pr388-evidence-head/node_modules/unpdf/dist/index.mjs';
import { OPS } from '/tmp/gutterpress-pr388-evidence-head/node_modules/unpdf/dist/pdfjs.mjs';
const sweep=process.argv[2];
if(!['combined','isolated','boundary'].includes(sweep))throw new Error('Supply sweep');
const base='/home/founder3/code/dimm-city/dc-op-manual/.worktrees/pdfx-field-guide-stress/.print-md/build/pdfx-stress/rerun-ff1022bf';
const dir=`${base}/${sweep}`,out=`/tmp/fg-validation-latest/${sweep}`;
await mkdir(out,{recursive:true});
const log=(await readFile(`${dir}/pdfx.log`,'utf8')).replace(/\x1b\[[0-9;]*m/g,'');
if(!log.includes(`Wrote: ${dir}/${sweep}-pdfx.pdf`))throw new Error('PDF/X completion log not found; do not read partial output');
const fallback=log.match(/Pages? ([0-9, ]+) could not keep/);
const blocked=new Set(fallback?fallback[1].split(',').map(x=>Number(x.trim())):[]);
const src=await getDocumentProxy(new Uint8Array(await readFile(`${dir}/${sweep}-pdf.pdf`)));
const dst=await getDocumentProxy(new Uint8Array(await readFile(`${dir}/${sweep}-pdfx.pdf`)));
if(src.numPages!==dst.numPages)throw new Error(`Page count mismatch ${src.numPages} vs ${dst.numPages}`);
const names=Object.fromEntries(Object.entries(OPS).map(([k,v])=>[v,k]));
const show=new Set(['showText','showSpacedText','nextLineShowText','nextLineSetSpacingShowText']);
const counts=(s:string)=>{const c:Record<string,number>={};for(const x of s)c[x]=(c[x]??0)+1;return c;};
async function inspect(doc:any,pno:number){
 const page=await doc.getPage(pno);const ops=await page.getOperatorList();const chars:string[]=[];
 for(let i=0;i<ops.fnArray.length;i++)if(show.has(names[ops.fnArray[i]])){
  const walk=(v:any)=>{if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object'&&'unicode' in v)chars.push(v.unicode);};walk(ops.argsArray[i]);
 }
 page.cleanup();return chars.join('');
}
const rows:any[]=[],mismatches:any[]=[];
try{
 for(let page=1;page<=src.numPages;page++){
  if(blocked.has(page)){rows.push({page,fallback:true});continue;}
  const a=await inspect(src,page),b=await inspect(dst,page),ca=counts(a),cb=counts(b);
  const delta=Object.fromEntries([...new Set([...Object.keys(ca),...Object.keys(cb)])].filter(k=>ca[k]!==cb[k]).map(k=>[k,{source:ca[k]??0,final:cb[k]??0}]));
  const row={page,fallback:false,sourceGlyphs:[...a].length,finalGlyphs:[...b].length,sequenceEqual:a===b,inventoryEqual:Object.keys(delta).length===0};rows.push(row);
  if(a!==b){mismatches.push({...row,delta});await writeFile(`${out}/page-${page}.json`,JSON.stringify({source:a,final:b,delta},null,2));}
  if(page%25===0)console.log(`${sweep}: checked through p${page}`);
 }
}finally{await src.destroy();await dst.destroy();}
const report={sweep,prCommit:'ff1022bf061e18a10afeaf4e15414f3bd0cd3c1e',source:`${dir}/${sweep}-pdf.pdf`,final:`${dir}/${sweep}-pdfx.pdf`,pages:rows.length,fallback:[...blocked],checked:rows.filter(x=>!x.fallback).length,exactSequenceMatches:rows.filter(x=>!x.fallback&&x.sequenceEqual).length,inventoryMatches:rows.filter(x=>!x.fallback&&x.inventoryEqual).length,mismatches,rows};
await writeFile(`${out}/glyph-retention.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,rows:undefined},null,2));
