import { PerformancePose } from '../PerformancePose';
import { AtlasSprite } from '../AtlasSprite';
import { preloadThrowableCues } from '../cues';
import { RIG_VIEWBOX, type RigProps, type ThrowableRig } from '../rig';
import type { ThrowableSpec } from '../spec';
import './skull.css';

export const spec: ThrowableSpec = {
  id: 'skull',
  name: 'Skull',
  tier: 'premium',
  category: 'characters',
  spawn: 'avatar-face',
  spawnMs: 167,
  flight: { ms: 300, mode: 'straight', upright: true },
  arrival: 'blink-pop',
  payload: { sizeU: 1.2, anchor: 'face', coversAvatar: true, ms: 3500 },
  beats: [
    { at: 300, marker: 'pop' },
    { at: 600, marker: 'jaw-chatter' },
    { at: 1400, marker: 'jaw-settle' },
    { at: 1600, marker: 'red-eyes' },
    { at: 2400, marker: 'vertical-crack' },
    { at: 2600, marker: 'gravestone' },
    { at: 2800, marker: 'gravestone-hold' },
    { at: 3800, marker: 'cut' },
  ],
  // Dedicated bone and stone recordings still need final sound acceptance.
  audio: [
    { at: 600, sample: 'bone_chatter', gain: 0.8 },
    { at: 1040, sample: 'bone_chatter', gain: 0.58 },
    { at: 1600, sample: 'swell_low', gain: 0.33 },
    { at: 2400, sample: 'stone_drop', gain: 0.93 },
  ],
};
preloadThrowableCues(spec.audio.map((cue) => cue.sample));
function Closed() {
  return (
    <AtlasSprite src="skull" rect={[0, 0, 627, 627]} x={-55} y={-58} width={110} height={116} />
  );
}
function Red() {
  return (
    <AtlasSprite src="skull" rect={[0, 627, 627, 627]} x={-55} y={-58} width={110} height={116} />
  );
}
function Projectile(_props: RigProps) {
  return (
    <svg viewBox={RIG_VIEWBOX} aria-hidden="true" focusable="false">
      <AtlasSprite src="skull" rect={[0, 0, 627, 627]} x={-30} y={-32} width={60} height={64} />
    </svg>
  );
}
function Payload({ uid }: RigProps) {
  return (
    <svg viewBox={RIG_VIEWBOX} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={`${uid}left`}>
          <path d="M-60 -65H0L-4 -42L3 -25L-3 -5L4 15L-2 36L0 65H-60Z" />
        </clipPath>
        <clipPath id={`${uid}right`}>
          <path d="M0 -65H60V65H0L-2 36L4 15L-3 -5L3 -25L-4 -42Z" />
        </clipPath>
      </defs>
      <g className="thr-skull__grave">
        <AtlasSprite
          src="impact-details"
          rect={[0, 0, 627, 627]}
          x={-53}
          y={-65}
          width={106}
          height={126}
        />
      </g>
      <g className="thr-skull__whole">
        <g className="thr-skull__closed">
          <Closed />
        </g>
        <g className="thr-skull__open">
          <PerformancePose
            src="skull-acting"
            row={0}
            rows={1}
            x={-55.0}
            y={-55.0}
            width={110.0}
            height={110.0}
            duration={190}
            delay={290}
            repeats={5}
          />
        </g>
        <g className="thr-skull__red">
          <Red />
        </g>
      </g>
      <g className="thr-skull__left">
        <g clipPath={`url(#${uid}left)`}>
          <Red />
        </g>
      </g>
      <g className="thr-skull__right">
        <g clipPath={`url(#${uid}right)`}>
          <Red />
        </g>
      </g>
    </svg>
  );
}
export const rig: ThrowableRig = { Projectile, Payload };
