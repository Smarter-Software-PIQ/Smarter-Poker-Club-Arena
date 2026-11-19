/**
 * A SHARED HAND IS RECORDED ONCE.
 *
 * Production, 2026-11-18: one hand reserved three short links inside ten
 * seconds (payload lengths 1,056, 3,030 and 3,540). The table's presentation
 * journals keep growing after `hand_complete` (the pot push is painted when
 * `pot_win` lands, about three seconds later) and the Share sheet was handed
 * the hand again on every re-read. The link is keyed by the payload, so each
 * re-read was a new token and a junk row in ca_shared_hands.
 *
 * The recording now has one end instant. These tests pin the rule itself
 * (src/lib/sharedHandRecording) and that TablePage has no other way to hand a
 * live hand to the sheet.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodeHand, type ShareableHand } from '../../src/components/table/ShareHand';
import type { SharedTableAppearance } from '../../src/lib/sharedTableAppearance';
import { createSharedHandRecording } from '../../src/lib/sharedHandRecording';

const HAND = 7421;

function facts(): ShareableHand {
  return {
    id: `table-${HAND}`,
    tableName: 'Club Arena',
    variant: 'NLH',
    stakes: '1/2',
    timestamp: 1763480000000,
    buttonSeat: 1,
    appearance: {
      skin: 'ocean_blue',
      background: 'midnight',
      cardBack: 'classic',
      faceDeck: 'ivory-club',
      showAvatars: true,
      fourColor: false,
      maxPlayers: 6,
      endAtMs: 9000,
      seatPaints: [[100, 1, 33, 0, 1, 200, 2, 0, 0]],
    } as SharedTableAppearance,
    players: [
      { seat: 1, name: 'Ari', stack: 200, cards: [], isHero: true, isWinner: true },
      { seat: 2, name: 'Sam', stack: 200, cards: [], isHero: false, isWinner: false },
    ],
    preflop: [
      { seat: 1, action: 'RAISE', amount: 6 },
      { seat: 2, action: 'FOLD' },
    ],
    potTotal: 9,
    winners: [{ seat: 1, amount: 9 }],
    handNumber: HAND,
  } as ShareableHand;
}

/** The page's journals: they only ever grow while the hand is on the felt. */
function journals(hand = HAND) {
  const seatPaints: number[][] = [[100, 1, 33, 0, 1, 200, 2, 0, 0]];
  return {
    paint(at: number, seat: number) {
      seatPaints.push([at, seat, 33, 0, 1, 200 + at, 2, 0, 0]);
    },
    read: () => ({
      hand,
      parts: { seatPaints: seatPaints.map((p) => [...p]) } as Partial<SharedTableAppearance>,
    }),
  };
}

const recorder = () => createSharedHandRecording<SharedTableAppearance, ShareableHand>();

describe('a shared hand is recorded once', () => {
  it('offers nothing while the award is still being painted, then one payload forever', () => {
    const rec = recorder();
    const j = journals();
    expect(rec.begin(HAND, facts())).toBe(true);
    expect(rec.sealed()).toBeNull();
    expect(rec.pendingHand()).toBe(HAND);

    /* What the page used to hand the sheet at each re-read: three payloads. */
    const atComplete = encodeHand(rec.preview(j.read())!);
    j.paint(3200, 1); // pot_win: the winner's seat is painted
    const atSheetOpen = encodeHand(rec.preview(j.read())!);
    j.paint(4100, 1);
    const atNextDeal = encodeHand(rec.preview(j.read())!);
    expect(new Set([atComplete, atSheetOpen, atNextDeal]).size).toBe(3);
    expect(rec.sealed()).toBeNull();

    /* The seal reads the journal one time; the award is in it. */
    const sealed = rec.seal(j.read())!;
    expect(sealed.appearance!.seatPaints).toHaveLength(3);
    const payload = encodeHand(sealed);
    expect(payload).toBe(atNextDeal);

    /* Later paints, later seals and a repeated completion change nothing. */
    j.paint(5000, 2);
    expect(rec.seal(j.read())).toBeNull();
    expect(rec.begin(HAND, { ...facts(), timestamp: 1 })).toBe(false);
    expect(rec.pendingHand()).toBeNull();
    expect(rec.sealed()).toBe(sealed);
    expect(encodeHand(rec.sealed()!)).toBe(payload);
    expect(Object.isFrozen(sealed)).toBe(true);
  });

  it('never merges a journal that belongs to another hand', () => {
    const rec = recorder();
    rec.begin(HAND, facts());
    const next = journals(HAND + 1);
    next.paint(50, 2);
    next.paint(60, 2);
    const sealed = rec.seal(next.read())!;
    expect(sealed.appearance!.seatPaints).toEqual(facts().appearance!.seatPaints);
    expect(rec.sealedHand()).toBe(HAND);
  });

  it('lets a repeated completion refresh the facts only while the hand is still open', () => {
    const rec = recorder();
    rec.begin(HAND, facts());
    expect(rec.begin(HAND, { ...facts(), potTotal: 12 })).toBe(true);
    expect(rec.seal(journals().read())!.potTotal).toBe(12);
    expect(rec.begin(HAND, { ...facts(), potTotal: 99 })).toBe(false);
    expect(rec.sealed()!.potTotal).toBe(12);
    /* The next hand opens its own recording; the last one stays as sealed. */
    expect(rec.begin(HAND + 1, facts())).toBe(true);
    expect(rec.sealedHand()).toBe(HAND);
  });

  it('holds a share request until the seal, and answers it with the final hand', () => {
    const rec = recorder();
    const j = journals();
    const immediate = vi.fn();
    expect(rec.whenSealed(null, immediate)).toBe(true); // nothing is being painted
    expect(immediate).toHaveBeenCalledTimes(1);

    rec.begin(HAND, facts());
    const seen: Array<ShareableHand | null> = [];
    const offer = vi.fn(() => seen.push(rec.sealed()));
    expect(rec.whenSealed(null, offer)).toBe(false);
    expect(rec.whenSealed(HAND, offer)).toBe(false);
    expect(offer).not.toHaveBeenCalled();
    /* An older hand from the archive is not the one being painted. */
    const older = vi.fn();
    expect(rec.whenSealed(HAND - 1, older)).toBe(true);
    expect(older).toHaveBeenCalledTimes(1);

    j.paint(3200, 1);
    const sealed = rec.seal(j.read());
    expect(offer).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([sealed]);
    rec.seal(j.read());
    expect(offer).toHaveBeenCalledTimes(1);
  });

  it('forgets a waiting request when the page goes away', () => {
    const rec = recorder();
    rec.begin(HAND, facts());
    const offer = vi.fn();
    rec.whenSealed(null, offer);
    rec.forgetRequest();
    rec.seal(journals().read());
    expect(offer).not.toHaveBeenCalled();
  });
});

describe('TablePage hands the sheet only a sealed recording', () => {
  const page = readFileSync(resolve(__dirname, '../../src/pages/TablePage.tsx'), 'utf8');
  const between = (from: string, to: string) => {
    const a = page.indexOf(from);
    const b = page.indexOf(to, a);
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    return page.slice(a, b);
  };

  it('uses the recording module and has no second way to re-read the journals', () => {
    expect(page).toContain(
      "import { createSharedHandRecording } from '../lib/sharedHandRecording';"
    );
    expect(page).toContain(
      'const shareRecording = useRef(createSharedHandRecording<SharedTableAppearance, ShareableHand>());'
    );
    expect(page).not.toContain('refreshCompletedPresentation');
    /* The journals are copied in exactly one place: the seal's reader. */
    expect(page.split('[...paintedSeats.current.events]').length - 1).toBe(2);
    expect(page.split('[...paintedChips.current.paths]').length - 1).toBe(2);
    const reader = between('const readShareJournal = useCallback(', 'const sealSharedHand');
    expect(reader).toContain('[...paintedSeats.current.events]');
    expect(reader).toContain('[...paintedChips.current.paths]');
    expect(reader).toContain('hand: paintedSeats.current.hand,');
  });

  it('begins the recording at HAND_COMPLETE without offering it', () => {
    const capture = between(
      'Share Hand: capture the hand that just finished',
      "reportError(e, 'TablePage.buildSharedHand')"
    );
    expect(capture).toContain('shareRecording.current.begin(Number(completedHand) || 0, {');
    expect(capture).not.toContain('setSharedHandData(');
    expect(capture).not.toContain('setShowShareHand(');
  });

  it('seals at the next deal before the journals are emptied, and at the post-hand reset', () => {
    const deal = between(
      'Fresh hand → reset the Share Hand action log',
      'handActionsRef.current = [];'
    );
    expect(deal.indexOf('sealSharedHand();')).toBeGreaterThan(-1);
    expect(deal.indexOf('sealSharedHand();')).toBeLessThan(
      deal.indexOf('paintedChips.current = { seen: new Set(), paths: [] };')
    );
    expect(deal.indexOf('sealSharedHand();')).toBeLessThan(
      deal.indexOf('paintedSeats.current = {')
    );
    const reset = between('handCompleteResetFnRef.current = () => {', 'setTableState((prev)');
    expect(reset).toContain('sealSharedHand(feltHandNumber);');
    expect(reset.indexOf('sealSharedHand(feltHandNumber);')).toBeLessThan(
      reset.indexOf('if (!stillShowingCompletedHand()) return;')
    );
  });

  it('gives the sheet the sealed hand, through the wait, from both share entries', () => {
    /* Three writers of the sheet's hand: the live entry (sealed), and the
       archive entry (the saved record). None of them is the hand-end handler. */
    expect(page.split('setSharedHandData(').length - 1).toBe(2);
    const live = between('onShareHand={() => {', 'observeSeat={observeShareSeat}');
    expect(live).toContain('offerShareWhenRecorded(null, () => {');
    expect(live).toContain('const hand = recording.sealed();');
    expect(live).toContain('setSharedHandData(hand);');
    const archive = between(
      'onShare={(hand) => {',
      "reportError(e, 'TablePage.shareHandFromDetail')"
    );
    expect(archive).toContain('offerShareWhenRecorded(Number(hand.handNumber) || 0, () => {');
    const wait = between('const offerShareWhenRecorded = (', 'sealSharedHand();\n  };');
    expect(wait).toContain('if (shareRecording.current.whenSealed(hand, offer)) return;');
    expect(wait).toContain('if (handCompleteTimerRef.current) {');
  });
});
