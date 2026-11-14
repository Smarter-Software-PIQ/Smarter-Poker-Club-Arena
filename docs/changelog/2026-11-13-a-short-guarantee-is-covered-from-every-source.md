# A short guarantee is covered from every source (2026-11-13)

Follow-up to `2026-11-13-overlay-cover-claims-every-horse.md`.

## What the last fourteen days showed

344 guaranteed MTTs, 11 closed with house money, 11,120 in total. Read from
`fn_ca_guarantee_funding` and the entry timestamps:

| Events                   | House posted           | What the rows show                                                                                                                                                                                                                                                                                  |
| ------------------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Oct 31 (x2), Nov 1 (x2)  | 104, 1,334, 1,580, 200 | The last entry arrived 27 to 30 minutes after the start, in windows of 72 to 80 minutes. This is the 30-minute overlay horizon, removed by the November 7 rescue.                                                                                                                                   |
| Nov 2 (x2)               | 60, 15                 | Two entries short each, before the rescue existed.                                                                                                                                                                                                                                                  |
| Nov 7                    | 88                     | The event the November 7 rescue was written for.                                                                                                                                                                                                                                                    |
| Nov 8 (x2), Nov 13 16:00 | 160, 160, 124          | After the rescue. Entries kept arriving one or two every five minutes to the end, four or five short. The rescue was due and asked; it registered one or two a cycle. Engine logs are not reachable from here, so the refusal reasons are not known; the thin on-shift pool that sank the 20K fits. |
| Nov 13 19:00             | 7,295                  | Nightly 20K, the changelog above.                                                                                                                                                                                                                                                                   |

## What changed

1. **Rebuys and add-ons are cover.** The guard publishes each running event
   that is still short (`markGuaranteeShort`, read before the registration
   door). While an event is marked, every eligible horse bust rebuys (was 70%),
   every horse adds on (was 74%) and the hashed 0 to 5 rebuy allowance is 5. The
   rebuy period, the event's own cap and the wallet still decide the purchase.
   The mark lapses after five minutes without a fresh reading.
2. **Cover keeps pace.** At progress p through late registration the event
   should hold p of the entries its guarantee needs; up to 12 a cycle are added
   to catch up. The final twenty minutes still ask for the rest.
3. **Every host is guarded.** The guard's host list is Midway, the arena while
   its switch is on, and the union or club of every guaranteed paid MTT on the
   board. Today only Midway holds guaranteed events (95 on the board).
4. **Cover runs before free seats.** Late registration is asked before the
   freeroll fill in each cycle.
5. **Durable alerts** through `raiseFinancialAlert`, one open row per event:
   a closing-window cover cycle that came up short, a guarantee still short 30
   minutes before entry closes, a guarantee that closed with house money, and a
   guarantee the fleet cannot be relied on to cover (hourly, next 24 hours).
   The earlier change's `reportError` is a console line and had no reader.
6. **Evidence on `/health`** (`overlayCover`): short events, cash calls made,
   answered and lapsed with median and slowest answer time, and the pool each
   cover ask met (free, at the limit, unable to pay).
7. **Supply model** (`tournamentHorseSupply`): a replay of the 7:30 PM state
   of November 13 from the measured aggregates (old pool 0, overlay cover 490
   free and 165 callable against 232 missing), and a board check that pins the
   two tournament games each horse keeps.

## Not changed, deliberately

- No two-tournament ceiling. Cash is capped at two tables; an event may take a
  horse's third or fourth game when a guarantee is short.
- The Rewards tab still shows the overlay to players.
- The 70% rebuy share (owner 2026-10-29) outside a short guarantee.

Engine change: activates at the 04:00 Chicago release.
