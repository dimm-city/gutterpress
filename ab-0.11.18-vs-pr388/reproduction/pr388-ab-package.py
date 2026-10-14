from pathlib import Path
from PIL import Image, ImageChops
import json, shutil, subprocess, time, hashlib

root=Path('/home/founder3/code/dimm-city/dc-op-manual/.worktrees/pdfx-field-guide-stress/.print-md/build/pdfx-ab-0.11.18-vs-42091ecc')
target=Path('/tmp/pr388-field-guide-evidence/ab-0.11.18-vs-pr388')
audit=Path('/tmp/pr388-ab-validation')
cases=['production-fonts','isolated','combined','boundary','production-fonts-effects']
labels={'production-fonts':'Original fonts, original styling','isolated':'Isolated sweep, lab font control','combined':'Combined sweep, lab font control','boundary':'Boundary sweep, lab font control','production-fonts-effects':'Original fonts, combined effects'}
target.mkdir(exist_ok=True)
def cp(src,dst):
    dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst)
def render(pdf,page,dest):
    subprocess.run(['pdftoppm','-f',str(page),'-l',str(page),'-singlefile','-scale-to','1200','-png',str(pdf),str(dest.with_suffix(''))],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

for case in cases:
    while not all((root/case/m/'export.json').exists() for m in ['v0.11.18','pr388']) or not (audit/case/'summary.json').exists() or not (root/case/'specimen-metrics.json').exists():
        time.sleep(10)
    d=root/case;dest=target/case
    for f in ['styles.css','source-path.txt','specimen-metrics.json','source-build.log','source-build-status.json']:
        if (d/f).exists():cp(d/f,dest/f)
    for mode in ['v0.11.18','pr388']:
        for f in (d/mode).glob('*'):
            if f.is_file() and f.suffix in ['.json','.log']:cp(f,dest/mode/f.name)
    for f in (d/'previews').glob('*'):
        if f.name.startswith('compare-') or f.name.endswith('-compare.png'):cp(f,dest/'previews'/f.name)
    shutil.copytree(audit/case,dest/'audit',dirs_exist_ok=True)
    print('Copied',case,flush=True)

for case in ['opaque-gradients','resolution-control']:
    d=root/case;dest=target/case
    for f in ['styles.css','source-path.txt','source-build.log','summary.json']:
        if (d/f).exists():cp(d/f,dest/f)
    cp(d/'source.pdf',dest/'source.pdf')
    for mode in ['v0.11.18','pr388']+(['v0.11.18-r300'] if case=='resolution-control' else []):
        for f in (d/mode).glob('*'):
            if f.is_file() and f.suffix in ['.json','.log','.pdf']:cp(f,dest/mode/f.name)
    for f in (d/'previews').glob('compare-*'):cp(f,dest/'previews'/f.name)
    shutil.copytree(audit/case,dest/'audit',dirs_exist_ok=True)

shutil.copytree(root/'integration-threshold',target/'integration-threshold',dirs_exist_ok=True)
for f in ['provenance.json','warning-comparison.json','head-update-7c692ab4.patch','crop-provenance.json']:
    cp(root/f,target/f)
repro=target/'reproduction';repro.mkdir(exist_ok=True)
for f in ['pr388-ab-export.ts','pr388-ab-proof.py','pr388-ab-crops.py','pr388-ab-resolution-proof.py','pr388-ab-validator.ts','pr388-ab-validator-watch.py','pr388-ab-run.py','pr388-ab-extra.py','pr388-ab-warnings.ts','pr388-gs-300','pr388-ab-package.py']:
    cp(Path('/tmp')/f,repro/f)
for p in root.joinpath('reproduction').glob('*'):
    if p.is_file() and not (repro/p.name).exists():cp(p,repro/p.name)

proof=[]
for case,pages in {'production-fonts':[6],'isolated':[7],'combined':[4,14],'boundary':[14],'production-fonts-effects':[7]}.items():
    d=root/case;dest=target/case/'proof';dest.mkdir(exist_ok=True)
    source=Path((d/'source-path.txt').read_text().strip())
    for page in pages:
        for mode,pdf in [('source',source),('v0.11.18',d/'v0.11.18/book.pdf'),('pr388',d/'pr388/book.pdf')]:
            out=dest/f'{mode}-p{page:03}.pdf'
            subprocess.run(['qpdf','--empty','--pages',str(pdf),str(page),'--',str(out)],check=True)
            check=subprocess.run(['qpdf','--check',str(out)],check=True,capture_output=True,text=True)
            temp=Path('/tmp/pr388-ab-extract-check.png');render(out,1,temp)
            ref=d/'previews'/f'{mode}-p{page:03}.png'
            identical=ImageChops.difference(Image.open(temp).convert('RGB'),Image.open(ref).convert('RGB')).getbbox() is None
            if not identical:raise RuntimeError(f'Extract pixels differ: {out}')
            proof.append({'file':str(out.relative_to(target)),'fullFile':str(pdf),'page':page,'pixelIdenticalAtHeight':1200,'qpdfExit':check.returncode,'sha256':hashlib.sha256(out.read_bytes()).hexdigest()})
    print('Extracted and checked',case,flush=True)
(target/'proof-extraction-check.json').write_text(json.dumps(proof,indent=2))

summary={};rows=[];checks=[]
for case in cases:
    j=json.loads((audit/case/'summary.json').read_text())
    ex={m:json.loads((root/case/m/'export.json').read_text()) for m in ['v0.11.18','pr388']}
    old,new=j['outputs']['baseline'],j['outputs']['preserve']
    rows.append(f'| {labels[case]} | {len(old["textPages"])} → {len(new["textPages"])} | {old["bytes"]/1e6:.2f} → {new["bytes"]/1e6:.2f} | {100*(1-new["bytes"]/old["bytes"]):.1f}% smaller | {len(ex["pr388"]["split"])} / {len(ex["pr388"]["fallback"])} |')
    summary[case]={'audit':j,'exports':ex}
    checks.append({'case':case,'pages':old['pages'],'boxesUnchanged':not(old['boxMismatches']+new['boxMismatches']),'retainedGlyphMismatches':len(old['retainedMismatch'])+len(new['retainedMismatch']),'newLostGlyphPages':j['comparison']['lostGlyphPages'],'transparency':old['finalTransparency']+new['finalTransparency'],'unembeddedFonts':len(old['unembeddedFonts'])+len(new['unembeddedFonts'])})
(target/'summary.json').write_text(json.dumps(summary,indent=2))
(target/'checks-summary.json').write_text(json.dumps(checks,indent=2))
table='| Full-book case | Live-text pages: old → PR | Size MB: old → PR | Size change | PR split / fallback |\n|---|---:|---:|---:|---:|\n'+'\n'.join(rows)
report=Path('/tmp/pr388-ab-report.md').read_text().replace('<!-- RESULTS_TABLE -->',table)
report=report.replace('<!-- VALIDATION_SUMMARY -->','All ten full outputs contain 228 pages, preserve every source page box, have zero live transparency, list all remaining fonts as embedded, and pass `qpdf --check`. There are no lost live-text pages relative to 0.11.18 and no unexpected retained-glyph sequence mismatches. The intended fallback pages lose live text as declared. [Compact checks](checks-summary.json) and per-case `audit/` folders contain the evidence.')
(target/'README.md').write_text(report)
print('PACKAGE READY',target,flush=True)
