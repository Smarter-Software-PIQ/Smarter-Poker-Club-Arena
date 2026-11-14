/**
 * AN ENTRANT HELD FOR THE BLIND IS NOT "SITTING OUT" (Dan 2026-09-23)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "IT SHOULDN'T SAY 'SITTING OUT' IF YOU AGREED TO 'POST THE BIG BLIND'. IT
 * ALSO SHOULDN'T SAY 'SITTING OUT' IF THEY ARE WAITING FOR BB, IT SHOULD SAY
 * 'WAITING FOR BB'."
 *
 * The engine flags every cash entrant it is holding for the big blind as
 * sitting out, and the seat printed SITTING OUT over all of them - including
 * the player in Dan's screenshot who had just tapped Post Big Blind. The seat
 * now takes `entryWait` from the parent, decided from the engine's own two
 * lists, and says what is true. This renders the seat for each state.
 */
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import SeatSlot, { type SeatPlayer } from '../../src/components/table/SeatSlot';
import { mapEngineSnapshot } from '../../src/utils/mapEngineSnapshot';
import type { EngineSnapshot } from '../../src/services/EngineStateClient';
import { sliceBetween } from '../helpers/sourceWindow';

const entrant = (over: Partial<SeatPlayer> = {}): SeatPlayer => ({
  id: 'u-kingfish',
  name: 'KingFish',
  avatar: '',
  stack: 1000,
  status: 'sitting_out',
  isHero: false,
  showCards: false,
  ...over,
});

const seat = (entryWait: 'waiting_for_button' | 'waiting_for_bb' | 'posting_bb' | null) =>
  render(
    <SeatSlot
      seatNumber={4}
      player={entrant()}
      position={null}
      isActive={false}
      lastAction={null}
      entryWait={entryWait}
    />
  ).container;

describe('what a sat-out seat says', () => {
  it('a tournament arrival uses the ordinary Sitting Out badge; a cash move retains its button hold', () => {
    const page = readFileSync(resolve(__dirname, '../../src/pages/TablePage.tsx'), 'utf8');
    const source = ts.createSourceFile(
      'TablePage.tsx',
      page,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    let expression = '';
    const visit = (node: ts.Node) => {
      if (
        ts.isJsxAttribute(node) &&
        node.name.getText(source) === 'entryWait' &&
        node.initializer &&
        ts.isJsxExpression(node.initializer)
      ) {
        expression = node.initializer.expression?.getText(source) ?? '';
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(expression).not.toBe('');
    const choose = new Function(
      'displayPlayer',
      'tableState',
      'bbPostAgreed',
      `return (${expression});`
    );
    const player = entrant({ waitingForButton: true });
    const tournamentWait = choose(player, { isTournament: true }, false);
    expect(tournamentWait).toBeNull();
    const c = seat(tournamentWait);
    expect(c.querySelector('[data-testid="seat-sitout-badge"]')?.textContent).toBe('Sitting Out');
    expect(c.textContent).not.toContain('Waiting For');
    const cashWait = choose(player, { isTournament: false }, false);
    expect(cashWait).toBe('waiting_for_button');
    expect(
      seat(cashWait).querySelector('[data-testid="seat-waiting-button-badge"]')?.textContent?.trim()
    ).toBe('Waiting For The Button To Pass');
  });

  it('the held-arrival footer scopes Sitting Out to tournaments and offers no return action', () => {
    const page = readFileSync(resolve(__dirname, '../../src/pages/TablePage.tsx'), 'utf8');
    // 2026-11-14: "Joining Lightning..." now opens the footer chain, so this
    // branch is the second one and no longer starts with the chain's brace.
    const bar = sliceBetween(page, 'heroWaitingForButton ? (', ') : lightningRoom');
    expect(bar).toContain(
      "tableState.isTournament ? 'Sitting Out' : 'Waiting For The Button To Pass'"
    );
    expect(bar).not.toContain("I'm Back");
  });

  it('held for the blind and unanswered: Waiting For BB, not Sitting Out', () => {
    const c = seat('waiting_for_bb');
    const badge = c.querySelector('[data-testid="seat-waiting-bb-badge"]');
    expect(badge?.textContent).toBe('Waiting For BB');
    expect(c.querySelector('[data-testid="seat-sitout-badge"]')).toBeNull();
    expect(c.textContent).not.toContain('Sitting Out');
  });

  it('agreed to post the big blind: no badge at all', () => {
    const c = seat('posting_bb');
    expect(c.querySelector('[data-testid="seat-waiting-bb-badge"]')).toBeNull();
    expect(c.querySelector('[data-testid="seat-sitout-badge"]')).toBeNull();
    expect(c.textContent).not.toContain('Sitting Out');
    expect(c.textContent).not.toContain('Waiting For BB');
  });

  it('a real sit-out is still a sit-out', () => {
    const c = seat(null);
    expect(c.querySelector('[data-testid="seat-sitout-badge"]')?.textContent).toBe('Sitting Out');
  });
});

describe('the parent decides from the engine lists', () => {
  it('TablePage reads post_bb_deferred_user_ids before waiting_for_bb_user_ids', () => {
    const page = readFileSync(resolve(__dirname, '../../src/pages/TablePage.tsx'), 'utf8');
    // The prop's expression, bounded by the prop that follows it in the JSX.
    const expr = sliceBetween(page, 'entryWait={', 'showPickedCardIndexes=');
    expect(expr.length).toBeGreaterThan(0);
    expect(expr).toContain('(tableState.postBBDeferredUserIds ?? []).includes(displayPlayer.id)');
    expect(expr).toContain("? 'posting_bb'");
    expect(expr).toContain('(tableState.waitingForBBUserIds ?? []).includes(displayPlayer.id)');
    expect(expr).toContain("? 'waiting_for_bb'");
    // the deferred check is the earlier branch
    expect(expr.indexOf('postBBDeferredUserIds')).toBeLessThan(expr.indexOf('waitingForBBUserIds'));
  });

  it('a player released to post on the next deal is posting, not sitting out (2026-09-24)', () => {
    // postBBToEnter deletes the player from BOTH waitingForBB and
    // postBBWhenClear and parks them in postingBBToEnter, which was not
    // published. So between the tap and the deal the seat read neither list
    // and fell through to SITTING OUT - the case Dan named.
    const page = readFileSync(resolve(__dirname, '../../src/pages/TablePage.tsx'), 'utf8');
    const expr = sliceBetween(page, 'entryWait={', 'showPickedCardIndexes=');
    expect(expr).toContain('(tableState.postingBBUserIds ?? []).includes(displayPlayer.id)');
    expect(expr.indexOf('postingBBUserIds')).toBeLessThan(expr.indexOf("? 'posting_bb'"));
    const mapper = readFileSync(resolve(__dirname, '../../src/utils/mapEngineSnapshot.ts'), 'utf8');
    expect(mapper).toContain('posting_bb_user_ids');
    expect(mapper).toMatch(
      /postingBBUserIds:\s*\n?\s*\(s as unknown as \{ posting_bb_user_ids\?: string\[\] \}\)\.posting_bb_user_ids \?\? \[\]/
    );
    const engine = readFileSync(
      resolve(__dirname, '../../server/src/engine/ServerTableEngine.ts'),
      'utf8'
    );
    // Idle and the physical occupancy completion publish it in the engine;
    // the shared live projection also retains the Lightning contract.
    const projection = readFileSync(
      resolve(__dirname, '../../server/src/engine/presentation/projectHandState.ts'),
      'utf8'
    );
    expect(
      engine.match(/posting_bb_user_ids: Array\.from\(this\.postingBBToEnter\)/g)
    ).toHaveLength(2);
    expect(engine).toContain('postingBBToEnter: this.postingBBToEnter,');
    expect(projection).toContain('posting_bb_user_ids: Array.from(ctx.postingBBToEnter)');
  });
});

describe('occupied nonparticipants survive the client mapper', () => {
  it('renders the retained avatar and correct badge through successive live updates', () => {
    const raw = {
      table_id: 'occupied',
      max_seats: 6,
      hand_number: 7,
      stage: 'preflop',
      waiting_for_bb_user_ids: ['waiting'],
      players: [
        {
          seat: 4,
          user_id: 'waiting',
          username: 'utg777',
          avatar_url: '/avatar.png',
          stack: 1796,
          cards: [],
          bet: 0,
          is_sitting_out: true,
        },
      ],
    } as unknown as EngineSnapshot;
    const view = render(
      <SeatSlot seatNumber={4} player={null} position={null} isActive={false} lastAction={null} />
    );
    for (const stage of ['preflop', 'flop', 'turn', 'river', 'showdown']) {
      const mapped = mapEngineSnapshot({ ...raw, stage } as EngineSnapshot, 'spectator', 6);
      view.rerender(
        <SeatSlot
          seatNumber={4}
          player={mapped.players[3] as SeatPlayer}
          position={null}
          isActive={false}
          lastAction={null}
          entryWait="waiting_for_bb"
        />
      );
      expect(view.container.textContent).toContain('utg777');
      expect(
        view.container.querySelector('[data-testid="seat-waiting-bb-badge"]')?.textContent
      ).toBe('Waiting For BB');
      expect(view.container.querySelector('img[src="/avatar.png"]')).not.toBeNull();
    }
    const mapped = mapEngineSnapshot({ ...raw, players: [] } as EngineSnapshot, 'spectator', 6);
    view.rerender(
      <SeatSlot
        seatNumber={4}
        player={mapped.players[3] as SeatPlayer}
        position={null}
        isActive={false}
        lastAction={null}
      />
    );
    expect(view.container.textContent).not.toContain('utg777');
  });

  it('adopts all three status lists on reconnect without dropping older-engine state', () => {
    const page = readFileSync(resolve(__dirname, '../../src/pages/TablePage.tsx'), 'utf8');
    const resync = sliceBetween(page, "case 'GAME_START':", "case 'HAND_STARTED':");
    expect(resync).toContain('syncData.waiting_for_bb_user_ids ?? prev.waitingForBBUserIds');
    expect(resync).toContain('syncData.post_bb_deferred_user_ids ?? prev.postBBDeferredUserIds');
    expect(resync).toContain('syncData.posting_bb_user_ids ?? prev.postingBBUserIds');
  });
});

// Run the actual DB-poll paint callback between engine frames. The row's
// voluntary sit-out flag does not encode the engine's waiting-for-BB hold.
function seatPollPaint(update: (fn: (state: any) => any) => void) {
  const source = ts.createSourceFile(
    'TablePage.tsx',
    readFileSync(resolve(__dirname, '../../src/pages/TablePage.tsx'), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let paint = '';
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === 'paint' &&
      node.initializer?.getText(source).includes('sittingOut.has(p.id)')
    ) {
      paint = node.initializer.getText(source);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!paint) throw new Error('Actual seat sit-out paint callback not found');
  const compiled = ts.transpileModule('const paint = ' + paint, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function('setTableState', 'cancelled', compiled + '\nreturn paint;')(update, false);
}

describe('DB seat refresh cannot release an engine entry hold', () => {
  it('keeps a tournament button hold sitting out between frames and releases it on admission', () => {
    let state: any = { players: [entrant({ waitingForButton: true })] };
    const paint = seatPollPaint((update) => {
      state = update(state);
    });
    paint(new Set());
    expect(state.players[0].status).toBe('sitting_out');
    state.players[0].waitingForButton = false;
    paint(new Set());
    expect(state.players[0].status).toBe('active');
  });

  it('keeps the avatar and waiting badge between frames, then clears on admission and departure', () => {
    let state: any = {
      players: [entrant({ avatar: '/waiting.png' })],
      waitingForBBUserIds: ['u-kingfish'],
    };
    const paint = seatPollPaint((update) => {
      state = update(state);
    });
    const view = render(
      <SeatSlot
        seatNumber={1}
        player={state.players[0]}
        position={null}
        isActive={false}
        lastAction={null}
        entryWait="waiting_for_bb"
      />
    );
    const repaint = () =>
      view.rerender(
        <SeatSlot
          seatNumber={1}
          player={state.players[0]}
          position={null}
          isActive={false}
          lastAction={null}
          entryWait={
            state.waitingForBBUserIds.includes(state.players[0]?.id) ? 'waiting_for_bb' : null
          }
        />
      );
    for (let poll = 0; poll < 3; poll++) {
      paint(new Set());
      expect(state.players[0].status).toBe('sitting_out');
      repaint();
      expect(view.container.querySelector('[data-testid="seat-waiting-bb-badge"]')).not.toBeNull();
      expect(view.container.querySelector('img[src="/waiting.png"]')).not.toBeNull();
    }
    // The engine admits this entrant; only then may the DB paint restore active.
    state = { ...state, waitingForBBUserIds: [] };
    paint(new Set());
    repaint();
    expect(state.players[0].status).toBe('active');
    expect(view.container.querySelector('[data-testid="seat-waiting-bb-badge"]')).toBeNull();
    paint(new Set(['u-kingfish']));
    repaint();
    expect(view.container.querySelector('[data-testid="seat-sitout-badge"]')).not.toBeNull();
    state = { ...state, players: [null] };
    paint(new Set());
    repaint();
    expect(view.container.textContent).not.toContain('KingFish');
  });

  it('retains folded and all-in precedence and never transfers a departed hold to another occupant', () => {
    let state: any = {
      waitingForBBUserIds: ['u-kingfish'],
      players: [
        entrant({ status: 'folded' }),
        entrant({ status: 'all_in' }),
        entrant({ id: 'replacement', status: 'sitting_out' }),
        null,
      ],
    };
    const paint = seatPollPaint((update) => {
      state = update(state);
    });
    paint(new Set());
    expect(state.players.map((p: SeatPlayer | null) => p?.status ?? null)).toEqual([
      'folded',
      'all_in',
      'active',
      null,
    ]);
  });

  it('renders the engine waiting reason even while another seat projection says active', () => {
    const view = render(
      <SeatSlot
        seatNumber={1}
        player={entrant({ status: 'active' })}
        position={null}
        isActive={false}
        lastAction={null}
        entryWait="waiting_for_bb"
      />
    );
    expect(view.container.querySelector('[data-testid="seat-waiting-bb-badge"]')).not.toBeNull();
    expect(view.container.querySelector('[data-testid="seat-sitout-badge"]')).toBeNull();
    view.rerender(
      <SeatSlot
        seatNumber={1}
        player={entrant({ status: 'active' })}
        position={null}
        isActive={false}
        lastAction={null}
        entryWait="posting_bb"
      />
    );
    expect(view.container.querySelector('[data-testid="seat-waiting-bb-badge"]')).toBeNull();
  });
});
