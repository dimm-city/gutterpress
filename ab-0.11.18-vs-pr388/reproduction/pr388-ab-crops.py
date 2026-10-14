from pathlib import Path
from PIL import Image,ImageDraw
import subprocess,time,json
root=Path('/home/founder3/code/dimm-city/dc-op-manual/.worktrees/pdfx-field-guide-stress/.print-md/build/pdfx-ab-0.11.18-vs-42091ecc')
# Rectangles are PDF points from the top-left, converted to pixels at600DPI.
specimens=[('production-fonts',6,'brick-detail',(10,10,90,65)),('production-fonts',6,'illustration-detail',(165,230,100,85)),('isolated',7,'callout-type',(360,185,120,80)),('combined',9,'fine-rules',(75,150,130,75)),('combined',1,'body-type',(75,320,130,65)),('combined',4,'foreground-cover',(70,75,250,40))]
rows=[]
for case,page,name,rect in specimens:
 d=root/case
 while not (d/'pr388/export.json').exists() or not (d/'v0.11.18/export.json').exists():time.sleep(10)
 source=Path((d/'source-path.txt').read_text().strip());p=d/'previews';p.mkdir(exist_ok=True)
 files=[source,d/'v0.11.18/book.pdf',d/'pr388/book.pdf'];ims=[]
 x,y,w,h=[round(v*600/72)for v in rect]
 for label,pdf in zip(['source','v0.11.18','pr388'],files):
  dest=p/f'{name}-{label}.png'
  subprocess.run(['pdftoppm','-f',str(page),'-l',str(page),'-singlefile','-r','600','-x',str(x),'-y',str(y),'-W',str(w),'-H',str(h),'-png',str(pdf),str(dest.with_suffix(''))],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  ims.append(Image.open(dest).convert('RGB'))
 canvas=Image.new('RGB',(w*3,h+40),'white');draw=ImageDraw.Draw(canvas)
 for i,(label,im)in enumerate(zip(['Source','0.11.18','PR388 preserve-text'],ims)):
  canvas.paste(im,(i*w,40));draw.text((i*w+12,12),f'{case} p{page}: {label} (600DPI render)',fill='black')
 canvas.save(p/(name+'-compare.png'))
 rows.append({'case':case,'page':page,'name':name,'rectPtTopLeft':rect,'dpi':600})
 (root/'crop-provenance.json').write_text(json.dumps(rows,indent=2));print(case,name,flush=True)
