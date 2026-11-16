import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { ReplayModel, ReplayVerb } from '../../utils/handReplay';
import type { ReplayFrame } from '../../utils/replayFrames';
import type { FrameMotion } from '../../utils/replayMotion';
import { rotateSeatsForHero, seatLayoutFor } from '../../lib/tableSeatGeometry';
import { resolveBackgroundLayers, resolveSkin } from '../../lib/tableTheme';
import type { SharedTableAppearance } from '../../lib/sharedTableAppearance';
import SeatSlot, { type LastAction, type PositionBadge } from '../table/SeatSlot';
import PotDisplay from '../table/PotDisplay';
import DealerButton from '../table/DealerButton';
import { FaceDeckContext } from '../table/faceDeckContext';
import CommunityCards from '../table/CommunityCards';
import {
  betChipOffsetPx,
  chipCollectOffsetPx,
  fitSeatToViewport,
  seatPodPx,
  POT_ANCHOR_PCT,
  PORTRAIT_CARD_LANE_MAX_VIEWPORT_PX,
} from '../table/tableGeometry';
import logo from '../../assets/smarter-poker-letter-logo.png';
import '../../styles/table-design-tokens.css';
import '../../pages/TablePage.css';
import './SharedTableStage.css';

function seatAction(verb?: ReplayVerb): LastAction {
  switch (verb) {
    case 'fold':
    case 'check':
    case 'call':
    case 'bet':
    case 'raise':
    case 'all_in':
    case 'discard':
      return verb;
    default:
      return null;
  }
}

export default function SharedTableStage({
  model,
  frame,
  motion,
  heroId,
  privateOwnerTag,
  appearance,
  holeCount,
}: {
  model: ReplayModel;
  frame: ReplayFrame;
  motion: FrameMotion;
  heroId: string | null;
  privateOwnerTag: string;
  appearance: SharedTableAppearance | null;
  holeCount: number;
}) {
  const scaler = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 320, h: 520, left: 0, viewport: 390 });
  useLayoutEffect(() => {
    const element = scaler.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      const stage = element.parentElement?.getBoundingClientRect();
      if (stage?.width && rect.width && rect.height) {
        setSize({
          w: rect.width,
          h: rect.height,
          left: rect.left - stage.left,
          viewport: stage.width,
        });
      }
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  const highestSeat = Math.max(...model.players.map((p) => p.seat));
  const ring = seatLayoutFor(
    Math.max(highestSeat, appearance?.maxPlayers ?? (highestSeat <= 6 ? 6 : 9))
  );
  const heroSeat = model.players.find((p) => p.userId === heroId)?.seat ?? 0;
  const seats = rotateSeatsForHero(ring, heroSeat);
  const deckStyle = appearance?.fourColor ? '4color' : '2color';
  const button = seats[(model.buttonSeat ?? 0) - 1];
  const pods = ring.map((pos) =>
    seatPodPx(size.viewport, pos.y >= 100 && pos.x === 50, size.w, {
      seats: ring.length,
      canvasHeightPx: size.h,
    })
  );
  const markerSize = {
    ...size,
    railBets: size.viewport <= 480 && size.h > size.w,
    portraitTags:
      size.viewport <= PORTRAIT_CARD_LANE_MAX_VIEWPORT_PX && window.innerHeight > size.viewport,
    portraitTaper: heroSeat ? undefined : 0,
  };
  const fitted = ring.map((pos, i) =>
    fitSeatToViewport(pos, markerSize, size.viewport, pods[i], size.left, ring.length)
  );
  const awardSlot = motion.potTo.length === 1 ? seats[motion.potTo[0] - 1] : null;
  const destination = awardSlot && fitted[awardSlot.visualIndex];
  const boards = [frame.board, ...frame.extraBoards];
  return (
    <FaceDeckContext.Provider value={appearance?.faceDeck}>
      <section
        className="table-page shared-table-stage"
        aria-label={frame.caption}
        data-seats={ring.length}
        data-hero={!!heroSeat}
        style={{ backgroundImage: resolveBackgroundLayers(appearance?.background) }}
      >
        <div
          ref={scaler}
          className="shared-table-stage__surface table-scaler"
          style={{ '--table-w': size.w + 'px', '--table-h': size.h + 'px' } as CSSProperties}
        >
          <div className="table-felt">
            <img className="table-art" src={resolveSkin(appearance?.skin ?? '')} alt="" />
            <div className="table-rail">
              <div className="table-surface">
                <div className="table-brand">
                  <img className="table-brand__logo" src={logo} alt="" />
                </div>
              </div>
            </div>
          </div>
          <div className="pot-area">
            <PotDisplay
              collectTo={
                destination
                  ? {
                      dx: ((destination.x - POT_ANCHOR_PCT.x) * size.w) / 100,
                      dy: ((destination.y - POT_ANCHOR_PCT.y) * size.h) / 100,
                    }
                  : null
              }
              mainPot={frame.pot}
              bigBlind={model.bigBlind}
              streetBets={Object.values(frame.committed).reduce((sum, bet) => sum + bet, 0)}
            />
          </div>
          <div className="shared-table-stage__boards">
            {boards.map((board, index) => (
              <div key={index}>
                {boards.length > 1 && <span>Run {index + 1}</span>}
                <CommunityCards
                  cards={board}
                  stage={
                    frame.isShowdown
                      ? 'showdown'
                      : board.length >= 5
                        ? 'river'
                        : board.length === 4
                          ? 'turn'
                          : board.length >= 3
                            ? 'flop'
                            : 'preflop'
                  }
                  boardIndex={index}
                  runs={boards.length}
                  handId={model.handNumber ?? undefined}
                  deckStyle={deckStyle}
                  cardBack={appearance?.cardBack}
                  playSounds={false}
                />
              </div>
            ))}
          </div>
          {button && (
            <DealerButton
              dealerVisualIndex={button.visualIndex}
              seatPositions={fitted}
              isVisible
              playSounds={false}
            />
          )}
          {model.players.map((p) => {
            const index = seats[p.seat - 1]?.visualIndex;
            const spot = fitted[index];
            if (!spot) return null;
            const own = p.userId === heroId;
            const revealed = frame.revealed.includes(p.seat);
            const cards = own ? (p.hole ?? p.privateHole) : revealed ? p.hole : null;
            const folded = frame.folded.includes(p.seat);
            const active = frame.activeSeat === p.seat;
            const action = active ? seatAction(frame.row?.verb) : null;
            const stack = frame.stacks[p.seat];
            const winner = frame.isShowdown && p.won > 0;
            const bet = betChipOffsetPx(spot, markerSize, pods[index]);
            const collect = chipCollectOffsetPx(spot, markerSize, pods[index]);
            const pos = {
              '--bet-offset-x': bet.x + 'px',
              '--bet-offset-y': bet.y + 'px',
              '--collect-dx': collect.x + 'px',
              '--collect-dy': collect.y + 'px',
              left: spot.x + '%',
              top: spot.y + '%',
              '--deal-from-x': 50 - spot.x + 'cqw',
              '--deal-from-y': 50 - spot.y + 'cqh',
              '--fold-to-x': 50 - spot.x + 'cqw',
              '--fold-to-y': 50 - spot.y + 'cqh',
            } as CSSProperties;
            return (
              <div
                key={p.seat}
                data-seat-wrapper={p.seat}
                style={pos}
                className={`seat-wrapper${own ? ' seat-wrapper--hero' : ''}${spot.y < 20 ? ' seat-wrapper--top seat-wrapper--cap' : ''}${revealed ? ' seat-wrapper--showing' : ''}`}
              >
                <SeatSlot
                  seatNumber={p.seat}
                  player={{
                    id: p.userId,
                    name: p.username,
                    avatar: p.avatarUrl ?? undefined,
                    stack: stack ?? 0,
                    stackPending: stack == null,
                    status: folded ? 'folded' : action === 'all_in' ? 'all_in' : 'active',
                    isHero: own,
                    showCards: revealed,
                    holeCards: cards ?? undefined,
                  }}
                  position={p.position as PositionBadge}
                  isActive={active}
                  lastAction={action}
                  lastBetAmount={frame.committed[p.seat]}
                  handInPlay={!frame.isShowdown}
                  holeCardCount={holeCount}
                  isDealing={frame.key === 'deal'}
                  isMucking={motion.fold === p.seat}
                  isCollectingChips={motion.sweep.includes(p.seat)}
                  isWinner={winner}
                  winnerDisplayActive={winner}
                  netWinAmount={winner ? p.won : undefined}
                  showAvatar={!!p.avatarUrl && appearance?.showAvatars !== false}
                  bigBlind={model.bigBlind}
                  deckStyle={deckStyle}
                  cardBack={appearance?.cardBack}
                  playSounds={false}
                />
                {own && !revealed && !!cards?.length && (
                  <span className="hr-seat__private">{privateOwnerTag}</span>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </FaceDeckContext.Provider>
  );
}
