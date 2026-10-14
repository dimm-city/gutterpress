from pathlib import Path
from PIL import Image,ImageDraw
import subprocess,json,concurrent.futures,time
base=Path('/home/founder3/code/dimm-city/dc-op-manual/.worktrees/pdfx-field-guide-stress/.print-md/build/pdfx-stress');out=base/'rerun-ff1022bf'
selected={'combined':[1,4,8,12,13,14,17,138,159,192,200], 'isolated':[2,5,7,8,9,10,13,15,17,18,19], 'boundary':[8,13,14,15,17,18,19,138,200]}
def render(job):
 sweep,mode,n=job;dest=out/sweep/'previews'/f'{mode}-p{n:03}';dest.parent.mkdir(exist_ok=True)
 subprocess.run(['pdftoppm','-scale-to','1200','-f',str(n),'-l',str(n),'-singlefile','-png',str(out/sweep/f'{sweep}-{mode}.pdf'),str(dest)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
for sweep,ns in selected.items():
 while True:
  try: status=json.loads((out/'build-status.json').read_text())
  except (FileNotFoundError,json.JSONDecodeError): status={}
  if sweep in status: break
  if any(v['exit'] for v in status.values()): raise RuntimeError(status)
  time.sleep(2)
 if status[sweep]['exit']: raise RuntimeError(status)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:list(pool.map(render,[(sweep,m,n) for n in ns for m in ['pdf','pdfx']]))
 for n in ns:
  a=Image.open(out/sweep/'previews'/f'pdf-p{n:03}.png').convert('RGB');b=Image.open(out/sweep/'previews'/f'pdfx-p{n:03}.png').convert('RGB')
  c=Image.new('RGB',(a.width+b.width,a.height+35),'white');c.paste(a,(0,35));c.paste(b,(a.width,35));d=ImageDraw.Draw(c);d.text((12,12),f'{sweep.upper()} P{n} - CHROMIUM SOURCE',fill='black');d.text((a.width+12,12),'LATEST PR ff1022bf - PRESERVE PDF/X',fill='black');c.save(out/sweep/'previews'/f'compare-p{n:03}.jpg',quality=86)
 print(sweep,'proof pages rendered',flush=True)
