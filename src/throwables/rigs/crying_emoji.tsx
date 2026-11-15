import { PerformancePose } from '../PerformancePose';
import { AtlasSprite } from '../AtlasSprite';
import { RIG_VIEWBOX, type RigProps, type ThrowableRig } from '../rig';
import type { ThrowableSpec } from '../spec';
import { preloadThrowableCues } from '../cues';
import './crying_emoji.css';
export const spec: ThrowableSpec = {
  id: 'crying_emoji',
  name: 'Loudly Crying',
  tier: 'free',
  category: 'emoticons',
  spawn: 'avatar-face',
  spawnMs: 167,
  flight: { ms: 300, mode: 'straight', upright: true },
  arrival: 'blink-pop',
  payload: { sizeU: 1.3, anchor: 'face', coversAvatar: true, ms: 3900 },
  beats: [
    { at: 300, marker: 'sad' },
    { at: 900, marker: 'lip-tremble' },
    { at: 1200, marker: 'cry' },
    { at: 1600, marker: 'puddle-spreads' },
    { at: 2300, marker: 'puddle-full' },
    { at: 3300, marker: 'sob-swell' },
    { at: 4200, marker: 'cut' },
  ],
  audio: [
    { at: 1200, sample: 'stifled_sob', gain: 0.74 },
    { at: 1600, sample: 'water_lap', gain: 0.25 },
    { at: 2300, sample: 'drip', gain: 0.5 },
    { at: 3300, sample: 'stifled_sob', gain: 0.92 },
  ],
};
preloadThrowableCues(spec.audio.map((c) => c.sample));
function Projectile(_props: RigProps) {
  return (
    <svg viewBox={RIG_VIEWBOX} aria-hidden="true" focusable="false">
      <AtlasSprite
        src="crying_emoji"
        rect={[40, 45, 570, 565]}
        x={-60}
        y={-60}
        width={120}
        height={120}
      />
    </svg>
  );
}
function Payload(_props: RigProps) {
  return (
    <svg viewBox={RIG_VIEWBOX} aria-hidden="true" focusable="false">
      <g className="thr-crying_emoji__sad">
        <AtlasSprite
          src="crying_emoji"
          rect={[40, 45, 570, 565]}
          x={-60}
          y={-60}
          width={120}
          height={120}
        />
      </g>
      <g className="thr-crying_emoji__tremble">
        <PerformancePose
          src="crying_emoji-acting"
          row={0}
          rows={2}
          x={-60.0}
          y={-59.474}
          width={120.0}
          height={118.947}
          duration={250}
          delay={570}
          repeats={3}
        />
      </g>
      <g className="thr-crying_emoji__puddle">
        <AtlasSprite
          src="rubber_duck"
          rect={[655, 810, 550, 350]}
          x={-80}
          y={40}
          width={160}
          height={48}
        />
      </g>
      <g className="thr-crying_emoji__sob">
        <PerformancePose
          src="crying_emoji-acting"
          row={1}
          rows={2}
          x={-60.0}
          y={-57.876}
          width={120.0}
          height={115.752}
          duration={660}
          delay={875}
          repeats={4}
        />
      </g>
      <g className="thr-crying_emoji__left">
        <AtlasSprite
          src="crying_emoji"
          rect={[1154, 1032, 35, 52]}
          x={-45}
          y={-4}
          width={12}
          height={16}
        />
      </g>
      <g className="thr-crying_emoji__right">
        <AtlasSprite
          src="crying_emoji"
          rect={[1154, 1032, 35, 52]}
          x={45}
          y={-4}
          width={12}
          height={16}
        />
      </g>
    </svg>
  );
}
export const rig: ThrowableRig = { Projectile, Payload };
