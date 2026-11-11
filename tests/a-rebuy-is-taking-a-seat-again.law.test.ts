import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { heroHoleCardsAreForThisHand } from '../src/lib/tableCardDisplay';
import { earlyHeroCardsReady } from '../src/utils/earlyHeroCards';
import { heroIdentityUnknown } from '../src/lib/heroCardCustody';

/**
 * A REBUY IS TAKING A SEAT AGAIN (2026-11-10).
 *
 * MichaelJordan, Monday Night Turbo: busted, rebought on the same table, and
 * was dealt three hands he could not see; the clock folded each one. The bust
 * vacates the physical seat, the page answers that through applySeatRemoved
 * (the engine's `seat_left` busted_awaiting_rebuy_decision, or the ten-second
 * seat read), and that latches leftSeatPendingRef. The rebuy receipt restored
 * heroSeat and never cleared the latch, so the delivery door dropped the
 * cards of a paid, seated player until the page was reloaded.
 *
 * This runs the page's own applySeatRemoved, its own rebuy receipt handler
 * and its own hole-card door, in the order that hand happened.
 */
const source = ts.createSourceFile(
  'TablePage.tsx',
  readFileSync('src/pages/TablePage.tsx', 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
let cardDoor = '';
let seatRemoved = '';
let rebuyReceipt = '';
const latchClears: string[] = [];
function enclosingName(node: ts.Node): string {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    if (ts.isJsxAttribute(n)) return n.name.getText(source);
  }
  return '';
}
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer)) {
    const name = node.name.getText(source);
    if (name === 'handleHoleCardPayload') cardDoor = node.initializer.arguments[0].getText(source);
    if (name === 'applySeatRemoved') seatRemoved = node.initializer.arguments[0].getText(source);
  }
  if (
    ts.isJsxAttribute(node) &&
    node.name.getText(source) === 'onConfirmRebuy' &&
    node.initializer &&
    ts.isJsxExpression(node.initializer) &&
    node.initializer.expression
  )
    rebuyReceipt = node.initializer.expression.getText(source);
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    node.left.getText(source) === 'leftSeatPendingRef.current' &&
    node.right.kind === ts.SyntaxKind.FalseKeyword
  )
    latchClears.push(enclosingName(node));
  ts.forEachChild(node, visit);
}
visit(source);
if (!cardDoor || !seatRemoved || !rebuyReceipt)
  throw new Error('The page seat-removal, rebuy receipt or card door was not found');

function compile(text: string, deps: Record<string, unknown>) {
  const body =
    ts.transpileModule(`const callback = ${text};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText + '\nreturn callback;';
  return new Function(...Object.keys(deps), body)(...Object.values(deps));
}

function table(opts: { rebuyTable?: string } = {}) {
  const hero = { id: 'hero', isHero: true, holeCards: [] as unknown[], stack: 0 };
  const state: any = {
    handNumber: 20,
    heroSeat: 7,
    players: [null, null, null, null, null, null, hero],
    communityCards: [],
    tournamentId: 'tournament',
    tableName: 'Monday Night Turbo',
    isTournament: true,
    arenaAsset: 'chips',
  };
  const purchaseContext = { active: true };
  const d: any = {
    userId: 'hero',
    tableId: 'table',
    tableState: state,
    tableStateRef: { current: state },
    setTableState: (update: any) => Object.assign(state, update(state)),
    // Seat custody.
    leftSeatPendingRef: { current: false },
    heroSeatRef: { current: 7 },
    seatAcquiredAtRef: { current: 1 as number | null },
    bootNoticeShownRef: { current: true },
    pendingSeatStackRef: { current: 0 },
    sittingOutIdsRef: { current: new Set<string>() },
    heartbeatToastRef: { current: { info: vi.fn() } },
    bootExplanation: () => null,
    seatCopy: () => ({ removedFromTable: '' }),
    setPendingSeat: vi.fn(),
    setSelectedSeat: vi.fn(),
    setHeroRowStack: vi.fn(),
    setShowBuyInModal: vi.fn(),
    setShowRebuyModal: vi.fn(),
    setBustRebuyOpen: vi.fn(),
    setBustRebuyDeadlineAt: vi.fn(),
    setHeroSitsOutPerRow: vi.fn(),
    setShowSitOut: vi.fn(),
    setSitOutSince: vi.fn(),
    setSitOutNextHand: vi.fn(),
    // The rebuy receipt.
    tournamentPurchaseContext: purchaseContext,
    tournamentPurchaseContextRef: { current: purchaseContext },
    rebuyPromptTokenRef: { current: 'token' },
    beginRebuyPrompt: () => 'token',
    endRebuyPrompt: vi.fn(),
    rebuyProcessingRef: { current: false },
    rebuyPurchasePendingRef: { current: false },
    rebuyJustSucceededRef: { current: false },
    setRebuyProcessing: vi.fn(),
    setRebuyUnconfirmed: vi.fn(),
    tournamentService: {
      processRebuy: vi.fn(async () => ({
        success: true,
        tableId: opts.rebuyTable ?? 'table',
        seatNumber: 7,
      })),
    },
    toast: { success: vi.fn(), error: vi.fn() },
    bustHoldRef: { current: { pendingExit: null } },
    releaseBustHold: vi.fn(),
    masterBus: { emit: vi.fn() },
    navigate: vi.fn(),
    setLeaveAttentionSuppressed: vi.fn(),
    requestEngineSnapshot: vi.fn(),
    TournamentPurchaseNotSubmittedError: class extends Error {},
    platformFrozenMessage: () => null,
    // The card door.
    engineSnapshotRef: { current: null },
    isLightningObserverSnapshot: () => false,
    heroHandRef: { current: 20 },
    heroCardsHandRef: { current: 0 },
    heroIdentityUnknown,
    identityPendingHeroCardsRef: { current: null },
    lightningRoomRef: { current: null },
    earlyHeroCardsRef: { current: null },
    earlyHeroCardsReady,
    heroHoleCardsAreForThisHand,
    reportError: vi.fn(),
    heroCardsRecoveredRef: { current: false },
    heroCardFetchRef: { current: vi.fn() },
    heroDealSoundHandRef: { current: 0 },
    lastDealPresentationHandRef: { current: 0 },
    dealSettledHandRef: { current: 0 },
    heldHeroDealSoundRef: { current: 0 },
    lightningHoldsHeroDealSound: () => false,
    soundService: { isEnabled: () => false },
    ambientSoundsAllowed: false,
    canonicalCards: (cards: unknown) => cards,
    cardsPreSortRef: { current: false },
    heroEngineCardOrderRef: { current: [] },
    heroHandOutcomeRef: { current: {} },
  };
  const applySeatRemoved = compile(seatRemoved, d);
  const confirmRebuy = compile(rebuyReceipt, d);
  const door = compile(cardDoor, d);
  return {
    d,
    state,
    bust: () => applySeatRemoved('busted_awaiting_rebuy_decision', { announce: true }),
    rebuy: () => confirmRebuy(),
    /** The engine seats the rebuy and deals the next hand. */
    dealt: (hand: number) => {
      state.handNumber = hand;
      d.heroHandRef.current = hand;
      state.players[6] = { id: 'hero', isHero: true, holeCards: [], stack: 5000 };
      door({
        new: {
          table_id: 'table',
          user_id: 'hero',
          hand_number: hand,
          cards: [
            { rank: 'A', suit: 'd' },
            { rank: '3', suit: 'd' },
          ],
        },
      });
      return (state.players[6]?.holeCards ?? []) as Array<{ rank: string }>;
    },
  };
}

describe('a tournament rebuy is taking a seat again', () => {
  it('a bust latches the seat as left, and the door then shows that player no cards', () => {
    const t = table();
    t.bust();
    expect(t.d.leftSeatPendingRef.current).toBe(true);
    expect(t.state.heroSeat).toBe(0);
    expect(t.dealt(21)).toEqual([]);
  });

  it('the rebuy receipt clears the latch, and the next hand is dealt face up to its player', async () => {
    const t = table();
    t.bust();
    await t.rebuy();
    expect(t.d.leftSeatPendingRef.current).toBe(false);
    expect(t.state.heroSeat).toBe(7);
    expect(t.d.heroSeatRef.current).toBe(7);
    expect(t.d.requestEngineSnapshot).toHaveBeenCalledTimes(1);
    expect(t.dealt(21).map((c) => c.rank)).toEqual(['A', '3']);
  });

  it('stamps the seat time, so a seat read begun before the purchase cannot latch it again', async () => {
    const t = table();
    t.bust();
    const before = Date.now();
    await t.rebuy();
    expect(t.d.seatAcquiredAtRef.current).toBeGreaterThanOrEqual(before);
    // A new seat is a clean slate: a later removal is announced again.
    expect(t.d.bootNoticeShownRef.current).toBe(false);
  });

  it('clears the latch when the rebuy seats the player at another table', async () => {
    const t = table({ rebuyTable: 'other-table' });
    t.bust();
    await t.rebuy();
    expect(t.d.navigate).toHaveBeenCalledWith('/table/other-table');
    expect(t.d.leftSeatPendingRef.current).toBe(false);
  });

  it('a rebuy that was not confirmed leaves the player as the bust left them', async () => {
    const t = table();
    t.d.tournamentService.processRebuy = vi.fn(async () => ({ success: false }));
    t.bust();
    await t.rebuy();
    expect(t.d.leftSeatPendingRef.current).toBe(true);
    expect(t.dealt(21)).toEqual([]);
  });

  it('every paid seat receipt on the page clears the latch, and the rebuy receipt is one of them', () => {
    expect(latchClears).toContain('onConfirmRebuy');
    expect(latchClears.length).toBeGreaterThanOrEqual(3);
  });
});
