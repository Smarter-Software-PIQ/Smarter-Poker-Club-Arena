export interface CardBox {
  left: number;
  top: number;
  width: number;
  height: number;
}
const intersects = (a: CardBox, b: CardBox, gap: number) =>
  a.left < b.left + b.width + gap &&
  a.left + a.width + gap > b.left &&
  a.top < b.top + b.height + gap &&
  a.top + a.height + gap > b.top;

/** Nearest clear position, preserving the row size and the association with its seat. */
export function placeProtectedCardRow(
  row: CardBox,
  protectedBoxes: CardBox[],
  bounds: CardBox,
  gap = 4,
  accept: (box: CardBox) => boolean = () => true
) {
  const xs = [row.left, bounds.left, bounds.left + bounds.width - row.width];
  const ys = [row.top, bounds.top, bounds.top + bounds.height - row.height];
  for (const box of protectedBoxes) {
    xs.push(box.left - row.width - gap, box.left + box.width + gap);
    ys.push(box.top - row.height - gap, box.top + box.height + gap);
  }
  const fits = (box: CardBox) =>
    box.left >= bounds.left &&
    box.top >= bounds.top &&
    box.left + box.width <= bounds.left + bounds.width &&
    box.top + box.height <= bounds.top + bounds.height &&
    protectedBoxes.every((other) => !intersects(box, other, gap)) &&
    accept(box);
  if (fits(row)) return row;
  let best: CardBox | null = null;
  let distance = Infinity;
  for (const left of new Set(xs)) {
    for (const top of new Set(ys)) {
      const nextDistance = Math.hypot(left - row.left, top - row.top);
      if (nextDistance >= distance) continue;
      const candidate = { ...row, left, top };
      if (fits(candidate)) {
        best = candidate;
        distance = nextDistance;
      }
    }
  }
  return best;
}

export function placeHiddenFans(
  scaler: HTMLElement,
  page: Element,
  pageBox: DOMRect,
  scale: number
) {
  // Closed hands follow the shoulder. On short rings a neighbouring plate
  // or the board can reach that shoulder after the chairs are locked.
  const displays = Array.from(
    page.querySelectorAll(
      '.community-area,.table-brand,.pot-display,.seat__info,.seat__strength,.seat__action,.seat__position-badge,.seat__cards--revealed .seat__card,.seat__cards--hero .seat__card,.action-panel,.spectator-footer-bar'
    )
  )
    .map((node) => node.getBoundingClientRect())
    .filter((r) => r.width && r.height);
  for (const row of scaler.querySelectorAll<HTMLElement>(
    '.seat__cards--opponent:not(.seat__cards--revealed)'
  )) {
    const cards = Array.from(row.querySelectorAll('.seat__card'))
      .map((card) => card.getBoundingClientRect())
      .filter((r) => r.width && r.height);
    if (!cards.length) continue;
    const dx = (parseFloat(row.style.getPropertyValue('--sp-fan-clear-x')) || 0) * scale;
    const dy = (parseFloat(row.style.getPropertyValue('--sp-fan-clear-y')) || 0) * scale;
    const left = Math.min(...cards.map((c) => c.left)) - dx;
    const top = Math.min(...cards.map((c) => c.top)) - dy;
    const fan = {
      left,
      top,
      width: Math.max(...cards.map((c) => c.right)) - dx - left,
      height: Math.max(...cards.map((c) => c.bottom)) - dy - top,
    };
    // Keep the complete fan on its own shoulder. Cards keep their size,
    // splay and animations. Subsequent markers avoid its actual position.
    const reach = fan.height;
    const minX = Math.max(pageBox.left, left - reach),
      minY = Math.max(pageBox.top, top - reach);
    const bounds = {
      left: minX,
      top: minY,
      width: Math.min(pageBox.right, left + fan.width + reach) - minX,
      height: Math.min(pageBox.bottom, top + fan.height + reach) - minY,
    };
    const placed = placeProtectedCardRow(fan, displays, bounds, 0.5) ?? fan;
    for (const [property, offset] of [
      ['--sp-fan-clear-x', placed.left - left],
      ['--sp-fan-clear-y', placed.top - top],
    ] as const) {
      const value = offset ? `${offset / scale}px` : '';
      if (row.style.getPropertyValue(property) !== value) row.style.setProperty(property, value);
    }
    displays.push(new DOMRect(placed.left, placed.top, placed.width, placed.height));
  }
}
