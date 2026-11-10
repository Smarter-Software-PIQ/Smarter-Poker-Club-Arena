/**
 * DONKEY CROSS, CONTRACT 6: A FAIR COIN ON EVERY STREET (Dan, 2026-10-11).
 *
 * "IT NEEDS TO LITERALLY BE A 50/50 CHANCE TO CROSS THE NEXT STREET. 'A
 * VIRTUAL COIN' MUST FLIP THAT IS TRULY RANDOM TO BE SAFE OR SMASH FOR EACH
 * STREET EVERY TIME." And, on the money: "Smaller prizes, keep 80%".
 *
 * Mirrors supabase/migrations/20261012113806_donkey_cross_flips_a_fair_coin_every_street.sql
 * exactly:
 *
 *   coin(k)   street k is SAFE when the first byte of
 *             HMAC-SHA256(key = server seed, message = client:nonce:street:k)
 *             is below 128: 128 of 256 values, exactly one half, and every
 *             street (street one too) has its own message, so no coin says
 *             anything about another.
 *   ladder    prize_1 = 1.6B - L, prize_(k+1) = 2 prize_k - loss_k, where
 *             loss_k = max(L, half of prize_k rounded up to the cent) is the
 *             contract-5 loss rule. Booking after any street is then worth
 *             exactly 0.80B; the top is capped at 20B (worth a little less).
 *
 * Every prize is a whole number of FIFTHS of a cent, so the ladder is exact
 * integer arithmetic here and exact numeric arithmetic in Postgres.
 */
import { hmacSha256Hex } from './wheelFairness';

/**
 * CONTRACT 7: STREET ONE IS ALWAYS SAFE (Dan, 2026-10-15): "STREET 1 IS ALWAYS
 * SUPPOSED TO BE 100% SAFE, NEVER DIE ON STREET 1 EVER." Every later street is
 * contract 6's fair coin. Street one pays 0.80B (a sure step worth exactly the
 * 80% Dan set), and street k+1 pays contract 6's street k, so booking after any
 * street is still worth exactly 0.80B. New rounds are dealt contract 7;
 * contract 6 receipts remain readable as they were sealed.
 *
 * The contract a NEW Donkey Cross round is dealt. */
export const ROAD_COIN_VERSION = 8;
export const ROAD_COIN_V7 = 7;
/** The first coin contract, street one included in the coin. Read-only now. */
export const ROAD_COIN_V6 = 6;
/** Every contract whose road is a sealed coin per street. */
export function isRoadCoinVersion(version: unknown): version is 6 | 7 | 8 {
  return version === ROAD_COIN_V6 || version === ROAD_COIN_V7 || version === ROAD_COIN_VERSION;
}
/** The most streets a round may have (diamond_choice_rounds.max_steps). */
export const ROAD_COIN_MAX_STREETS = 20;
/** The top of the road, as a multiple of the stake. */
export const ROAD_COIN_TOP_MULTIPLE = 20;

type Fraction = { numerator: bigint; denominator: bigint };

function cents(chips: number, label: string) {
  const value = Math.round(chips * 100);
  if (!Number.isFinite(chips) || Math.abs(chips * 100 - value) > 1e-6)
    throw new Error(`Invalid ${label}`);
  return value;
}

/**
 * The prize ladder, in fifths of a cent, for a stake and its floor (chips).
 * Mirrors public.fn_choice_road_prizes_v6.
 */
export function roadCoinPrizeFifths(
  betChips: number,
  floorChips: number,
  version: number = ROAD_COIN_V7
): number[] {
  if (version !== ROAD_COIN_V6 && version !== ROAD_COIN_V7)
    throw new Error('Invalid Historical Road Version');
  if (version === ROAD_COIN_V7) {
    // Contract 7: the sure first street (0.80B), then contract 6's road.
    const B7 = cents(betChips, 'Road Stake');
    return [4 * B7, ...roadCoinPrizeFifths(betChips, floorChips, ROAD_COIN_V6)].slice(
      0,
      ROAD_COIN_MAX_STREETS
    );
  }
  const B = cents(betChips, 'Road Stake');
  const L = cents(floorChips, 'Road Floor');
  if (B <= 0 || L < 0 || L * 5 >= B * 4) throw new Error('The Floor Beats The Edge');
  const top = ROAD_COIN_TOP_MULTIPLE * B * 5;
  const out: number[] = [];
  let next = 8 * B - 5 * L;
  for (;;) {
    if (next >= top) {
      out.push(top);
      break;
    }
    out.push(next);
    if (out.length === ROAD_COIN_MAX_STREETS) break;
    // loss = max(L, ceil(prize cents / 2)) cents, and prize cents = next / 5.
    const loss = Math.max(L, Math.ceil(next / 10));
    next = 2 * next - 5 * loss;
  }
  return out;
}

/** Sixtieths of a cent represent both 1.05 times a whole cent and the
 * division by three on street two exactly. End before the 20x prize cap. */
function roadPrizesV8(betChips: number, floorChips: number): bigint[] {
  const bet = BigInt(cents(betChips, 'Road Stake'));
  const floor = BigInt(cents(floorChips, 'Road Floor'));
  if (bet < 1n || floor < 0n || floor > bet) throw new Error('Invalid Road Floor');
  const prizes: bigint[] = [];
  let next = 63n * bet;
  while (next <= 1200n * bet && prizes.length < ROAD_COIN_MAX_STREETS) {
    prizes.push(next);
    const half = (next + 119n) / 120n;
    const loss = 60n * (half > floor ? half : floor);
    next = prizes.length === 1 ? (4n * next - loss) / 3n : 2n * next - loss;
  }
  return prizes;
}

/** The ladder in chips, as the server stores it in `prizes`. */
export function roadCoinPrizes(
  betChips: number,
  floorChips: number,
  version: number = ROAD_COIN_VERSION
): number[] {
  if (version === 8) return roadPrizesV8(betChips, floorChips).map((value) => Number(value) / 6000);
  return roadCoinPrizeFifths(betChips, floorChips, version).map((fifths) => fifths / 500);
}

/** One street's prize as an exact rational number of cents. */
export function roadCoinPrize(
  betChips: number,
  floorChips: number,
  street: number,
  version: number = ROAD_COIN_VERSION
): Fraction {
  if (version === 8) {
    const value = roadPrizesV8(betChips, floorChips)[street - 1];
    if (value === undefined) throw new Error('Invalid Road Prize');
    return { numerator: value, denominator: 60n };
  }
  const ladder = roadCoinPrizeFifths(betChips, floorChips, version);
  if (!Number.isInteger(street) || street < 1 || street > ladder.length)
    throw new Error('Invalid Road Prize');
  return { numerator: BigInt(ladder[street - 1]), denominator: 5n };
}

/** Multiplier cents per street (110 = 1.10x), for painting the road. */
export function roadCoinLadderCents(prizes: readonly number[], betChips: number): number[] {
  return prizes.map((prize) => Math.round((prize / betChips) * 10000) / 100);
}

/**
 * The road a NEW standard round of one chip is dealt (floor half the stake):
 * 1.10x up to 20.00x. What the rules and the lobby describe before a quote.
 */
export const ROAD_COIN_REFERENCE_CENTS: readonly number[] = roadCoinLadderCents(
  roadCoinPrizes(1, 0.5),
  1
);

/** Whether this sealed coin lands SAFE. Mirrors public.fn_choice_road_coin_v6. */
export async function roadCoin(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  street: number,
  version: number = ROAD_COIN_VERSION
): Promise<boolean> {
  if (!Number.isSafeInteger(street) || street < 1) throw new Error('Invalid Street');
  // Contract 7: street one is always safe (public.fn_choice_road_coin_v7).
  if (version >= ROAD_COIN_V7 && street === 1) return true;
  const hash = await hmacSha256Hex(serverSeed, `${clientSeed}:${nonce}:street:${street}`);
  return Number.parseInt(hash.slice(0, 2), 16) < (version === 8 && street === 2 ? 192 : 128);
}

/** Every street's coin, street one first. Mirrors public.fn_choice_road_coins_v6. */
export async function roadCoins(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  streets: number,
  version: number = ROAD_COIN_VERSION
): Promise<boolean[]> {
  const out: boolean[] = [];
  for (let street = 1; street <= streets; street++)
    out.push(await roadCoin(serverSeed, clientSeed, nonce, street, version));
  return out;
}

/** How far the donkey would get: the safe streets before the first smash.
 * Mirrors public.fn_choice_road_end_v6. */
export function roadCoinEnd(coins: readonly boolean[]): number {
  const smash = coins.indexOf(false);
  return smash < 0 ? coins.length : smash;
}

/**
 * Exact expected value, as a fraction of the stake, of booking after `street`
 * streets: the chance of reaching it times its prize, plus every earlier smash
 * times what that smash pays. Used by the law test; never shown to a player.
 */
export function roadCoinStopValue(
  betChips: number,
  floorChips: number,
  street: number,
  version: number = ROAD_COIN_VERSION
): Fraction {
  if (version === 8) {
    const prizes = roadPrizesV8(betChips, floorChips);
    if (!Number.isInteger(street) || street < 1 || street > prizes.length)
      throw new Error('Invalid Road Stop');
    const floor = BigInt(cents(floorChips, 'Road Floor'));
    let value = prizes[street - 1];
    let denominator = 1n;
    for (let n = street; n > 1; n--) {
      const half = (prizes[n - 2] + 119n) / 120n;
      const loss = 60n * (half > floor ? half : floor);
      const safe = n === 2 ? 3n : 1n;
      value = safe * value + loss * denominator;
      denominator *= safe + 1n;
    }
    return {
      numerator: value,
      denominator: denominator * 60n * BigInt(cents(betChips, 'Road Stake')),
    };
  }
  if (version === ROAD_COIN_V7) {
    // The sure first street pays its prize outright; every later stop is the
    // contract-6 stop one street earlier (the coins start at street two).
    const B7 = cents(betChips, 'Road Stake');
    if (street === 1) return { numerator: 4n * BigInt(B7), denominator: 5n * BigInt(B7) };
    return roadCoinStopValue(betChips, floorChips, street - 1, ROAD_COIN_V6);
  }
  const ladder = roadCoinPrizeFifths(betChips, floorChips, version);
  const L = cents(floorChips, 'Road Floor');
  const B = cents(betChips, 'Road Stake');
  if (!Number.isInteger(street) || street < 1 || street > ladder.length)
    throw new Error('Invalid Road Stop');
  // Everything in fifths of a cent over 2^street.
  let total = 0n;
  for (let j = 0; j < street; j++) {
    const loss = j === 0 ? L : Math.max(L, Math.ceil(ladder[j - 1] / 10));
    total += 5n * BigInt(loss) * 2n ** BigInt(street - j - 1);
  }
  total += BigInt(ladder[street - 1]);
  return { numerator: total, denominator: 2n ** BigInt(street) * 5n * BigInt(B) };
}
