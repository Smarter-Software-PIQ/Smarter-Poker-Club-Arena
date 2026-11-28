/**
 * The table's #SmarterDesign surfaces, mounted offline for the rendered ink
 * guard (tests/e2e/css/table-surfaces-wear-smarterdesign.spec.ts).
 *
 * Each surface is the REAL component the table renders, inside the same
 * ConsoleSkinProvider value MultiTableSurface gives the table layer, so every
 * skin-scoped rule (`.sc--sd`, `[data-console-skin='smarterdesign']`) applies
 * exactly as it does for a player. The spec picks the surface with
 * `<html data-surface="...">`. Supabase and the signed-in user are swapped for
 * the offline stand-ins beside this file by the spec's esbuild bundle.
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ConsoleSkinProvider } from '../../../../src/components/console/consoleSkin';
import { ToastProvider } from '../../../../src/components/common/Toast';
import { TableMenu, createDefaultMenuSections } from '../../../../src/components/table/TableMenu';
import HandHistoryPanel from '../../../../src/components/table/HandHistoryPanel';
import { HandDetailModal } from '../../../../src/components/table/HandDetailModal';
import LeaderboardPanel from '../../../../src/components/table/LeaderboardPanel';
import RealTimeResultPanel from '../../../../src/components/table/RealTimeResultPanel';
import { GameRulesModal } from '../../../../src/components/table/GameRulesModal';
import { ThemeSettingsModal } from '../../../../src/components/table/ThemeSettingsModal';
import { OnlineFriendInvitePicker } from '../../../../src/components/table/OnlineFriendInvitePicker';
import LeaveTableConfirm from '../../../../src/components/table/LeaveTableConfirm';
import { TableChat, type ChatMessage } from '../../../../src/components/table/TableChat';
import { BuyInModal } from '../../../../src/components/table/BuyInModal';
import { InsuranceModal } from '../../../../src/components/table/InsuranceModal';
import AddOnModal from '../../../../src/components/table/AddOnModal';
import { adaptServiceHandToPanel } from '../../../../src/lib/handHistoryAdapter';
import { FIXTURE_USER_ID } from './supabaseStub';

const HERO = FIXTURE_USER_ID;
const VILLAIN = '00000000-0000-4000-8000-0000000000b1';
const noop = () => undefined;

const hand = adaptServiceHandToPanel(
  {
    id: 'fixture-hand-1',
    table_id: 'fixture-table',
    table_name: 'Midway 1/2',
    played_at: '2026-11-28T12:00:00.000Z',
    hand_number: 3046089,
    total_hands: 0,
    main_pot: 1470,
    side_pots: [],
    community_cards: ['7clubs', '2clubs', '9hearts', 'Kdiamonds', 'Tclubs'],
    players: [
      {
        seat: 1,
        user_id: HERO,
        username: 'fixture_hero',
        avatar_url: null,
        position: 'BTN',
        hole_cards: [
          { rank: 'A', suit: 'spades' },
          { rank: 'A', suit: 'hearts' },
        ],
        result: 735,
        is_winner: true,
        showdown_reveal: { reveal_order: 1, mucked: false, hand_name: 'Pair' },
      },
      {
        seat: 2,
        user_id: VILLAIN,
        username: 'Emerson Blackwell',
        avatar_url: null,
        position: 'BB',
        hole_cards: [
          { rank: 'K', suit: 'clubs' },
          { rank: 'Q', suit: 'clubs' },
        ],
        result: -735,
        is_winner: false,
        showdown_reveal: { reveal_order: 2, mucked: false, hand_name: 'High Card' },
      },
    ],
    actions: [
      { player_id: HERO, action: 'raise', amount: 6, street: 'preflop', timestamp: 1 },
      { player_id: VILLAIN, action: 'call', amount: 4, street: 'preflop', timestamp: 2 },
      { player_id: VILLAIN, action: 'check', amount: 0, street: 'flop', timestamp: 3 },
      { player_id: HERO, action: 'all_in', amount: 735, street: 'flop', timestamp: 4 },
      { player_id: VILLAIN, action: 'call', amount: 735, street: 'flop', timestamp: 5 },
    ],
    winners: [{ user_id: HERO, amount: 1470, pot_index: 0, hand_name: 'Pair' }],
    winners_by_board: [],
    rake: 0,
    bbj_fee: 0,
    game_type: 'NLH',
    stakes: '1/2',
  } as unknown as Parameters<typeof adaptServiceHandToPanel>[0],
  HERO
);

const chatMessages: ChatMessage[] = [
  {
    id: 'm1',
    type: 'DEALER',
    content: 'Hand #3046089 Started',
    timestamp: new Date('2026-11-28T12:00:00Z'),
  },
  {
    id: 'm2',
    type: 'PLAYER',
    playerId: VILLAIN,
    playerName: 'Emerson Blackwell',
    content: 'Nice Hand',
    timestamp: new Date('2026-11-28T12:00:05Z'),
  },
  {
    id: 'm3',
    type: 'PLAYER',
    playerId: HERO,
    playerName: 'fixture_hero',
    content: 'Thank You',
    timestamp: new Date('2026-11-28T12:00:09Z'),
  },
  {
    id: 'm4',
    type: 'SYSTEM',
    content: 'Cali Duncan Joined The Table',
    timestamp: new Date('2026-11-28T12:00:12Z'),
  },
];

const card = (rank: string, suit: 'h' | 'd' | 'c' | 's') => ({ rank, suit });

function Drawer() {
  const [open, setOpen] = useState(true);
  return (
    <TableMenu
      isOpen={open}
      onClose={() => setOpen(false)}
      onToggle={() => setOpen((v) => !v)}
      tableName="Midway 1/2"
      handNumber={3046089}
      sessionDuration="1h 12m"
      sections={createDefaultMenuSections({
        onSitOut: noop,
        onInviteOnlineFriend: noop,
        onRebuy: noop,
        onSessionStats: noop,
        onSettings: noop,
        onToggleSounds: noop,
        onHandHistory: noop,
        onLeaderboard: noop,
        onHelp: noop,
        onLeaveTable: noop,
        onLeaveTableNextHand: noop,
      })}
    />
  );
}

function Surface({ name }: { name: string }) {
  switch (name) {
    case 'drawer':
      return <Drawer />;
    case 'hand-history':
      return (
        <HandHistoryPanel isOpen onClose={noop} hands={[hand]} heroId={HERO} onOpenDetail={noop} />
      );
    case 'hand-detail':
      return (
        <HandDetailModal
          isOpen
          onClose={noop}
          hands={[hand]}
          heroId={HERO}
          initialHandId={hand.id}
          currentUserName="fixture_hero"
        />
      );
    case 'leaderboard':
      return (
        <LeaderboardPanel
          isOpen
          onClose={noop}
          title="Table Leaderboard"
          period="session"
          onPeriodChange={noop}
          players={[
            {
              rank: 1,
              playerId: HERO,
              playerName: 'fixture_hero',
              amount: 735,
              isPositive: true,
              handsPlayed: 41,
              isCurrentUser: true,
            },
            {
              rank: 2,
              playerId: 'p2',
              playerName: 'Cali Duncan',
              amount: 120,
              isPositive: true,
              handsPlayed: 38,
            },
            {
              rank: 3,
              playerId: VILLAIN,
              playerName: 'Emerson Blackwell',
              amount: 735,
              isPositive: false,
              handsPlayed: 44,
            },
          ]}
        />
      );
    case 'session-stats':
      return (
        <RealTimeResultPanel
          isOpen
          onClose={noop}
          tableId="fixture-table"
          userId={HERO}
          initialStack={200}
          bigBlind={2}
          onOpenDetailed={noop}
        />
      );
    case 'game-rules':
      return (
        <GameRulesModal
          isOpen
          onClose={noop}
          variant="No Limit Hold'em"
          stakes="1/2"
          minBuyIn={80}
          maxBuyIn={400}
          rakePercentage={5}
          rakeCap={4}
          isStraddleEnabled
          isRunItTwiceEnabled
          isCashTable
        />
      );
    case 'table-studio':
      return <ThemeSettingsModal isOpen onClose={noop} userId={HERO} isVip={false} />;
    case 'invite':
      return (
        <OnlineFriendInvitePicker
          mode="modal"
          isOpen
          onClose={noop}
          senderUserId={HERO}
          senderName="fixture_hero"
          kind="cash"
          tableId="fixture-table"
          tableName="Midway 1/2"
        />
      );
    case 'leave':
      return (
        <LeaveTableConfirm
          isOpen
          currentStack={935}
          tableName="Midway 1/2"
          onConfirm={noop}
          onCancel={noop}
        />
      );
    case 'chat':
      return (
        <TableChat
          messages={chatMessages}
          onSendMessage={noop}
          myPlayerId={HERO}
          tableId="fixture-table"
          isCollapsed={false}
          onToggleCollapse={noop}
        />
      );
    case 'buy-in':
      return (
        <BuyInModal
          isOpen
          onClose={noop}
          onConfirm={() => ({ ok: true }) as never}
          tableName="Midway 1/2"
          gameType="NLH"
          minBuyIn={80}
          maxBuyIn={400}
          defaultBuyIn={200}
          accountBalance={5200}
          bigBlind={2}
        />
      );
    case 'insurance':
      return (
        <InsuranceModal
          isOpen
          onClose={noop}
          onAccept={noop}
          onDecline={noop}
          onDeclineForHand={noop}
          onEvCashout={noop}
          timeRemaining={15}
          enableEvCashout
          offer={{
            maxCoverage: 600,
            equityPercent: 72,
            premiumRate: 0.25,
            potAmount: 1470,
            yourStack: 0,
            opponentStack: 0,
            yourCards: [card('A', 's'), card('A', 'h')],
            opponentCards: [card('K', 'c'), card('Q', 'c')],
            board: [card('7', 'c'), card('2', 'c'), card('9', 'h')],
            outs: [card('3', 'c'), card('4', 'c'), card('5', 'c')],
            outPct: 21,
          }}
        />
      );
    case 'add-on':
      return (
        <AddOnModal
          isVisible
          addOnCost={10}
          addOnFee={1}
          addOnChips={10000}
          walletBalance={5200}
          timeRemaining={45}
          onAccept={async () => true}
          onDecline={noop}
        />
      );
    default:
      return <p>Unknown Surface</p>;
  }
}

const surface = document.documentElement.dataset.surface || '';
createRoot(document.getElementById('root')!).render(
  <MemoryRouter>
    <ToastProvider>
      <ConsoleSkinProvider value="smarterdesign">
        <div className="table-page table-page--embedded" data-fixture-surface={surface}>
          <Surface name={surface} />
        </div>
      </ConsoleSkinProvider>
    </ToastProvider>
  </MemoryRouter>
);
