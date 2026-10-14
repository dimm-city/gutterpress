from pathlib import Path
from PIL import Image,ImageChops,ImageStat,ImageDraw
import subprocess,concurrent.futures,json,time
base=Path('/home/founder3/code/dimm-city/dc-op-manual/.worktrees/pdfx-field-guide-stress/.print-md/build/pdfx-stress');out=base/'rerun-ff1022bf';cache=out/'raster720';cache.mkdir(exist_ok=True)
def render(tag,pdf):
 d=cache/tag;d.mkdir(exist_ok=True)
 subprocess.run(['pdftoppm','-scale-to','720','-png',str(pdf),str(d/'p')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
 return {int(p.stem.split('-')[-1]):p for p in d.glob('p-*.png')}
def metrics(a,b):
 if a.size!=b.size:return {'sizeMismatch':[a.size,b.size]}
 d=ImageChops.difference(a,b);return {'mae':sum(ImageStat.Stat(d).mean)/3,'bbox':d.getbbox()}
def sheet(files,dest):
 thumbs=[]
 for n,p in files:
  im=Image.open(p).convert('RGB');im.thumbnail((184,240));thumbs.append((n,im))
 canvas=Image.new('RGB',(184*8,264*((len(thumbs)+7)//8)),'white');draw=ImageDraw.Draw(canvas)
 for i,(n,im) in enumerate(thumbs):x=(i%8)*184;y=(i//8)*264;canvas.paste(im,(x,y+20));draw.text((x+5,y+3),str(n),fill='black')
 canvas.save(dest,quality=85)
result={}
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
 for sweep,oldsource,oldfinal,selected,limit in [
  ('combined','experimental-source.pdf','experimental-preserve.pdf',list(range(1,229)),228),
  ('isolated','isolated-source.pdf','isolated-sample-preserve.pdf',[2,4,5,7,8,9,10,13,15,17,18,19],228),
  ('boundary','boundary-final-source.pdf','boundary-reviewed/preserve.pdf',[8,13,14,15,17,18,19],26)]:
  while True:
   try:s=json.loads((out/'build-status.json').read_text())
   except(FileNotFoundError,json.JSONDecodeError):s={}
   if sweep in s:break
   if any(v['exit'] for v in s.values()):raise RuntimeError(s)
   time.sleep(2)
  if s[sweep]['exit']:raise RuntimeError(s)
  tasks=[(sweep+'-old-source',base/oldsource),(sweep+'-new-source',out/sweep/(sweep+'-pdf.pdf')),(sweep+'-old-final',base/oldfinal),(sweep+'-new-final',out/sweep/(sweep+'-pdfx.pdf'))]
  maps=list(pool.map(lambda pair:render(*pair),tasks));oldS,newS,oldF,newF=maps
  sourceRows=[dict(page=n,**metrics(Image.open(oldS[n]).convert('RGB'),Image.open(newS[n]).convert('RGB')))for n in range(1,limit+1)]
  finalRows=[dict(page=n,**metrics(Image.open(oldF[i+1] if sweep!='combined' else oldF[n]).convert('RGB'),Image.open(newF[n]).convert('RGB')))for i,n in enumerate(selected)]
  result[sweep]={'source':sourceRows,'final':finalRows,'renderHeight':720,'historicalFinalPages':selected}
  (out/'visual-regression.json').write_text(json.dumps(result,indent=2))
  preview=out/sweep/'previews';preview.mkdir(exist_ok=True)
  for start in range(1,229,48):sheet([(n,newF[n])for n in range(start,min(start+48,229))],preview/f'contact-{start:03}.jpg')
  print(sweep,{'sourceChanged':[r for r in sourceRows if r.get('mae',1)>0], 'finalChanged':[r for r in finalRows if r.get('mae',1)>0]},flush=True)
