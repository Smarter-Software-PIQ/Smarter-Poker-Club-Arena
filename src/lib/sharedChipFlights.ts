import type { ChipAnimationEvent } from '../components/table/ChipAnimation';
type Rect = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;
const types = ['straight', 'to-pot', 'to-winner'] as const;
const colors = ['red', 'green', 'blue', 'black', 'gold'] as const;
export type SharedChip = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
export function captureChip(at: number, e: ChipAnimationEvent, rect: Rect): SharedChip {
  return [
    at,
    (e.from.x - rect.left) / rect.width,
    (e.from.y - rect.top) / rect.height,
    (e.to.x - rect.left) / rect.width,
    (e.to.y - rect.top) / rect.height,
    e.amount,
    e.delay ?? 0,
    types.indexOf(e.type ?? 'straight'),
    e.chipColor ? colors.indexOf(e.chipColor) : -1,
    e.showLabel === undefined ? -1 : Number(e.showLabel),
    e.labelAmount ?? -1,
    e.denomValue ?? -1,
  ];
}
export function readSharedChips(value: unknown): SharedChip[] | undefined {
  if (!Array.isArray(value) || !value.length || value.length > 4096) return;
  let previous = 0;
  for (const chip of value) {
    if (!Array.isArray(chip) || chip.length !== 12 || !chip.every(Number.isFinite)) return;
    const [at, x, y, tx, ty, amount, delay, type, color, label, labelAmount, denom] = chip;
    if (
      !Number.isSafeInteger(at) ||
      at < previous ||
      at > 86400000 ||
      [x, y, tx, ty].some((n) => Math.abs(n) > 16) ||
      amount < 0 ||
      delay < 0 ||
      delay > 60000 ||
      !Number.isInteger(type) ||
      !types[type] ||
      !Number.isInteger(color) ||
      color < -1 ||
      color >= colors.length ||
      ![-1, 0, 1].includes(label) ||
      labelAmount < -1 ||
      denom < -1
    )
      return;
    previous = at;
  }
  return value as SharedChip[];
}
export function replayChip(
  chip: SharedChip,
  id: string,
  rect: Rect,
  rate: number
): ChipAnimationEvent {
  const [, x, y, tx, ty, amount, delay, type, color, label, labelAmount, denom] = chip;
  return {
    id,
    from: { x: rect.left + x * rect.width, y: rect.top + y * rect.height },
    to: { x: rect.left + tx * rect.width, y: rect.top + ty * rect.height },
    amount,
    delay: delay / rate,
    type: types[type],
    chipColor: colors[color],
    showLabel: label < 0 ? undefined : !!label,
    labelAmount: labelAmount < 0 ? undefined : labelAmount,
    denomValue: denom < 0 ? undefined : denom,
  };
}
