// Run from server/: node --import tsx scripts/horse-play-style-for.ts < ids.txt > styles.tsv
//
// horsePlayStyles per-style tracking (2026-11-16): the playing style of each
// Horse id read from stdin, for offline joins (results per style). One id per
// line; an optional second column (tab or comma) is the authored
// persona.playStyle, which wins when it is one of the three names, exactly as
// the brain reads it. Prints `id<TAB>style` per line, in input order. Blank
// lines and lines starting with # are skipped.
//
// Pure: horsePlayStyleFor only. No database, no network, no environment read.
// NEVER refer to the horses as "bots" - they are HORSES only.
import { createInterface } from 'node:readline';
import { horsePlayStyleFor } from '../src/engine/HorsePlayStyle.js';

export function horsePlayStyleLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const [id, authored] = trimmed.split(/[\t,]/).map((x) => x.trim());
  if (!id) return null;
  return `${id}\t${horsePlayStyleFor(id, authored || undefined)}`;
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const out = horsePlayStyleLine(line);
  if (out !== null) process.stdout.write(`${out}\n`);
});
