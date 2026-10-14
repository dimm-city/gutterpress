from pathlib import Path
import subprocess, json, shutil, time
b=Path('/home/founder3/code/dimm-city/dc-op-manual/.worktrees/pdfx-field-guide-stress')
out=b/'.print-md/build/pdfx-ab-0.11.18-vs-42091ecc/production-fonts-effects'
css=b/'field-guide/styles/fg-overrides.css'
manifest=b/'field-guide/manifest.ab-v0.11.18.yaml'
manifest.write_text((b/'field-guide/manifest.yaml').read_text().replace('  transparency: preserve-text\n',''))
root=Path('/tmp/gutterpress-v0.11.18-ab')
cmd=['bun',str(root/'packages/cli/src/cli.ts'),'build',str(b/'field-guide'),'--manifest',str(manifest),'--format','pdf','--out',str(out/'source.pdf')]
try:
    with (out/'source-build.log').open('w') as log:
        r=subprocess.run(cmd,cwd=root,stdout=log,stderr=subprocess.STDOUT)
    (out/'source-build-status.json').write_text(json.dumps({'exit':r.returncode,'command':cmd},indent=2))
    if r.returncode:raise SystemExit(r.returncode)
finally:
    css.write_text((out/'restore-styles.css').read_text())
(out/'source-path.txt').write_text(str(out/'source.pdf')+'\n')
# Avoid overlapping the export runs; the first process exports its four cases.
while True:
    try:status=json.loads((out.parent/'status.json').read_text())
    except (FileNotFoundError,json.JSONDecodeError):status={}
    if any(v['exit'] for v in status.values()):raise RuntimeError(status)
    if len(status)==8:break
    time.sleep(10)
for version in ['v0.11.18','pr388']:
    dest=out/version;dest.mkdir(exist_ok=True)
    with (dest/'export.log').open('w') as log:
        r=subprocess.run(['bun','/tmp/pr388-ab-export.ts',version,str(out/'source.pdf'),str(dest),str(out/'styles.css')],stdout=log,stderr=subprocess.STDOUT)
    print('production-fonts-effects',version,r.returncode,flush=True)
    if r.returncode:raise SystemExit(r.returncode)
