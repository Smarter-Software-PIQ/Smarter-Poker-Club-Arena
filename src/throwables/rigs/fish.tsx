import { AtlasSprite } from '../AtlasSprite';
import { PerformancePose } from '../PerformancePose';
import { preloadThrowableCues } from '../cues';
import { RIG_VIEWBOX, type RigProps, type ThrowableRig } from '../rig';
import type { ThrowableSpec } from '../spec';
import './fish.css';

export const spec: ThrowableSpec = {
  id: 'fish',
  name: 'Fish',
  tier: 'free',
  category: 'objects',
  spawn: 'avatar-corner',
  spawnMs: 167,
  flight: { ms: 300, mode: 'straight', upright: true },
  arrival: 'land',
  payload: { sizeU: 1.35, anchor: 'face', coversAvatar: true, ms: 3700 },
  beats: [
    { at: 300, marker: 'land' },
    { at: 700, marker: 'first-flop' },
    { at: 1240, marker: 'second-flop' },
    { at: 1780, marker: 'third-flop' },
    { at: 2100, marker: 'head-cut' },
    { at: 2420, marker: 'middle-cut' },
    { at: 2740, marker: 'tail-cut' },
    { at: 4000, marker: 'cut' },
  ],
  audio: [
    { at: 700, sample: 'fish_slap', gain: 0.78 },
    { at: 1240, sample: 'fish_slap', gain: 0.9 },
    { at: 1780, sample: 'fish_slap', gain: 0.65 },
    { at: 2100, sample: 'sushi_chop', gain: 0.78 },
    { at: 2420, sample: 'sushi_chop', gain: 0.86 },
    { at: 2740, sample: 'sushi_chop', gain: 1 },
  ],
};
preloadThrowableCues(spec.audio.map((cue) => cue.sample));

function FishBody() {
  return (
    <AtlasSprite src="fish" rect={[0, 0, 627, 627]} x={-75} y={-75} width={150} height={150} />
  );
}
function Projectile(_props: RigProps) {
  return (
    <svg viewBox={RIG_VIEWBOX} aria-hidden="true" focusable="false">
      <g transform="scale(.65)">
        <FishBody />
      </g>
    </svg>
  );
}
function Nigiri() {
  return (
    <AtlasSprite
      src="fish-nigiri"
      rect={[0, 0, 640, 480]}
      sheetSize={[640, 480]}
      x={-40}
      y={-30}
      width={80}
      height={60}
    />
  );
}

function Payload({ uid }: RigProps) {
  return (
    <svg viewBox={RIG_VIEWBOX} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={uid + 'middle'}>
          <rect x="-23" y="-75" width="100" height="150" />
        </clipPath>
        <clipPath id={uid + 'tail'}>
          <rect x="25" y="-75" width="52" height="150" />
        </clipPath>
        <linearGradient id={uid + 'steel'} x2=".4" y2="1">
          <stop stopColor="#d7edff" />
          <stop offset=".45" stopColor="#8199aa" />
          <stop offset=".63" stopColor="#f9ffff" />
          <stop offset="1" stopColor="#aec3d2" />
        </linearGradient>
        <g id={uid + 'cleaver'}>
          <path
            d="M-30 -18 H12 V4 Q5 12 -29 9Z"
            fill={'url(#' + uid + 'steel)'}
            stroke="#46616f"
            strokeWidth="1.4"
          />
          <path d="M-29 8 Q-9 11 11 4" fill="none" stroke="white" strokeWidth="2" />
          <path
            d="M12 -16 H31 Q36 -15 35 -11 Q34 -8 30 -8 L12 -10Z"
            fill="#723722"
            stroke="#301f1b"
            strokeWidth="1.5"
          />
          <circle cx="27" cy="-12" r="1.6" fill="#f1c28d" />
        </g>
      </defs>
      <g className="thr-fish__flop">
        <PerformancePose
          src="fish-acting"
          row={0}
          rows={2}
          x={-75}
          y={-75}
          width={150}
          height={150}
          duration={410}
          repeats={5}
        />
      </g>
      <g className="thr-fish__middle" clipPath={'url(#' + uid + 'middle)'}>
        <FishBody />
      </g>
      <g className="thr-fish__tail" clipPath={'url(#' + uid + 'tail)'}>
        <FishBody />
      </g>
      <g transform="translate(-47 10) rotate(-15)">
        <g className="thr-fish__first">
          <Nigiri />
        </g>
      </g>
      <g transform="translate(1 -13) rotate(4)">
        <g className="thr-fish__second">
          <Nigiri />
        </g>
      </g>
      <g transform="translate(49 14) rotate(14)">
        <g className="thr-fish__third">
          <Nigiri />
        </g>
      </g>
      <g className="thr-fish__knife">
        <use href={'#' + uid + 'cleaver'} />
      </g>
    </svg>
  );
}
export const rig: ThrowableRig = { Projectile, Payload };
