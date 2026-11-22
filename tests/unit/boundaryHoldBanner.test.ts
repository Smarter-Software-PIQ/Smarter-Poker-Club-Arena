import { describe, expect, it } from 'vitest';
import { selectBoundaryHoldBanner } from '../../src/utils/boundaryHoldBanner';

describe('selectBoundaryHoldBanner', () => {
  it('returns null for cash games or while a hand is actively in progress', () => {
    expect(
      selectBoundaryHoldBanner({
        isTournament: false,
        isHandInProgress: false,
        handForHand: true,
        pauseOwners: ['hand_for_hand'],
      })
    ).toBeNull();
    expect(
      selectBoundaryHoldBanner({
        isTournament: true,
        isHandInProgress: true,
        handForHand: true,
        pauseOwners: ['hand_for_hand'],
      })
    ).toBeNull();
  });

  it('shows hand-for-hand banner when parked with hand_for_hand or tableState.handForHand', () => {
    expect(
      selectBoundaryHoldBanner({
        isTournament: true,
        isHandInProgress: false,
        handForHand: true,
        pauseOwners: [],
      })
    ).toMatchObject({ kind: 'hand_for_hand', title: 'Hand-For-Hand Play' });
    expect(
      selectBoundaryHoldBanner({
        isTournament: true,
        isHandInProgress: false,
        pauseOwners: ['hand_for_hand', 'tournament_move'],
      })
    ).toMatchObject({ kind: 'hand_for_hand' });
  });

  it('shows table balancing banner for tournament_move holds and closeout for terminal_closeout', () => {
    expect(
      selectBoundaryHoldBanner({
        isTournament: true,
        isHandInProgress: false,
        pauseOwners: ['tournament_move'],
      })
    ).toMatchObject({ kind: 'tournament_move', title: 'Balancing Tables' });
    expect(
      selectBoundaryHoldBanner({
        isTournament: true,
        isHandInProgress: false,
        pauseOwners: ['terminal_closeout', 'hand_for_hand'],
      })
    ).toMatchObject({ kind: 'terminal_closeout', title: 'Finalizing Tournament' });
  });
});
