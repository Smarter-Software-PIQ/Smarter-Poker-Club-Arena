import type { EngineFrame } from './liveTableRealtime';

export type RevealFrame = {
  at: number;
  host: boolean;
  back: boolean;
  front: boolean;
  profile: string | null;
  angle: number | null;
  currentTime: number | null;
  endTime: number | null;
  finished: boolean;
  faceStylesValid: boolean;
  reducedMotion: boolean;
};
export type RevealReceipt = {
  hand: number;
  from: number;
  to: number;
  at: number;
  frames: RevealFrame[];
  outcome: 'complete' | 'interrupted' | 'bounded';
};
export type RevealCapture = { receipts: RevealReceipt[]; stop: () => RevealReceipt[] };

declare global {
  interface Window {
    __naturalBoardReveal?: RevealCapture;
  }
}

/** Serialized into the already authenticated spectator page. No socket or application writes. */
export function installNaturalBoardReveal(deadline: number): void {
  window.__naturalBoardReveal?.stop();
  const receipts: RevealReceipt[] = [];
  let stopped = false,
    raf = 0,
    baseline: { hand: number; count: number; frames: number } | null = null;
  let active: RevealReceipt | null = null;
  const interrupt = () => {
    if (active) active.outcome = 'interrupted';
    active = null;
    baseline = null;
  };
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    interrupt();
    return receipts;
  };
  window.__naturalBoardReveal = { receipts, stop };
  const tick = () => {
    if (stopped) return;
    if (Date.now() >= deadline || (receipts.length >= 6 && !active)) {
      stop();
      return;
    }
    const boards = [...document.querySelectorAll<HTMLElement>('.community-cards')].filter(
      (node) => node.getBoundingClientRect().width > 0
    );
    const text =
      document.querySelector('.header-hand-number, .table-brand__hand')?.textContent ?? '';
    const hand = Number(/^\s*(?:Hand\s+)?#\s*(\d+)\s*$/.exec(text)?.[1]);
    const board = boards[0];
    const banner = document.querySelector<HTMLElement>('[data-testid="table-connection-banner"]');
    if (
      document.visibilityState !== 'visible' ||
      !document.hasFocus() ||
      boards.length !== 1 ||
      !board ||
      board.closest('.table-page--backgrounded') ||
      !Number.isSafeInteger(hand) ||
      hand <= 0 ||
      (banner && banner.getBoundingClientRect().width > 0)
    ) {
      interrupt();
      raf = requestAnimationFrame(tick);
      return;
    }
    const cards = [
      ...board.querySelectorAll<HTMLElement>(
        '.community-cards__container > .community-cards__card'
      ),
    ];
    const count = cards.length;
    if (active && (active.hand !== hand || active.to !== count)) interrupt();
    if (
      !active &&
      baseline?.hand === hand &&
      baseline.frames >= 2 &&
      ((baseline.count === 3 && count === 4) || (baseline.count === 4 && count === 5))
    ) {
      active = {
        hand,
        from: baseline.count,
        to: count,
        at: Date.now(),
        frames: [],
        outcome: 'interrupted',
      };
      receipts.push(active);
    }
    if (active) {
      const slot = cards[count - 1];
      const flip = slot.querySelector<HTMLElement>('.card-squeeze');
      const animation = flip
        ?.getAnimations()
        .find((a) => (a as CSSAnimation).animationName === 'ccCardSqueeze');
      const transform = flip ? getComputedStyle(flip).transform : null;
      let angle: number | null = null;
      if (transform) {
        try {
          const m = new DOMMatrixReadOnly(transform);
          angle = Math.abs((Math.atan2(m.m13, m.m11) * 180) / Math.PI);
        } catch {
          /* unknown orientation */
        }
      }
      const timing = animation?.effect?.getComputedTiming();
      const back = slot.querySelector<HTMLElement>('.card-squeeze__face--back');
      const front = slot.querySelector<HTMLElement>('.card-squeeze__face--front');
      const validFace = (face: HTMLElement | null) => {
        if (!face) return false;
        const style = getComputedStyle(face);
        return (
          style.backfaceVisibility === 'hidden' &&
          style.visibility === 'visible' &&
          style.display !== 'none' &&
          Number(style.opacity) > 0
        );
      };
      active.frames.push({
        at: Date.now(),
        host: slot.classList.contains('card-squeeze-host'),
        back: !!slot.querySelector('.card-squeeze__face--back'),
        front: !!slot.querySelector('.card-squeeze__face--front'),
        profile: slot.dataset.rsProfile?.slice(0, 80) ?? null,
        angle,
        currentTime: typeof animation?.currentTime === 'number' ? animation.currentTime : null,
        endTime: typeof timing?.endTime === 'number' ? timing.endTime : null,
        finished: animation?.playState === 'finished',
        faceStylesValid: validFace(back) && validFace(front),
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      });
      if (animation?.playState === 'finished') {
        active.outcome = 'complete';
        active = null;
      } else if (active.frames.length >= 240 || Date.now() - active.at > 10_000) {
        active.outcome = 'bounded';
        active = null;
      }
    }
    baseline =
      baseline?.hand === hand && baseline.count === count
        ? { hand, count, frames: baseline.frames + 1 }
        : { hand, count, frames: 1 };
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

/** Join only already admitted public natural wire facts; never retain raw frames/cards. */
export function naturalBoardRevealEvidence(
  receipts: RevealReceipt[],
  frames: EngineFrame[],
  tableId: string
) {
  const unstableTransport =
    new Set(frames.map((f) => f.socketId)).size > 1 ||
    frames.some(
      (f) =>
        ['SNAPSHOT', 'SUBSCRIBED'].includes(String(f.message.type)) ||
        (f.message.payload as Record<string, unknown> | undefined)?.type === 'engine_restarting'
    );
  const admitted = (unstableTransport ? [] : receipts).flatMap((receipt) => {
    const events = frames.filter((frame) => {
      const p = frame.message.payload as Record<string, unknown> | undefined;
      return (
        frame.direction === 'received' &&
        frame.message.type === 'EVENT' &&
        frame.message.replayed !== true &&
        p?.replayed !== true &&
        p?.type === 'community_cards_dealt' &&
        p.table_id === tableId &&
        Number(p.hand_number) === receipt.hand &&
        Array.isArray(p.board) &&
        p.board.length === receipt.to &&
        Array.isArray(p.board2) &&
        p.board2.length === 0 &&
        Array.isArray(p.board3) &&
        p.board3.length === 0 &&
        frame.at <= receipt.at &&
        receipt.at - frame.at <= 1000
      );
    });
    if (events.length !== 1) return [];
    const first = receipt.frames[0];
    const bareFirst =
      !!first && !first.reducedMotion && (!first.host || !first.back || !first.front);
    const backFirst =
      !!first &&
      !first.reducedMotion &&
      first.faceStylesValid &&
      first.host &&
      first.back &&
      first.front &&
      first.profile !== null &&
      first.angle !== null &&
      first.angle < 90;
    const faceSeen = receipt.frames.some(
      (f) => f.faceStylesValid && f.angle !== null && f.angle > 90
    );
    const end = receipt.frames.at(-1);
    const owed =
      receipt.outcome === 'complete' &&
      end?.finished &&
      typeof end.endTime === 'number' &&
      end.endTime > 0 &&
      end.currentTime !== null &&
      end.currentTime >= end.endTime;
    return [
      {
        ...receipt,
        verdict: bareFirst ? 'violation' : backFirst && faceSeen && owed ? 'qualified' : 'unknown',
      },
    ];
  });
  return {
    kind: 'natural-board-reveal-paint-opportunity/v1',
    tableId,
    transportContinuity: unstableTransport ? 'unproven' : 'observed',
    limit:
      'rAF DOM/computed animation evidence; not painted pixels or complete compositor frame coverage',
    verdict: admitted.some((r) => r.verdict === 'violation')
      ? 'violation'
      : admitted.some((candidate) =>
            [4, 5].every((to) =>
              admitted.some(
                (r) => r.hand === candidate.hand && r.to === to && r.verdict === 'qualified'
              )
            )
          )
        ? 'qualified'
        : 'unknown',
    receipts: admitted,
  };
}
