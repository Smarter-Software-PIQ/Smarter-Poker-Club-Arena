# tests/a-hand-records-which-horse-option-receipts-fired-in-it.law.test.ts

public.ca_horse_hand_receipts (one row per hand and Horse option receipt, for hands a person was dealt into) is created by one cheap transaction that locks no hot table (a new empty table only: no foreign key, trigger, function, index or install window), can store no card (the receipt text is an option name and two action words, enforced by a CHECK that every engine text passes), and is service-role insert-and-read only with RLS, no policy and no client, edge-function or later-migration reference.
