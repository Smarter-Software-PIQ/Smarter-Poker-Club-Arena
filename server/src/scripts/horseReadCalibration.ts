/**
 * Walk-forward read calibration over an exported accepted-hand JSONL.gz
 * (public.hand_history rows, chronological). Usage:
 *   node --import tsx src/scripts/horseReadCalibration.ts HANDS.jsonl.gz TARGETS.json OUT.jsonl.gz
 * TARGETS.json: {"targets": ["<user id>", ...]}. Measurement only.
 */
import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import { createGunzip, createGzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { HorseMind } from '../engine/HorseMind.js';
import {
  walkForwardReadCalibration,
  type CalibrationHand,
} from '../benchmark/HorseReadCalibration.js';

async function main(): Promise<void> {
  const [handsPath, targetsPath, outPath] = process.argv.slice(2);
  if (!handsPath || !targetsPath || !outPath) throw new Error('usage: HANDS TARGETS OUT');
  const targets = new Set<string>(JSON.parse(readFileSync(targetsPath, 'utf8')).targets);
  const hands: CalibrationHand[] = [];
  const rl = createInterface({ input: createReadStream(handsPath).pipe(createGunzip()) });
  for await (const line of rl) if (line.trim()) hands.push(JSON.parse(line));
  const out = createGzip();
  out.pipe(createWriteStream(outPath));
  let events = 0;
  const result = HorseMind.runInSandbox(HorseMind.createSandbox(), () =>
    walkForwardReadCalibration(
      hands,
      (id) => targets.has(id),
      (e) => {
        events++;
        out.write(JSON.stringify(e) + '\n');
      }
    )
  );
  out.end();
  process.stdout.write(JSON.stringify({ ...result, events }) + '\n');
}
main().catch((e) => {
  process.stderr.write(String(e?.stack ?? e) + '\n');
  process.exit(1);
});
