# Horses read an ordinary tight regular as tight

The owner's first requirement for the Horses' reads is that they recognise tight human play and adjust to it. They
could not, for an ordinary tight regular. A Horse judges how often a player enters pots from counters that fade with a
30-hand half-life, so however long the player has been at the table the evidence never adds up to more than about 44
hands. At that much evidence the read's 90% rule can call a full-ring player tight only when he plays 11.9% of hands
or fewer (23.1% short-handed, 30.2% heads-up), and the response against a tight opener also needed him to raise 6% or
less (15.8%, 21.3%). A regular who plays 14% and raises 7% was read as neutral forever.

## What changed

- The opponent counters keep a third, slow window over hands, VPIP and PFR only, with a 120-hand half-life. It can
  hold up to about 174 hands of evidence. At that much evidence the same 90% rule, the same 6 prior hands at the Horse
  average and the same margins call tight at up to 15.6% full ring, 27.9% short-handed and 35.4% heads-up, and the
  tight-opener response needs a raise rate of up to 8.8%, 20.0% and 26.0%.
- The style read uses that window for VPIP, PFR and the call share only when it holds more hands than the 30-hand
  window and both windows put the player at or below the Horse average. So it can only strengthen a tight read, never
  make a player look loose or aggressive, and it stops speaking as soon as his last 30 hands lean the other way.
  Everything else in the read, including the 15-hand minimum before any read and the fast 8-hand window that stands a
  read down when a player changes gear, is unchanged. Horses and humans are read alike.
- Both learners keep it: the engine's own learner and the database learner that writes each accepted hand into the
  shared opponent profiles (new column `horse_exact_profiles.long_counters`, migration `20261115015341`). The shared
  rows carry it to every decision, and the decision's read frame (`horse-decision-reads-v15`) carries it to the second
  look and to exact replay. Decisions whose rows have no long window keep their frames byte for byte.
- Forward only. Nothing is back-filled or replayed: each profile starts its long window with its next accepted hand
  after the migration is installed, and until the window holds more hands than the 30-hand one (about 51 of that
  player's hands in that game, format, table size and speed) the read is exactly what it was.

## What it changes in live play

About 120 hands after release (per player, per game context), Horses start to read regulars who play around 14% full
ring (about 26% short-handed, 33% heads-up) as tight. Against them the preflop responses that already exist engage:
3-betting a tight opener only with hands that beat his range, flatting less with dominated hands, and 4-betting and
calling his re-raises tighter. A player near the new limit (15% full ring) is read tight most of the time after about
240 hands. Players at the Horse average are unaffected, and so is every Omaha read (no Omaha consumer reads it).

## Not changed

Two forced-action defects listed by the audit stay as they are and are owned elsewhere: a player who leaves while not
on turn gets one counted fold, and a Lightning timed-out check is counted as a check. The long window counts exactly
what the 30-hand window counts. Its weight per hand is smaller (one hand among up to 174 rather than 44), so a single
leave moves the read less; the Lightning check bias moves the rate by the same share in both windows, and the long
window can make that shifted rate credible for a mixed player whose timed-out checks pull a 24% to 25% rate under
15.6%.
