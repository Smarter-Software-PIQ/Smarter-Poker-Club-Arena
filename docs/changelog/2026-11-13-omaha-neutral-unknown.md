# Omaha: An Unknown Opponent Can Be Read As Neutral (Option, Default Off)

Owner directive, 2026-11-13 (relayed by the Hold'em strategy lane; also the owner's review order to the PLO lane, 00:21 Chicago): an unknown opponent must receive a neutral, explicitly uncertain read, not an automatic aggressive classification.

## Today

In Omaha every opponent without a disproof is read as an aggressive raiser (HorseOpponentExploit presumedAggressorRead, owner update 2026-10-27), people and Horses alike. Production telemetry, last three days: plo_opponent_presumed_aggressive 26,881,726; plo_opponent_presumption_disproved 3,117,508. People in Omaha are loose rather than more aggressive than Horses (style labels v1: median account raise rate 17.6 against the Horses' 17.7; VPIP about 75 against 32).

## Change

Option `omahaNeutralUnknown` (DEFAULT OFF). With it on, the Omaha read (HorseOpponentExploit `neutralUnknownRead`) is identical to today's in every outcome except the one where the presumption would apply (an opponent with no engaged raise read and no disproof). There it is the opponent's own measured statistics with nothing engaged: the read a measured opponent at the Horse mean gets. It stays non-null and keeps the `presumed` flag, which marks a read with no evidence of its own, so every gate that admits only evidenced reads (the V86 counters, streetBullyRead, opener pressure) and every detector that falls back to measured evidence (isLagBully) runs exactly as before; only the raise read changes. (The reviewed head a59cd6b0 dropped the flag, which let a zero-evidence prior flag a heads-up PLO4 unknown as giving up the turn; a law test now pins this.) Receipt `plo_opponent_neutral_unknown` fires only in that case; disproved and evidenced opponents read and count as today. presumedAggressorRead and its constants are unchanged. League cards `plo4/plo5/plo6_omaha_neutral_unknown` deal the option nightly. A bounded population prior (the shared style-read contract, #10699) is not part of this change.

## League (Development, Seed 31337)

Six-handed, Horse field, 3,000 duplicate pairs per cell, option on minus off, bb/100 (stderr): PLO4 cash +14.1 (6.4), PLO4 MTT 40 BB +5.2 (5.4), PLO5 cash +0.7 (7.4), PLO5 MTT -4.0 (5.0), PLO6 cash -3.3 (6.2), PLO6 MTT +4.3 (3.4). One cell (PLO4 cash) is positive at about 2.2 standard errors; six cells together are inconclusive; no cell is significantly negative. The human-calibrated population is qualified for Hold'em only and was not used. A first run measured an earlier version that returned no read at all (it also switched off the two detectors above); it is superseded. The runner is kept with the evidence (plo-handoff-review-01a1cbbd/plo-neutral/NeutralLeague.scratch.test.ts.txt; run from server/ with NL_OUT, NL_VARIANTS, NL_FORMATS, NL_FIELDS, NL_PAIRS).

## Limits

Default off. Activation is a separate decision against the existing acceptance conditions, with the shared style-read contract and a held-out evaluation named by the Hand Analysis owner.
