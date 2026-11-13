# An opponent style read, default off

Hold'em Horses had one blunt rule for an aggressive bettor (a postflop aggression
factor above 2.5 switches the one-pair fold layers off) and no way to tell a
value-heavy bettor from a maniac. A new pure classifier, `HorseOpponentStyle.ts`,
reads decayed decision-time counters on separate axes (entry width, aggression,
betting-range evidence with its showdown selection discount) with confidence, a
release when the recent window changes gear, a pre-repair discount for cash
table-speed profiles built before the showdown-domain fix, and a telemetry-only
label. Unknown opponents are neutral and flagged uncertain. Four options, all off
by default and explicit-true only, consume it: a value bettor is not a maniac,
big-bet respect (at most +0.15), flop/turn raise respect, and tight opener and
re-raiser respect preflop. Each only moves toward folding, stands down at
push/fold depths and in bounty events, and writes a registered `_seen` receipt.
Three more options, also off: the legacy over-folder branch stands down for
pre-repair profiles, value extraction against credible callers, and bluffing by
each street's fold-to-bet. Revealed strength is kept by bet size, and the
post-release count that lifts the pre-repair discount is recounted from
persisted hand history. Two always-on counters now count the legacy fold-rate
and aggression-factor branches. With every option off, 180 pinned decisions are unchanged.
