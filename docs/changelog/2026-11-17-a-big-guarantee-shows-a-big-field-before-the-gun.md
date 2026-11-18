# A big guarantee shows a big field before the gun

Owner, 2026-11-17, looking at Nightly 20K at T-7 with 37 entrants: "WHY ISN'T THERE LIKE 100-200 HORSES REGISTERED FOR THIS WITHIN 10 MINUTES OF STARTING?!"

Cause: `mttPrestartPlan` gave every paid MTT the same 32-48 prestart field regardless of guarantee, by design (November 1). Satellite qualifiers count toward that field, so on 2026-11-18 01:00 UTC 27 satellite seats plus 13 horses made 40 and the ramp stopped. The other ~550 entrants arrived after the clock started (617 entrants the night before; 580 of them registered after start).

Change: a paid event's prestart field is now a stable random 20-35% of its planned field, never below the existing 32-48 draw and never above 200. Small events are unchanged; Nightly 20K (572-entry plan) now builds 120-200 before start and at least ~100 by T-10. Late registration, funding doors, capacity (`maxPlayers - 1`), the six-per-pass step and the 45 s tick are untouched.
