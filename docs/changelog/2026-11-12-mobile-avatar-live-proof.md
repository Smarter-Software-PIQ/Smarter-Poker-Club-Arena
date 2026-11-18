# Mobile avatar screenshots wait for actual enlargement

The production screenshot reader sampled two animation frames after changing the
viewport. The protected layout can still be decoding and placing portraits then,
so the reader captured baseline scales of 1 before the approved enlargement ran.
Reproduced in WebKit at layout widths 599, 600, 604 and 661: immediate samples were
unchanged; settled samples enlarged the bottom portrait to 2 and selected upper
portraits to 1.8–1.95 using public production artwork.

The existing cash live-table proof now waits for actual non-unit portrait scale
on supported layouts before collecting its containment measurements and PNGs.
A real-component resize regression exercises this wait without finishing the
layout animations for it. Unsupported layouts retain their existing coverage.
The bounded screenshot allowance covers the four viewport checks. No artwork,
seat position, engine behavior or production account operation changes.

This corrects evidence collection, not a claim that local fixtures prove the
production result. Live enlargement and screenshots remain required for closeout.
