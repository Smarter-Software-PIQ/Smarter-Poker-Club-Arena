/**
 * SPARRING RUNNER (benchmark only; scripts/sparring.sh drives it). One process plays one matchup
 * cell of the sparring matrix against the Horse option set(s) of a tree, or prints the table.
 *
 * env:
 *   SPARRING_TREE   repo root whose engine plays the Horses (default: this checkout)
 *   SPARRING_BASE   switch-table JSON {option: "on"|"off"|...}: the baseline (live) set
 *   SPARRING_CAND   optional switch-table JSON merged over the baseline: the candidate set. A "decide" key holds
 *                   raw HorseDecideOpts for flags that are not switch options (e.g. {"decide":
 *                   {"omahaMathCore": true, "omahaMathCorePlo5Flop": true}}); they are applied to the CAND arm.
 *   SPARRING_CELL   "<adversary>:<variant>:<seats>:<stackBB>:<pairs>:<seed>"  (play one cell)
 *   SPARRING_PROFILE optional JSON of SparringProfile fields merged over aggro_reg
 *   SPARRING_OUT    file to append the cell result (JSON line)
 *   SPARRING_REPORT a results file to print as the matchup table (report mode)
 *   SPARRING_PERHAND=1 keep per-hand nets and public action lines (for pairing two trees with
 *                   scripts/sparring-compare.py)
 *   SPARRING_CONTROL 1 = add the OFF-vs-OFF control arm CTRL (the BASE option set again; law: 0 flips and 0.0
 *                   chips against BASE). Default: 1 when SPARRING_CAND is set, else 0.
 *   SPARRING_TARGET comma-separated adversaries that are the candidate's TARGET probes (report mode): they are
 *                   left out of the guard family of LEAD-3 RULING 1; every other adversary is a guard probe.
 * Adversaries: profile:<name> (SPARRING_PROFILES), probe:<name> (SPARRING_PROBES), probe:tell.
 * Prints aggregates only: no hole card is ever printed or written.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import {
  SPARRING_PROBES,
  guardFamilyZ,
  SPARRING_PROFILES,
  runSparringCell,
  sparringProfilePolicy,
  tellProbe,
  type SparringArm,
  type SparringCellResult,
  type SparringProfile,
  type SparringVariant,
} from './SparringLeague.js';
import type { HorseDecideOpts } from '../engine/HorseLogic.js';
import * as OS from '../engine/HorseOptionSwitch.js';

type SwitchStates = Record<string, string>;
type CandFile = Record<string, unknown> & { decide?: Record<string, unknown> };
const cfg = (options: SwitchStates) => ({
  version: 2,
  style: { version: 1, options: {} },
  options,
});

/** Switch-table states -> HorseDecideOpts through this tree's own parser (as the serving worker). */
export function decideOptsOf(states: SwitchStates): { opts: HorseDecideOpts; dropped: string[] } {
  const kept: SwitchStates = {};
  const dropped: string[] = [];
  const parse = OS.parseOptionSwitchConfig as (c: unknown) => { ok: boolean; states?: unknown };
  for (const [k, v] of Object.entries(states)) {
    if (parse(cfg({ [k]: v })).ok) kept[k] = v;
    else dropped.push(k);
  }
  const parsed = parse(cfg(kept));
  if (!parsed.ok) throw new Error('switch states invalid after filtering');
  const toOpts = OS.optionSwitchDecisionOpts as (s: unknown) => HorseDecideOpts;
  return { opts: toOpts(parsed.states), dropped };
}

function fmt(x: number | null | undefined, se?: number | null): string {
  if (x === null || x === undefined) return '-';
  return se === undefined || se === null ? x.toFixed(1) : `${x.toFixed(1)} ± ${se.toFixed(1)}`;
}

function verdict(d: number | null, se: number | null, adversaryWinsMeansWorse = true): string {
  if (d === null || se === null || !(se > 0)) return '-';
  const z = d / se;
  if (Math.abs(z) < 2) return 'NO CHANGE';
  // d is the change in the adversary's win rate: up = worse for the Horses.
  return z > 0 === adversaryWinsMeansWorse ? 'WORSE' : 'BETTER';
}

type Row = SparringCellResult & { adversary: string; dropped?: string[] };
const STREET_COLS = ['preflop', 'flop', 'turn', 'river'] as const;

/** FLIPS FIRST: per cell, the candidate's and the control's first divergences from BASE, with denominators. */
function flipsBlock(rows: Row[]): void {
  if (!rows.some((r) => r.arms.some((a) => a.flips))) return;
  console.log(
    'FLIPS FIRST. First divergence per hand from BASE on the same deal. Street columns: hands that parted at a ' +
      'Horse-seat decision on that street / Horse-seat decisions compared on that street (both arms on the same ' +
      'line up to there). CTRL = OFF-vs-OFF control (the BASE option set again): law = 0 parted, 0.0 chips. ' +
      'Hard flags read the Horse seats (h); s = the adversary script, b = the Horse brain in seat 0.'
  );
  const head =
    '| adversary | game | seats | bb | arm | hands parted / hands | preflop | flop | turn | river | seat 0 first | ' +
    'change classes | mirror deal parted | net differs (hands) | arm-BASE bb/100 | illegal h BASE/arm | ' +
    'fallback h BASE/arm | illegal s BASE/arm | illegal b BASE/arm | snapped |';
  console.log(head);
  console.log(head.replace(/[^|]/g, '-'));
  for (const r of rows) {
    const b = r.arms[0];
    for (const a of r.arms.slice(1)) {
      const f = a.flips?.main;
      if (!f) continue;
      const sum = (pre: string, o: Record<string, number>) =>
        Object.entries(o).reduce((t, [k, v]) => (k.startsWith(pre) ? t + v : t), 0);
      const st = STREET_COLS.map(
        (s) => `${sum(`horse|${s}|`, f.flips)} / ${f.compared[`horse|${s}`] ?? 0}`
      );
      const seat0 = `${sum('seat0|', f.flips)} / ${sum('seat0|', f.compared)}`;
      const cls =
        Object.entries(f.flips)
          .sort((x, y) => y[1] - x[1])
          .slice(0, 5)
          .map(([k, v]) => `${k.replace(/\|/g, ' ')} ${v}`)
          .join('; ') || 'none';
      const bs = b.bySeat;
      const as = a.bySeat;
      console.log(
        `| ${r.adversary} | ${r.variant} | ${r.seats} | ${r.stackBB} | ${a.label} | ${f.handsDiffering} / ${f.hands} | ${st.join(
          ' | '
        )} | ${seat0} | ${cls} | ${a.flips?.mirror ? `${a.flips.mirror.handsDiffering} / ${a.flips.mirror.hands}` : '-'} | ${
          f.netDiffHands
        } | ${fmt(a.vsArm0Bb100, a.vsArm0Se)} | ${bs.horse.illegal}/${as.horse.illegal} | ${bs.horse.brainFallback}/${
          as.horse.brainFallback
        } | ${bs.scripted.illegal}/${as.scripted.illegal} | ${bs.seat0Brain.illegal}/${as.seat0Brain.illegal} | ${
          b.scriptedSnapped
        }/${a.scriptedSnapped} |`
      );
    }
  }
  console.log('');
}

/** LEAD-3 RULING 1 guard thresholds for this table's probe and cell counts, and each probe's pooled z. */
function guardBlock(rows: Row[]): void {
  const cand = (r: Row) => r.arms.find((a) => a.label === 'CAND');
  const graded = rows.filter((r) => {
    const c = cand(r);
    return c && c.vsArm0Bb100 !== null && c.vsArm0Se !== null;
  });
  if (!graded.length) return;
  const targets = new Set(
    (process.env.SPARRING_TARGET ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
  );
  const by = new Map<string, Row[]>();
  for (const r of graded) by.set(r.adversary, [...(by.get(r.adversary) ?? []), r]);
  const guards = [...by.keys()].filter((k) => !targets.has(k));
  const P = guards.length;
  const C = Math.max(0, ...guards.map((k) => by.get(k)!.length));
  if (P < 1) return;
  const zP = guardFamilyZ(P);
  const zPC = guardFamilyZ(P * C);
  console.log(
    `GUARD THRESHOLDS (LEAD-3 RULING 1) for this table: guard probes P = ${P}, cells per probe C = ${C}` +
      `${[...by.values()].some((v) => v.length !== C) ? ' (largest; cell counts differ)' : ''}. ` +
      `GUARD-POOLED fails above z_fam(P) = ${zP.toFixed(2)}; GUARD-CELL fails above z_fam(P x C) = z_fam(${P * C}) = ${zPC.toFixed(
        2
      )}. Target probes (SPARRING_TARGET): ${targets.size ? [...targets].join(', ') : 'none declared, every adversary counted as a guard'}. A cell with no chip difference counts in P and C with z = 0; the pooled mean is over the cells with a difference.`
  );
  const head =
    '| adversary | role | cells | pooled CAND-BASE bb/100 | pooled z | vs z_fam(P) | largest cell z | vs z_fam(P x C) |';
  console.log(head);
  console.log(head.replace(/[^|]/g, '-'));
  for (const [k, rs] of by) {
    let w = 0;
    let wx = 0;
    let zmax = -Infinity;
    for (const r of rs) {
      const c = cand(r)!;
      const se = c.vsArm0Se as number;
      const x = c.vsArm0Bb100 as number;
      // A cell with no chip difference (0.0 +/- 0.0) is a look of the family (it counts in P and C)
      // with z = 0; it has no variance to weight by, so the pooled mean is over the other cells.
      if (!(se > 0)) {
        zmax = Math.max(zmax, 0);
        continue;
      }
      w += 1 / (se * se);
      wx += x / (se * se);
      zmax = Math.max(zmax, x / se);
    }
    const mean = w > 0 ? wx / w : 0;
    const se = w > 0 ? Math.sqrt(1 / w) : 0;
    const z = se > 0 ? mean / se : 0;
    const guard = !targets.has(k);
    console.log(
      `| ${k} | ${guard ? 'guard' : 'target'} | ${rs.length} | ${fmt(mean, se)} | ${z.toFixed(2)} | ${
        guard ? (z > zP ? 'ABOVE' : 'within') : '-'
      } | ${zmax.toFixed(2)} | ${guard ? (zmax > zPC ? 'ABOVE' : 'within') : '-'} |`
    );
  }
  console.log('');
}

function report(file: string): void {
  const rows = readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim().startsWith('{'))
    .map((l) => JSON.parse(l) as Row);
  flipsBlock(rows);
  guardBlock(rows);
  const two = rows.some((r) => r.arms.some((a) => a.label === 'CAND'));
  const head = two
    ? '| adversary | game | seats | bb | hands | adv vs BASE bb/100 | adv vs CAND bb/100 | CAND-BASE (paired) | verdict | probe edge BASE | probe edge CAND |'
    : '| adversary | game | seats | bb | hands | adversary bb/100 (Horses lose) | probe edge vs mirror | probe verdict | top chip source (bb/100) |';
  console.log(head);
  console.log(head.replace(/[^|]/g, '-'));
  for (const r of rows) {
    const b = r.arms[0];
    const c = r.arms.find((a) => a.label === 'CAND');
    if (two && c) {
      console.log(
        `| ${r.adversary} | ${r.variant} | ${r.seats} | ${r.stackBB} | ${r.pairs} | ${fmt(b.bb100, b.se)} | ${fmt(
          c.bb100,
          c.se
        )} | ${fmt(c.vsArm0Bb100, c.vsArm0Se)} | ${verdict(c.vsArm0Bb100, c.vsArm0Se)} | ${fmt(
          b.edgeBb100,
          b.edgeSe
        )} | ${fmt(c.edgeBb100, c.edgeSe)} |`
      );
    } else {
      const top = Object.entries(b.chipFlow)[0];
      const pv =
        b.edgeBb100 === null || b.edgeSe === null
          ? '-'
          : b.edgeBb100 > 2 * b.edgeSe
            ? 'PROFITS (exploit)'
            : b.edgeBb100 < -2 * b.edgeSe
              ? 'loses'
              : 'no edge';
      console.log(
        `| ${r.adversary} | ${r.variant} | ${r.seats} | ${r.stackBB} | ${r.pairs} | ${fmt(b.bb100, b.se)} | ${fmt(
          b.edgeBb100,
          b.edgeSe
        )} | ${pv} | ${top ? `${top[0]} ${top[1].toFixed(1)}` : '-'} |`
      );
    }
  }
}

async function main(): Promise<void> {
  if (process.env.SPARRING_REPORT) {
    report(process.env.SPARRING_REPORT);
    return;
  }
  const cell = process.env.SPARRING_CELL;
  if (!cell) throw new Error('SPARRING_CELL or SPARRING_REPORT required');
  const parts = cell.split(':');
  if (parts.length !== 7)
    throw new Error('SPARRING_CELL must be kind:name:variant:seats:stackBB:pairs:seed');
  const adversary = `${parts[0]}:${parts[1]}`;
  const [variant, seatsS, stackS, pairsS, seedS] = parts.slice(2);
  const read = (f?: string): SwitchStates =>
    f ? (JSON.parse(readFileSync(f, 'utf8')) as SwitchStates) : {};
  const { decide: baseDecide, ...baseSw } = read(process.env.SPARRING_BASE) as unknown as CandFile;
  const baseStates = baseSw as SwitchStates;
  const base = decideOptsOf(baseStates);
  const arms: SparringArm[] = [
    { label: 'BASE', horseOpts: { ...base.opts, ...((baseDecide ?? {}) as HorseDecideOpts) } },
  ];
  let dropped = base.dropped;
  if (process.env.SPARRING_CAND) {
    const raw = JSON.parse(readFileSync(process.env.SPARRING_CAND, 'utf8')) as CandFile;
    const { decide, ...sw } = raw;
    const candStates = sw as SwitchStates;
    const cand = decideOptsOf({ ...baseStates, ...candStates });
    for (const k of Object.keys(candStates))
      if (cand.dropped.includes(k))
        throw new Error(
          `candidate option ${k} is not registered in this tree: the CAND arm would not be on`
        );
    arms.push({
      label: 'CAND',
      horseOpts: { ...cand.opts, ...((decide ?? {}) as HorseDecideOpts) },
    });
    dropped = [...new Set([...dropped, ...cand.dropped])];
  }
  // The OFF-vs-OFF control: the BASE option set again, as its own arm with its own sandboxes.
  if ((process.env.SPARRING_CONTROL ?? (process.env.SPARRING_CAND ? '1' : '0')) === '1')
    arms.push({ label: 'CTRL', horseOpts: { ...arms[0].horseOpts } });
  const [kind, name] = adversary.split(':') as [string, string];
  const common = {
    variant: variant as SparringVariant,
    seats: Number(seatsS),
    stackBB: Number(stackS),
    pairs: Number(pairsS),
    seed: Number(seedS),
    arms,
    bbAnte: variant === 'plo5' ? 1 : 0,
    keepPerHand: process.env.SPARRING_PERHAND === '1',
    // THE LIFETIME OPPONENT HUD (SparringHud.ts): data in, data out; nothing is warmed in this process.
    ...(process.env.SPARRING_HUD === '1'
      ? {
          hud: {
            priors: process.env.SPARRING_HUD_PRIORS
              ? ((
                  JSON.parse(readFileSync(process.env.SPARRING_HUD_PRIORS, 'utf8')) as Record<
                    string,
                    Record<string, [number, number]>
                  >
                )[variant] ?? {})
              : {},
            preload: process.env.SPARRING_HUD_PRELOAD
              ? (JSON.parse(readFileSync(process.env.SPARRING_HUD_PRELOAD, 'utf8')) as unknown[])
              : [],
            exportProfiles: Boolean(process.env.SPARRING_HUD_EXPORT),
          },
        }
      : {}),
  };
  let result: SparringCellResult;
  if (kind === 'profile') {
    const prof: SparringProfile = {
      ...(SPARRING_PROFILES[name] ?? SPARRING_PROFILES.aggro_reg),
      ...(process.env.SPARRING_PROFILE
        ? (JSON.parse(
            readFileSync(process.env.SPARRING_PROFILE, 'utf8')
          ) as Partial<SparringProfile>)
        : {}),
    };
    result = await runSparringCell({
      name: adversary,
      policy: sparringProfilePolicy(prof),
      ...common,
      mirror: process.env.SPARRING_MIRROR === '1',
    });
  } else if (kind === 'probe' && name === 'tell') {
    // Calibrate the Horses' value share by line and size on its own seed range, then probe.
    const calib = await runSparringCell({
      name: 'tell-calibration',
      policy: (_s, horse) => horse(),
      ...common,
      arms: [arms[0]],
      pairs: Math.max(2000, Math.round(common.pairs / 2)),
      seed: (common.seed ^ 0x5eed) >>> 0,
      collectTells: true,
    });
    const table = calib.arms[0].tells ?? {};
    result = await runSparringCell({
      name: adversary,
      policy: tellProbe(table),
      ...common,
      mirror: true,
    });
    (result as SparringCellResult & { tellTable?: unknown }).tellTable = Object.fromEntries(
      Object.entries(table)
        .filter(([, v]) => v.wagers >= 40)
        .map(([k, v]) => [k, { wagers: v.wagers, valueShare: +(v.value / v.wagers).toFixed(3) }])
    );
  } else if (kind === 'probe') {
    const pol = (
      SPARRING_PROBES as Record<string, (typeof SPARRING_PROBES)[keyof typeof SPARRING_PROBES]>
    )[name];
    if (!pol) throw new Error(`unknown probe ${name}`);
    result = await runSparringCell({ name: adversary, policy: pol, ...common, mirror: true });
  } else throw new Error(`unknown adversary ${adversary}`);
  if (process.env.SPARRING_HUD_EXPORT && result.hud) {
    // the stores go to their own 0600 file (public counts only); the result line keeps the counts
    writeFileSync(process.env.SPARRING_HUD_EXPORT, JSON.stringify(result.hud), { mode: 0o600 });
    for (const h of result.hud) {
      delete h.main.profiles;
      if (h.mirror) delete h.mirror.profiles;
    }
  }
  const line = JSON.stringify({ adversary, dropped, ...result });
  if (process.env.SPARRING_OUT)
    appendFileSync(process.env.SPARRING_OUT, line + '\n', { mode: 0o600 });
  else console.log(line);
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  }
);
