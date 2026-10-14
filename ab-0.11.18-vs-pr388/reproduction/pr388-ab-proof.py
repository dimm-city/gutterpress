from pathlib import Path
from PIL import Image, ImageDraw, ImageStat, ImageChops
import subprocess, json, time
root=Path('/home/founder3/code/dimm-city/dc-op-manual/.worktrees/pdfx-field-guide-stress/.print-md/build/pdfx-ab-0.11.18-vs-42091ecc')
cases={'production-fonts':[4,6,7,40,138,200], 'isolated':[5,7,9,10,13,15,19], 'combined':[1,4,9,13,14,15,17,19], 'boundary':[8,13,14], 'production-fonts-effects':[1,4,7,13,14,200]}
def render(pdf,page,dest):
    if dest.exists():
        try:
            with Image.open(dest) as im: im.load()
            return
        except (OSError, ValueError): dest.unlink()
    subprocess.run(['pdftoppm','-f',str(page),'-l',str(page),'-singlefile','-scale-to','1200','-png',str(pdf),str(dest.with_suffix(''))],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
for case,pages in cases.items():
    d=root/case
    while not all((d/m/'export.json').exists() for m in ['v0.11.18','pr388']):time.sleep(10)
    source=Path((d/'source-path.txt').read_text().strip())
    p=d/'previews';p.mkdir(exist_ok=True)
    modes={'source':source,'v0.11.18':d/'v0.11.18/book.pdf','pr388':d/'pr388/book.pdf'}
    rows=[]
    for page in pages:
        images=[]
        for mode,pdf in modes.items():
            dest=p/f'{mode}-p{page:03}.png';render(pdf,page,dest);images.append(Image.open(dest).convert('RGB'))
        w,h=images[0].size
        canvas=Image.new('RGB',(3*w,h+40),'white');draw=ImageDraw.Draw(canvas)
        for i,(label,im) in enumerate(zip(['Chromium source','Gutterpress 0.11.18','PR388 preserve-text'],images)):
            canvas.paste(im,(i*w,40));draw.text((i*w+12,12),f'{case} / page {page} / {label}',fill='black')
        canvas.save(p/f'compare-p{page:03}.jpg',quality=95)
        delta=ImageChops.difference(images[1],images[2]);rows.append({'page':page,'renderHeight':h,'oldVsNewMeanChannelError':sum(ImageStat.Stat(delta).mean)/3,'oldVsNewIdentical':delta.getbbox() is None})
    (d/'specimen-metrics.json').write_text(json.dumps(rows,indent=2))
    print(case,'proof rendered',len(pages),flush=True)
