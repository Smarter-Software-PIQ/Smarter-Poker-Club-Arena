import { useEffect, useRef, useState } from 'react';
import { fetchMyHandCount, owedHands, type HandCount } from '../lib/hitAndRun';
import { fetchMyLightningSession, lightningAnchorSeat } from '../lightning/lightningSession';

/** The count is read once the hand's settlement has had time to land. */
export const HAND_COUNT_REFRESH_DELAY_MS = 1500;

const NONE: HandCount = { owed: null, required: null };

/**
 * HIT AND RUN (owner 2026-11-06): the hero's hands still owed in profit and
 * this countdown's total, refreshed after every completed hand so the felt
 * counts it down (and the Charles Rule's added hands can be announced).
 *
 * A classic table's engine carries both on the hero's seat (`engine`); that
 * answer is used as is. A Lightning room is not the seat's table, and its
 * count moves at every Lightning settlement, so it is read from the database
 * for the player's anchor table after each hand and while waiting between
 * hands (`engine` undefined).
 */
export function useHeroHandCount(opts: {
  enabled: boolean;
  tableId: string | null | undefined;
  lightningClusterId: string | null | undefined;
  handNumber: number;
  engine:
    | {
        owed: number | null;
        required: number | null;
        reason?: HandCount['reason'];
        bigWinBb?: number | null;
      }
    | undefined;
}): HandCount {
  const { enabled, tableId, lightningClusterId, handNumber, engine } = opts;
  const [read, setRead] = useState<HandCount>(NONE);
  const anchorRef = useRef<{ clusterId: string; tableId: string } | null>(null);
  const useEngine = engine !== undefined && !lightningClusterId;
  const engineOwed = useEngine ? owedHands(engine?.owed) : null;
  /**
   * THE PAUSED COUNT (owner 2026-11-13). The engine's seat carries only hands
   * owed, and a paused countdown owes none, so while the engine says none the
   * paused count is read from the database: once when the table opens, then
   * after each hand for as long as a count was just owed or is paused. A read
   * that finds nothing paused stops the reading until hands are owed again.
   */
  const watchPaused = useRef(true);
  if (engineOwed !== null) watchPaused.current = true;

  useEffect(() => {
    if (!enabled || !tableId || (useEngine && (engineOwed !== null || !watchPaused.current))) {
      setRead(NONE);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      let target: string | null = tableId;
      if (lightningClusterId) {
        target =
          anchorRef.current?.clusterId === lightningClusterId ? anchorRef.current.tableId : null;
        if (!target) {
          try {
            const anchor = lightningAnchorSeat(await fetchMyLightningSession(lightningClusterId));
            if (anchor) {
              anchorRef.current = { clusterId: lightningClusterId, tableId: anchor.anchorTableId };
              target = anchor.anchorTableId;
            }
          } catch {
            target = null;
          }
        }
      }
      if (!target || cancelled) return;
      const count = await fetchMyHandCount(target);
      if (cancelled) return;
      if (useEngine && !(count.paused && count.paused > 0)) watchPaused.current = false;
      setRead(count);
    }, HAND_COUNT_REFRESH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, useEngine, engineOwed, tableId, lightningClusterId, handNumber]);

  if (!enabled) return NONE;
  if (!useEngine) return read;
  const owed = engineOwed;
  // The engine owes nothing: only the database's paused count is shown.
  if (owed === null)
    return read.paused && read.paused > 0
      ? { owed: null, required: null, paused: read.paused, pausedRequired: read.pausedRequired }
      : NONE;
  return {
    owed,
    required: owed === null ? null : owedHands(engine?.required),
    reason: owed === null ? null : (engine?.reason ?? null),
    bigWinBb: owed === null ? null : (engine?.bigWinBb ?? null),
  };
}

/**
 * THE CHARLES RULE, announced: the countdown's total went up while hands were
 * still owed, so the player doubled up and hands were added. `onAdded` is
 * called once per increase with the hands added.
 */
export function useHandsAddedByDouble(count: HandCount, onAdded: (added: number) => void): void {
  const prev = useRef<HandCount>(NONE);
  const notify = useRef(onAdded);
  notify.current = onAdded;
  useEffect(() => {
    const before = prev.current;
    prev.current = count;
    // A Charles double raises the countdown's own total. When a +250 BB win
    // is (or was) what the count shows, its total is not the countdown's, so
    // a change in it is never announced as a double.
    const bigWin = (c: HandCount) => c.reason === 'big_win' || c.reason === 'both';
    if (
      before.owed !== null &&
      before.required !== null &&
      count.owed !== null &&
      count.required !== null &&
      count.required > before.required &&
      !bigWin(before) &&
      !bigWin(count)
    )
      notify.current(count.required - before.required);
  }, [count.owed, count.required, count.reason]);
}

/**
 * HIT AND RUN: the hand a countdown starts, say so once ("You Are In Profit.
 * Play 10 Hands Before You Can Leave"), so the count beside the seat is never
 * a surprise. Only a countdown that starts while this table is open counts:
 * a count already running when the page opens (a reload, a reconnect) is not
 * announced again. `handNumber` is the table's hand counter.
 */
export function useCountdownStarted(
  count: HandCount,
  handNumber: number,
  onStart: (hands: number, reason?: HandCount['reason'], bigWinBb?: number | null) => void
): void {
  const prev = useRef<HandCount>(NONE);
  const firstHand = useRef<number | null>(null);
  const notify = useRef(onStart);
  notify.current = onStart;
  useEffect(() => {
    if (firstHand.current === null && handNumber > 0) firstHand.current = handNumber;
  }, [handNumber]);
  useEffect(() => {
    const before = prev.current;
    prev.current = count;
    if (
      before.owed === null &&
      count.owed !== null &&
      count.required !== null &&
      count.owed === count.required &&
      firstHand.current !== null &&
      handNumber > firstHand.current
    )
      notify.current(count.owed, count.reason, count.bigWinBb);
  }, [count.owed, count.required, handNumber]);
}

/**
 * THE COUNT PAUSES AND RESUMES (owner 2026-11-13): falling out of profit
 * with hands left pauses the countdown, and coming back picks it up where it
 * stopped. Both are said when they happen, so a count that disappears and
 * returns is never a surprise. A pause already standing when the table opens
 * is not announced; `handNumber` is the table's hand counter.
 */
export function useCountdownPauseResume(
  count: HandCount,
  handNumber: number,
  onPause: (hands: number) => void,
  onResume: (hands: number) => void
): void {
  const prev = useRef<HandCount>(NONE);
  const lastPaused = useRef<number | null>(null);
  const firstHand = useRef<number | null>(null);
  const pause = useRef(onPause);
  const resume = useRef(onResume);
  pause.current = onPause;
  resume.current = onResume;
  useEffect(() => {
    if (firstHand.current === null && handNumber > 0) firstHand.current = handNumber;
  }, [handNumber]);
  useEffect(() => {
    const before = prev.current;
    prev.current = count;
    const paused = count.paused && count.paused > 0 ? count.paused : null;
    const wasPaused = before.paused && before.paused > 0 ? before.paused : null;
    if (paused !== null) {
      if (wasPaused === null && firstHand.current !== null && handNumber > firstHand.current)
        pause.current(paused);
      lastPaused.current = paused;
      return;
    }
    if (count.owed !== null && lastPaused.current !== null) {
      const hitRun = count.reason !== 'big_win';
      if (hitRun) resume.current(count.owed);
      lastPaused.current = null;
    }
  }, [count.owed, count.paused, count.reason, handNumber]);
}

/**
 * THE CHARLES RULE AFTER A LARGE WIN (owner 2026-11-11): another win of 250
 * big blinds or more while hands are already owed resets the count to ten.
 * Said when it happens, so a count going back up is never a surprise.
 */
export function useBigWinRestarted(
  count: HandCount,
  onRestart: (hands: number, bigWinBb: number | null) => void
): void {
  const prev = useRef<HandCount>(NONE);
  const notify = useRef(onRestart);
  notify.current = onRestart;
  useEffect(() => {
    const before = prev.current;
    prev.current = count;
    if (
      before.owed !== null &&
      count.owed !== null &&
      count.owed > before.owed &&
      (count.reason === 'big_win' || count.reason === 'both') &&
      count.required === count.owed
    )
      notify.current(count.owed, count.bigWinBb ?? null);
  }, [count.owed, count.required, count.reason, count.bigWinBb]);
}
