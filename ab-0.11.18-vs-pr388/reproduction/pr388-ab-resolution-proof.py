from pathlib import Path
from PIL import Image,ImageDraw
import subprocess,json
r=Path('/home/founder3/code/dimm-city/dc-op-manual/.worktrees/pdfx-field-guide-stress/.print-md/build/pdfx-ab-0.11.18-vs-42091ecc/resolution-control');p=r/'previews';p.mkdir(exist_ok=True)
rows=[]
for mode in ['v0.11.18','v0.11.18-r300','pr388']:
 j=json.loads((r/mode/'export.json').read_text());rows.append({'mode':mode,'bytes':j['outputBytes'],'times':j['times']})
(r/'summary.json').write_text(json.dumps(rows,indent=2))
for page in [1,2,4]:
 ims=[]
 for mode in ['source','v0.11.18','v0.11.18-r300','pr388']:
  pdf=r/'source.pdf' if mode=='source' else r/mode/'book.pdf';dest=p/f'{mode}-p{page}'
  subprocess.run(['pdftoppm','-f',str(page),'-l',str(page),'-singlefile','-scale-to','1200','-png',str(pdf),str(dest)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  ims.append(Image.open(str(dest)+'.png').convert('RGB'))
 w,h=ims[0].size;im=Image.new('RGB',(w*4,h+40),'white');draw=ImageDraw.Draw(im)
 for i,(name,src)in enumerate(zip(['RGB source','0.11.18 stock','0.11.18 adjusted -r300','PR388 preserve-text'],ims)):
  im.paste(src,(w*i,40));draw.text((w*i+10,12),f'Control p{page}: {name}',fill='black')
 im.save(p/f'compare-p{page}.jpg',quality=95)
 print(page,flush=True)
