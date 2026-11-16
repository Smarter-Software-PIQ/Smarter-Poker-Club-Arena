import { useMemo } from 'react';
import type { ShareableHand } from './ShareHand';
import { replayFromShareable, shareUserId } from '../../lib/shareHandModel';
import { buildReplayFrames } from '../../utils/replayFrames';
import { frameMotion } from '../../utils/replayMotion';
import { holdingSize } from '../../utils/holdingSize';
import SharedTableStage from '../replay/SharedTableStage';

export default function ShareTablePreview({ hand }: { hand: ShareableHand }) {
  const model = useMemo(() => replayFromShareable(hand), [hand]);
  const frames = useMemo(() => buildReplayFrames(model), [model]);
  const frame = frames[frames.length - 1];
  const hero = hand.players.find((player) => player.isHero);
  if (!frame || !model.players.length) return null;
  return (
    <div className="share-hand__table-picture" inert aria-label="Table at the end of the hand">
      <SharedTableStage
        model={model}
        frame={frame}
        motion={frameMotion(null, frame, [])}
        heroId={hero ? shareUserId(hero.seat) : null}
        privateOwnerTag={hero?.name ?? ''}
        playing={false}
        rate={1}
        offset={hand.appearance?.endAtMs ?? 0}
        appearance={hand.appearance ?? null}
        holeCount={holdingSize(model)}
      />
    </div>
  );
}
