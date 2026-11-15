import { PerformancePose } from '../PerformancePose';
import { preloadThrowableCues } from '../cues';
import { AtlasSprite } from '../AtlasSprite';
import { RIG_VIEWBOX, type RigProps, type ThrowableRig } from '../rig';
import type { ThrowableSpec } from '../spec';
import './bear.css';
export const spec: ThrowableSpec = {
  id: 'bear',
  name: 'Bear',
  tier: 'vip',
  category: 'characters',
  spawn: 'avatar-face',
  spawnMs: 167,
  flight: { ms: 400, mode: 'straight', upright: true },
  arrival: 'blink-pop',
  payload: { sizeU: 1.5, anchor: 'face', coversAvatar: true, ms: 4100 },
  beats: [
    { at: 400, marker: 'arrival' },
    { at: 667, marker: 'pop' },
    { at: 700, marker: 'warning-growl' },
    { at: 2033, marker: 'anger' },
    { at: 2500, marker: 'roar' },
    { at: 3500, marker: 'tremble' },
    { at: 4500, marker: 'cut' },
  ],
  audio: [
    { at: 400, sample: 'thump_soft', gain: 0.3 },
    { at: 700, sample: 'grizzly_warning', gain: 0.82 },
    { at: 2500, sample: 'grizzly_growl', gain: 0.94 },
  ],
};
preloadThrowableCues(spec.audio.map((c) => c.sample));
function Projectile(_props: RigProps) {
  return (
    <svg viewBox={RIG_VIEWBOX} aria-hidden="true" focusable="false">
      <AtlasSprite src="bear" rect={[20, 8, 610, 610]} x={-30} y={-30} width={60} height={60} />
    </svg>
  );
}
function Payload(_props: RigProps) {
  return (
    <svg viewBox={RIG_VIEWBOX} aria-hidden="true" focusable="false">
      <g className="thr-bear__pop">
        <g className="thr-bear__laugh-window">
          <g className="thr-bear__closed">
            <AtlasSprite
              src="bear"
              rect={[20, 8, 610, 610]}
              x={-75}
              y={-75}
              width={150}
              height={150}
            />
          </g>
          <g className="thr-bear__open">
            <PerformancePose
              src="bear-acting"
              row={0}
              rows={3}
              x={-75.0}
              y={-75.0}
              width={150.0}
              height={150.0}
              duration={460}
              delay={300}
              repeats={3}
            />
          </g>
        </g>
        <g className="thr-bear__anger">
          <PerformancePose
            src="bear-acting"
            row={1}
            rows={3}
            x={-73.317}
            y={-75.0}
            width={146.635}
            height={150.0}
            duration={450}
            delay={1610}
            repeats={1}
          />
        </g>
        <g className="thr-bear__roar">
          <PerformancePose
            src="bear-acting"
            row={2}
            rows={3}
            x={-73.317}
            y={-75.0}
            width={146.635}
            height={150.0}
            duration={825}
            delay={2080}
            repeats={2}
          />
          <g className="thr-bear__flush">
            <AtlasSprite
              src="bear"
              rect={[638, 624, 610, 624]}
              x={-75}
              y={-75}
              width={150}
              height={150}
            />
          </g>
        </g>
        <g className="thr-bear__vein">
          <AtlasSprite
            src="impact-details"
            rect={[627, 627, 627, 627]}
            x={24}
            y={-48}
            width={23}
            height={23}
          />
        </g>
        <g className="thr-bear__stars">
          <AtlasSprite src="star" rect={[60, 65, 505, 515]} x={8} y={-27} width={12} height={12} />
          <AtlasSprite src="star" rect={[60, 65, 505, 515]} x={36} y={-19} width={11} height={11} />
        </g>
      </g>
    </svg>
  );
}
export const rig: ThrowableRig = { Projectile, Payload };
