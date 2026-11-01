import type { CardBox } from './protectedCardPlacement';

export type WagerAnchor = { x: number; y: number };

/** Layout offsets exclude slide-in, stack-enter and collection transforms. */
export function wagerRestPoint(bet: HTMLElement): WagerAnchor | undefined {
  const stacks = bet.querySelector<HTMLElement>('.cp-stacks');
  if (!stacks?.offsetParent) return undefined;
  const layoutOrigin = (element: HTMLElement) => {
    let x = 0,
      y = 0;
    let node: HTMLElement | null = element;
    while (node) {
      x += node.offsetLeft;
      y += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }
    return { x, y };
  };
  // A static flex wager may not be an offsetParent until translated. Both
  // paths must measure the same tower point before and after compensation.
  const tower = layoutOrigin(stacks),
    outer = layoutOrigin(bet);
  return {
    x: tower.x - outer.x + stacks.offsetWidth / 2,
    y: tower.y - outer.y + stacks.offsetHeight,
  };
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
