# All Horses Play The Hybrid Style

Dan, November 5, 2026, verbatim: "YOU NEED TO HAVE CHANGED ALL 1000 HORSES TO
THE NEW 'HYBRID' STYLE HORSE AND RETIRE ALL OTHER 'STYLES ASSIGNED TO THOSE
HORSES' AND ACTIVATE THE NEW 'HYBRID' TO ALL OF THEM."

## What Changed

Every one of the 1,000 live horses now carries `horse_profile.style =
"hybrid"` in the database. Until today the fleet was still labelled with the
five legacy styles (tricky 224, grinder 220, tag 209, balanced 207, lag 202)
even though the engine has played the Hybrid for every hand since the
November 4 release. The old style of each horse is kept under
`horse_profile.retiredStyle`, so the persona a horse was born with stays in
its history. Nothing else in a horse's profile moves: the four tuning dials,
the authored persona and the diagnostic counts are exactly what they were.
The 62 closed horse accounts are left alone.

The server now knows `hybrid` as a real horse style. Reading a horse row with
that style resolves to `hybrid` itself, never to a default picked by hashing
the id. Every path that assigns a style to a horse writes `hybrid`: a newly
created horse, and the boot-time completeness sweep, which also moves any
horse still found on a retired style over to the Hybrid and records what it
retired. No path writes one of the five retired styles to a horse any more.

## What Did Not Change

The Hybrid still plays by game mode, exactly as the November 4 release
designed it. A cash seat plays the Grinder profile with Pebbles' dials and a
tournament seat plays the Tricky profile with Flint's dials, whatever the
stored style says, so a `hybrid` row makes the same decision a `tag` or
`grinder` row made yesterday. The worker's execution receipts
(`hybrid_v1_cash_grinder_decided` and `hybrid_v1_tournament_tricky_decided`)
fire on the same conditions as before. The five legacy style tables stay in
the brain because the Hybrid resolves to two of them, and historical reports
keep their original style attribution.

Table talk is persona, not decision: a Hybrid horse keeps the voice of the
style it retired, so the quiet grinders stay quiet and the needling LAGs keep
needling. A horse with no retired style speaks in the friendly voice.

## How It Reached Production

The database change is one migration,
`20261105222744_all_horses_play_the_hybrid_style.sql`: plain row updates on
the horse rows of `public.profiles`, one transaction, no DDL, bounded by lock
and statement timeouts, and it refuses to commit unless every live horse is
on the Hybrid when it finishes. It installs through Apply Merged Migration
after the merge, as every migration does. The code change ships in the next
engine release through the normal release lane. Between the two, the engine
already on the Hetzner box keeps playing the Hybrid by mode, so the relabelled
rows change nothing at the tables.

## Law

`server/src/services/EveryHorseIsAssignedTheHybrid.law.test.ts` pins, at one
fixed clock, that `hybrid` reads as itself, that every live assignment path
writes it and keeps the retired style, that the migration file does exactly
that and nothing else, and that a `hybrid` row resolves to the same mode
profile and the same brain decision as the row it replaced.
