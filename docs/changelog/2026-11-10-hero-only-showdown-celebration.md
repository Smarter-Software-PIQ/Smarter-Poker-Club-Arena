# Hero-only showdown celebrations

The viewing hero receives the win sound, confetti and winner particles only when the engine names them among the pot winners. Every chop qualifies, even a small share or a rake-negative split. Revealing cards no longer plays a premature winner-like chime or high-rank fanfare to losing players and spectators. A scoop fanfare belongs only to the scooping hero.

Pot flights, stack updates, winner labels, card reveals, sound preferences and run-it-twice deferral retain their existing paths. This is client-only and uses the existing authoritative winner IDs.

The retained law executes the actual celebration admission callback for winners, losers, chops and deferred runouts, checks small-chop confetti, and pins the reveal and scoop sound boundaries. Before the fix, eight of twelve cases failed.
