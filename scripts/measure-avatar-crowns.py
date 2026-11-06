#!/usr/bin/env python3
"""Measure visible crown headroom from shipped library art; never alter the art."""
from pathlib import Path
import sys
from PIL import Image

assets = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / 'Documents/Smarter-Poker-World-Hub/public/avatars/table'
output = Path(__file__).resolve().parent.parent / 'src/components/table/avatarCrownBounds.ts'
rows = []
for path in sorted([*assets.glob('*.webp'), *assets.glob('*.png')]):
    if not path.name.startswith(('free_', 'vip_', 'custom_')):
        continue
    with Image.open(path) as image:
        # Ignore barely visible feathering; this is the visible head, not its glow.
        alpha = image.convert('RGBA').getchannel('A').point(lambda a: 255 if a >= 16 else 0)
        bounds = alpha.getbbox()
        if not bounds:
            raise ValueError(f'Avatar has no visible subject: {path.name}')
        rows.append(f"  '{path.name}': {bounds[1] / image.height:.6f},")
if not rows:
    raise ValueError('No shipped library avatar art found')
# Regeneration owns only measured data; preserve maintained projection helpers.
source = output.read_text(encoding='utf-8')
start = source.index('export const AVATAR_CROWN_TOP:')
map_start = source.index('{', start) + 1
map_end = source.index('\n};', map_start)
output.write_text(source[:map_start] + '\n' + '\n'.join(rows) + source[map_end:], encoding='utf-8')
print(f'Measured {len(rows)} avatar crowns; wrote {output}')
