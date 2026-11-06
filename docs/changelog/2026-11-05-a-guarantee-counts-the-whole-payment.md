# 2026-11-05 - A Buy-In Guarantee Counts The Whole Player Payment

Owner rule (Dan, 2026-11-05): "The full qualifying player-funded tournament payment counts toward the buy-in guarantee before deducting bounty allocations or rake." A 40-chip entry split 26 prize / 10 bounty / 4 rake credits all 40. The house funds H = max(0, G - C) once; guarantee credit is not money.

## The 2,445 On A 1,500 Guarantee, Reconciled

Wednesday Feature `94ef58cf-5f0b-47dd-bbe1-d490e036b083` (G 1,500; entry 30 = 27 prize + 3 rake; rebuy and add-on 30).

| Time (UTC, Nov 5) | Ledger                                                        | Amount |
| ----------------- | ------------------------------------------------------------- | ------ |
| 02:52:23          | 4 ticket redemptions (escrow to prize liability)              | 120    |
| 02:52:24 onward   | 60 wallet buy-ins at 30                                       | 1,800  |
| 02:53:41          | start overlay, union bank to prize liability (1,500 - 6 x 27) | 1,338  |
| 03:33 - 03:41     | 2 rebuys at 30                                                | 60     |
| 04:05:16          | start overlay returned to the union bank (#9518 fix)          | -1,338 |
| 04:54             | 42 add-ons at 30                                              | 1,260  |
| 07:37 - 08:20     | 10 prizes paid                                                | 3,042  |
| 08:20:28          | rake to the union                                             | 198    |

The display: with 41 paid entries (40 players + 1 rebuy) the stored prize pool was 41 x 27 = 1,107 plus the 1,338 start overlay = **2,445**. It was the advertised guarantee's start-time top-up stacked on collected money, sized on six entries and on the net 27, not an overpayment to any wallet. No player was overpaid: the overlay was returned before payouts, and the event finished with C = 3,240 gross (1,800 + 120 + 60 + 1,260), H = 0, prizes 3,042 + rake 198 = 3,240.

At the moment of the screenshot the correct figures were: gross credited 41 x 30 = 1,230; regular prize funded 1,107; rake 123; house funding pending H = 1,500 - 1,230 = 270; projected prize money 1,107 + 270 = 1,377.

## What Changed

- Migration `20261105222502_a_buyin_guarantee_counts_the_whole_player_payment.sql`:
  `fn_ca_guarantee_funding(uuid)` reads C (wallet buy-ins, rebuys, add-ons, satellite seats, redeemed tickets, at full charge, minus refunds) and P (overlay and promo funding posted, net of returns) from the event's own ledger; `fn_ca_guarantee_place_floor` = prize pool + max(0, max(0, G - C) - P). The close-out core, its atomic proof, both place settlements, both final-table deal paths, the completion guard, the shortfall reader, the legacy back-pay writer and the two settlement detectors now read that floor instead of G - bounty_pool. Diamond events keep their own book. `fn_ca_tournament_prize_funding` also returns gross_coverage, house_required, house_posted and house_due.
- Client: `guaranteeShortfall`, `displayTotalPool` and `effectivePrizePool` count rake as guarantee credit and never stack the guarantee on collected money; the lobby card, lobby panel, info panel, detail, ranking, rewards, break screen and XMTT pages pass the live `total_rake` and `prize_pool_finalized`. Rewards shows "Credited Toward The Guarantee" (gross) and the house share as one total.

## Historical Correction Manifest (Completed Guaranteed MTTs Since 2026-10-01)

1,597 completed guaranteed chip MTTs read. 166 carry house funding above max(0, G - C), 10,575.55 chips in all; none is below it. Every one is completed and paid to players: under the standing rule nothing is taken back from a player for a platform defect, so no money moves. Columns: start date, event, name, G, C (gross), H = max(0, G - C), P (house funding posted, net).

| Date       | Event    | Name                                       | G       | C       | H       | P       |
| ---------- | -------- | ------------------------------------------ | ------- | ------- | ------- | ------- |
| 2026-10-01 | ad478944 | Prime Time Free Buy (NLH)                  | 500.00  | 12.00   | 488.00  | 500.00  |
| 2026-10-01 | 20f237a9 | Midweek Bounty                             | 350.00  | 240.00  | 110.00  | 194.00  |
| 2026-10-01 | 7e6c8489 | Wednesday Feature                          | 750.00  | 320.00  | 430.00  | 462.00  |
| 2026-10-01 | 5f76f4aa | Midweek Mystery                            | 600.00  | 60.00   | 540.00  | 570.00  |
| 2026-10-01 | 29ea2c47 | $100 Freeroll 12:00 AM                     | 100.00  | 10.00   | 90.00   | 100.00  |
| 2026-10-01 | e595669d | Midnight Free Buy (NLH)                    | 250.00  | 7.00    | 243.00  | 250.00  |
| 2026-10-01 | 13d342b9 | Sunrise Bounty (NLH)                       | 90.00   | 145.00  | 0       | 3.00    |
| 2026-10-01 | c21cacad | $100 Freeroll 6:00 AM                      | 100.00  | 67.00   | 33.00   | 100.00  |
| 2026-10-01 | 8e460304 | $100 Freeroll 6:00 AM                      | 100.00  | 5.00    | 95.00   | 100.00  |
| 2026-10-01 | 49cffcc3 | Morning Free Buy (NLH)                     | 250.00  | 5.00    | 245.00  | 250.00  |
| 2026-10-01 | 91de7c48 | Morning Free Buy (NLH)                     | 250.00  | 5.00    | 245.00  | 250.00  |
| 2026-10-01 | 527f869e | DSS Thursday $100 Freeroll 10 AM CT        | 100.00  | 8.00    | 92.00   | 100.00  |
| 2026-10-01 | f7297cb5 | $100 Freeroll 12:00 PM                     | 100.00  | 5.00    | 95.00   | 100.00  |
| 2026-10-01 | 32375574 | Midday Free Buy (NLH)                      | 250.00  | 4.00    | 246.00  | 250.00  |
| 2026-10-01 | e604d224 | $100 Freeroll 12:00 PM                     | 100.00  | 5.00    | 95.00   | 100.00  |
| 2026-10-01 | 9fee5704 | DSS Thursday $100 Turbo Freeroll 1 PM CT   | 100.00  | 10.00   | 90.00   | 100.00  |
| 2026-10-01 | a21f7007 | Five-Card Reload                           | 250.00  | 270.00  | 0       | 7.00    |
| 2026-10-01 | 3414f268 | DSS Thursday $100 PLO4 Freeroll 4 PM CT    | 100.00  | 6.00    | 94.00   | 100.00  |
| 2026-10-01 | 33e0ec87 | Afternoon Free Buy (NLH)                   | 250.00  | 11.00   | 239.00  | 250.00  |
| 2026-10-01 | 69b14087 | $100 Freeroll 6:00 PM                      | 100.00  | 34.00   | 66.00   | 100.00  |
| 2026-10-01 | e7e91739 | $100 Freeroll 6:00 PM                      | 100.00  | 8.00    | 92.00   | 100.00  |
| 2026-10-02 | 302e5fc1 | DSS Thursday $150 Evening Freeroll 7 PM CT | 150.00  | 5.00    | 145.00  | 150.00  |
| 2026-10-02 | 2af11204 | Omaha Thursday Opener                      | 300.00  | 300.00  | 0       | 30.00   |
| 2026-10-02 | c9761dac | Midnight Bounty (NLH)                      | 100.00  | 125.00  | 0       | 31.00   |
| 2026-10-02 | c4c11ef1 | Five-Card Bounty                           | 500.00  | 600.00  | 0       | 110.00  |
| 2026-10-02 | f296b405 | Five-Card Bounty                           | 500.00  | 585.00  | 0       | 119.75  |
| 2026-10-02 | 8267d0dd | Midnight Bounty (NLH)                      | 100.00  | 135.00  | 0       | 19.00   |
| 2026-10-02 | 549e1066 | Six-Card Feature                           | 600.00  | 560.00  | 40.00   | 96.00   |
| 2026-10-02 | d8a77448 | Pre-Dawn Mystery Bounty (PLO5)             | 80.00   | 135.00  | 0       | 12.50   |
| 2026-10-02 | b6dd93ee | Sunrise Bounty (NLH)                       | 90.00   | 105.00  | 0       | 27.00   |
| 2026-10-02 | f7cc9b28 | Friday Graveyard                           | 100.00  | 110.00  | 0       | 1.00    |
| 2026-10-02 | 1e23fd5b | Sunrise Bounty (NLH)                       | 90.00   | 130.00  | 0       | 12.00   |
| 2026-10-02 | deccbd20 | Brunch Special PKO (PLO8)                  | 180.00  | 260.00  | 0       | 76.00   |
| 2026-10-02 | bfb9fcf0 | Friday Morning PLO                         | 200.00  | 180.00  | 20.00   | 38.00   |
| 2026-10-02 | bcef92fb | Union PKO Afternoon (PLO4)                 | 600.00  | 1040.00 | 0       | 184.00  |
| 2026-10-02 | 62394661 | Afternoon Bounty (NLH)                     | 200.00  | 240.00  | 0       | 56.00   |
| 2026-10-02 | 08e44805 | Evening Mystery Bounty (PLO5)              | 400.00  | 540.00  | 0       | 130.00  |
| 2026-10-02 | 2fbb6051 | Union Mystery Bounty (PLO5)                | 800.00  | 1100.00 | 0       | 250.00  |
| 2026-10-02 | 63b60ab6 | Friday Rebuy Rush                          | 400.00  | 430.00  | 0       | 13.00   |
| 2026-10-02 | b5102d84 | Union Mystery Bounty (PLO5)                | 800.00  | 1575.00 | 0       | 12.50   |
| 2026-10-02 | af9deba5 | Night Owl Special (NLH)                    | 600.00  | 920.00  | 0       | 48.00   |
| 2026-10-02 | adc903f5 | Late Night PKO (PLO4)                      | 450.00  | 1120.00 | 0       | 2.00    |
| 2026-10-03 | 41657d32 | Friday Night Feature                       | 1500.00 | 1500.00 | 0       | 150.00  |
| 2026-10-03 | 553ca0f8 | Midday Free Buy (NLH)                      | 250.00  | 195.00  | 55.00   | 60.00   |
| 2026-10-03 | 2df1b40b | $100 Freeroll 12:00 PM                     | 100.00  | 22.00   | 78.00   | 78.30   |
| 2026-10-03 | 0e544043 | Midday Free Buy (NLH)                      | 250.00  | 19.00   | 231.00  | 231.60  |
| 2026-10-03 | 1572fe44 | Afternoon Free Buy (NLH)                   | 250.00  | 29.00   | 221.00  | 221.90  |
| 2026-10-03 | a9901ed2 | Afternoon Free Buy (NLH)                   | 250.00  | 224.00  | 26.00   | 32.90   |
| 2026-10-03 | 07bf5243 | DSS Saturday $100 PLO4 Freeroll 4 PM CT    | 100.00  | 11.00   | 89.00   | 89.30   |
| 2026-10-03 | 96642785 | $100 Freeroll 6:00 PM                      | 100.00  | 14.00   | 86.00   | 86.50   |
| 2026-10-04 | 128ea755 | DSS Saturday $150 Evening Freeroll 7 PM CT | 150.00  | 25.00   | 125.00  | 125.10  |
| 2026-10-04 | e4cc8aac | Prime Time Free Buy (NLH)                  | 500.00  | 62.00   | 438.00  | 439.80  |
| 2026-10-04 | bfcbea31 | $100 Freeroll 12:00 AM                     | 100.00  | 12.00   | 88.00   | 88.20   |
| 2026-10-04 | 29cb4af6 | Midnight Free Buy (NLH)                    | 250.00  | 32.00   | 218.00  | 218.80  |
| 2026-10-04 | 03ba4530 | $100 Freeroll 6:00 AM                      | 100.00  | 10.00   | 90.00   | 90.40   |
| 2026-10-04 | bc24431d | Morning Free Buy (NLH)                     | 250.00  | 34.00   | 216.00  | 217.20  |
| 2026-10-04 | e79b40ef | DSS Sunday $100 Freeroll 10 AM CT          | 100.00  | 28.00   | 72.00   | 72.50   |
| 2026-10-04 | 223d2fa1 | $100 Freeroll 12:00 PM                     | 100.00  | 10.00   | 90.00   | 90.10   |
| 2026-10-04 | c555b731 | Midday Free Buy (NLH)                      | 250.00  | 26.00   | 224.00  | 224.40  |
| 2026-10-04 | c90f8bb4 | Afternoon Free Buy (NLH)                   | 250.00  | 29.00   | 221.00  | 221.70  |
| 2026-10-04 | fd78e877 | DSS Sunday $100 PLO4 Freeroll 4 PM CT      | 100.00  | 27.00   | 73.00   | 73.30   |
| 2026-10-04 | f394e9ab | $100 Freeroll 6:00 PM                      | 100.00  | 19.00   | 81.00   | 81.50   |
| 2026-10-05 | 678a5f36 | DSS Sunday $150 Evening Freeroll 7 PM CT   | 150.00  | 26.00   | 124.00  | 124.20  |
| 2026-10-05 | 48e4d5bf | Prime Time Free Buy (NLH)                  | 500.00  | 48.00   | 452.00  | 452.40  |
| 2026-10-05 | 88663927 | $100 Freeroll 12:00 AM                     | 100.00  | 25.00   | 75.00   | 75.20   |
| 2026-10-05 | 713c8daf | $100 Freeroll 6:00 AM                      | 100.00  | 31.00   | 69.00   | 69.70   |
| 2026-10-05 | 0ac2ef5d | DSS Monday $100 Freeroll 10 AM CT          | 100.00  | 25.00   | 75.00   | 75.20   |
| 2026-10-05 | 04cb651a | Afternoon Bounty (NLH)                     | 200.00  | 270.00  | 0       | 38.00   |
| 2026-10-05 | 6185db05 | $100 Freeroll 12:00 PM                     | 100.00  | 31.00   | 69.00   | 69.70   |
| 2026-10-06 | cd400e60 | Coffee Break Freeroll (PLO4)               | 80.00   | 48.00   | 32.00   | 32.60   |
| 2026-10-06 | af73e82c | Midday Free Buy (NLH)                      | 250.00  | 147.00  | 103.00  | 104.70  |
| 2026-10-06 | cb4e4f4d | Coffee Break Freeroll (PLO4)               | 80.00   | 53.00   | 27.00   | 28.10   |
| 2026-10-06 | fcc41ba5 | Afternoon Free Buy (NLH)                   | 250.00  | 141.00  | 109.00  | 109.70  |
| 2026-10-06 | c2628a0b | Night Owl Special (NLH)                    | 600.00  | 920.00  | 0       | 48.00   |
| 2026-10-06 | 629a43bc | Late Night PKO (PLO4)                      | 450.00  | 800.00  | 0       | 130.00  |
| 2026-10-07 | 1d64b149 | Prime Time Free Buy (NLH)                  | 500.00  | 514.00  | 0       | 3.20    |
| 2026-10-09 | 1f9d2b46 | Midday Free Buy (NLH)                      | 250.00  | 258.00  | 0       | 2.80    |
| 2026-10-10 | c7abbd45 | Midnight Free Buy (NLH)                    | 250.00  | 255.00  | 0       | 6.20    |
| 2026-10-12 | 822172a6 | Midnight Bounty (NLH)                      | 100.00  | 150.00  | 0       | 10.00   |
| 2026-10-12 | dbd7c361 | Midnight Bounty (NLH)                      | 100.00  | 130.00  | 0       | 22.00   |
| 2026-10-13 | 6738ffa1 | Morning Free Buy (NLH)                     | 250.00  | 239.00  | 11.00   | 12.50   |
| 2026-10-16 | b651ec17 | Pre-Dawn Mystery Bounty (PLO5)             | 80.00   | 115.00  | 0       | 22.50   |
| 2026-10-17 | 7b66848b | Prime Time Free Buy (NLH)                  | 500.00  | 489.00  | 11.00   | 36.80   |
| 2026-10-18 | e13bc7c5 | Prime Time Free Buy (NLH)                  | 500.00  | 363.00  | 137.00  | 154.40  |
| 2026-10-19 | 43f5aa49 | Prime Time Free Buy (NLH)                  | 500.00  | 402.00  | 98.00   | 118.60  |
| 2026-10-19 | 05236455 | Coffee Break Freeroll (PLO4)               | 80.00   | 42.00   | 38.00   | 39.60   |
| 2026-10-19 | f3d4feb8 | Midday Free Buy (NLH)                      | 250.00  | 148.00  | 102.00  | 108.80  |
| 2026-10-19 | 19d8ba17 | Union Mystery Bounty (PLO5)                | 800.00  | 1475.00 | 0       | 62.50   |
| 2026-10-19 | 178af80d | Union Grand Championship (NLH)             | 2500.00 | 3650.00 | 0       | 310.00  |
| 2026-10-19 | a237bfa3 | Evening Mystery Bounty (PLO5)              | 400.00  | 690.00  | 0       | 55.00   |
| 2026-10-19 | 7301709b | Union Mystery Bounty (PLO5)                | 800.00  | 1300.00 | 0       | 150.00  |
| 2026-10-19 | 0e045868 | Evening Mystery Bounty (PLO5)              | 400.00  | 645.00  | 0       | 77.50   |
| 2026-10-19 | c3e44a68 | Union Grand Championship (NLH)             | 5000.00 | 6550.00 | 0       | 1070.00 |
| 2026-10-20 | fafef2ae | Prime Time Free Buy (NLH)                  | 500.00  | 414.00  | 86.00   | 107.30  |
| 2026-10-20 | dc07bc0f | Midnight Free Buy (NLH)                    | 500.00  | 469.00  | 31.00   | 56.20   |
| 2026-10-20 | 24efc4e9 | Morning Free Buy (NLH)                     | 500.00  | 433.00  | 67.00   | 90.70   |
| 2026-10-20 | e030484e | Coffee Break Freeroll (PLO4)               | 500.00  | 315.00  | 185.00  | 197.90  |
| 2026-10-20 | 997f69e4 | Coffee Break Freeroll (PLO4)               | 500.00  | 395.00  | 105.00  | 123.40  |
| 2026-10-20 | b99da71d | Midday Free Buy (NLH)                      | 500.00  | 399.00  | 101.00  | 121.80  |
| 2026-10-20 | 1c1a9d58 | Coffee Break Freeroll (PLO4)               | 500.00  | 255.00  | 245.00  | 254.50  |
| 2026-10-20 | 3fa1e6a8 | Afternoon Free Buy (NLH)                   | 500.00  | 415.00  | 85.00   | 108.20  |
| 2026-10-21 | 24e16bc3 | Prime Time Free Buy (NLH)                  | 1000.00 | 319.00  | 681.00  | 694.00  |
| 2026-10-21 | e530609a | Midnight Free Buy (NLH)                    | 500.00  | 412.00  | 88.00   | 105.10  |
| 2026-10-21 | 0f3af61a | Morning Free Buy (NLH)                     | 500.00  | 406.00  | 94.00   | 113.80  |
| 2026-10-21 | 196c02ad | Coffee Break Freeroll (PLO4)               | 500.00  | 384.00  | 116.00  | 134.30  |
| 2026-10-21 | 06a508b7 | Coffee Break Freeroll (PLO4)               | 500.00  | 489.00  | 11.00   | 38.40   |
| 2026-10-21 | c70157f2 | Midday Free Buy (NLH)                      | 500.00  | 396.00  | 104.00  | 119.80  |
| 2026-10-21 | 4fb75b0c | Coffee Break Freeroll (PLO4)               | 500.00  | 368.00  | 132.00  | 152.40  |
| 2026-10-21 | 48d2a79d | Afternoon Free Buy (NLH)                   | 500.00  | 397.00  | 103.00  | 122.80  |
| 2026-10-22 | 2873feca | Prime Time Free Buy (NLH)                  | 1000.00 | 308.00  | 692.00  | 707.40  |
| 2026-10-22 | 3a8ae8a5 | Midnight Free Buy (NLH)                    | 500.00  | 480.00  | 20.00   | 41.90   |
| 2026-10-22 | ead3a8cf | Morning Free Buy (NLH)                     | 500.00  | 386.00  | 114.00  | 134.50  |
| 2026-10-22 | f50f12a0 | Coffee Break Freeroll (PLO4)               | 500.00  | 443.00  | 57.00   | 85.20   |
| 2026-10-22 | f5a98d7e | Coffee Break Freeroll (PLO4)               | 500.00  | 435.00  | 65.00   | 92.20   |
| 2026-10-22 | 822a4c37 | Midday Free Buy (NLH)                      | 500.00  | 394.00  | 106.00  | 127.70  |
| 2026-10-22 | 065bf262 | Afternoon Free Buy (NLH)                   | 500.00  | 281.00  | 219.00  | 227.60  |
| 2026-10-23 | 5536c3b5 | Prime Time Free Buy (NLH)                  | 1000.00 | 321.00  | 679.00  | 692.70  |
| 2026-10-23 | 5b0e70a8 | Midnight Free Buy (NLH)                    | 500.00  | 335.00  | 165.00  | 175.60  |
| 2026-10-23 | 962a265d | Morning Free Buy (NLH)                     | 250.00  | 25.00   | 225.00  | 226.10  |
| 2026-10-23 | 12cd5817 | Friday Morning PLO                         | 500.00  | 150.00  | 350.00  | 365.00  |
| 2026-10-23 | f13a28e3 | Morning Grinder (PLO)                      | 500.00  | 115.00  | 385.00  | 392.00  |
| 2026-10-23 | bd1eebe2 | Mid-Morning Turbo (6-Max NLH)              | 500.00  | 320.00  | 180.00  | 199.00  |
| 2026-10-23 | fef7da2d | Brunch Special PKO (PLO8)                  | 500.00  | 390.00  | 110.00  | 344.00  |
| 2026-10-23 | d30818d3 | Midday Free Buy (NLH)                      | 500.00  | 408.00  | 92.00   | 104.20  |
| 2026-10-23 | 41b934e9 | Afternoon Free Buy (NLH)                   | 500.00  | 333.00  | 167.00  | 178.80  |
| 2026-10-24 | 0176c25a | Prime Time Free Buy (NLH)                  | 500.00  | 179.00  | 321.00  | 325.30  |
| 2026-10-24 | f10d3c18 | Morning Free Buy (NLH)                     | 250.00  | 221.00  | 29.00   | 39.20   |
| 2026-10-24 | 55dfe15c | Midday Free Buy (NLH)                      | 500.00  | 190.00  | 310.00  | 321.30  |
| 2026-10-24 | ffa057b0 | Evening Mystery Bounty (PLO5)              | 1000.00 | 1530.00 | 0       | 205.00  |
| 2026-10-24 | 27d762ea | Afternoon Free Buy (NLH)                   | 500.00  | 206.00  | 294.00  | 303.10  |
| 2026-10-25 | 185e2f35 | Prime Time Free Buy (NLH)                  | 500.00  | 360.00  | 140.00  | 153.40  |
| 2026-10-25 | 24d17778 | Midday Free Buy (NLH)                      | 500.00  | 280.00  | 220.00  | 236.10  |
| 2026-10-25 | b5bbd3d3 | Afternoon Free Buy (NLH)                   | 500.00  | 290.00  | 210.00  | 228.00  |
| 2026-10-26 | d5d373cb | Sunday Funday Mystery                      | 5000.00 | 9700.00 | 0       | 730.00  |
| 2026-10-26 | c2b5ede9 | Prime Time Free Buy (NLH)                  | 500.00  | 415.00  | 85.00   | 106.50  |
| 2026-10-26 | c0dc9310 | Midday Free Buy (NLH)                      | 500.00  | 350.00  | 150.00  | 163.60  |
| 2026-10-26 | 48a3c576 | Afternoon Free Buy (NLH)                   | 500.00  | 321.00  | 179.00  | 191.40  |
| 2026-10-27 | 20f2524b | Prime Time Free Buy (NLH)                  | 500.00  | 341.00  | 159.00  | 173.10  |
| 2026-10-27 | a1573714 | Midday Free Buy (NLH)                      | 500.00  | 497.00  | 3.00    | 21.30   |
| 2026-10-27 | c5866080 | Afternoon Free Buy (NLH)                   | 500.00  | 194.00  | 306.00  | 312.00  |
| 2026-10-28 | 5889b234 | Prime Time Free Buy (NLH)                  | 500.00  | 112.00  | 388.00  | 392.60  |
| 2026-10-28 | c63ecd0f | Midday Free Buy (NLH)                      | 500.00  | 322.00  | 178.00  | 191.10  |
| 2026-10-28 | e2d8d5c0 | Afternoon Free Buy (NLH)                   | 500.00  | 117.00  | 383.00  | 388.10  |
| 2026-10-29 | a70c1028 | 40 Chip Bounty Freezeout - 5K GTD (NLH)    | 5000.00 | 5800.00 | 0       | 1230.00 |
| 2026-10-29 | a3a99927 | Prime Time Free Buy (NLH)                  | 500.00  | 94.00   | 406.00  | 410.10  |
| 2026-10-29 | f499dd7e | Morning Free Buy (NLH)                     | 250.00  | 214.00  | 36.00   | 44.30   |
| 2026-10-29 | d4b6204c | 40 Chip Freezeout - 5K GTD (NLH)           | 5000.00 | 5520.00 | 0       | 32.00   |
| 2026-10-31 | d4f6dbf8 | 40 Chip Bounty Freezeout - 5K GTD (NLH)    | 5000.00 | 5520.00 | 0       | 1412.00 |
| 2026-10-31 | 9d9233c2 | Prime Time Free Buy (NLH)                  | 500.00  | 90.00   | 410.00  | 412.60  |
| 2026-10-31 | d380a511 | Midday Free Buy (NLH)                      | 500.00  | 287.00  | 213.00  | 213.10  |
| 2026-10-31 | 7e6ec833 | 40 Chip Freezeout - 5K GTD (NLH)           | 5000.00 | 5440.00 | 0       | 104.00  |
| 2026-10-31 | 2aae42a7 | Afternoon Free Buy (NLH)                   | 500.00  | 70.00   | 430.00  | 432.50  |
| 2026-11-01 | c111d1cb | 40 Chip Bounty Freezeout - 5K GTD (NLH)    | 5000.00 | 5640.00 | 0       | 1334.00 |
| 2026-11-01 | e371d0d1 | Prime Time Free Buy (NLH)                  | 500.00  | 68.00   | 432.00  | 438.80  |
| 2026-11-01 | d687f54a | Midnight Free Buy (NLH)                    | 250.00  | 63.00   | 187.00  | 193.30  |
| 2026-11-01 | ab9bae8d | Morning Free Buy (NLH)                     | 250.00  | 47.00   | 203.00  | 207.70  |
| 2026-11-01 | 19831ca5 | Midday Free Buy (NLH)                      | 500.00  | 51.00   | 449.00  | 454.10  |
| 2026-11-01 | c27d6189 | Afternoon Free Buy (NLH)                   | 500.00  | 70.00   | 430.00  | 437.00  |
| 2026-11-02 | 6b72abc3 | 40 Chip Bounty Freezeout - 5K GTD (NLH)    | 5000.00 | 3800.00 | 1200.00 | 1580.00 |
| 2026-11-02 | ccfe06ae | Sunday Funday Mystery                      | 5000.00 | 7650.00 | 0       | 200.00  |
| 2026-11-02 | c23b46a9 | Prime Time Free Buy (NLH)                  | 500.00  | 100.00  | 400.00  | 410.00  |
| 2026-11-02 | 82067412 | Midnight Free Buy (NLH)                    | 250.00  | 102.00  | 148.00  | 158.20  |
| 2026-11-02 | 5dce7dd3 | Morning Free Buy (NLH)                     | 250.00  | 30.00   | 220.00  | 223.00  |
| 2026-11-02 | 2637de9d | 40 Chip Freezeout - 1.5K GTD (NLH)         | 1500.00 | 1600.00 | 0       | 60.00   |
| 2026-11-02 | baf48b99 | Midday Free Buy (NLH)                      | 500.00  | 71.00   | 429.00  | 436.10  |
| 2026-11-02 | 98e38de4 | Midday Turbo (NLH)                         | 250.00  | 260.00  | 0       | 15.00   |

No completed event since 2026-11-02 carries excess house funding: #9518 (2026-11-04) stopped the start-time overlay. The net-basis close-out this migration replaces was the remaining source.

## Guaranteed Free Buy Ticket Funding Is Part Of H

Migration `20261105225426_guaranteed_free_buy_ticket_funding_is_part_of_h.sql`: a guaranteed regular or all-in-or-fold Midway Free Buy posts one promo chip per first entry at registration. At finalization `fn_apply_prize_guarantee` now returns any promo above H = max(0, G - C) to the Midway promo wallet (one keyed reversal leg, escrow and pool in the finalization subtransaction), so total ticket and house funding equals H and is never a one-chip-per-ticket transfer on top of it. Owner example: G 500, 250 tickets, 160 player chips: promo 340, pool 500. A Free Buy without a guarantee keeps its voucher funding V.
