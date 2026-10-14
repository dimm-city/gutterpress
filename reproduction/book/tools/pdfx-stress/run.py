#!/usr/bin/env python3
"""Render a Field Guide CSS sweep with an explicit Gutterpress source checkout."""
import argparse, pathlib, subprocess, datetime
p=argparse.ArgumentParser()
p.add_argument("--pr-root",required=True,type=pathlib.Path)
p.add_argument("--sweep",choices=["combined","isolated","boundary"],default="combined")
p.add_argument("--pdfx",action="store_true",help="Also produce preserve-text PDF/X")
p.add_argument("--out",type=pathlib.Path)
a=p.parse_args(); pr=a.pr_root.resolve(); root=pathlib.Path(__file__).resolve().parents[2]
css=root/"field-guide/styles/fg-overrides.css"; original=css.read_text()
marker="/* PDFX STRESS LAB"
base=original.split(marker)[0]
out=(a.out or root/".print-md/build/pdfx-stress"/datetime.datetime.now().strftime("rerun-%Y%m%d-%H%M%S")).resolve(); out.mkdir(parents=True,exist_ok=True)
cmd=["bun",str(pr/"packages/cli/src/cli.ts"),"build",str(root/"field-guide")]
if a.sweep=="boundary":cmd += ["--manifest",str(root/"field-guide/manifest.pdfx-stress.yaml")]
try:
    css.write_text(base+(root/"tools/pdfx-stress"/(a.sweep+".css")).read_text())
    (out/"styles.css").write_text(css.read_text())
    (out/"pr-commit.txt").write_text(subprocess.check_output(["git","-C",str(pr),"rev-parse","HEAD"],text=True))
    for fmt in (["pdf","pdfx"] if a.pdfx else ["pdf"]):
        args=cmd+["--format",fmt,"--out",str(out/(a.sweep+"-"+fmt+".pdf"))]
        if fmt=="pdfx":args += ["--icc",str(pr/"packages/cli/profiles/CGATS21_CRPC1.icc"),"--skip-post-validate"]
        with (out/(fmt+".log")).open("w") as log:subprocess.run(args,cwd=pr,stdout=log,stderr=subprocess.STDOUT,check=True)
    print(out)
finally:
    css.write_text(original)
