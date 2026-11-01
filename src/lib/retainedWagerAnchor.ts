import type { CardBox } from './protectedCardPlacement';

export type WagerAnchor = { x: number; y: number };

/** Layout offsets exclude slide-in, stack-enter and collection transforms. */
export function wagerRestPoint(bet: HTMLElement): WagerAnchor | undefined {
  const stacks = bet.querySelector<HTMLElement>('.cp-stacks');
  if (!stacks) return undefined;
  let x = stacks.offsetWidth / 2;
  let y = stacks.offsetHeight;
  let node: HTMLElement | null = stacks;
  while (node && node !== bet) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return node === bet ? { x, y } : undefined;
}

export function wagerAnchor(
  box: CardBox,
  canvas: CardBox,
  scale: number,
  restPoint?: WagerAnchor
): WagerAnchor {
  return {
    x: (box.left - canvas.left) / scale + (restPoint?.x ?? box.width / scale / 2),
    y: (box.top - canvas.top) / scale + (restPoint?.y ?? box.height / scale / 2),
  };
}

export function retainedWagerCorrection(
  anchor: WagerAnchor,
  box: CardBox,
  canvas: CardBox,
  scale: number,
  restPoint?: WagerAnchor
): WagerAnchor {
  const current = wagerAnchor(box, canvas, scale, restPoint);
  return { x: anchor.x - current.x, y: anchor.y - current.y };
}
