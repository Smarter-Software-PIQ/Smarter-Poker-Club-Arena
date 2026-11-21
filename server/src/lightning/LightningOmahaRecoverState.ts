/**
 * Lane CORE-FIX-1 (PLO-OWNER lead-3, AUDIT-A item 16; owner order Nov 21): the game state the Lightning host hands
 * omahaMathCoreRecover when the controller refused a core choice facing a bet (LightningHandHost.executeHorseDecision,
 * COREGUARD). It used to be a partial state - gameMode hard-coded 'cash' and no asset, board count, bomb pot,
 * variant rules, rake, dealer seat, action history, betting structure or legal sizes - so omahaMathCoreInScope could
 * not re-check a Diamond table, a double board, an all-in-or-fold menu or a capped street there, and the price ran
 * without the table's rake. This is the fresh table state with every field the scope gate and the pricing read,
 * from the host's own snapshots (the same fields LightningHorse.buildLightningHorseSnapshot sends the worker).
 * Public information only: other seats' cards are blanked exactly as the worker snapshot does.
 */
import type { HorseGameStateV2 } from '../engine/HorseLogic.js';
import { horseVariantRulesFor } from '../engine/VariantRules.js';

export interface LightningOmahaRecoverInput {
  /** the controller's fresh state (hc.getState()) */
  state: {
    players: ReadonlyArray<Record<string, unknown> & { user_id?: string; cards?: unknown[] }>;
    communityCards: unknown[];
    communityCards2?: unknown[] | null;
    communityCards3?: unknown[] | null;
    stage: string;
    currentBet: number;
    pot: number;
    minRaise?: number;
    dealerSeat?: number | null;
    lastRaise?: number | null;
    actionHistory?: ReadonlyArray<Record<string, unknown>> | null;
    bombPot?: boolean | null;
  };
  heroUserId: string;
  blinds: Record<string, unknown>;
  variant: string;
  boardCount: number;
  /** rules.arena.asset ('chips' | 'diamonds' | ...); null when the table names none */
  asset: string | null;
  allInOrFold: boolean;
  rakeConfig: unknown;
  auth: {
    toCall: number;
    legalActions: readonly string[];
    minRaiseTo?: number | null;
    maxRaiseTo?: number | null;
    structure?: string | null;
    fixedBetSize?: number | null;
    wagersCapped?: boolean | null;
  };
}

export function lightningOmahaRecoverState(inp: LightningOmahaRecoverInput): HorseGameStateV2 {
  const st = inp.state;
  const players = st.players.map((p) =>
    p.user_id === inp.heroUserId ? { ...p } : { ...p, cards: [] as unknown[] }
  );
  return {
    stateSchemaVersion: 1,
    players,
    communityCards: [...st.communityCards],
    communityCards2: [...(st.communityCards2 ?? [])],
    communityCards3: [...(st.communityCards3 ?? [])],
    boardCount: inp.boardCount,
    bombPot: st.bombPot === true,
    stage: st.stage,
    currentBet: st.currentBet,
    pot: st.pot,
    minRaise: st.minRaise,
    ...(st.dealerSeat != null ? { dealerSeat: st.dealerSeat } : {}),
    ...(st.lastRaise != null ? { lastRaise: st.lastRaise } : {}),
    actionHistory: (st.actionHistory ?? []).map((a) => ({ ...a })),
    ...inp.blinds,
    gameMode: 'cash',
    format: 'cash',
    gameVariant: inp.variant,
    ...(inp.asset ? { asset: inp.asset } : {}),
    allInOrFold: inp.allInOrFold,
    rakeConfig: inp.rakeConfig,
    variantRules: horseVariantRulesFor(inp.variant),
    toCall: inp.auth.toCall,
    legalActions: [...inp.auth.legalActions],
    minRaiseTo: inp.auth.minRaiseTo ?? null,
    maxRaiseTo: inp.auth.maxRaiseTo ?? null,
    ...(inp.auth.structure ? { bettingStructure: inp.auth.structure } : {}),
    fixedBetSize: inp.auth.fixedBetSize ?? null,
    wagersCapped: inp.auth.wagersCapped === true,
  } as unknown as HorseGameStateV2;
}
