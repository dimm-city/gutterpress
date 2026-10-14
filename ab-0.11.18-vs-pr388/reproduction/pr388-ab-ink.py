from pathlib import Path
from PIL import Image,ImageDraw,ImageOps
from collections import Counter
import subprocess,json
r=Path('/home/founder3/code/dimm-city/dc-op-manual/.worktrees/pdfx-field-guide-stress/.print-md/build/pdfx-ab-0.11.18-vs-42091ecc/resolution-control')
d=r/'ink-control';d.mkdir(exist_ok=True)
rows=[]
for mode in ['v0.11.18','v0.11.18-r300','pr388']:
 out=d/(mode+'.tif')
 args=['gs','-dSAFER','-dBATCH','-dNOPAUSE','-sDEVICE=tiff32nc','-dUseFastColor=true','-dFirstPage=2','-dLastPage=2','-r600','-sOutputFile='+str(out),str(r/mode/'book.pdf')]
 subprocess.run(args,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 im=Image.open(out);assert im.mode=='CMYK',im.mode
 rect=tuple(round(v*600/72) for v in [360,185,480,265]);crop=im.crop(rect)
 crop.save(d/(mode+'-crop.tif'),compression='tiff_lzw')
 counts=Counter(crop.getdata());dark={k:v for k,v in counts.items() if k[3]>=128}
 total=sum(dark.values());pure=sum(v for k,v in dark.items() if max(k[:3])<=2)
 rows.append({'mode':mode,'rectPt':[360,185,480,265],'dpi':600,'method':'Ghostscript tiff32nc with UseFastColor=true; inspect encoded DeviceCMYK/Gray colorants without ICC remapping; not a press simulation.','command':args,'pixelsWithKAtLeast50Percent':total,'ofThosePixelsCmyAtMost2of255':pure,'fractionNearKOnly':pure/total if total else None,'commonDarkColors':sorted(dark.items(),key=lambda x:-x[1])[:12]})
 channels=crop.split();w,h=crop.size;canvas=Image.new('RGB',(4*w,h+35),'white');draw=ImageDraw.Draw(canvas)
 for i,(name,ch) in enumerate(zip(['Cyan','Magenta','Yellow','Black'],channels)):
  canvas.paste(ImageOps.invert(ch).convert('RGB'),(i*w,35));draw.text((i*w+8,10),mode+' / '+name,fill='black')
 canvas.save(d/(mode+'-plates.png'))
 im.close();out.unlink()
 print(mode,rows[-1]['fractionNearKOnly'],flush=True)
(d/'measurements.json').write_text(json.dumps(rows,indent=2))
