# Omaha: An Unknown Opponent Can Be Read As Neutral (Option, Default Off)

Owner directive, 2026-11-13 (relayed by the Hold'em strategy lane; also the owner's review order to the PLO lane, 00:21 Chicago): an unknown opponent must receive a neutral, explicitly uncertain read, not an automatic aggressive classification.

## Today

In Omaha every opponent without a disproof is read as an aggressive raiser (HorseOpponentExploit presumedAggressorRead, owner update 2026-10-27), people and Horses alike. Production telemetry, last three days: plo_opponent_presumed_aggressive 26,881,726; plo_opponent_presumption_disproved 3,117,508. People in Omaha are loose rather than more aggressive than Horses (style labels v1: median account raise rate 17.6 against the Horses' 17.7; VPIP about 75 against 32).

## Change

Option `omahaNeutralUnknown` (DEFAULT OFF). With it on, HorseMind.opponentRead for the Omaha family skips the presumption and returns the opponent's own measured read only: no read means no exploit layer engages, exactly as against an opponent at the Horse mean; protective layers are untouched; an opponent whose own hands engage a read keeps it. Receipt `plo_opponent_neutral_unknown`. presumedAggressorRead, its constants and the presumed flag are unchanged. A bounded population prior (the shared style-read contract) is not part of this change.

## League (Development, Seed 31337)

Six-handed, Horse field, 3,000 duplicate pairs per cell, option on minus off, bb/100 (stderr): PLO4 cash +13.4 (6.1), PLO4 MTT 40 BB +7.9 (5.3), PLO5 cash -4.4 (7.3), PLO5 MTT -5.9 (5.1), PLO6 cash -0.9 (6.6), PLO6 MTT +3.4 (3.4). Inconclusive; no cell significantly negative. The human-calibrated population is qualified for Hold'em only and was not used.

## Limits

Default off. Activation is a separate decision against the existing acceptance conditions, with the shared style-read contract and a held-out evaluation named by the Hand Analysis owner.
