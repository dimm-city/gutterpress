from pathlib import Path
import json,shutil,hashlib,re,time,subprocess
root=Path('/home/founder3/code/dimm-city/dc-op-manual/.worktrees/pdfx-field-guide-stress/.print-md/build/pdfx-ab-0.11.18-vs-42091ecc')
repo=Path('/tmp/pr388-field-guide-evidence');target=repo/'ab-0.11.18-vs-pr388';audit=Path('/tmp/pr388-ab-validation')
cases=['production-fonts','isolated','combined','boundary','production-fonts-effects']
while not (target/'README.md').exists() or not (target/'proof-extraction-check.json').exists():time.sleep(10)
while len(json.loads((root/'crop-provenance.json').read_text()))<6:time.sleep(10)
for case in cases+['opaque-gradients','resolution-control']:
    j=json.loads((audit/case/'summary.json').read_text())
    for mode,v in j['outputs'].items():
        assert v['pages']==j['source']['pages'] and v['sourcePagesEqual'],(case,mode)
        for k in ['boxMismatches','finalTransparency','unembeddedFonts','retainedMismatch']:assert not v[k],(case,mode,k)
        a=json.loads((audit/case/(mode+'-audit.json')).read_text())
        assert 'PDF/X-1a:2001' in a['metadata']['GTS_PDFXConformance'],(case,mode,'metadata')
        assert any(x['subtype']=='/GTS_PDFX' and x['hasProfile'] and x['channels']=='4' for x in a['outputIntents']),(case,mode,'intent')
    assert not j['outputs']['preserve']['nonFallbackMismatch'],case
    assert not j['comparison']['lostGlyphPages'],case
    shutil.copytree(audit/case,target/case/'audit',dirs_exist_ok=True)
    for p in (root/case/'previews').glob('*'):
        if p.name.startswith('compare-') or p.name.endswith('-compare.png'):shutil.copy2(p,target/case/'previews'/p.name)
proof=json.loads((target/'proof-extraction-check.json').read_text());assert len(proof)==18
assert all(x['pixelIdenticalAtHeight']==1200 and x['qpdfExit']==0 for x in proof)
shutil.copytree(root/'resolution-control/ink-control',target/'resolution-control/ink-control',dirs_exist_ok=True)
for n in ['source-equivalence.json','background-resolution.json','crop-provenance.json']:
    shutil.copy2(root/n,target/n)
for n in ['pr388-ab-ink.py','pr388-ab-finalize.py']:
    shutil.copy2(Path('/tmp')/n,target/'reproduction'/n)

# Check every relative Markdown destination in the new report, including images.
missing=[]
for dest in re.findall(r'\]\(([^)]+)\)',(target/'README.md').read_text()):
    if '://' in dest or dest.startswith('#'):continue
    if not (target/dest.split('#')[0]).exists():missing.append(dest)
assert not missing,missing
assert all(p.stat().st_size<100_000_000 for p in target.rglob('*') if p.is_file()),'GitHub file size limit'
files=[p for p in target.rglob('*') if p.is_file()]
manifest={str(p.relative_to(target)):{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(files)}
(target/'files.json').write_text(json.dumps(manifest,indent=2))
print('VALIDATED',len(files),'files',round(sum(p.stat().st_size for p in files)/1e6,2),'MB',flush=True)
