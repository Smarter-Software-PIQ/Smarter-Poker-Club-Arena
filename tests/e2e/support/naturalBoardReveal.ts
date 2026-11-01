import type { EngineFrame } from './liveTableRealtime';

export type RevealFrame = {
  at: number;
  rafGapMs?: number;
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
  baselineFrames?: number;
  frames: RevealFrame[];
  outcome: 'complete' | 'interrupted' | 'bounded';
};
export type RevealDiagnostics = {
  schema: 'natural-board-sampling/v1';
  installedAt: number;
  firstTickAt: number | null;
  lastTickAt: number | null;
  ticks: number;
  eligibleTicks: number;
  maxRafGapMs: number;
  gapsOverOneSecond: number;
  gapCapReached: boolean;
  stopReason: 'manual' | 'deadline' | 'receipt-cap' | null;
  reasons: Record<
    | 'hidden'
    | 'unfocused'
    | 'no-board'
    | 'multiple-boards'
    | 'backgrounded'
    | 'invalid-hand'
    | 'missing-table-owner'
    | 'ambiguous-hand'
    | 'banner'
    | 'active-hand-change'
    | 'active-count-change'
    | 'baseline-hand-change'
    | 'baseline-count-change',
    number
  >;
  boardCounts: Record<'0' | '1' | '2+', number>;
  cardCounts: Record<'0' | '1' | '2' | '3' | '4' | '5' | 'other', number>;
  hand: {
    validTicks: number;
    invalidTicks: number;
    changes: number;
    selectedLabelHiddenTicks: number;
    scopedMismatchTicks: number;
  };
  baseline: {
    stableTicks: number;
    resets: number;
    longestFrames: number;
    turnTransitions: number;
    riverTransitions: number;
    otherTransitions: number;
    admissions: number;
  };
};
export type RevealCapture = {
  receipts: RevealReceipt[];
  diagnostics: RevealDiagnostics;
  stop: () => RevealReceipt[];
};

declare global {
  interface Window {
    __naturalBoardReveal?: RevealCapture;
  }
}

/** Serialized into the already authenticated spectator page. No socket or application writes. */
export function installNaturalBoardReveal(deadline: number): void {
  window.__naturalBoardReveal?.stop();
  const receipts: RevealReceipt[] = [];
  const diagnostics: RevealDiagnostics = {
    schema: 'natural-board-sampling/v1',
    installedAt: Date.now(),
    firstTickAt: null,
    lastTickAt: null,
    ticks: 0,
    eligibleTicks: 0,
    maxRafGapMs: 0,
    gapsOverOneSecond: 0,
    gapCapReached: false,
    stopReason: null,
    reasons: {
      hidden: 0,
      unfocused: 0,
      'no-board': 0,
      'multiple-boards': 0,
      backgrounded: 0,
      'invalid-hand': 0,
      'missing-table-owner': 0,
      'ambiguous-hand': 0,
      banner: 0,
      'active-hand-change': 0,
      'active-count-change': 0,
      'baseline-hand-change': 0,
      'baseline-count-change': 0,
    },
    boardCounts: { '0': 0, '1': 0, '2+': 0 },
    cardCounts: { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, other: 0 },
    hand: {
      validTicks: 0,
      invalidTicks: 0,
      changes: 0,
      selectedLabelHiddenTicks: 0,
      scopedMismatchTicks: 0,
    },
    baseline: {
      stableTicks: 0,
      resets: 0,
      longestFrames: 0,
      turnTransitions: 0,
      riverTransitions: 0,
      otherTransitions: 0,
      admissions: 0,
    },
  };
  const increment = (value: number) => Math.min(1_000_000, value + 1);
  let previousHand: number | null = null;
  let stopped = false,
    raf = 0,
    baseline: { hand: number; count: number; frames: number } | null = null;
  let active: RevealReceipt | null = null;
  let previousTickAt = Date.now();
  const interrupt = () => {
    if (active || baseline) diagnostics.baseline.resets = increment(diagnostics.baseline.resets);
    if (active) active.outcome = 'interrupted';
    active = null;
    baseline = null;
  };
  const stop = (reason: NonNullable<RevealDiagnostics['stopReason']> = 'manual') => {
    if (!stopped) diagnostics.stopReason = reason;
    stopped = true;
    cancelAnimationFrame(raf);
    interrupt();
    return receipts;
  };
  window.__naturalBoardReveal = { receipts, diagnostics, stop };
  const tick = () => {
    if (stopped) return;
    if (Date.now() >= deadline || (receipts.length >= 6 && !active)) {
      stop(Date.now() >= deadline ? 'deadline' : 'receipt-cap');
      return;
    }
    const tickAt = Date.now();
    const rafGapMs = Math.max(0, tickAt - previousTickAt);
    previousTickAt = tickAt;
    diagnostics.ticks = increment(diagnostics.ticks);
    diagnostics.firstTickAt ??= tickAt;
    diagnostics.lastTickAt = tickAt;
    diagnostics.maxRafGapMs = Math.max(diagnostics.maxRafGapMs, Math.min(60_000, rafGapMs));
    if (rafGapMs > 1_000) diagnostics.gapsOverOneSecond = increment(diagnostics.gapsOverOneSecond);
    if (rafGapMs > 60_000) diagnostics.gapCapReached = true;
    const boards = [...document.querySelectorAll<HTMLElement>('.community-cards')].filter(
      (node) => node.getBoundingClientRect().width > 0
    );
    const board = boards[0];
    const tableRoot = board?.closest('.table-page');
    // The producer keeps inactive table views mounted. A global header can
    // belong to another hand even when its slot is display:none.
    const parseHand = (text: string) => Number(/^\s*(?:Hand\s+)?#\s*(\d+)\s*$/.exec(text)?.[1]);
    const ownedLabels = [
      ...(tableRoot?.querySelectorAll<HTMLElement>('.header-hand-number, .table-brand__hand') ??
        []),
    ];
    const ownedHands = ownedLabels.map((label) => parseHand(label.textContent ?? ''));
    const distinctHands = new Set(ownedHands);
    const hand = ownedHands.length > 0 && distinctHands.size === 1 ? ownedHands[0] : NaN;
    const handLabel = ownedLabels[0];
    const banner = document.querySelector<HTMLElement>('[data-testid="table-connection-banner"]');
    diagnostics.boardCounts[boards.length === 0 ? '0' : boards.length === 1 ? '1' : '2+'] =
      increment(
        diagnostics.boardCounts[boards.length === 0 ? '0' : boards.length === 1 ? '1' : '2+']
      );
    const validHand = Number.isSafeInteger(hand) && hand > 0;
    if (validHand) {
      diagnostics.hand.validTicks = increment(diagnostics.hand.validTicks);
      if (previousHand !== null && previousHand !== hand)
        diagnostics.hand.changes = increment(diagnostics.hand.changes);
      previousHand = hand;
    } else diagnostics.hand.invalidTicks = increment(diagnostics.hand.invalidTicks);
    if (handLabel && handLabel.getBoundingClientRect().width === 0)
      diagnostics.hand.selectedLabelHiddenTicks = increment(
        diagnostics.hand.selectedLabelHiddenTicks
      );
    // Metadata only: compare the old global selection with the owned hand.
    const globalLabel = document.querySelector('.header-hand-number, .table-brand__hand');
    const globalHand = parseHand(globalLabel?.textContent ?? '');
    if (validHand && Number.isSafeInteger(globalHand) && globalHand > 0 && globalHand !== hand)
      diagnostics.hand.scopedMismatchTicks = increment(diagnostics.hand.scopedMismatchTicks);
    const exclusions: Array<keyof RevealDiagnostics['reasons']> = [];
    if (document.visibilityState !== 'visible') exclusions.push('hidden');
    if (!document.hasFocus()) exclusions.push('unfocused');
    if (!board) exclusions.push('no-board');
    if (boards.length > 1) exclusions.push('multiple-boards');
    if (board?.closest('.table-page--backgrounded')) exclusions.push('backgrounded');
    if (!tableRoot) exclusions.push('missing-table-owner');
    if (distinctHands.size > 1) exclusions.push('ambiguous-hand');
    if (!validHand) exclusions.push('invalid-hand');
    if (banner && banner.getBoundingClientRect().width > 0) exclusions.push('banner');
    if (board) {
      const observedCount = board.querySelectorAll(
        '.community-cards__container > .community-cards__card'
      ).length;
      const bucket =
        observedCount <= 5
          ? (String(observedCount) as keyof RevealDiagnostics['cardCounts'])
          : 'other';
      diagnostics.cardCounts[bucket] = increment(diagnostics.cardCounts[bucket]);
    }
    if (exclusions.length || !board) {
      for (const reason of exclusions)
        diagnostics.reasons[reason] = increment(diagnostics.reasons[reason]);
      interrupt();
      raf = requestAnimationFrame(tick);
      return;
    }
    diagnostics.eligibleTicks = increment(diagnostics.eligibleTicks);
    const cards = [
      ...board.querySelectorAll<HTMLElement>(
        '.community-cards__container > .community-cards__card'
      ),
    ];
    const count = cards.length;
    if (active && (active.hand !== hand || active.to !== count)) {
      const reason = active.hand !== hand ? 'active-hand-change' : 'active-count-change';
      diagnostics.reasons[reason] = increment(diagnostics.reasons[reason]);
      interrupt();
    }
    if (baseline && baseline.hand !== hand) {
      diagnostics.reasons['baseline-hand-change'] = increment(
        diagnostics.reasons['baseline-hand-change']
      );
      diagnostics.baseline.resets = increment(diagnostics.baseline.resets);
    } else if (baseline && baseline.count !== count) {
      diagnostics.reasons['baseline-count-change'] = increment(
        diagnostics.reasons['baseline-count-change']
      );
    }
    if (baseline?.hand === hand && baseline.count !== count) {
      const key =
        baseline.count === 3 && count === 4
          ? 'turnTransitions'
          : baseline.count === 4 && count === 5
            ? 'riverTransitions'
            : 'otherTransitions';
      diagnostics.baseline[key] = increment(diagnostics.baseline[key]);
    }
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
        baselineFrames: baseline.frames,
        frames: [],
        outcome: 'interrupted',
      };
      receipts.push(active);
      diagnostics.baseline.admissions = increment(diagnostics.baseline.admissions);
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
        rafGapMs,
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
    if (baseline?.hand === hand && baseline.count === count)
      diagnostics.baseline.stableTicks = increment(diagnostics.baseline.stableTicks);
    baseline =
      baseline?.hand === hand && baseline.count === count
        ? { hand, count, frames: baseline.frames + 1 }
        : { hand, count, frames: 1 };
    diagnostics.baseline.longestFrames = Math.max(
      diagnostics.baseline.longestFrames,
      Math.min(1_000_000, baseline.frames)
    );
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

export type NaturalBoardRevealInterval = {
  name: 'before-outage' | 'after-reconnect';
  receipts: RevealReceipt[];
  frames: EngineFrame[];
  diagnostics?: RevealDiagnostics | null;
};

/** Qualify each connected interval independently; never join across a reconnect. */
export function naturalBoardRevealIntervalsEvidence(
  intervals: NaturalBoardRevealInterval[],
  tableId: string
) {
  if (
    intervals.length > 2 ||
    new Set(intervals.map((interval) => interval.name)).size !== intervals.length
  )
    throw new Error('Natural board evidence requires at most two distinct connected intervals');
  const evidence = intervals.map(({ name, receipts, frames, diagnostics }) => ({
    name,
    ...(diagnostics ? { diagnostics } : {}),
    ...naturalBoardRevealEvidence(receipts, frames, tableId),
  }));
  return {
    kind: 'natural-board-reveal-connected-intervals/v1',
    tableId,
    limit:
      'rAF DOM/computed animation evidence; not painted pixels or complete compositor frame coverage',
    verdict: evidence.some((interval) => interval.verdict === 'violation')
      ? 'violation'
      : evidence.some((interval) => interval.verdict === 'qualified')
        ? 'qualified'
        : 'unknown',
    intervals: evidence,
  };
}
