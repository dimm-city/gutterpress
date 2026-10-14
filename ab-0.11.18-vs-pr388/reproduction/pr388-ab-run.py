from pathlib import Path
import subprocess, json, shutil, datetime
book=Path('/home/founder3/code/dimm-city/dc-op-manual/.worktrees/pdfx-field-guide-stress')
old=book/'.print-md/build/pdfx-stress'
out=book/'.print-md/build/pdfx-ab-0.11.18-vs-42091ecc'
out.mkdir(parents=True,exist_ok=True)
status={}
for case in ['production-fonts','isolated','combined','boundary']:
    d=out/case;d.mkdir(exist_ok=True)
    src=old/'baseline.pdf' if case=='production-fonts' else old/'rerun-ff1022bf'/case/(case+'-pdf.pdf')
    css=old/'baseline.css' if case=='production-fonts' else old/'rerun-ff1022bf'/case/'styles.css'
    shutil.copy2(css,d/'styles.css')
    (d/'source-path.txt').write_text(str(src)+'\n')
    for version in ['v0.11.18','pr388']:
        dest=d/version;dest.mkdir(exist_ok=True)
        cmd=['bun','/tmp/pr388-ab-export.ts',version,str(src),str(dest),str(d/'styles.css')]
        with (dest/'export.log').open('w') as log:
            r=subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT)
        status[case+'/'+version]={'exit':r.returncode,'completed':datetime.datetime.now(datetime.timezone.utc).isoformat()}
        (out/'status.json').write_text(json.dumps(status,indent=2))
        print(case,version,r.returncode,flush=True)
        if r.returncode:raise SystemExit(r.returncode)
