"""Builds assets/mars-basemap.jpg (1440 x 720) from the Mars colour map and MOLA bump map in
source-data/: shifted to start at 180°W, brightened, with hill shading.
Run: python3 tools/make_basemap.py   (needs numpy, scipy, pillow)"""
import os
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
HERE=os.path.dirname(os.path.abspath(__file__)); SRC=os.path.join(HERE,'source-data')
W,H=1440,720
c=np.asarray(Image.open(os.path.join(SRC,'marsmap1k.jpg')).convert('RGB'),float)/255
b=np.asarray(Image.open(os.path.join(SRC,'marsbump1k.jpg')).convert('L'),float)
c=np.roll(c,500,1); b=np.roll(b,500,1)
c=np.asarray(Image.fromarray((c*255).astype(np.uint8)).resize((W,H),Image.LANCZOS),float)/255
e=np.asarray(Image.fromarray(b.astype(np.float32)).resize((W,H),Image.BICUBIC),float)*0.1159  # elevation, km
e=gaussian_filter(e,0.6,mode=('nearest','wrap'))
gy,gx=np.gradient(e)
lat=np.radians(90-(np.arange(H)+.5)/H*180)[:,None]
gx=gx/np.maximum(np.cos(lat),0.15)
px_km=3390*np.pi/H
dzdx=gx/px_km*12; dzdy=gy/px_km*12   # vertical exaggeration
shade=( -dzdx*0.7071 + dzdy*0.7071 )  # lit from the north-west
shade=np.tanh(shade*3)*0.18
img=c**0.78                      # brighten dark areas
img=img*(1+shade[...,None])
img=np.clip(img*1.06+0.03,0,1)
Image.fromarray((img*255).round().astype(np.uint8)).save(os.path.join(HERE,'..','assets','mars-basemap.jpg'),quality=90,optimize=True)
print('ok')
