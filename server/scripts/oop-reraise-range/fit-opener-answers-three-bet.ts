/**
 * FIT: how an opener answers an OUT-OF-POSITION 3-bet (HorseOopReraiseRangeHolds OPENER_ANSWERS_PRIOR).
 *
 * Input: a read-only pull of hand_history, one JSON object per line, cash PLO4 / PLO5 / NLH hands with two or more
 * preflop raises (the hands where an opener can face a 3-bet). The pull query, run read-only in two-hour windows:
 *
 *   select id, created_at, game_variant v, big_blind bb, button_seat btn, bomb_pot bp,
 *     (select jsonb_agg(jsonb_build_array(p->'seat', p->>'userId', p->'stack')) from jsonb_array_elements(players) p) pl,
 *     (select jsonb_agg(jsonb_build_array(a->'seat', a->>'stage', a->>'action', a->'amount', a->>'origin', null, a->'dead')
 *        order by o) from jsonb_array_elements(actions) with ordinality t(a, o)) ac
 *   from hand_history
 *   where created_at >= $from and created_at < $to and tournament_id is null
 *     and game_variant in ('plo4', 'plo5', 'nlh')
 *     and (select count(*) from jsonb_array_elements(actions) a
 *          where a->>'stage' = 'preflop' and a->>'action' in ('raise', 'all_in')) >= 2
 *
 * No hole cards are read. Each hand is run through the counter's own definition
 * (openerAnswersThreeBetHandIncrements: public actions, learnable admission, a full-raise all-in is a raise), and the
 * answer is kept when the 3-bettor acts before the opener after the flop (out of position) and is bucketed by the
 * effective stack of the two at the deal. Bomb pots are excluded. Nothing is keyed on who the opener is.
 *
 * Usage: npx tsx server/scripts/oop-reraise-range/fit-opener-answers-three-bet.ts <pull.ndjson> [window label]
 * Prints the table as JSON (paste into OPENER_ANSWERS_PRIOR with a new OPENER_ANSWERS_PRIOR_VERSION).
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import {
  openerAnswersThreeBetHandIncrements,
  oopReraiseDepthBucket,
  type OopReraiseDepthBucket,
} from '../../src/engine/HorseOopReraiseRangeHolds.js';

type Row = {
  v: string;
  bb: string | number;
  btn: number;
  bp?: unknown;
  pl: [number, string, number][];
  ac: [number, string, string, number | null, string | null, unknown, unknown][];
};

const order = (seat: number, btn: number): number => {
  const d = seat - btn;
  return d <= 0 ? d + 1024 : d;
};

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) throw new Error('usage: fit-opener-answers-three-bet.ts <pull.ndjson> [window]');
  const window = process.argv[3] ?? '';
  const games = ['plo4', 'plo5', 'nlh'] as const;
  const buckets: OopReraiseDepthBucket[] = ['le135', '135_250', '250_500', 'gt500'];
  const tally: Record<string, { fold: number; call: number; raise: number; n: number }> = {};
  for (const g of games)
    for (const b of buckets) tally[`${g}:${b}`] = { fold: 0, call: 0, raise: 0, n: 0 };
  let hands = 0;
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const h = JSON.parse(line) as Row;
    if (!games.includes(h.v as (typeof games)[number])) continue;
    if (h.bp !== null && h.bp !== undefined && h.bp !== false) continue;
    hands++;
    const ids = new Map(h.pl.map(([seat, id]) => [Number(seat), String(id)]));
    const stacks = new Map(h.pl.map(([seat, , st]) => [Number(seat), Number(st)]));
    let level = 0;
    const actions = [];
    for (const [seat, stage, action, amount, origin, , dead] of h.ac ?? []) {
      if (stage !== 'preflop') continue;
      const amt = Number(amount ?? 0);
      const full = action === 'all_in' ? amt > level + 0.005 : undefined;
      if (dead !== true && Number.isFinite(amt)) level = Math.max(level, amt);
      actions.push({
        userId: ids.get(Number(seat)),
        seat: Number(seat),
        stage,
        action,
        amount: amt,
        origin: origin ?? undefined,
        ...(full !== undefined ? { isFullRaise: full } : {}),
      });
    }
    const inc = openerAnswersThreeBetHandIncrements(actions as never);
    if (inc.size === 0) continue;
    // the opener and the 3-bettor (the first two aggressive actions)
    const aggr = actions.filter(
      (a) =>
        a.action === 'raise' ||
        a.action === 'bet' ||
        (a.action === 'all_in' && a.isFullRaise === true)
    );
    if (aggr.length < 2) continue;
    const s = aggr[0]!.seat;
    const t = aggr[1]!.seat;
    if (!(order(t, h.btn) < order(s, h.btn))) continue; // keep out-of-position 3-bets only
    const bb = Number(h.bb) > 0 ? Number(h.bb) : 1;
    const eff = Math.min(stacks.get(s) ?? 0, stacks.get(t) ?? 0) / bb;
    for (const cell of inc.values()) {
      const row = tally[`${h.v}:${oopReraiseDepthBucket(eff)}`]!;
      row.n += cell.opp;
      row.fold += cell.fold;
      row.call += cell.call;
      row.raise += cell.raise;
    }
  }
  const out: Record<
    string,
    Record<string, { fold: number; call: number; raise: number; n: number }>
  > = {};
  for (const g of games) {
    out[g] = {};
    const pool = buckets.reduce(
      (acc, k) => {
        const x = tally[`${g}:${k}`]!;
        return {
          fold: acc.fold + x.fold,
          call: acc.call + x.call,
          raise: acc.raise + x.raise,
          n: acc.n + x.n,
        };
      },
      { fold: 0, call: 0, raise: 0, n: 0 }
    );
    for (const b of buckets) {
      const r = tally[`${g}:${b}`]!;
      // a thin bucket (under 30 answers) takes the game's pooled answer (never a made-up number)
      const src = r.n >= 30 ? r : pool;
      const n = src.fold + src.call + src.raise;
      const q = (x: number) => Math.round((x / n) * 10000) / 10000;
      const fold = q(src.fold);
      const raise = q(src.raise);
      out[g][b] = { fold, call: Math.round((1 - fold - raise) * 10000) / 10000, raise, n: r.n };
    }
  }
  console.log(JSON.stringify({ window, hands, prior: out }, null, 2));
}

void main();
