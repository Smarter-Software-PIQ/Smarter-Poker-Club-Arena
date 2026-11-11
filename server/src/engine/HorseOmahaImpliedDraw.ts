import type { OmahaDrawInfo } from './HorseEval.js';
/** Physical draw eligibility for implied credit. NLH retains its existing
 * pricing; Omaha must actually draw using its exact-two-hole evaluator,
 * tightened in PLO5/PLO6 so bare dominated sucker gutshots and bare PLO6
 * non-nut flushes without straight backup do not manufacture implied equity. */
export function hasPhysicalImpliedDraw(
  isOmaha: boolean,
  draw: OmahaDrawInfo | null,
  holeCount = 4
): boolean {
  if (!isOmaha) return true;
  if (!draw) return false;
  if (holeCount <= 4) {
    return draw.nutty || draw.dominatedFlushDraw || draw.straightOuts > 0;
  }
  if (holeCount === 5) {
    return (
      draw.nutty ||
      draw.bigWrap ||
      (draw.dominatedFlushDraw && draw.straightOuts >= 4) ||
      draw.nutStraightOuts >= 4 ||
      draw.straightOuts >= 8
    );
  }
  // PLO6 (`holeCount >= 6`): bare dominated flush draws and bare 4-out non-nut
  // gutshots frequently lose stacks when completed; require nut draw, big wrap,
  // combo draw, or >= 6 nut straight outs.
  return (
    draw.nutty ||
    draw.bigWrap ||
    (draw.dominatedFlushDraw && draw.straightOuts >= 4) ||
    draw.nutStraightOuts >= 6 ||
    draw.straightOuts >= 10
  );
}
