# styleTightMethodLine

OFF. An opt-in arm (read as `=== true`). This file records where the option stands against the eight rows of
[HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md). Class definition:
docs/changelog/2026-11-16-tight-at-the-observation-line.md (CLASS-DEFINITIONS).

## Mechanism

MET. HorseOpponentStyle.tightMethodLineRead, applied in classifyOpponentStyle only when every earlier participation
route leaves the side neutral, for no-limit hold'em reads: 50 or more hands in the window, VPIP at or below the
observation method's line (0.18 full, 0.30 short; heads-up none), VPIP credibly (90%) below the Horse mean, PFR at or
below the Horse PFR mean, no contrary evidence. Plumbed from HorseDecideOpts through HorseMind's decision read
options; receipt style_tight_method_line_seen.

## Input fidelity

NOT MET. Tested on synthetic counters carrying the two graded people's rates; not on a recorded production node. The
long window travels in the pooled rows and the read frame, so the inputs exist on the production path, but no
production decision has been replayed with the option on.

## Value

NOT MET. No paired measurement. The consumers it reaches (the tight-side style consumers and labels) have their own
evidence; the value of reading a tight, mostly-calling player tight is not measured.

## Continuation

NOT MET. Not measured how such players continue against the adjustments the tight side enables.

## Reach

NOT MET (not measured on production). By arithmetic on a saturated 120-hand window at a full table: VPIP at or below
about 0.175 with PFR at or below 0.137. The observation found two such people in one evening window (915 Horse
decisions faced them).

## Scope

No-limit hold'em style read, full and short tables, every format on its own Horse cell. Heads-up, fixed-limit
hold'em, pineapple, short deck and Omaha are not read by the route. Read only when a style consumer asks.

## Visibility

style_tight_method_line_seen (HorseDataLedger) and receipt.tightMethodLine (line, hands, VPIP, PFR, posterior);
league card nlh_style_tight_method_line.

## Limits

- A point-estimate line would name about one average player in four tight at 50 hands; the 90% test against the
  Horse mean is kept for that reason, so a 0.167 player on a thin window can stay neutral.
- The observation uses lifetime counts; the engine reads a 120-hand window. The two will still disagree on players
  whose recent window differs from their lifetime rate.
- Tight opener and tight re-raiser respect keep their own PFR tests; this option only supplies the tight side.
