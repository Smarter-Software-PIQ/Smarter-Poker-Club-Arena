# The Hybrid Release Gets Its Own :55 Window

The engine release gate admitted activations only inside the owner window `2026-11-04-tournament-fourfold-certified-recovery`, which expired at 05:00Z on 2026-11-05. Release 41977933257, carrying the Hybrid horse profiles (#9488, merge `a936a6b6`), was therefore refused at 06:27Z with "explicit later owner window expired".

A new fixed window, `2026-11-05-hybrid-and-phase1-55-0645z`, admits one certified activation of a target containing that merge from 06:45Z to 12:45Z on 2026-11-05, at Chicago minute 53 notice and minute 55 activation only, under Dan's standing :55-break order and his order to deploy and verify the Hybrid in the next engine release. Every guard is unchanged; no migration is added; earlier windows keep their witnesses and expiries. The floor tests now address the four-fold certified recovery window by its id, and a new case binds this window's witness.
