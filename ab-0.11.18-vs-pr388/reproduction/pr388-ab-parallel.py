from pathlib import Path
import subprocess, concurrent.futures, shutil
book=Path('/home/founder3/code/dimm-city/dc-op-manual/.worktrees/pdfx-field-guide-stress')
base=book/'.print-md/build/pdfx-stress/rerun-ff1022bf'
out=book/'.print-md/build/pdfx-ab-0.11.18-vs-42091ecc'
def run(case):
    d=out/case;d.mkdir(exist_ok=True)
    src=base/case/(case+'-pdf.pdf');css=base/case/'styles.css'
    shutil.copy2(css,d/'styles.css');(d/'source-path.txt').write_text(str(src)+'\n')
    for version in ['v0.11.18','pr388']:
        dest=d/version;dest.mkdir(exist_ok=True)
        with (dest/'worker.log').open('w') as log:
            r=subprocess.run(['bun','/tmp/pr388-ab-export.ts',version,str(src),str(dest),str(d/'styles.css')],stdout=log,stderr=subprocess.STDOUT)
        print(case,version,r.returncode,flush=True)
        if r.returncode:raise RuntimeError((case,version,r.returncode))
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    list(pool.map(run,['isolated','combined','boundary']))
