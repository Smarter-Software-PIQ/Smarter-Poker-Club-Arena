import { AtlasSprite } from '../AtlasSprite';
import { RIG_VIEWBOX, type RigProps, type ThrowableRig } from '../rig';
import type { ThrowableSpec } from '../spec';
import { preloadThrowableCues } from '../cues';
import './donkey.css';
export const spec: ThrowableSpec = {
  id: 'donkey',
  name: 'Donkey',
  tier: 'premium',
  category: 'characters',
  spawn: 'avatar-face',
  spawnMs: 167,
  flight: { ms: 333, mode: 'straight', upright: true },
  arrival: 'blink-pop',
  payload: { sizeU: 1.5, anchor: 'face', coversAvatar: false, ms: 4034 },
  beats: [
    { at: 333, marker: 'arrival' },
    { at: 433, marker: 'pop' },
    { at: 1150, marker: 'inhale' },
    { at: 1550, marker: 'bray' },
    { at: 2630, marker: 'reply-one' },
    { at: 3180, marker: 'reply-two' },
    { at: 3750, marker: 'reply-three' },
    { at: 4367, marker: 'cut' },
  ],
  audio: [
    { at: 433, sample: 'thump_soft', gain: 0.3 },
    { at: 1150, sample: 'donkey_hee_haw', gain: 1 },
  ],
};
preloadThrowableCues(spec.audio.map((cue) => cue.sample));
const sheetSize = [4032, 448] as const;

function Grin({ size }: { size: number }) {
  return (
    <AtlasSprite
      src="donkey"
      sheetSize={sheetSize}
      rect={[0, 0, 448, 448]}
      x={-size / 2}
      y={-size / 2}
      width={size}
      height={size}
    />
  );
}

function Projectile(_props: RigProps) {
  return (
    <svg viewBox={RIG_VIEWBOX} aria-hidden="true" focusable="false">
      <Grin size={92} />
    </svg>
  );
}

function Payload(_props: RigProps) {
  return (
    <svg viewBox={RIG_VIEWBOX} aria-hidden="true" focusable="false">
      <g className="thr-donkey__head">
        <g className="thr-donkey__grin">
          <Grin size={160} />
        </g>
        <g className="thr-donkey__call">
          <svg x={-80} y={-80} width={160} height={160} viewBox="0 0 160 160" overflow="hidden">
            <g className="thr-donkey__poses">
              <AtlasSprite
                src="donkey"
                sheetSize={sheetSize}
                rect={[448, 0, 3584, 448]}
                x={0}
                y={0}
                width={1280}
                height={160}
              />
            </g>
          </svg>
        </g>
      </g>
    </svg>
  );
}
export const rig: ThrowableRig = { Projectile, Payload };
