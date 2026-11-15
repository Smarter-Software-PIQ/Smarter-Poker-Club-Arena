import { PerformancePose } from '../PerformancePose';
import { AtlasSprite } from '../AtlasSprite';
import { RIG_VIEWBOX, type RigProps, type ThrowableRig } from '../rig';
import type { ThrowableSpec } from '../spec';
import { preloadThrowableCues } from '../cues';
import './thinking.css';

export const spec: ThrowableSpec = {
  id: 'thinking',
  name: 'Thinking Face',
  tier: 'free',
  category: 'emoticons',
  spawn: 'avatar-face',
  spawnMs: 167,
  flight: { ms: 333, mode: 'straight', upright: true },
  arrival: 'blink-pop',
  payload: { sizeU: 1.05, anchor: 'face', coversAvatar: true, ms: 3667 },
  beats: [
    { at: 433, marker: 'pop' },
    { at: 600, marker: 'hand-rise' },
    { at: 900, marker: 'chin-touch' },
    { at: 1200, marker: 'brows-knit' },
    { at: 1800, marker: 'brow-raise' },
    { at: 2400, marker: 'hmm-return' },
    { at: 3000, marker: 'hmm-hold' },
    { at: 4000, marker: 'cut' },
  ],
  audio: [
    { at: 433, sample: 'pop_soft', gain: 0.25 },
    { at: 1200, sample: 'thoughtful_hum', gain: 0.8 },
  ],
};
preloadThrowableCues(spec.audio.map((cue) => cue.sample));
function Face({ tile }: { tile: number }) {
  const rects: [number, number, number, number][] = [
    [0, 0, 627, 627],
    [627, 0, 627, 627],
    [0, 627, 627, 627],
  ];
  return <AtlasSprite src="thinking" rect={rects[tile]} x={-65} y={-65} width={130} height={130} />;
}
function Projectile(_props: RigProps) {
  return (
    <svg viewBox={RIG_VIEWBOX} aria-hidden="true" focusable="false">
      <Face tile={0} />
    </svg>
  );
}
function Payload(_props: RigProps) {
  return (
    <svg viewBox={RIG_VIEWBOX} aria-hidden="true" focusable="false">
      <g className="thr-thinking__pop">
        <g className="thr-thinking__neutral">
          <Face tile={0} />
        </g>
        <g className="thr-thinking__frown">
          <PerformancePose
            src="thinking-acting"
            row={0}
            rows={2}
            x={-65.0}
            y={-65.0}
            width={130.0}
            height={130.0}
            duration={520}
            delay={810}
            repeats={1}
          />
        </g>
        <g className="thr-thinking__raised">
          <PerformancePose
            src="thinking-acting"
            row={1}
            rows={2}
            x={-65.0}
            y={-65.0}
            width={130.0}
            height={130.0}
            duration={620}
            delay={1430}
            repeats={2}
          />
        </g>
        <g className="thr-thinking__hand">
          <AtlasSprite
            src="thinking"
            rect={[627, 627, 627, 627]}
            x={-55}
            y={-20}
            width={100}
            height={100}
          />
        </g>
      </g>
    </svg>
  );
}
export const rig: ThrowableRig = { Projectile, Payload };
