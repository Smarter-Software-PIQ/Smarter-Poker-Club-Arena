/**
 * LIGHTNING: HOW MANY MORE PLAYERS (Dan 2026-11-11).
 *
 * "The table kept showing a message that Lightning could not start because
 * there were not enough players. That must never show. Put a ticker under the
 * bomb pot indicator: XX More Players Until Lightning Games Start."
 *
 * A Lightning game is a feeder game (MUST MOVE) until it has enough players,
 * then it turns into Lightning (owner 2026-11-05). While it is that feeder
 * game this masthead line counts down, live, from the database's own figures
 * (fn_cash_cluster_lightning_state: on_threshold less live_eligible, re-read
 * every five seconds while the game could switch). It says nothing on a
 * Classic game, while the game is switching (Lightning Is Starting owns that
 * moment) or once Lightning is running, and nothing when a figure is unknown.
 */
import type { LightningLobbyState } from '../../lightning/lightningLobby';
import './LightningStartTicker.css';

export function lightningStartTickerText(
  state: LightningLobbyState | null | undefined
): string | null {
  if (!state || state.lightningEnabled !== true) return null;
  if (state.clusterMode !== 'must_move') return null;
  const on = state.onThreshold;
  const live = state.liveEligible;
  if (on === null || live === null || on <= 0) return null;
  const left = on - live;
  if (left <= 0) return null;
  return left === 1
    ? '1 More Player Until Lightning Games Start'
    : `${left} More Players Until Lightning Games Start`;
}

export default function LightningStartTicker({
  state,
}: {
  state: LightningLobbyState | null | undefined;
}) {
  const text = lightningStartTickerText(state);
  if (!text) return null;
  return (
    <span
      className="table-brand__line table-brand__line--bomb"
      data-testid="lightning-start-ticker"
      role="status"
      aria-live="polite"
    >
      <span className="lightning-start-ticker__text">{text}</span>
    </span>
  );
}
