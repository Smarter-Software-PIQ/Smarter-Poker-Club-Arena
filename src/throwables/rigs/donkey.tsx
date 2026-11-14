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
const sheetSize = [1448, 724] as const;

function Grin({ size }: { size: number }) {
  return (
    <AtlasSprite
      src="donkey"
      sheetSize={sheetSize}
      rect={[0, 0, 724, 724]}
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
  // Divide the bray pose just below the incisors. The lower muzzle articulates
  // about that edge while the upper teeth, nostrils and eyes stay planted.
  return (
    <svg viewBox={RIG_VIEWBOX} aria-hidden="true" focusable="false">
      <g className="thr-donkey__head">
        <g className="thr-donkey__grin">
          <Grin size={160} />
        </g>
        <g className="thr-donkey__call" transform="scale(0.221)">
          <AtlasSprite
            src="donkey"
            sheetSize={sheetSize}
            rect={[724, 0, 724, 450]}
            x={-362}
            y={-362}
            width={724}
            height={450}
          />
          <g transform="translate(0 88)">
            <g className="thr-donkey__jaw">
              <AtlasSprite
                src="donkey"
                sheetSize={sheetSize}
                rect={[724, 450, 724, 274]}
                x={-362}
                y={0}
                width={724}
                height={274}
              />
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}
export const rig: ThrowableRig = { Projectile, Payload };
