/**
 * Cross-build Horse decision replay: the half that loads ONE build's engine and runs it.
 *
 * Every engine module is imported at run time from the build's own `server/src`, so the same tool file drives any
 * commit. It needs a TypeScript loader: run it with `node --import tsx` from `<build>/server` (the command line in
 * horse-decision-crossbuild-replay.mjs does that in a child process per build), or inside the server vitest.
 * Nothing here reads a database: the caller points SUPABASE_URL at supabase.invalid.
 *
 * A build may be older than this tool. Anything optional it lacks (a seeding function, the scope helper, the
 * memory observer) is skipped there and listed in the replay header as `missingParts`, so the comparison can say so.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance as nodePerformance } from 'node:perf_hooks';
import {
  AUGMENT_VERSION,
  BASE_STYLES,
  DEFAULT_MEMORY_HANDS,
  DEFAULT_SEEDS,
  FIXED_NOW_MS,
  GROUP_PLANS,
  applyVariants,
  augmentState,
  handPlan,
  keepsCapturedDecision,
  syntheticMemoryHands,
} from './horse-decision-crossbuild-replay-lib.mjs';

/** `<worktree>` or `<worktree>/server` -> the absolute server directory of a build. */
export function serverRootOf(build) {
  const root = resolve(build);
  if (existsSync(join(root, 'src', 'engine', 'HorseLogic.ts'))) return root;
  if (existsSync(join(root, 'server', 'src', 'engine', 'HorseLogic.ts')))
    return join(root, 'server');
  throw new Error(`${build} is not a Club Arena checkout (no server/src/engine/HorseLogic.ts)`);
}

async function optional(path, missing, label) {
  if (!existsSync(path)) {
    missing.push(label);
    return null;
  }
  try {
    return await import(path);
  } catch (e) {
    missing.push(`${label} (import failed: ${String(e?.message ?? e).slice(0, 120)})`);
    return null;
  }
}

/** Loads the engine parts a replay needs from one build. Required: HorseLogic, HorseMind. The rest is optional. */
export async function loadBuild(build) {
  const server = serverRootOf(build);
  const eng = (f) => join(server, 'src', 'engine', f);
  const missing = [];
  const { HorseLogic } = await import(eng('HorseLogic.ts'));
  const mindModule = await import(eng('HorseMind.ts'));
  const evalModule = await optional(eng('HorseEval.ts'), missing, 'HorseEval');
  const sizeModule = await optional(eng('horsePublicBetSize.ts'), missing, 'horsePublicBetSize');
  const timeModule = await optional(
    eng('horsePublicActionTime.ts'),
    missing,
    'horsePublicActionTime'
  );
  const telemetry = await optional(eng('BrainTelemetry.ts'), missing, 'BrainTelemetry');
  const optionSwitch = await optional(eng('HorseOptionSwitch.ts'), missing, 'HorseOptionSwitch');
  const styleSwitch = await optional(eng('HorseStyleSwitch.ts'), missing, 'HorseStyleSwitch');
  const need = (mod, name, label) => {
    const fn = mod?.[name];
    if (typeof fn !== 'function' && mod) missing.push(label ?? name);
    return typeof fn === 'function' ? fn : null;
  };
  return {
    server,
    missing,
    HorseLogic,
    HorseMind: mindModule.HorseMind,
    readScopeOf: need(mindModule, 'readScopeOf'),
    seedFastRandom: need(evalModule, 'seedFastRandom'),
    seedHorseBetSizeRandom: need(sizeModule, 'seedHorseBetSizeRandom'),
    seedHorseTimingRandom: need(timeModule, 'seedHorseTimingRandom'),
    enableBrainTelemetry: need(telemetry, 'enableBrainTelemetry'),
    drainFires: need(telemetry, 'drainFires'),
    optionSwitch,
    styleSwitch,
  };
}

/**
 * The decide options a build gives a set of switch rows, mapped by THAT build's own switch code, the way the worker
 * does it: plain options through parseOptionSwitchConfig + optionSwitchDecisionOpts, style options through
 * styleSwitchDecisionOpts + styleSwitchBrainOpts. A row the build does not know is dropped by the build and listed
 * in `unknown`; a row the build refuses is dropped here and listed in `refused`. Raw variants are laid over the
 * result. `unmet` lists row variants the build did not turn into the asked value (unknown there, off-only, refused).
 */
export function decisionOptionsFor(B, rows, { raw = {}, expect = {} } = {}) {
  const OS = B.optionSwitch;
  const SS = B.styleSwitch;
  if (!OS || !SS)
    throw new Error(
      'this build has no HorseOptionSwitch / HorseStyleSwitch: its switch rows cannot be mapped'
    );
  const styleNames = [...SS.STYLE_SWITCH_OPTIONS];
  const styleStates = {};
  for (const o of styleNames) styleStates[o] = rows[o] ?? 'off';
  const plain = {};
  for (const [k, v] of Object.entries(rows)) if (!styleNames.includes(k)) plain[k] = v;
  const ss = SS.styleSwitchStatesFrom(styleStates);
  if (!ss) throw new Error('the style switch rows are invalid on this build');
  const unknown =
    typeof OS.optionSwitchUnknownNames === 'function'
      ? [...OS.optionSwitchUnknownNames(plain)]
      : null;
  const config = (options) => ({
    version: 2,
    style: { version: 1, options: styleStates },
    options,
  });
  let parsed = OS.parseOptionSwitchConfig(config(plain));
  // An older build can refuse the whole set because of ONE row it cannot hold (a state the option did not take
  // yet, an option it lists as off-only). Production on that build would then switch nothing at all; here the rows
  // it refuses are dropped ONE BY ONE and named, so every other switch is still the same on both builds.
  const refused = [];
  if (!parsed.ok) {
    const kept = {};
    for (const [name, state] of Object.entries(plain)) {
      if (OS.parseOptionSwitchConfig(config({ [name]: state })).ok) kept[name] = state;
      else refused.push(`${name}=${state}`);
    }
    parsed = OS.parseOptionSwitchConfig(config(kept));
    if (!parsed.ok)
      throw new Error(
        'the option switch rows are INVALID on this build (parseOptionSwitchConfig refused them even row by row)'
      );
  }
  const styleOpts = SS.styleSwitchBrainOpts(SS.styleSwitchDecisionOpts(ss, 'harness-horse', true));
  const optionOpts = OS.optionSwitchDecisionOpts(parsed.states);
  const opts = { ...styleOpts, ...optionOpts, ...raw };
  const unmet = [];
  for (const [name, state] of Object.entries(expect)) {
    const want =
      state === 'on' || state === 'on_shadow' ? true : state === 'off' ? false : undefined;
    if (want === undefined) continue;
    const got = opts[name];
    // a style option that is off is simply absent
    if (want === true ? got !== true : got === true)
      unmet.push(`${name}=${state} (this build gives ${JSON.stringify(got)})`);
  }
  return { opts, unknown, refused, unmet, mappedRows: Object.keys(parsed.states ?? {}).length };
}

function freezeClocks() {
  const realDateNow = Date.now;
  const realPerfNow = globalThis.performance.now;
  const realNodePerfNow = nodePerformance.now;
  Date.now = () => FIXED_NOW_MS;
  try {
    globalThis.performance.now = () => 0;
    nodePerformance.now = () => 0;
  } catch {
    /* a frozen performance object: the builds still share whatever clock it gives */
  }
  return () => {
    Date.now = realDateNow;
    try {
      globalThis.performance.now = realPerfNow;
      nodePerformance.now = realNodePerfNow;
    } catch {
      /* nothing was replaced */
    }
  };
}

function seedMemory(B, st, hands, status) {
  const M = B.HorseMind;
  if (typeof M?.observe !== 'function') {
    status.unavailable++;
    return 'unavailable';
  }
  const gs = st.gs;
  const bb = gs.bigBlind;
  let scope = null;
  let previous;
  try {
    scope = B.readScopeOf
      ? B.readScopeOf(gs.gameVariant, (gs.dealtSeatIds ?? gs.players ?? []).length)
      : null;
    previous = typeof M.currentScope === 'function' ? M.currentScope() : undefined;
    if (scope && typeof M.setDecisionScope === 'function') M.setDecisionScope(scope);
    for (const hand of syntheticMemoryHands(st, { hands })) {
      M.observe(hand.history, [], undefined, undefined, bb);
      if (typeof M.observeHandComplete === 'function')
        M.observeHandComplete(hand.key, hand.history, bb, hand.showdown, scope);
    }
    status.seeded++;
    return 'seeded';
  } catch (e) {
    status.error++;
    status.firstError ??= String(e?.message ?? e).slice(0, 200);
    return 'error';
  } finally {
    try {
      if (scope && typeof M.setDecisionScope === 'function' && previous !== undefined)
        M.setDecisionScope(previous);
    } catch {
      /* the scope is reset by the next decision */
    }
  }
}

/**
 * Replays states through one build's HorseLogic.decide. `states` is an array of { line, idx } (the state's JSON text
 * and its index in its file, which the input variations key on). Returns { rows, memoryStatus, errors }.
 * Before every decision: HorseMind.reset(), the three random streams seeded from the seed, the clocks frozen.
 */
export function replayStates(
  B,
  states,
  opts,
  { seeds = DEFAULT_SEEDS, memory = 'some', memoryHands = DEFAULT_MEMORY_HANDS, onRow = null } = {}
) {
  const restore = freezeClocks();
  const memoryStatus = { seeded: 0, error: 0, unavailable: 0, firstError: null };
  const rows = [];
  let errors = 0;
  try {
    if (B.enableBrainTelemetry) B.enableBrainTelemetry();
    for (const { line, idx } of states) {
      for (const seed of seeds) {
        const st = JSON.parse(line);
        const tags = augmentState(st, st.i0 ?? idx, { memory });
        B.HorseMind.reset();
        const mem = tags.includes('opponent_memory')
          ? seedMemory(B, st, memoryHands, memoryStatus)
          : null;
        if (B.seedFastRandom) B.seedFastRandom(seed);
        if (B.seedHorseBetSizeRandom) B.seedHorseBetSizeRandom(seed ^ 0x5bd1e995);
        if (B.seedHorseTimingRandom) B.seedHorseTimingRandom(seed ^ 0x9e3779b9);
        if (B.drainFires) B.drainFires();
        let row;
        try {
          const d = B.HorseLogic.decide(st.player, st.gs, st.style, st.mods, {
            ...(st.opts ?? {}),
            ...opts,
            telemetry: true,
            observeMind: false,
            decisionTimeMs: FIXED_NOW_MS,
          });
          const fires = B.drainFires
            ? B.drainFires()
                .map((f) => `${f.feature}:${f.fires}`)
                .sort()
            : [];
          row = {
            k: st.k,
            i: idx,
            seed,
            group: st.group,
            sub: st.sub ?? null,
            tags,
            mem,
            variant: st.gs.gameVariant,
            mode: st.gs.gameMode,
            stage: st.gs.stage,
            nPlayers: (st.gs.dealtSeatIds ?? st.gs.players ?? []).length,
            toCall: st.gs.toCall,
            action: d.action,
            amount: d.amount ?? null,
            j: JSON.stringify(d),
            fires,
          };
        } catch (e) {
          errors++;
          row = {
            k: st.k,
            i: idx,
            seed,
            group: st.group,
            tags,
            mem,
            error: String(e?.stack ?? e).slice(0, 600),
          };
        }
        if (onRow) onRow(row);
        else rows.push(row);
      }
    }
  } finally {
    restore();
    try {
      B.HorseMind.reset();
    } catch {
      /* nothing to reset */
    }
  }
  return { rows, memoryStatus, errors };
}

/** Reads a states file into the { line, idx } list replayStates takes, optionally one shard of it. */
export function readStatesFile(file, shard = 0, shards = 1) {
  const out = [];
  const lines = readFileSync(file, 'utf8').split('\n');
  let idx = 0;
  for (const line of lines) {
    if (!line) continue;
    if (idx % shards === shard) out.push({ line, idx });
    idx++;
  }
  return out;
}

/**
 * Generates one group's decision states by playing full hands with the build's own league engine
 * (benchmark/HorseLeague.ts playHand, which builds the decision state the way production does) and recording every
 * HorseLogic.decide input. Deterministic for a (build, options, group, target). Returns the states and counts.
 */
export async function captureGroup(
  B,
  group,
  target,
  opts,
  { onState = null, maxHands = 40000 } = {}
) {
  const plan = GROUP_PLANS[group];
  if (!plan) throw new Error(`unknown group "${group}"`);
  const league = await import(join(B.server, 'src', 'benchmark', 'HorseLeague.ts'));
  const hybridModule = await import(join(B.server, 'src', 'engine', 'HorseHybridProfile.ts'));
  const hy = hybridModule.HORSE_HYBRID_PROFILES[plan.mode];
  let buildTournamentMState = null;
  if (plan.mode === 'tournament')
    ({ buildTournamentMState } = await import(
      join(B.server, 'src', 'engine', 'HorseTournamentPreflop.ts')
    ));
  const mtt = (seats, stackBB, kind) => {
    const ctx = league.finalTableMttWithStacksContext(seats, stackBB);
    if (kind === 'final') return ctx;
    if (kind === 'hu')
      return {
        ...ctx,
        format: 'hu_sng',
        tournament: { ...ctx.tournament, spotsPaid: 1, payoutPct: [100] },
      };
    const t = {
      ...ctx.tournament,
      playersLeft: 180,
      spotsPaid: 30,
      inMoney: false,
      nearBubble: false,
      payoutPct: [30, 20, 14, 10, 8, 6, 4, 3, 3, 2],
    };
    t.m = buildTournamentMState({
      stackChips: stackBB * 2,
      smallBlind: 1,
      bigBlind: 2,
      ante: 2,
      anteType: 'big_blind',
      playersAtTable: seats,
      nextSmallBlind: 2,
      nextBigBlind: 4,
      nextAnte: 4,
      minutesToNextLevel: 10,
      opponentStacks: Array.from({ length: seats - 1 }, (_, i) => ({
        userId: 'league-seat-' + (i + 1),
        stackChips: stackBB * 2,
      })),
      previousZone: null,
    });
    return { ...ctx, tournament: t };
  };
  const states = [];
  const kept = {};
  let total = 0;
  let depth = 0;
  let cur = null;
  let handErrors = 0;
  let firstHandError = null;
  const HL = B.HorseLogic;
  const original = HL.decide;
  HL.decide = function (player, gs, style, mods, o, ...rest) {
    if (depth === 0 && cur && total < target) {
      cur.n++;
      if (keepsCapturedDecision(gs.stage, cur.seed, cur.n, cur.seats)) {
        const state = {
          k: `${group}:${cur.seed}:${cur.n}`,
          group,
          sub: cur.sub,
          seed: cur.seed,
          ...JSON.parse(JSON.stringify({ player, gs, style, mods })),
        };
        if (onState) onState(state);
        else states.push(state);
        kept[gs.stage] = (kept[gs.stage] ?? 0) + 1;
        total++;
      }
    }
    depth++;
    try {
      return original.call(HL, player, gs, style, mods, o, ...rest);
    } finally {
      depth--;
    }
  };
  const counters = { illegal: 0, truncated: 0 };
  let h = 0;
  const restore = freezeClocks();
  try {
    while (total < target && h < maxHands) {
      const hp = handPlan(group, h);
      const ctx = hp.mode === 'cash' ? undefined : mtt(hp.seats, hp.stackBB, hp.kind);
      cur = { seed: hp.seed, seats: hp.seats, n: 0, sub: hp.sub };
      try {
        B.HorseMind.reset();
        league.playHand(
          hp.seed,
          hp.dealerSeat,
          () => ({ ...opts }),
          counters,
          undefined,
          hp.variant,
          hp.seats,
          hp.stackBB,
          ctx,
          () => (hp.hybrid ? { ...hy.mods } : {}),
          undefined,
          (s) => (hp.hybrid ? hy.style : BASE_STYLES[(s + h) % BASE_STYLES.length])
        );
      } catch (e) {
        handErrors++;
        firstHandError ??= String(e?.message ?? e).slice(0, 300);
      }
      cur = null;
      h++;
    }
  } finally {
    HL.decide = original;
    restore();
  }
  return { group, target, states, total, hands: h, kept, handErrors, firstHandError, counters };
}

// ---------------------------------------------------------------------------------------------------------------
// Child-process entry points (one build per process): `node --import tsx <this file> <job.json>`
// ---------------------------------------------------------------------------------------------------------------

async function runJob(job) {
  const B = await loadBuild(job.build);
  const variants = applyVariants(job.rows, job.variants ?? []);
  const mapped = decisionOptionsFor(B, variants.rows, variants);
  if (mapped.unmet.length && !job.allowUnmet)
    throw new Error(
      `this build does not apply the asked variant: ${mapped.unmet.join('; ')}. Use "+raw:<option>=true" to set a decide option past the switch registry.`
    );
  if (job.kind === 'options')
    return {
      missingParts: B.missing,
      received: mapped.opts,
      unknown: mapped.unknown,
      refused: mapped.refused,
      unmet: mapped.unmet,
      mappedRows: mapped.mappedRows,
    };
  if (job.kind === 'capture') {
    writeFileSync(job.out, '');
    let buf = '';
    let n = 0;
    const res = await captureGroup(B, job.group, job.target, mapped.opts, {
      onState: (s) => {
        buf += JSON.stringify(s) + '\n';
        if (++n % 100 === 0) {
          appendFileSync(job.out, buf);
          buf = '';
        }
      },
    });
    appendFileSync(job.out, buf);
    const { states: _states, ...summary } = res;
    return {
      ...summary,
      missingParts: B.missing,
      received: mapped.opts,
      unknown: mapped.unknown,
      refused: mapped.refused,
    };
  }
  if (job.kind === 'replay') {
    writeFileSync(job.out, '');
    let buf = '';
    let n = 0;
    const states = readStatesFile(job.states, job.shard ?? 0, job.shards ?? 1);
    const res = replayStates(B, states, mapped.opts, {
      seeds: job.seeds,
      memory: job.memory,
      memoryHands: job.memoryHands,
      onRow: (row) => {
        buf += JSON.stringify(row) + '\n';
        if (++n % 200 === 0) {
          appendFileSync(job.out, buf);
          buf = '';
        }
      },
    });
    appendFileSync(job.out, buf);
    return {
      group: job.group,
      states: states.length,
      decisions: n,
      errors: res.errors,
      memoryStatus: res.memoryStatus,
      missingParts: B.missing,
      received: mapped.opts,
      unknown: mapped.unknown,
      refused: mapped.refused,
      unmet: mapped.unmet,
      augmentVersion: AUGMENT_VERSION,
    };
  }
  throw new Error(`unknown job kind "${job.kind}"`);
}

const isEntrypoint = (() => {
  try {
    return (
      process.argv[1] &&
      resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname) &&
      process.argv[2]
    );
  } catch {
    return false;
  }
})();
if (isEntrypoint) {
  const job = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  runJob(job)
    .then((result) => {
      writeFileSync(
        job.result,
        JSON.stringify({ ok: true, node: process.version, ...result }, null, 1)
      );
      process.exit(0);
    })
    .catch((e) => {
      writeFileSync(
        job.result,
        JSON.stringify(
          { ok: false, node: process.version, error: String(e?.stack ?? e).slice(0, 2000) },
          null,
          1
        )
      );
      console.error(String(e?.stack ?? e));
      process.exit(1);
    });
}
