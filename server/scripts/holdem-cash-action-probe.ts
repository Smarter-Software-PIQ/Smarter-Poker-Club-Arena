/**
 * HOLD'EM CASH ACTION PROBE, command line (see
 * src/benchmark/HoldemCashActionProbe.ts).
 *
 *     cd server && npx tsx scripts/holdem-cash-action-probe.ts
 *     SEATS=9,6 HANDS=20000 DEPTH=100 SEED=7 npx tsx scripts/holdem-cash-action-probe.ts
 *     OFF=1 ...   # the same deals with v85CashAction off (the prior ranges)
 *
 * No database and no solver store are read.
 */
import { measureTable } from '../src/benchmark/HoldemCashActionProbe.js';

const seatList = (process.env.SEATS ?? '9,8,7,6,5,4,3,2').split(',').map(Number);
const hands = Number(process.env.HANDS ?? 6000);
const depth = Number(process.env.DEPTH ?? 100);
const seed = Number(process.env.SEED ?? 20261110);
const opts = process.env.OFF === '1' ? { v85CashAction: false } : {};
for (const n of seatList) {
  const t = measureTable(n, hands, depth, seed, opts);
  console.log(
    `${n}-handed  VPIP ${t.vpip}  PFR ${t.pfr}  3bet ${t.threeBet}  squeeze ${t.squeeze}  RFI ${t.rfi}  open ${t.openAvgBB}bb [${t.openMinBB}-${t.openMaxBB}]` +
      `  field vs open f/c/r ${t.vsOpen.field.fold}/${t.vsOpen.field.call}/${t.vsOpen.field.raise}` +
      `  sb ${t.vsOpen.sb.fold}/${t.vsOpen.sb.call}/${t.vsOpen.sb.raise}` +
      `  bb ${t.vsOpen.bb.fold}/${t.vsOpen.bb.call}/${t.vsOpen.bb.raise}` +
      `  bb fold vs open+caller ${t.bbVsOpenCallerFold}`
  );
}
process.exit(0);
