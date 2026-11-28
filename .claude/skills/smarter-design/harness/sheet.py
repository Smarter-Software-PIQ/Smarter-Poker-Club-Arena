"""Before|after sheets from two shot folders.
   python3 sheet.py /tmp/before /tmp/after /tmp/sheets operations,dashboard-full 393 2600 0.75
"""
import sys
from PIL import Image, ImageDraw, ImageFont

before, after, out, names, w, maxh, scale = sys.argv[1:8]
w, maxh, scale = int(w), int(maxh), float(scale)
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', 34)
except OSError:
    font = None
for n in names.split(','):
    n = n.replace('/', '_')
    b = Image.open(f'{before}/{n}-{w}.png')
    a = Image.open(f'{after}/{n}-{w}.png')
    b = b.crop((0, 0, b.width, min(b.height, maxh)))
    a = a.crop((0, 0, a.width, min(a.height, maxh)))
    gap, top = 30, 60
    s = Image.new('RGB', (b.width + a.width + gap, max(b.height, a.height) + top), (12, 16, 24))
    d = ImageDraw.Draw(s)
    d.text((10, 12), f'{n.upper()}  BEFORE', fill=(170, 190, 210), font=font)
    d.text((b.width + gap + 10, 12), 'AFTER', fill=(116, 223, 255), font=font)
    s.paste(b, (0, top))
    s.paste(a, (b.width + gap, top))
    s = s.resize((int(s.width * scale), int(s.height * scale)), Image.LANCZOS)
    s.save(f'{out}/{n}-{w}.png', optimize=True)
