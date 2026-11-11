// Preserve the approved artwork; mask only dark exterior pixels connected to an edge.
import { loadSharp } from '../lib/sharp-loader.mjs';
const sharp = await loadSharp();
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../public/assets/diamond-spins/', import.meta.url));
for (const name of ['crash-cockpit-deck-v1', 'mines-vault-deck-v1']) {
  const {
    data,
    info: { width: w, height: h, channels: c },
  } = await sharp(root + name + '.webp')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const seen = new Uint8Array(w * h),
    q = new Int32Array(w * h);
  let head = 0,
    tail = 0;
  const visit = (n) => {
    if (n < 0 || n >= w * h || seen[n]) return;
    const i = n * c;
    if (Math.max(data[i], data[i + 1], data[i + 2]) > 24) return;
    seen[n] = 1;
    q[tail++] = n;
  };
  for (let x = 0; x < w; x++) {
    visit(x);
    visit((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    visit(y * w);
    visit(y * w + w - 1);
  }
  while (head < tail) {
    const n = q[head++],
      x = n % w;
    if (x > 0) visit(n - 1);
    if (x < w - 1) visit(n + 1);
    visit(n - w);
    visit(n + w);
  }
  let d = '';
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      while (x < w && seen[y * w + x]) x++;
      const a = x;
      while (x < w && !seen[y * w + x]) x++;
      if (x > a) d += `M${a} ${y}h${x - a}v1H${a}z`;
    }
  }
  writeFileSync(
    root + name + '-mask.svg',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><path fill="white" d="${d}"/></svg>\n`
  );
  console.log(name, tail, 'exterior pixels');
}
