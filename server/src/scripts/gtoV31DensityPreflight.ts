/**
 * R8 density pre-flight: where would a cash playbook be asked to decide on
 * its certification tables, and which cell list is dense enough to certify?
 *
 *   npx tsx src/scripts/gtoV31DensityPreflight.ts --pairs=2000 --max-cells=100 --out=/tmp/r8-density.json
 *
 * Plays every contract v3 cash table of the planned scope (default: heads-up
 * and six-max at the 80 bb bucket, which holds every 61-110 bb stack, plus
 * the human-calibrated six-max table) with no playbook loaded, records the
 * demand, and reports the densest single-raised-pot plan of at most
 * --max-cells cells: expected playbook decisions per run at the contract's
 * pairs against the 300 floor, and cells not reached in both kinds. Offline
 * only; never touches the database or the live store.
 *
 * --target (default 450) is the expected decisions per run the proposal aims
 * for before spending the rest of the budget on density.
 *
 * --eligible=<file> with --eligible-sha256=<hex> (both or neither) restricts
 * the proposal to the cells that file lists as eligible (gtoV31EligibleCellFilter);
 * scoring, demand and the ceiling are unchanged. Without it nothing changes.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  gtoV31EligibleCellFilter,
  proposeGtoV31CellPlan,
  recordGtoV31Demand,
  scoreGtoV31CellPlan,
} from '../benchmark/GtoV31DensityPreflight.js';
import { equityGovernor } from '../engine/EquityLoadGovernor.js';

function arg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((v) => v.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

async function main(): Promise<void> {
  if (equityGovernor.snapshot().enabled)
    throw new Error('run the pre-flight with EQUITY_GOVERNOR=off');
  const pairs = Number(arg('pairs', '2000'));
  const maxCells = Number(arg('max-cells', '100'));
  const target = Number(arg('target', '450'));
  const tables = arg('tables', 'cash_ev_2max_80bb,cash_ev_6max_80bb,human_cash_ev_6max_80bb').split(
    ','
  );
  const pots = new Set(arg('pots', 'srp').split(','));
  const out = arg('out', '');
  const eligiblePath = arg('eligible', '');
  const eligibleSha = arg('eligible-sha256', '');
  if (!eligiblePath !== !eligibleSha)
    throw new Error('--eligible and --eligible-sha256 go together');
  let eligible:
    | ((c: Parameters<ReturnType<typeof gtoV31EligibleCellFilter>>[0]) => boolean)
    | null = null;
  if (eligiblePath) {
    const bytes = readFileSync(eligiblePath);
    if (createHash('sha256').update(bytes).digest('hex') !== eligibleSha)
      throw new Error('--eligible file does not match --eligible-sha256');
    eligible = gtoV31EligibleCellFilter(JSON.parse(bytes.toString('utf8')));
  }
  const demand = await recordGtoV31Demand({
    family: 'cash',
    tables,
    pairsPerTable: pairs,
    runSeed: 0x5eed8,
  });
  const proposal = proposeGtoV31CellPlan(demand, {
    maxCells,
    targetDecisions: target,
    inScope: (c) => pots.has(c.potType) && (!eligible || eligible(c)),
  });
  const everything = scoreGtoV31CellPlan(
    demand,
    Object.keys(demand.cells).filter((k) => pots.has(demand.cells[k].potType))
  );
  const report = {
    caveat:
      'Demand recorded with no playbook loaded: the candidate arm plays heuristics, so later streets can differ from a real playbook. An estimate, not a certification.',
    scope: {
      tables,
      pots: [...pots],
      probePairsPerTable: pairs,
      maxCells,
      targetDecisionsPerRun: target,
      ...(eligiblePath ? { eligibleCells: { path: eligiblePath, sha256: eligibleSha } } : {}),
    },
    distinctCellsAsked: Object.keys(demand.cells).length,
    unkeyable: demand.unkeyable,
    proposal: {
      cells: proposal.keys.map((k) => ({ key: k, ...demand.cells[k] })),
      score: proposal.score,
    },
    ceilingIfEveryInScopeCellWereSolved: everything,
    demand,
  };
  if (out) writeFileSync(out, JSON.stringify(report, null, 1));
  const s = proposal.score;
  console.log(
    `[r8-density] ${proposal.keys.length} cells proposed; contract ${s.contractPairsPerTable} pairs/table; ` +
      `weakest run ${s.minRunDecisions.toFixed(0)} decisions (floor 300); ${s.runsUnderFloor} runs under floor; ` +
      `${s.unreached.length} cells unreached; passes=${s.passes}`
  );
  for (const r of s.runs) console.log(`[r8-density]   ${r.run}: ${r.expectedDecisions.toFixed(0)}`);
  console.log(
    `[r8-density] ceiling (all ${everything.cells} in-scope cells asked): weakest run ${everything.minRunDecisions.toFixed(0)}`
  );
}

const { channelHub } = await import('../hub/ChannelHub.js');
main()
  .catch((e) => {
    console.error('[r8-density] failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => channelHub.close());
