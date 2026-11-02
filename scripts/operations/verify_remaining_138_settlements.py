#!/usr/bin/env python3
"""Independent verifier for the remaining 138 assigned equal-share settlements (139 total including Proby).

Supports two verification modes:
  1. `preflight`: Verifies the pre-settlement cohort invariants across the 138 remaining events
     (123 Chip events + 15 Diamond events) and 139 total events (including Proby), keeping Chip
     and Diamond totals strictly separate, verifying the 1,436 active Diamond custody rows,
     prior earned awards (8,990 Diamonds + 285.31 Chips), prior 88 v2 Diamond cancellations
     (34,600 Diamonds refunded), closed Diamond Arena, and strict exclusion of event 16761305.
  2. `postsettle`: Independently reconciles all 138 remaining (and 139 total) equal-share
     settlements across receipt_version = 4 receipts, exact PostgreSQL numeric allocation_hash,
     Chip credit receipts/chip_ledger/wallet_transactions/tournament_payouts and rake settlements,
     Diamond ledger/arena_withdraw/custody drain/payouts, 25,642-Diamond fee burn and house mint,
     zero remaining custody across all 1,436 rows, zero open guarantee earmarks (preserving the 39
     existing earmark rows), preservation of prior awards and cancellations, aborted_unsettled
     original-hand dispositions, final native equal_ack runtime retirement, and strict exclusion
     of event 16761305.
"""

from __future__ import annotations

import argparse
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import sys
from typing import Any, Mapping, Sequence

PROBY_TOURNAMENT_ID = "2781bcd7-cc8a-4713-ab3e-0d0a81fdf110"
ORIGINAL89_OPERATION_ID = "d44c4440-2911-430c-8ee7-376611ef3f38"
EXCLUDED_MYSTERY_BOUNTY_ID = "16761305-83ad-4282-be72-5b9cb2dd88bc"
DIAMOND_ARENA_CLUB_ID = "002c2d27-9584-4e52-835a-bb2be148fc81"
DIAMOND_HOUSE_HOLDER_ID = "00000000-0000-0000-0000-00000000d1a0"
CHIP_UNION_ID = "fade0000-0000-0000-0000-000000000001"
EXPECTED_SETTLE_FUNCTION_MD5 = "ef3c8122a5fccc4f90630c1672080240"
DIAMOND_FREEBUY_ZERO_FEE_IDS = frozenset({
    "10146b16-aaac-4606-a2aa-7bbc3863b750",
    "6429087f-a9d1-49a3-b7cf-85e1ee283ac9",
    "78d24c32-683a-42fa-8d7a-b5cf6dadf251",
})

CANONICAL_139_MANIFEST: tuple[dict[str, Any], ...] = tuple([
    {
        "tournament_id": "0640f029-0372-4ca7-bb46-7cfd248da7b3",
        "operation_id": "28f18e0d-8342-5972-b75d-639450d43e26",
        "cohort_group": "frozen25",
        "asset": "chips",
        "name": "Sunday Deep Stack Satellite 30",
        "eligible_players": 7,
        "retained_seats": 7,
        "prize_balance": "396.00",
        "bounty_balance": "0.00",
        "fee_balance": "24.00"
    },
    {
        "tournament_id": "0771b01a-b8ea-434b-bf2e-f7d4651d445e",
        "operation_id": "05ad5e1e-deaf-5d53-ae7a-737e50f5cf3c",
        "cohort_group": "frozen25",
        "asset": "chips",
        "name": "Funday Six-Card Satellite 10",
        "eligible_players": 3,
        "retained_seats": 3,
        "prize_balance": "84.00",
        "bounty_balance": "0.00",
        "fee_balance": "6.00"
    },
    {
        "tournament_id": "161b65b2-a718-4fd7-9a6b-f60fbd77a40a",
        "operation_id": "98fc03ab-1650-5af8-a6da-3f8240b2168e",
        "cohort_group": "frozen25",
        "asset": "chips",
        "name": "Sunday Deep Stack Satellite 25",
        "eligible_players": 20,
        "retained_seats": 20,
        "prize_balance": "972.50",
        "bounty_balance": "0.00",
        "fee_balance": "52.50"
    },
    {
        "tournament_id": "1bd6558e-1964-41d9-9ceb-cb908fde6c1a",
        "operation_id": "8a8b58d1-7b46-57d5-bb30-10292463f10c",
        "cohort_group": "frozen25",
        "asset": "chips",
        "name": "Funday PLO High Roller Satellite 15",
        "eligible_players": 4,
        "retained_seats": 4,
        "prize_balance": "112.50",
        "bounty_balance": "0.00",
        "fee_balance": "7.50"
    },
    {
        "tournament_id": "261eacc5-a26b-40c8-a30e-1913ab6e5a9e",
        "operation_id": "b3d4680a-38ed-533f-8d12-bbcab9cb6d8f",
        "cohort_group": "frozen25",
        "asset": "chips",
        "name": "Funday PLO Classic Satellite 5",
        "eligible_players": 16,
        "retained_seats": 16,
        "prize_balance": "188.00",
        "bounty_balance": "0.00",
        "fee_balance": "12.00"
    },
    {
        "tournament_id": "2b654457-f2ef-42c8-b72a-1c8dbc8885d5",
        "operation_id": "a61c7dc5-3ea6-5285-85d6-17ecb797fea4",
        "cohort_group": "frozen25",
        "asset": "chips",
        "name": "Sunday Deep Stack Satellite 30",
        "eligible_players": 2,
        "retained_seats": 2,
        "prize_balance": "366.00",
        "bounty_balance": "0.00",
        "fee_balance": "24.00"
    },
    {
        "tournament_id": "354624e9-5f96-4baf-afe8-294c701f7b5e",
        "operation_id": "aad2cc6b-7fe5-5d3e-93de-60a82c67c50a",
        "cohort_group": "frozen25",
        "asset": "chips",
        "name": "Funday Main Event Satellite 15",
        "eligible_players": 8,
        "retained_seats": 8,
        "prize_balance": "108.00",
        "bounty_balance": "0.00",
        "fee_balance": "12.00"
    },
    {
        "tournament_id": "41392bff-72d7-46bb-b4ae-8f393d000810",
        "operation_id": "523de700-540d-5f44-b68c-1191f23c214a",
        "cohort_group": "frozen25",
        "asset": "chips",
        "name": "Funday Late PKO Satellite 10",
        "eligible_players": 5,
        "retained_seats": 5,
        "prize_balance": "59.00",
        "bounty_balance": "0.00",
        "fee_balance": "5.00"
    },
    {
        "tournament_id": "525a9726-68f5-4deb-8071-d62a9c6d9480",
        "operation_id": "cbb21fc2-2cd2-5ab8-9fca-06992d958af8",
        "cohort_group": "frozen25",
        "asset": "chips",
        "name": "Funday Big Stack Satellite 10",
        "eligible_players": 7,
        "retained_seats": 7,
        "prize_balance": "68.00",
        "bounty_balance": "0.00",
        "fee_balance": "7.00"
    },
    {
        "tournament_id": "54ca613b-0bd2-4492-8610-b1281dbaa822",
        "operation_id": "b8719110-10fe-552f-91dc-f5429711a8c1",
        "cohort_group": "frozen25",
        "asset": "chips",
        "name": "Funday PLO5 Satellite 5",
        "eligible_players": 7,
        "retained_seats": 7,
        "prize_balance": "31.50",
        "bounty_balance": "0.00",
        "fee_balance": "3.50"
    },
    {
        "tournament_id": "5c05942e-3eac-4f3b-90e5-1f25942a36ba",
        "operation_id": "290309a1-46db-5b0c-b2cf-b945708c5410",
        "cohort_group": "frozen25",
        "asset": "chips",
        "name": "Funday Mystery Satellite 10",
        "eligible_players": 6,
        "retained_seats": 6,
        "prize_balance": "94.00",
        "bounty_balance": "0.00",
        "fee_balance": "6.00"
    },
    {
        "tournament_id": "65cb94c0-752a-43b4-981d-098294d044f9",
        "operation_id": "51d8ce37-55a4-5a6c-96ec-4d729dc85fea",
        "cohort_group": "frozen25",
        "asset": "chips",
        "name": "Funday Bounty Builder Satellite 10",
        "eligible_players": 4,
        "retained_seats": 4,
        "prize_balance": "50.00",
        "bounty_balance": "0.00",
        "fee_balance": "4.00"
    },
    {
        "tournament_id": "6a0cbe20-8139-4c73-90d0-a038c5095387",
        "operation_id": "7d1c98ab-1341-5a88-80df-611e522e1989",
        "cohort_group": "frozen25",
        "asset": "chips",
        "name": "Funday PLO Opener Satellite 5",
        "eligible_players": 4,
        "retained_seats": 4,
        "prize_balance": "30.00",
        "bounty_balance": "0.00",
        "fee_balance": "2.00"
    },
    {
        "tournament_id": "73ad085c-0598-4202-84fc-27d30604d134",
        "operation_id": "623599db-a65a-577b-9cc7-d9e9fbbe3093",
        "cohort_group": "frozen25",
        "asset": "chips",
        "name": "Funday Warm-Up Satellite 10",
        "eligible_players": 3,
        "retained_seats": 3,
        "prize_balance": "56.00",
        "bounty_balance": "0.00",
        "fee_balance": "4.00"
    },
    {
        "tournament_id": "94eefeb1-5435-4fdd-b601-dbd7938bfd82",
        "operation_id": "3a6b6a99-af9a-580e-9eb4-075ef4bc369d",
        "cohort_group": "frozen25",
        "asset": "chips",
        "name": "40 Chip Freezeout - 5K GTD (NLH) 9-Max SNG Satellite",
        "eligible_players": 3,
        "retained_seats": 3,
        "prize_balance": "97.20",
        "bounty_balance": "0.00",
        "fee_balance": "10.80"
    },
    {
        "tournament_id": "9e527f7b-d2b5-499c-a0c1-0720e5e29369",
        "operation_id": "98414b46-ecfe-521c-b5a8-b592c2593e0e",
        "cohort_group": "frozen25",
        "asset": "chips",
        "name": "Funday Six-Max Satellite 5",
        "eligible_players": 7,
        "retained_seats": 7,
        "prize_balance": "66.00",
        "bounty_balance": "0.00",
        "fee_balance": "4.00"
    },
    {
        "tournament_id": "aa8e9409-8385-4a8d-9607-9bbc00769f97",
        "operation_id": "6afcf4ca-d8ec-542a-88ba-1dc5a6fdfa80",
        "cohort_group": "frozen25",
        "asset": "chips",
        "name": "Funday Turbo Satellite 5",
        "eligible_players": 15,
        "retained_seats": 15,
        "prize_balance": "136.00",
        "bounty_balance": "0.00",
        "fee_balance": "9.00"
    },
    {
        "tournament_id": "bc8b63f8-5d0b-46c3-9693-e80174d42934",
        "operation_id": "06f1f061-80ba-568c-9d80-5f0fa1f05e52",
        "cohort_group": "frozen25",
        "asset": "chips",
        "name": "Funday Main Event Satellite 15",
        "eligible_players": 4,
        "retained_seats": 4,
        "prize_balance": "198.00",
        "bounty_balance": "0.00",
        "fee_balance": "12.00"
    },
    {
        "tournament_id": "cc64ed2b-90d3-4e8e-bb00-006c6d5e964f",
        "operation_id": "a93e6bd1-9a09-520e-8aea-3e0a99206f2e",
        "cohort_group": "frozen25",
        "asset": "chips",
        "name": "Funday Championship Satellite 10",
        "eligible_players": 7,
        "retained_seats": 7,
        "prize_balance": "102.00",
        "bounty_balance": "0.00",
        "fee_balance": "7.00"
    },
    {
        "tournament_id": "d58470df-498c-42d0-b5d4-9d7cb5b7828a",
        "operation_id": "b7194d26-6005-5b1b-bab0-8ea363436310",
        "cohort_group": "frozen25",
        "asset": "chips",
        "name": "Funday Prime Time Satellite 10",
        "eligible_players": 7,
        "retained_seats": 7,
        "prize_balance": "113.00",
        "bounty_balance": "0.00",
        "fee_balance": "7.00"
    },
    {
        "tournament_id": "de73adfa-bce1-4ac4-8eb6-aa8bc65631af",
        "operation_id": "449d2c00-b316-5fe3-bcb0-f4448fe873b2",
        "cohort_group": "frozen25",
        "asset": "chips",
        "name": "Sunday Funday Late PKO 9-Max SNG Satellite",
        "eligible_players": 9,
        "retained_seats": 9,
        "prize_balance": "121.50",
        "bounty_balance": "0.00",
        "fee_balance": "13.50"
    },
    {
        "tournament_id": "e408f603-5364-44b0-80aa-5dd6a917e47a",
        "operation_id": "cb1c76c5-b892-558d-b252-aa73be875782",
        "cohort_group": "frozen25",
        "asset": "chips",
        "name": "Sunday Deep Stack Satellite 30",
        "eligible_players": 15,
        "retained_seats": 15,
        "prize_balance": "1020.00",
        "bounty_balance": "0.00",
        "fee_balance": "60.00"
    },
    {
        "tournament_id": "eeed2c77-f292-4e09-a0db-dbe544c115f7",
        "operation_id": "934a754f-a963-596f-ac48-c2f0e3c5d7a5",
        "cohort_group": "frozen25",
        "asset": "chips",
        "name": "Sunday Funday PLO5 Mystery 6-Max SNG Satellite",
        "eligible_players": 4,
        "retained_seats": 4,
        "prize_balance": "124.20",
        "bounty_balance": "0.00",
        "fee_balance": "13.80"
    },
    {
        "tournament_id": "f18c199d-69e7-4c51-9f7b-c121cdacbebc",
        "operation_id": "12ce2b71-2b98-5264-b3dc-22c9cf4259b6",
        "cohort_group": "frozen25",
        "asset": "chips",
        "name": "40 Chip Freezeout - 2.5K GTD (NLH) Satellite 5",
        "eligible_players": 5,
        "retained_seats": 5,
        "prize_balance": "40.50",
        "bounty_balance": "0.00",
        "fee_balance": "4.50"
    },
    {
        "tournament_id": "f2c1265c-85f4-487c-b3f2-65984da196d7",
        "operation_id": "52934901-0961-55e9-93a6-c2335483d572",
        "cohort_group": "frozen25",
        "asset": "chips",
        "name": "Sunday Deep Stack Satellite 30",
        "eligible_players": 7,
        "retained_seats": 7,
        "prize_balance": "216.00",
        "bounty_balance": "0.00",
        "fee_balance": "24.00"
    },
    {
        "tournament_id": "095d7449-3282-46c5-8a39-768fe14dce5a",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Union Grand Championship (NLH) 9-Max SNG Satellite",
        "eligible_players": 9,
        "retained_seats": 9,
        "prize_balance": "121.50",
        "bounty_balance": "0.00",
        "fee_balance": "13.50"
    },
    {
        "tournament_id": "0cb8e80f-4031-4b72-bbd6-f076605f1575",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Union Grand Championship (NLH) 9-Max SNG Satellite",
        "eligible_players": 9,
        "retained_seats": 9,
        "prize_balance": "121.50",
        "bounty_balance": "0.00",
        "fee_balance": "13.50"
    },
    {
        "tournament_id": "0d98f87e-65bb-483c-b34d-0cc6af4a4e29",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "diamonds",
        "name": "Sunday Deep Stack Satellite 30",
        "eligible_players": 7,
        "retained_seats": 7,
        "prize_balance": "2160",
        "bounty_balance": "0",
        "fee_balance": "240"
    },
    {
        "tournament_id": "0ef3dbfb-c092-4008-b7bd-bde65a474e83",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Prime Time Main Event (NLH) 9-Max SNG Satellite",
        "eligible_players": 8,
        "retained_seats": 8,
        "prize_balance": "72.90",
        "bounty_balance": "0.00",
        "fee_balance": "8.10"
    },
    {
        "tournament_id": "10146b16-aaac-4606-a2aa-7bbc3863b750",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "diamonds",
        "name": "Midday Free Buy (NLH)",
        "eligible_players": 46,
        "retained_seats": 46,
        "prize_balance": "31010",
        "bounty_balance": "0",
        "fee_balance": "0"
    },
    {
        "tournament_id": "112ea67a-3885-4755-84cc-5f8523d3f82c",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "40 Chip Bounty Freezeout - 5K GTD (NLH) 9-Max SNG Satellite",
        "eligible_players": 7,
        "retained_seats": 7,
        "prize_balance": "97.20",
        "bounty_balance": "0.00",
        "fee_balance": "10.80"
    },
    {
        "tournament_id": "120ffb44-a3e6-4691-a52c-450768a09056",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Afternoon Free Buy (NLH)",
        "eligible_players": 19,
        "retained_seats": 19,
        "prize_balance": "490.35",
        "bounty_balance": "0.00",
        "fee_balance": "1.30"
    },
    {
        "tournament_id": "1294ab27-2191-484c-aa3e-98192de09e44",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Friday Fight Night Opener 9-Max SNG Satellite",
        "eligible_players": 9,
        "retained_seats": 9,
        "prize_balance": "72.90",
        "bounty_balance": "0.00",
        "fee_balance": "8.10"
    },
    {
        "tournament_id": "135b187e-c096-483a-b347-10be69df956b",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "40 Chip Freezeout - 5K GTD (NLH) 9-Max SNG Satellite",
        "eligible_players": 9,
        "retained_seats": 9,
        "prize_balance": "97.20",
        "bounty_balance": "0.00",
        "fee_balance": "10.80"
    },
    {
        "tournament_id": "15202cb0-648c-4583-a6f9-9512a6e678c6",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "40 Chip Bounty Freezeout - 5K GTD (NLH) 9-Max SNG Satellite",
        "eligible_players": 3,
        "retained_seats": 3,
        "prize_balance": "97.20",
        "bounty_balance": "0.00",
        "fee_balance": "10.80"
    },
    {
        "tournament_id": "19349646-5d29-4e79-a65d-c01be5c0a7e6",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Sunday Deep Stack Satellite 25",
        "eligible_players": 4,
        "retained_seats": 4,
        "prize_balance": "600.00",
        "bounty_balance": "0.00",
        "fee_balance": "10.00"
    },
    {
        "tournament_id": "197ed0bd-8fdb-4897-b001-dfe902139f9c",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Saturday Stackfest PKO 9-Max SNG Satellite",
        "eligible_players": 9,
        "retained_seats": 9,
        "prize_balance": "72.90",
        "bounty_balance": "0.00",
        "fee_balance": "8.10"
    },
    {
        "tournament_id": "19cf1192-d926-4042-a13c-67eca5ebf9a3",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Saturday Night Big Stack 9-Max SNG Satellite",
        "eligible_players": 7,
        "retained_seats": 7,
        "prize_balance": "121.50",
        "bounty_balance": "0.00",
        "fee_balance": "13.50"
    },
    {
        "tournament_id": "2305ddd2-58af-43fb-9089-567108e4ca77",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Nightly 10K (NLH) 9-Max SNG Satellite",
        "eligible_players": 9,
        "retained_seats": 9,
        "prize_balance": "81.00",
        "bounty_balance": "0.00",
        "fee_balance": "9.00"
    },
    {
        "tournament_id": "26ebb662-63bf-4bc5-9ac8-962bc5ad8849",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "diamonds",
        "name": "Prime Time Satellite 3",
        "eligible_players": 4,
        "retained_seats": 4,
        "prize_balance": "300",
        "bounty_balance": "0",
        "fee_balance": "12"
    },
    {
        "tournament_id": "2781bcd7-cc8a-4713-ab3e-0d0a81fdf110",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "25 Chip Daily Rebuy (NLH) Satellite 5",
        "eligible_players": 6,
        "retained_seats": 6,
        "prize_balance": "31.50",
        "bounty_balance": "0.00",
        "fee_balance": "3.50"
    },
    {
        "tournament_id": "27b49998-863d-44f7-8f11-f38d4de476b8",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Sunday Deep Stack Satellite 30",
        "eligible_players": 8,
        "retained_seats": 8,
        "prize_balance": "396.00",
        "bounty_balance": "0.00",
        "fee_balance": "24.00"
    },
    {
        "tournament_id": "30bac12f-028e-4d05-841a-9c900c779850",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Prime Time Satellite 10",
        "eligible_players": 4,
        "retained_seats": 4,
        "prize_balance": "56.00",
        "bounty_balance": "0.00",
        "fee_balance": "4.00"
    },
    {
        "tournament_id": "369d46bd-1eba-44bf-a80f-fb19ec980614",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "diamonds",
        "name": "Prime Time Satellite 10",
        "eligible_players": 2,
        "retained_seats": 2,
        "prize_balance": "360",
        "bounty_balance": "0",
        "fee_balance": "40"
    },
    {
        "tournament_id": "3859e739-513e-4ed5-af23-5a190aa40f46",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "25 Chip Daily Rebuy (NLH) 9-Max SNG Satellite",
        "eligible_players": 9,
        "retained_seats": 9,
        "prize_balance": "64.80",
        "bounty_balance": "0.00",
        "fee_balance": "7.20"
    },
    {
        "tournament_id": "4163a647-780e-4a5e-910f-ccc0fe5cf218",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Thursday Six-Card Satellite 5",
        "eligible_players": 4,
        "retained_seats": 4,
        "prize_balance": "38.00",
        "bounty_balance": "0.00",
        "fee_balance": "2.00"
    },
    {
        "tournament_id": "45072749-ed7a-4e27-9891-f21cdd44a20a",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Prime Time Satellite 3",
        "eligible_players": 3,
        "retained_seats": 3,
        "prize_balance": "30.00",
        "bounty_balance": "0.00",
        "fee_balance": "1.20"
    },
    {
        "tournament_id": "46ba2e7c-c9f8-42b6-b416-d7342a676531",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "40 Chip Freezeout - 2.5K GTD (NLH) 9-Max SNG Satellite",
        "eligible_players": 8,
        "retained_seats": 8,
        "prize_balance": "97.20",
        "bounty_balance": "0.00",
        "fee_balance": "10.80"
    },
    {
        "tournament_id": "4b7f3840-cc55-49b7-acd0-57216a89d044",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "25 Chip Daily Rebuy (NLH) 9-Max SNG Satellite",
        "eligible_players": 4,
        "retained_seats": 4,
        "prize_balance": "64.80",
        "bounty_balance": "0.00",
        "fee_balance": "7.20"
    },
    {
        "tournament_id": "4d88fc8c-a6d7-4e93-8cb6-ac45acb4e35d",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "25 Chip Daily Rebuy (NLH) 9-Max SNG Satellite",
        "eligible_players": 7,
        "retained_seats": 7,
        "prize_balance": "64.80",
        "bounty_balance": "0.00",
        "fee_balance": "7.20"
    },
    {
        "tournament_id": "4dfe400c-c942-41df-9e6b-bbd8336c9cf7",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Saturday Mystery 9-Max SNG Satellite",
        "eligible_players": 6,
        "retained_seats": 6,
        "prize_balance": "72.90",
        "bounty_balance": "0.00",
        "fee_balance": "8.10"
    },
    {
        "tournament_id": "4e2cc712-8773-4d00-8927-6319153bddf4",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "25 Chip Daily Rebuy (NLH) 9-Max SNG Satellite",
        "eligible_players": 6,
        "retained_seats": 6,
        "prize_balance": "64.80",
        "bounty_balance": "0.00",
        "fee_balance": "7.20"
    },
    {
        "tournament_id": "551125c0-4129-4f28-b174-caedb576cd99",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "40 Chip Freezeout - 5K GTD (NLH) 9-Max SNG Satellite",
        "eligible_players": 4,
        "retained_seats": 4,
        "prize_balance": "97.20",
        "bounty_balance": "0.00",
        "fee_balance": "10.80"
    },
    {
        "tournament_id": "5638ff13-7d12-4a54-b784-4f309792db60",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Prime Time Main Event (NLH) 9-Max SNG Satellite",
        "eligible_players": 7,
        "retained_seats": 7,
        "prize_balance": "72.90",
        "bounty_balance": "0.00",
        "fee_balance": "8.10"
    },
    {
        "tournament_id": "5a3e686c-8a9e-4c7c-b2c3-829c6a1ce096",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Prime Time Main Event (NLH) 9-Max SNG Satellite",
        "eligible_players": 5,
        "retained_seats": 5,
        "prize_balance": "72.90",
        "bounty_balance": "0.00",
        "fee_balance": "8.10"
    },
    {
        "tournament_id": "5ef9868a-03d3-4d3b-bc92-41c63bd8b10c",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "40 Chip Bounty Freezeout - 5K GTD (NLH) 9-Max SNG Satellite",
        "eligible_players": 9,
        "retained_seats": 9,
        "prize_balance": "97.20",
        "bounty_balance": "0.00",
        "fee_balance": "10.80"
    },
    {
        "tournament_id": "6379b29e-1307-4e8b-91e7-e9a0975cd64d",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Midday Free Buy (NLH)",
        "eligible_players": 19,
        "retained_seats": 19,
        "prize_balance": "369.95",
        "bounty_balance": "0.00",
        "fee_balance": "3.80"
    },
    {
        "tournament_id": "6429087f-a9d1-49a3-b7cf-85e1ee283ac9",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "diamonds",
        "name": "Midnight Free Buy (NLH)",
        "eligible_players": 37,
        "retained_seats": 37,
        "prize_balance": "11200",
        "bounty_balance": "0",
        "fee_balance": "0"
    },
    {
        "tournament_id": "64599cc4-03bb-4f1d-8df7-ef610abe10af",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Nightly 10K (NLH) 9-Max SNG Satellite",
        "eligible_players": 9,
        "retained_seats": 9,
        "prize_balance": "81.00",
        "bounty_balance": "0.00",
        "fee_balance": "9.00"
    },
    {
        "tournament_id": "68af0f95-82f5-4047-b424-6780a4236f4d",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Omaha Thursday Graveyard",
        "eligible_players": 90,
        "retained_seats": 90,
        "prize_balance": "923.00",
        "bounty_balance": "0.00",
        "fee_balance": "57.00"
    },
    {
        "tournament_id": "6acde8fb-5631-4320-965d-bf9dbf01c4d8",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "PLO5 Mystery Bounty Satellite 5",
        "eligible_players": 4,
        "retained_seats": 4,
        "prize_balance": "33.00",
        "bounty_balance": "0.00",
        "fee_balance": "2.00"
    },
    {
        "tournament_id": "6c6724e5-1ee4-40c0-ad21-44e9f9b6d800",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Prime Time Main Event (NLH) 9-Max SNG Satellite",
        "eligible_players": 9,
        "retained_seats": 9,
        "prize_balance": "72.90",
        "bounty_balance": "0.00",
        "fee_balance": "8.10"
    },
    {
        "tournament_id": "6d047305-e5ac-4200-803f-399c83cf76f3",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Sunday 200 Deep Stack 9-Max SNG Satellite",
        "eligible_players": 3,
        "retained_seats": 3,
        "prize_balance": "461.70",
        "bounty_balance": "0.00",
        "fee_balance": "51.30"
    },
    {
        "tournament_id": "6f25fd3f-b96a-40be-b32b-e9f8a39c22e8",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Saturday Stackfest PKO 9-Max SNG Satellite",
        "eligible_players": 8,
        "retained_seats": 8,
        "prize_balance": "72.90",
        "bounty_balance": "0.00",
        "fee_balance": "8.10"
    },
    {
        "tournament_id": "768cb55b-e915-4a01-9c74-f97535f700a3",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "25 Chip Daily Rebuy (NLH) 9-Max SNG Satellite",
        "eligible_players": 9,
        "retained_seats": 9,
        "prize_balance": "64.80",
        "bounty_balance": "0.00",
        "fee_balance": "7.20"
    },
    {
        "tournament_id": "7850aedc-640b-4905-b9e1-61d75d9543d0",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "40 Chip Freezeout - 2.5K GTD (NLH) 9-Max SNG Satellite",
        "eligible_players": 3,
        "retained_seats": 3,
        "prize_balance": "97.20",
        "bounty_balance": "0.00",
        "fee_balance": "10.80"
    },
    {
        "tournament_id": "78ed8458-4ffd-416a-a8fd-d0f0c5e3509e",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Six-Card Feature 6-Max SNG Satellite",
        "eligible_players": 3,
        "retained_seats": 3,
        "prize_balance": "75.60",
        "bounty_balance": "0.00",
        "fee_balance": "8.40"
    },
    {
        "tournament_id": "7932d2bb-7cfb-4b0e-ae99-75fcbae82d52",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Union Grand Championship (NLH) 9-Max SNG Satellite",
        "eligible_players": 9,
        "retained_seats": 9,
        "prize_balance": "121.50",
        "bounty_balance": "0.00",
        "fee_balance": "13.50"
    },
    {
        "tournament_id": "7986217a-0a67-4585-bd43-254356a9cb54",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Midnight Free Buy (NLH)",
        "eligible_players": 19,
        "retained_seats": 19,
        "prize_balance": "236.60",
        "bounty_balance": "0.00",
        "fee_balance": "1.80"
    },
    {
        "tournament_id": "7ab02286-fa29-44a2-a64f-0cb3d60ca572",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Saturday Mystery 9-Max SNG Satellite",
        "eligible_players": 9,
        "retained_seats": 9,
        "prize_balance": "72.90",
        "bounty_balance": "0.00",
        "fee_balance": "8.10"
    },
    {
        "tournament_id": "7de6c45c-ac37-4c32-a22a-4faea11d6cfa",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Nightly 10K (NLH) 9-Max SNG Satellite",
        "eligible_players": 4,
        "retained_seats": 4,
        "prize_balance": "81.00",
        "bounty_balance": "0.00",
        "fee_balance": "9.00"
    },
    {
        "tournament_id": "80861496-ee6c-498e-bae4-4d6acd8381c2",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "40 Chip Bounty Freezeout - 5K GTD (NLH) 9-Max SNG Satellite",
        "eligible_players": 3,
        "retained_seats": 3,
        "prize_balance": "97.20",
        "bounty_balance": "0.00",
        "fee_balance": "10.80"
    },
    {
        "tournament_id": "8229a0af-3c5a-4672-b9df-3d8523613086",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "40 Chip Freezeout - 2.5K GTD (NLH) 9-Max SNG Satellite",
        "eligible_players": 9,
        "retained_seats": 9,
        "prize_balance": "97.20",
        "bounty_balance": "0.00",
        "fee_balance": "10.80"
    },
    {
        "tournament_id": "85bec2f4-0aa8-42b8-8799-d9d3acff2275",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Nightly 10K (NLH) 9-Max SNG Satellite",
        "eligible_players": 5,
        "retained_seats": 5,
        "prize_balance": "81.00",
        "bounty_balance": "0.00",
        "fee_balance": "9.00"
    },
    {
        "tournament_id": "8855c50e-c4ed-4235-91c1-323627023b15",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "40 Chip Bounty Freezeout - 5K GTD (NLH) 9-Max SNG Satellite",
        "eligible_players": 9,
        "retained_seats": 9,
        "prize_balance": "97.20",
        "bounty_balance": "0.00",
        "fee_balance": "10.80"
    },
    {
        "tournament_id": "8aae8210-0444-455f-97f6-19a3a072eda0",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "40 Chip Freezeout - 5K GTD (NLH) 9-Max SNG Satellite",
        "eligible_players": 4,
        "retained_seats": 4,
        "prize_balance": "97.20",
        "bounty_balance": "0.00",
        "fee_balance": "10.80"
    },
    {
        "tournament_id": "8d8a5ecf-29c6-49e7-82fa-3109b6681fb6",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Friday Five-Card Bounty 6-Max SNG Satellite",
        "eligible_players": 5,
        "retained_seats": 5,
        "prize_balance": "75.60",
        "bounty_balance": "0.00",
        "fee_balance": "8.40"
    },
    {
        "tournament_id": "90fc40a9-0f76-4835-a1e9-5c487f32b2c8",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Friday Night Feature 9-Max SNG Satellite",
        "eligible_players": 8,
        "retained_seats": 8,
        "prize_balance": "72.90",
        "bounty_balance": "0.00",
        "fee_balance": "8.10"
    },
    {
        "tournament_id": "928dc47d-14b8-4721-9990-a5ccfd57a41e",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "diamonds",
        "name": "Nightly 10K Satellite 15",
        "eligible_players": 3,
        "retained_seats": 3,
        "prize_balance": "540",
        "bounty_balance": "0",
        "fee_balance": "60"
    },
    {
        "tournament_id": "94beb183-6b2a-4dbf-b1ea-556bf9681124",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "40 Chip Freezeout - 2.5K GTD (NLH) 9-Max SNG Satellite",
        "eligible_players": 3,
        "retained_seats": 3,
        "prize_balance": "97.20",
        "bounty_balance": "0.00",
        "fee_balance": "10.80"
    },
    {
        "tournament_id": "95760eed-827d-4502-8be6-cfb8ec610e1b",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Sunday 200 Deep Stack 9-Max SNG Satellite",
        "eligible_players": 9,
        "retained_seats": 9,
        "prize_balance": "461.70",
        "bounty_balance": "0.00",
        "fee_balance": "51.30"
    },
    {
        "tournament_id": "962cb5ce-3255-4ac3-9672-769752b4d169",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Nightly 10K (NLH) 9-Max SNG Satellite",
        "eligible_players": 4,
        "retained_seats": 4,
        "prize_balance": "81.00",
        "bounty_balance": "0.00",
        "fee_balance": "9.00"
    },
    {
        "tournament_id": "9b0e7b08-17ad-46ad-be00-9745f788cdd3",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Friday Five-Card Bounty 6-Max SNG Satellite",
        "eligible_players": 3,
        "retained_seats": 3,
        "prize_balance": "75.60",
        "bounty_balance": "0.00",
        "fee_balance": "8.40"
    },
    {
        "tournament_id": "9b23a2ec-d514-457f-ac61-fc80722068ad",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "40 Chip Freezeout - 2.5K GTD (NLH) 9-Max SNG Satellite",
        "eligible_players": 5,
        "retained_seats": 5,
        "prize_balance": "97.20",
        "bounty_balance": "0.00",
        "fee_balance": "10.80"
    },
    {
        "tournament_id": "a3e9d95e-9f0a-4b6b-9652-f6c697baadac",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Saturday Stackfest Opener 9-Max SNG Satellite",
        "eligible_players": 8,
        "retained_seats": 8,
        "prize_balance": "72.90",
        "bounty_balance": "0.00",
        "fee_balance": "8.10"
    },
    {
        "tournament_id": "b2870f16-db00-4820-a2d7-b5fc76e627ab",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Friday Night Feature 9-Max SNG Satellite",
        "eligible_players": 9,
        "retained_seats": 9,
        "prize_balance": "72.90",
        "bounty_balance": "0.00",
        "fee_balance": "8.10"
    },
    {
        "tournament_id": "b6435b76-7225-4d40-87fe-52f3a9d4521e",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Friday Five-Card Bounty 6-Max SNG Satellite",
        "eligible_players": 5,
        "retained_seats": 5,
        "prize_balance": "75.60",
        "bounty_balance": "0.00",
        "fee_balance": "8.40"
    },
    {
        "tournament_id": "b67b1975-f8cb-417b-87f9-9910c8290178",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Saturday Night Big Stack 9-Max SNG Satellite",
        "eligible_players": 3,
        "retained_seats": 3,
        "prize_balance": "121.50",
        "bounty_balance": "0.00",
        "fee_balance": "13.50"
    },
    {
        "tournament_id": "b8484257-68b3-4961-aad3-4b096bb7c7b5",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Nightly 10K Satellite 15",
        "eligible_players": 4,
        "retained_seats": 4,
        "prize_balance": "99.00",
        "bounty_balance": "0.00",
        "fee_balance": "6.00"
    },
    {
        "tournament_id": "bab7002d-4e6c-4845-a6e0-af16a35a70cc",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "40 Chip Freezeout - 2.5K GTD (NLH) 9-Max SNG Satellite",
        "eligible_players": 5,
        "retained_seats": 5,
        "prize_balance": "97.20",
        "bounty_balance": "0.00",
        "fee_balance": "10.80"
    },
    {
        "tournament_id": "be27c5a4-8282-4dd1-8881-fe1145a94b5e",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Union Grand Championship (NLH) 9-Max SNG Satellite",
        "eligible_players": 6,
        "retained_seats": 6,
        "prize_balance": "121.50",
        "bounty_balance": "0.00",
        "fee_balance": "13.50"
    },
    {
        "tournament_id": "bed32f92-c2e5-485e-aa90-5ff62bdfd325",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Midday Turbo (NLH)",
        "eligible_players": 19,
        "retained_seats": 19,
        "prize_balance": "949.00",
        "bounty_balance": "0.00",
        "fee_balance": "61.00"
    },
    {
        "tournament_id": "bf050b4a-afd3-43d4-82f4-5eab0983d490",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Prime Time Main Event (NLH) 9-Max SNG Satellite",
        "eligible_players": 3,
        "retained_seats": 3,
        "prize_balance": "72.90",
        "bounty_balance": "0.00",
        "fee_balance": "8.10"
    },
    {
        "tournament_id": "bfad9be3-52f8-4f08-863b-cb8790ab4b75",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "40 Chip Freezeout - 5K GTD (NLH) 9-Max SNG Satellite",
        "eligible_players": 5,
        "retained_seats": 5,
        "prize_balance": "97.20",
        "bounty_balance": "0.00",
        "fee_balance": "10.80"
    },
    {
        "tournament_id": "c2835ddc-d3b6-4b91-9e1b-895028435b3c",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Saturday Stackfest PKO 9-Max SNG Satellite",
        "eligible_players": 3,
        "retained_seats": 3,
        "prize_balance": "72.90",
        "bounty_balance": "0.00",
        "fee_balance": "8.10"
    },
    {
        "tournament_id": "c48b7118-a0e5-4b33-98df-79dcf29f15af",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Prime Time Main Event (NLH) 9-Max SNG Satellite",
        "eligible_players": 8,
        "retained_seats": 8,
        "prize_balance": "72.90",
        "bounty_balance": "0.00",
        "fee_balance": "8.10"
    },
    {
        "tournament_id": "c685ebb7-954d-4a38-a26d-9c23c23600a4",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "40 Chip Freezeout - 5K GTD (NLH) 9-Max SNG Satellite",
        "eligible_players": 7,
        "retained_seats": 7,
        "prize_balance": "97.20",
        "bounty_balance": "0.00",
        "fee_balance": "10.80"
    },
    {
        "tournament_id": "cc73fe07-8ab2-4282-9ba6-633563de2fec",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Prime Time Main Event (NLH) 9-Max SNG Satellite",
        "eligible_players": 8,
        "retained_seats": 8,
        "prize_balance": "72.90",
        "bounty_balance": "0.00",
        "fee_balance": "8.10"
    },
    {
        "tournament_id": "d110fd05-846e-46c1-adca-a2e515e95144",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Six-Card Feature 6-Max SNG Satellite",
        "eligible_players": 6,
        "retained_seats": 6,
        "prize_balance": "75.60",
        "bounty_balance": "0.00",
        "fee_balance": "8.40"
    },
    {
        "tournament_id": "d4fe7c06-14eb-4ded-a2fd-07a57559f2dd",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "25 Chip Daily Rebuy (NLH) 9-Max SNG Satellite",
        "eligible_players": 8,
        "retained_seats": 8,
        "prize_balance": "64.80",
        "bounty_balance": "0.00",
        "fee_balance": "7.20"
    },
    {
        "tournament_id": "d8b96746-98a8-444f-a779-76904bbca946",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "25 Chip Daily Rebuy (NLH) 9-Max SNG Satellite",
        "eligible_players": 8,
        "retained_seats": 8,
        "prize_balance": "64.80",
        "bounty_balance": "0.00",
        "fee_balance": "7.20"
    },
    {
        "tournament_id": "dbaca4cd-8959-427d-8b91-2d97310e6fd6",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Friday Fight Night PKO 9-Max SNG Satellite",
        "eligible_players": 9,
        "retained_seats": 9,
        "prize_balance": "72.90",
        "bounty_balance": "0.00",
        "fee_balance": "8.10"
    },
    {
        "tournament_id": "dcffef19-4c19-4c5a-b433-d043d3641bc9",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "25 Chip Daily Rebuy (NLH) 9-Max SNG Satellite",
        "eligible_players": 7,
        "retained_seats": 7,
        "prize_balance": "64.80",
        "bounty_balance": "0.00",
        "fee_balance": "7.20"
    },
    {
        "tournament_id": "deaa61a7-0553-4c81-a178-e9ba822a1ba2",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Sunday 200 Deep Stack 9-Max SNG Satellite",
        "eligible_players": 9,
        "retained_seats": 9,
        "prize_balance": "461.70",
        "bounty_balance": "0.00",
        "fee_balance": "51.30"
    },
    {
        "tournament_id": "debf5e04-6f4d-4858-88a0-84b6fe1ba598",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "40 Chip Freezeout - 2.5K GTD (NLH) 9-Max SNG Satellite",
        "eligible_players": 9,
        "retained_seats": 9,
        "prize_balance": "97.20",
        "bounty_balance": "0.00",
        "fee_balance": "10.80"
    },
    {
        "tournament_id": "e507f99a-fc33-45f7-9f7a-60f2793d3876",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Friday Fight Night Opener 9-Max SNG Satellite",
        "eligible_players": 3,
        "retained_seats": 3,
        "prize_balance": "72.90",
        "bounty_balance": "0.00",
        "fee_balance": "8.10"
    },
    {
        "tournament_id": "e9e505d4-13ed-48ee-b7bf-1bdbb28cc8f2",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "40 Chip Freezeout - 5K GTD (NLH) 9-Max SNG Satellite",
        "eligible_players": 9,
        "retained_seats": 9,
        "prize_balance": "97.20",
        "bounty_balance": "0.00",
        "fee_balance": "10.80"
    },
    {
        "tournament_id": "eb916895-36f9-49e9-a364-486ad4555744",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Nightly 10K (NLH) 9-Max SNG Satellite",
        "eligible_players": 6,
        "retained_seats": 6,
        "prize_balance": "81.00",
        "bounty_balance": "0.00",
        "fee_balance": "9.00"
    },
    {
        "tournament_id": "ef75f627-1f29-4729-97cd-9988495b49f1",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "40 Chip Freezeout - 2.5K GTD (NLH) Satellite 5",
        "eligible_players": 4,
        "retained_seats": 4,
        "prize_balance": "40.50",
        "bounty_balance": "0.00",
        "fee_balance": "4.50"
    },
    {
        "tournament_id": "f55d1faf-380b-4aeb-a0bf-e0151531dab5",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Union Grand Championship (NLH) 9-Max SNG Satellite",
        "eligible_players": 6,
        "retained_seats": 6,
        "prize_balance": "121.50",
        "bounty_balance": "0.00",
        "fee_balance": "13.50"
    },
    {
        "tournament_id": "fac51189-3bcc-4bd6-b5b5-34316c034edb",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Friday Night Feature 9-Max SNG Satellite",
        "eligible_players": 4,
        "retained_seats": 4,
        "prize_balance": "72.90",
        "bounty_balance": "0.00",
        "fee_balance": "8.10"
    },
    {
        "tournament_id": "fcb7f99f-b43e-4043-88ad-4ed13c17d40a",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "Friday Fight Night PKO 9-Max SNG Satellite",
        "eligible_players": 8,
        "retained_seats": 8,
        "prize_balance": "72.90",
        "bounty_balance": "0.00",
        "fee_balance": "8.10"
    },
    {
        "tournament_id": "fdfcadfd-4044-4696-874d-5ec50cf93a48",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "chips",
        "name": "40 Chip Bounty Freezeout - 5K GTD (NLH) 9-Max SNG Satellite",
        "eligible_players": 9,
        "retained_seats": 9,
        "prize_balance": "97.20",
        "bounty_balance": "0.00",
        "fee_balance": "10.80"
    },
    {
        "tournament_id": "fe9145bb-acc1-4a51-97d1-e473d3c39c6e",
        "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
        "cohort_group": "original89",
        "asset": "diamonds",
        "name": "Sunday Deep Stack Satellite 25",
        "eligible_players": 4,
        "retained_seats": 4,
        "prize_balance": "6000",
        "bounty_balance": "0",
        "fee_balance": "100"
    },
    {
        "tournament_id": "0903a95a-d53e-41f5-955f-6ea8c2150cf1",
        "operation_id": "170fcc59-2856-5d43-8920-ffa6b373f0a5",
        "cohort_group": "other26_25",
        "asset": "chips",
        "name": "Funday Main Event Satellite 15",
        "eligible_players": 14,
        "retained_seats": 14,
        "prize_balance": "397.50",
        "bounty_balance": "0.00",
        "fee_balance": "22.50"
    },
    {
        "tournament_id": "0fc27b7b-4290-4e73-8680-9791e021f114",
        "operation_id": "12b8f9d4-0e17-579b-a19d-6e53ad956bb1",
        "cohort_group": "other26_25",
        "asset": "diamonds",
        "name": "Friday Five-Card Bounty",
        "eligible_players": 18,
        "retained_seats": 18,
        "prize_balance": "20000",
        "bounty_balance": "1350",
        "fee_balance": "2640"
    },
    {
        "tournament_id": "11615efe-bd76-4f8d-807c-f1f22bf345f9",
        "operation_id": "71d6aa23-921b-5503-8211-14566d51ec78",
        "cohort_group": "other26_25",
        "asset": "chips",
        "name": "Sunday Funday Happy Hour 9-Max SNG Satellite",
        "eligible_players": 9,
        "retained_seats": 9,
        "prize_balance": "72.90",
        "bounty_balance": "0.00",
        "fee_balance": "8.10"
    },
    {
        "tournament_id": "19486d1f-2959-41e5-9268-5e0908e0d356",
        "operation_id": "ae07daa2-59ab-52f2-9b61-7ecda18e2094",
        "cohort_group": "other26_25",
        "asset": "chips",
        "name": "Sunday Deep Stack Satellite 25",
        "eligible_players": 5,
        "retained_seats": 5,
        "prize_balance": "600.00",
        "bounty_balance": "0.00",
        "fee_balance": "12.50"
    },
    {
        "tournament_id": "19d83ee0-03ed-4603-b4f0-2d5a944c7f15",
        "operation_id": "d4bd4eb6-8937-526b-ba71-bf1845c5d957",
        "cohort_group": "other26_25",
        "asset": "chips",
        "name": "Stackfest Opener Satellite 5",
        "eligible_players": 4,
        "retained_seats": 4,
        "prize_balance": "38.00",
        "bounty_balance": "0.00",
        "fee_balance": "2.00"
    },
    {
        "tournament_id": "28fd0051-32fa-408d-950e-3a556c5979b2",
        "operation_id": "4523b4a2-6106-583f-9e5b-4d297292ac9f",
        "cohort_group": "other26_25",
        "asset": "diamonds",
        "name": "Late Night PKO (PLO4)",
        "eligible_players": 60,
        "retained_seats": 60,
        "prize_balance": "15000",
        "bounty_balance": "8325",
        "fee_balance": "2180"
    },
    {
        "tournament_id": "295fbdf9-653b-4389-961b-26bc83589219",
        "operation_id": "bfbed3e6-9c46-50ca-8f38-b04368e8e59e",
        "cohort_group": "other26_25",
        "asset": "chips",
        "name": "Sunday Deep Stack Satellite 30",
        "eligible_players": 8,
        "retained_seats": 8,
        "prize_balance": "618.00",
        "bounty_balance": "0.00",
        "fee_balance": "42.00"
    },
    {
        "tournament_id": "36c4dd29-99ca-4bc8-b719-416b82036b1f",
        "operation_id": "0b9ad1a2-2e35-5fa1-bbd5-629aaa21bd21",
        "cohort_group": "other26_25",
        "asset": "chips",
        "name": "25 Chip Daily Rebuy (NLH) Satellite 5",
        "eligible_players": 6,
        "retained_seats": 6,
        "prize_balance": "27.00",
        "bounty_balance": "0.00",
        "fee_balance": "3.00"
    },
    {
        "tournament_id": "37b4adc0-f9f4-484e-a914-3c50749055df",
        "operation_id": "2b925cdd-aaa7-4d16-aff9-ef1fa22496f2",
        "cohort_group": "other26_25",
        "asset": "diamonds",
        "name": "Nightly 10K (NLH)",
        "eligible_players": 243,
        "retained_seats": 243,
        "prize_balance": "194460",
        "bounty_balance": "0",
        "fee_balance": "12040"
    },
    {
        "tournament_id": "4908686b-aade-485e-b16f-a473a9ccdbca",
        "operation_id": "e61b76ce-66c0-5eb7-804f-79da95da10ab",
        "cohort_group": "other26_25",
        "asset": "chips",
        "name": "Stackfest PKO Satellite 5",
        "eligible_players": 4,
        "retained_seats": 4,
        "prize_balance": "30.00",
        "bounty_balance": "0.00",
        "fee_balance": "2.00"
    },
    {
        "tournament_id": "54abdabf-d625-4785-9b0e-099037446189",
        "operation_id": "0a7a56f1-d85c-5bd0-b8c5-51bb446183e5",
        "cohort_group": "other26_25",
        "asset": "chips",
        "name": "Funday PLO PKO Satellite 10",
        "eligible_players": 3,
        "retained_seats": 3,
        "prize_balance": "56.00",
        "bounty_balance": "0.00",
        "fee_balance": "4.00"
    },
    {
        "tournament_id": "57af2978-595b-41b8-b302-d68de81c0c3a",
        "operation_id": "c8405dfd-cead-50ba-a376-d41a0ac9751f",
        "cohort_group": "other26_25",
        "asset": "chips",
        "name": "Prime Time Satellite 5",
        "eligible_players": 10,
        "retained_seats": 10,
        "prize_balance": "122.50",
        "bounty_balance": "0.00",
        "fee_balance": "7.50"
    },
    {
        "tournament_id": "644379fb-3252-412a-a843-378a77470790",
        "operation_id": "01be3a8a-ff69-5bfe-bb80-d9dec97170ff",
        "cohort_group": "other26_25",
        "asset": "chips",
        "name": "Sunday Deep Stack Satellite 30",
        "eligible_players": 5,
        "retained_seats": 5,
        "prize_balance": "426.00",
        "bounty_balance": "0.00",
        "fee_balance": "24.00"
    },
    {
        "tournament_id": "78d24c32-683a-42fa-8d7a-b5cf6dadf251",
        "operation_id": "7ea582b3-0ecc-5d3c-9224-2d5a32615e79",
        "cohort_group": "other26_25",
        "asset": "diamonds",
        "name": "Prime Time Free Buy (NLH)",
        "eligible_players": 47,
        "retained_seats": 47,
        "prize_balance": "8500",
        "bounty_balance": "0",
        "fee_balance": "0"
    },
    {
        "tournament_id": "83d66653-e765-4cb8-943e-0ac3d510ad06",
        "operation_id": "35109279-e158-59e3-aa23-3fb39734031c",
        "cohort_group": "other26_25",
        "asset": "chips",
        "name": "Prime Time Satellite 5",
        "eligible_players": 7,
        "retained_seats": 7,
        "prize_balance": "56.50",
        "bounty_balance": "0.00",
        "fee_balance": "3.50"
    },
    {
        "tournament_id": "8b7cc4f1-b7d8-48f9-b3da-b15dff5cbed3",
        "operation_id": "b62e4193-3dc3-574f-88d4-47a3100a28d1",
        "cohort_group": "other26_25",
        "asset": "chips",
        "name": "PLO5 Mystery Bounty Satellite 5",
        "eligible_players": 10,
        "retained_seats": 10,
        "prize_balance": "112.00",
        "bounty_balance": "0.00",
        "fee_balance": "8.00"
    },
    {
        "tournament_id": "97b69931-4644-4e90-8f50-b70b9a247715",
        "operation_id": "ce49e075-6cdf-58a1-a265-f3f57651b850",
        "cohort_group": "other26_25",
        "asset": "chips",
        "name": "Nightly 10K Satellite 5",
        "eligible_players": 8,
        "retained_seats": 8,
        "prize_balance": "71.00",
        "bounty_balance": "0.00",
        "fee_balance": "4.00"
    },
    {
        "tournament_id": "a54bdd4f-26b8-47c5-aa24-2c2b97b14015",
        "operation_id": "407dc27c-1042-56dd-962e-67cd6a720c81",
        "cohort_group": "other26_25",
        "asset": "diamonds",
        "name": "Friday Fight Night Opener",
        "eligible_players": 69,
        "retained_seats": 69,
        "prize_balance": "30240",
        "bounty_balance": "0",
        "fee_balance": "3360"
    },
    {
        "tournament_id": "d5decc98-cd0f-417f-aa28-6df009a74c76",
        "operation_id": "59374492-3591-5e40-b894-146568358b43",
        "cohort_group": "other26_25",
        "asset": "chips",
        "name": "Morning Free Buy (NLH)",
        "eligible_players": 9,
        "retained_seats": 9,
        "prize_balance": "138.99",
        "bounty_balance": "0.00",
        "fee_balance": "4.80"
    },
    {
        "tournament_id": "d9393e4e-63da-4a5b-8571-fbbf9654ad1a",
        "operation_id": "fb9646f9-c5ab-55a2-ba2a-253cf2e819da",
        "cohort_group": "other26_25",
        "asset": "chips",
        "name": "Nightly 10K Satellite 5",
        "eligible_players": 13,
        "retained_seats": 13,
        "prize_balance": "122.50",
        "bounty_balance": "0.00",
        "fee_balance": "7.50"
    },
    {
        "tournament_id": "e287e6b9-630d-4f2e-a205-d21841a490d8",
        "operation_id": "b182897f-d83b-5017-aa9f-172e1a9eddba",
        "cohort_group": "other26_25",
        "asset": "diamonds",
        "name": "Friday Fight Night PKO",
        "eligible_players": 85,
        "retained_seats": 85,
        "prize_balance": "30000",
        "bounty_balance": "12825",
        "fee_balance": "2580"
    },
    {
        "tournament_id": "eb82f8d7-53b9-4e2a-9fd5-c2b76ec73d19",
        "operation_id": "b43b91e4-d1d6-5067-af30-0f5efb54b25b",
        "cohort_group": "other26_25",
        "asset": "diamonds",
        "name": "Funday PLO5 Satellite 5",
        "eligible_players": 4,
        "retained_seats": 4,
        "prize_balance": "300",
        "bounty_balance": "0",
        "fee_balance": "20"
    },
    {
        "tournament_id": "f4c2dd81-58d7-4a11-99de-da923b70d5f7",
        "operation_id": "3d4bed03-02b0-5862-a61e-894cd0fd3e62",
        "cohort_group": "other26_25",
        "asset": "diamonds",
        "name": "Friday Night Feature",
        "eligible_players": 75,
        "retained_seats": 75,
        "prize_balance": "30000",
        "bounty_balance": "0",
        "fee_balance": "2370"
    },
    {
        "tournament_id": "ff1ec3f2-f2f2-46d6-b30e-e9ef612532b1",
        "operation_id": "d12d4e40-ac78-5350-82bc-56359113278d",
        "cohort_group": "other26_25",
        "asset": "chips",
        "name": "Grand Championship Satellite 10",
        "eligible_players": 6,
        "retained_seats": 6,
        "prize_balance": "283.00",
        "bounty_balance": "0.00",
        "fee_balance": "17.00"
    },
    {
        "tournament_id": "ff83fd35-a6d9-4111-a4dd-849f574264bc",
        "operation_id": "cd5390e1-36b2-5284-bad0-ceebdf9fff4f",
        "cohort_group": "other26_25",
        "asset": "chips",
        "name": "Sunday Deep Stack Satellite 30",
        "eligible_players": 8,
        "retained_seats": 8,
        "prize_balance": "336.00",
        "bounty_balance": "0.00",
        "fee_balance": "24.00"
    }
])

CANONICAL_139_BY_ID: dict[str, dict[str, Any]] = {
    entry["tournament_id"]: entry for entry in CANONICAL_139_MANIFEST
}
CANONICAL_138_REMAINING_BY_ID: dict[str, dict[str, Any]] = {
    tid: entry
    for tid, entry in CANONICAL_139_BY_ID.items()
    if tid != PROBY_TOURNAMENT_ID
}

# Expected aggregate constants kept strictly separate by asset
EXPECTED_CHIP_ALL124_EVENTS = 124
EXPECTED_CHIP_REMAINING123_EVENTS = 123
EXPECTED_CHIP_ALL124_PLAYERS = 963
EXPECTED_CHIP_REMAINING123_PLAYERS = 957
EXPECTED_CHIP_ALL124_PRIZE = Decimal("19573.49")
EXPECTED_CHIP_REMAINING123_PRIZE = Decimal("19541.99")
EXPECTED_CHIP_ALL124_BOUNTY = Decimal("0.00")
EXPECTED_CHIP_ALL124_FEE = Decimal("1482.80")
EXPECTED_CHIP_REMAINING123_FEE = Decimal("1479.30")
EXPECTED_CHIP_PRIOR_PAYOUTS_COUNT = 73
EXPECTED_CHIP_PRIOR_PAYOUTS_SUM = Decimal("285.31")

EXPECTED_DIAMOND_ALL15_EVENTS = 15
EXPECTED_DIAMOND_ORIGINAL89_EVENTS = 7
EXPECTED_DIAMOND_OTHER26_EVENTS = 8
EXPECTED_DIAMOND_ALL15_PLAYERS = 704
EXPECTED_DIAMOND_ORIGINAL89_PLAYERS = 103
EXPECTED_DIAMOND_OTHER26_PLAYERS = 601
EXPECTED_DIAMOND_ALL15_PRIZE = Decimal("380070")
EXPECTED_DIAMOND_ALL15_BOUNTY = Decimal("22500")
EXPECTED_DIAMOND_ALL15_DISTRIBUTABLE = Decimal("402570")
EXPECTED_DIAMOND_ALL15_FEE = Decimal("25642")
EXPECTED_DIAMOND_ORIGINAL89_FEE = Decimal("452")
EXPECTED_DIAMOND_OTHER26_FEE = Decimal("25190")
EXPECTED_DIAMOND_CUSTODY_ROWS = 1436
EXPECTED_DIAMOND_ELIMINATED_ROWS = 732
EXPECTED_DIAMOND_TOTAL_CUSTODY_BEFORE = Decimal("428212")
EXPECTED_DIAMOND_PRIOR_PRIZE_COUNT = 5
EXPECTED_DIAMOND_PRIOR_PRIZE_SUM = Decimal("1090")
EXPECTED_DIAMOND_PRIOR_BOUNTY_OBLIGATIONS = 120
EXPECTED_DIAMOND_PRIOR_BOUNTY_LEGS = 121
EXPECTED_DIAMOND_PRIOR_BOUNTY_SUM = Decimal("7900")
EXPECTED_DIAMOND_PRIOR_AWARDS_TOTAL = Decimal("8990")
EXPECTED_DIAMOND_EARMARK_LEDGER_ROWS = 39
EXPECTED_PRIOR_DIAMOND_V2_CANCELLATIONS = 88
EXPECTED_PRIOR_DIAMOND_OVERDUE_REFUND_SUM = Decimal("34600")


def _dec(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    return Decimal(str(value))


def format_pg_jsonb_shares(shares: Sequence[Mapping[str, Any]], asset: str) -> str:
    """Serialize financial->'shares' with exact PostgreSQL jsonb::text formatting."""
    unit_scale = 1 if asset == "diamonds" else 100
    parts: list[str] = []
    for s in shares:
        key_val = str(s["key"])
        reg_id = str(s["registration_id"])
        user_id = str(s["user_id"])
        if unit_scale == 1:
            amt_str = str(int(_dec(s["amount"])))
            bounty_str = str(int(_dec(s["bounty"])))
            prize_str = str(int(_dec(s["prize"])))
        else:
            amt_u = int((_dec(s["amount"]) * Decimal(100)).to_integral_exact())
            bounty_u = int((_dec(s["bounty"]) * Decimal(100)).to_integral_exact())
            prize_u = int((_dec(s["prize"]) * Decimal(100)).to_integral_exact())

            def _fmt_100(u: int) -> str:
                if u == 0:
                    return "0.00000000000000000000"
                q = Decimal(u) / Decimal(100)
                return f"{q:.16f}"

            amt_str = _fmt_100(amt_u)
            bounty_str = _fmt_100(bounty_u)
            prize_str = _fmt_100(prize_u)

        item_str = (
            f'{{"key": {json.dumps(key_val)}, '
            f'"prize": {prize_str}, '
            f'"amount": {amt_str}, '
            f'"bounty": {bounty_str}, '
            f'"user_id": {json.dumps(user_id)}, '
            f'"registration_id": {json.dumps(reg_id)}}}'
        )
        parts.append(item_str)
    return "[" + ", ".join(parts) + "]"


def compute_pg_shares_md5(shares: Sequence[Mapping[str, Any]], asset: str) -> str:
    serialized = format_pg_jsonb_shares(shares, asset)
    return hashlib.md5(serialized.encode("utf-8")).hexdigest()


def compute_equal_shares_for_event(
    tournament_id: str,
    asset: str,
    prize_balance: Decimal,
    bounty_balance: Decimal,
    eligible_players: Sequence[Mapping[str, Any]],
) -> tuple[list[dict[str, Any]], str]:
    """Compute canonical equal-share rows and exact PostgreSQL allocation_hash."""
    unit_scale = 1 if asset == "diamonds" else 100
    prize_units = int((prize_balance * Decimal(unit_scale)).to_integral_exact())
    bounty_units = int((bounty_balance * Decimal(unit_scale)).to_integral_exact())
    total_units = prize_units + bounty_units

    ordered = sorted(
        eligible_players,
        key=lambda r: (str(r["registered_at"]), str(r["registration_id"]), str(r["user_id"])),
    )
    count = len(ordered)
    if count <= 0:
        raise ValueError(f"Event {tournament_id} has no eligible players")

    base_units = total_units // count
    remainder_units = total_units % count
    prize_remaining = prize_units

    shares: list[dict[str, Any]] = []
    for idx, player in enumerate(ordered, start=1):
        share_units = base_units + (1 if idx <= remainder_units else 0)
        prize_part = min(prize_remaining, share_units)
        bounty_part = share_units - prize_part
        prize_remaining -= prize_part

        reg_id = str(player["registration_id"])
        user_id = str(player["user_id"])
        key = f"tournament-abort-equal-share:{tournament_id}:{reg_id}"
        if unit_scale == 1:
            prize_val: Any = prize_part
            bounty_val: Any = bounty_part
            amount_val: Any = share_units
        else:
            prize_val = str((Decimal(prize_part) / Decimal(100)).quantize(Decimal("0.01")))
            bounty_val = str((Decimal(bounty_part) / Decimal(100)).quantize(Decimal("0.01")))
            amount_val = str((Decimal(share_units) / Decimal(100)).quantize(Decimal("0.01")))

        shares.append({
            "registration_id": reg_id,
            "user_id": user_id,
            "prize": prize_val,
            "bounty": bounty_val,
            "amount": amount_val,
            "key": key,
        })

    return shares, compute_pg_shares_md5(shares, asset)


def verify_remaining_138_preflight(snapshot: Mapping[str, Any]) -> dict[str, Any]:
    """Verify pre-settlement cohort invariants for the 138 remaining events (and 139 total)."""
    errors: list[str] = []

    events = snapshot.get("events")
    if not isinstance(events, list):
        return {"ok": False, "mode": "preflight", "errors": ["events must be a list"]}

    seen_ids: set[str] = set()
    for ev in events:
        tid = str(ev.get("tournament_id", ""))
        if tid == EXCLUDED_MYSTERY_BOUNTY_ID:
            errors.append(
                f"Event {EXCLUDED_MYSTERY_BOUNTY_ID} (Union Mystery Bounty PLO5) must remain excluded from the 139 settlement scope"
            )
        if tid in seen_ids:
            errors.append(f"Duplicate tournament_id in preflight snapshot: {tid}")
        seen_ids.add(tid)

    include_proby = PROBY_TOURNAMENT_ID in seen_ids
    expected_map = CANONICAL_139_BY_ID if include_proby else CANONICAL_138_REMAINING_BY_ID
    expected_total_count = 139 if include_proby else 138

    if len(events) != expected_total_count:
        errors.append(f"Expected {expected_total_count} events in snapshot, found {len(events)}")

    missing_ids = sorted(set(expected_map.keys()) - seen_ids)
    unexpected_ids = sorted(seen_ids - set(expected_map.keys()) - {EXCLUDED_MYSTERY_BOUNTY_ID})
    if missing_ids:
        errors.append(f"Missing expected tournament_ids ({len(missing_ids)}): {missing_ids[:5]}")
    if unexpected_ids:
        errors.append(f"Unexpected tournament_ids ({len(unexpected_ids)}): {unexpected_ids[:5]}")

    chip_count = 0
    chip_players = 0
    chip_prize = Decimal("0.00")
    chip_bounty = Decimal("0.00")
    chip_fee = Decimal("0.00")

    diamond_count = 0
    diamond_orig89_count = 0
    diamond_other26_count = 0
    diamond_players = 0
    diamond_orig89_players = 0
    diamond_other26_players = 0
    diamond_prize = Decimal("0")
    diamond_bounty = Decimal("0")
    diamond_fee = Decimal("0")
    diamond_orig89_fee = Decimal("0")
    diamond_other26_fee = Decimal("0")

    for ev in events:
        tid = str(ev.get("tournament_id", ""))
        canonical = expected_map.get(tid)
        if canonical is None:
            continue

        if str(ev.get("operation_id", "")) != canonical["operation_id"]:
            errors.append(
                f"Event {tid} operation_id mismatch: expected {canonical['operation_id']}, got {ev.get('operation_id')}"
            )
        if str(ev.get("asset", "")) != canonical["asset"]:
            errors.append(
                f"Event {tid} asset mismatch: expected {canonical['asset']}, got {ev.get('asset')}"
            )
        if str(ev.get("cohort_group", canonical["cohort_group"])) != canonical["cohort_group"]:
            errors.append(
                f"Event {tid} cohort_group mismatch: expected {canonical['cohort_group']}, got {ev.get('cohort_group')}"
            )
        if str(ev.get("status", "")) != "RUNNING":
            errors.append(f"Event {tid} preflight status must be RUNNING, got {ev.get('status')}")

        elig = int(ev.get("eligible_players", -1))
        seats = int(ev.get("retained_seats", -1))
        if elig != canonical["eligible_players"] or seats != canonical["retained_seats"] or elig != seats:
            errors.append(
                f"Event {tid} eligible/seat mismatch: expected {canonical['eligible_players']}, got eligible={elig} seats={seats}"
            )

        p_bal = _dec(ev.get("prize_balance"))
        b_bal = _dec(ev.get("bounty_balance"))
        f_bal = _dec(ev.get("fee_balance"))
        if p_bal != _dec(canonical["prize_balance"]) or b_bal != _dec(canonical["bounty_balance"]) or f_bal != _dec(canonical["fee_balance"]):
            errors.append(
                f"Event {tid} escrow drift: expected ({canonical['prize_balance']}, {canonical['bounty_balance']}, {canonical['fee_balance']}), got ({p_bal}, {b_bal}, {f_bal})"
            )

        if canonical["asset"] == "chips":
            chip_count += 1
            chip_players += elig
            chip_prize += p_bal
            chip_bounty += b_bal
            chip_fee += f_bal
        else:
            diamond_count += 1
            diamond_players += elig
            diamond_prize += p_bal
            diamond_bounty += b_bal
            diamond_fee += f_bal
            if canonical["cohort_group"] == "original89":
                diamond_orig89_count += 1
                diamond_orig89_players += elig
                diamond_orig89_fee += f_bal
            else:
                diamond_other26_count += 1
                diamond_other26_players += elig
                diamond_other26_fee += f_bal

    exp_chip_events = EXPECTED_CHIP_ALL124_EVENTS if include_proby else EXPECTED_CHIP_REMAINING123_EVENTS
    exp_chip_players = EXPECTED_CHIP_ALL124_PLAYERS if include_proby else EXPECTED_CHIP_REMAINING123_PLAYERS
    exp_chip_prize = EXPECTED_CHIP_ALL124_PRIZE if include_proby else EXPECTED_CHIP_REMAINING123_PRIZE
    exp_chip_fee = EXPECTED_CHIP_ALL124_FEE if include_proby else EXPECTED_CHIP_REMAINING123_FEE

    if chip_count != exp_chip_events:
        errors.append(f"Chip event count mismatch: expected {exp_chip_events}, got {chip_count}")
    if chip_players != exp_chip_players:
        errors.append(f"Chip eligible players mismatch: expected {exp_chip_players}, got {chip_players}")
    if chip_prize != exp_chip_prize:
        errors.append(f"Chip prize total mismatch: expected {exp_chip_prize}, got {chip_prize}")
    if chip_bounty != EXPECTED_CHIP_ALL124_BOUNTY:
        errors.append(f"Chip bounty total mismatch: expected {EXPECTED_CHIP_ALL124_BOUNTY}, got {chip_bounty}")
    if chip_fee != exp_chip_fee:
        errors.append(f"Chip fee total mismatch: expected {exp_chip_fee}, got {chip_fee}")

    if diamond_count != EXPECTED_DIAMOND_ALL15_EVENTS:
        errors.append(f"Diamond event count mismatch: expected {EXPECTED_DIAMOND_ALL15_EVENTS}, got {diamond_count}")
    if diamond_orig89_count != EXPECTED_DIAMOND_ORIGINAL89_EVENTS or diamond_other26_count != EXPECTED_DIAMOND_OTHER26_EVENTS:
        errors.append(
            f"Diamond 7/8 split mismatch: expected 7+8, got {diamond_orig89_count}+{diamond_other26_count}"
        )
    if diamond_players != EXPECTED_DIAMOND_ALL15_PLAYERS or diamond_orig89_players != EXPECTED_DIAMOND_ORIGINAL89_PLAYERS or diamond_other26_players != EXPECTED_DIAMOND_OTHER26_PLAYERS:
        errors.append(
            f"Diamond players mismatch: expected 704 (103+601), got {diamond_players} ({diamond_orig89_players}+{diamond_other26_players})"
        )
    if diamond_prize != EXPECTED_DIAMOND_ALL15_PRIZE:
        errors.append(f"Diamond prize total mismatch: expected {EXPECTED_DIAMOND_ALL15_PRIZE}, got {diamond_prize}")
    if diamond_bounty != EXPECTED_DIAMOND_ALL15_BOUNTY:
        errors.append(f"Diamond bounty total mismatch: expected {EXPECTED_DIAMOND_ALL15_BOUNTY}, got {diamond_bounty}")
    if diamond_prize + diamond_bounty != EXPECTED_DIAMOND_ALL15_DISTRIBUTABLE:
        errors.append(
            f"Diamond distributable total mismatch: expected {EXPECTED_DIAMOND_ALL15_DISTRIBUTABLE}, got {diamond_prize + diamond_bounty}"
        )
    if diamond_fee != EXPECTED_DIAMOND_ALL15_FEE or diamond_orig89_fee != EXPECTED_DIAMOND_ORIGINAL89_FEE or diamond_other26_fee != EXPECTED_DIAMOND_OTHER26_FEE:
        errors.append(
            f"Diamond fee total mismatch: expected 25642 (452+25190), got {diamond_fee} ({diamond_orig89_fee}+{diamond_other26_fee})"
        )

    custody = snapshot.get("diamond_custody_summary", {})
    if int(custody.get("active_custody_rows", -1)) != EXPECTED_DIAMOND_CUSTODY_ROWS:
        errors.append(
            f"Diamond active custody rows mismatch: expected {EXPECTED_DIAMOND_CUSTODY_ROWS}, got {custody.get('active_custody_rows')}"
        )
    if int(custody.get("playing_custody_rows", -1)) != EXPECTED_DIAMOND_ALL15_PLAYERS:
        errors.append(
            f"Diamond playing custody rows mismatch: expected {EXPECTED_DIAMOND_ALL15_PLAYERS}, got {custody.get('playing_custody_rows')}"
        )
    if int(custody.get("eliminated_custody_rows", -1)) != EXPECTED_DIAMOND_ELIMINATED_ROWS:
        errors.append(
            f"Diamond eliminated custody rows mismatch: expected {EXPECTED_DIAMOND_ELIMINATED_ROWS}, got {custody.get('eliminated_custody_rows')}"
        )
    if _dec(custody.get("total_custody_balance")) != EXPECTED_DIAMOND_TOTAL_CUSTODY_BEFORE:
        errors.append(
            f"Diamond total custody balance mismatch: expected {EXPECTED_DIAMOND_TOTAL_CUSTODY_BEFORE}, got {custody.get('total_custody_balance')}"
        )
    if int(custody.get("open_guarantee_earmarks", -1)) != 0:
        errors.append(
            f"Diamond open guarantee earmarks must be 0, got {custody.get('open_guarantee_earmarks')}"
        )
    if int(custody.get("earmark_ledger_rows", -1)) != EXPECTED_DIAMOND_EARMARK_LEDGER_ROWS:
        errors.append(
            f"Diamond earmark ledger row count mismatch: expected {EXPECTED_DIAMOND_EARMARK_LEDGER_ROWS}, got {custody.get('earmark_ledger_rows')}"
        )

    prior = snapshot.get("prior_awards_and_closures", {})
    if int(prior.get("diamond_prior_prize_count", -1)) != EXPECTED_DIAMOND_PRIOR_PRIZE_COUNT:
        errors.append(
            f"Diamond prior prize count mismatch: expected {EXPECTED_DIAMOND_PRIOR_PRIZE_COUNT}, got {prior.get('diamond_prior_prize_count')}"
        )
    if _dec(prior.get("diamond_prior_prize_sum")) != EXPECTED_DIAMOND_PRIOR_PRIZE_SUM:
        errors.append(
            f"Diamond prior prize sum mismatch: expected {EXPECTED_DIAMOND_PRIOR_PRIZE_SUM}, got {prior.get('diamond_prior_prize_sum')}"
        )
    if int(prior.get("diamond_prior_bounty_obligations", -1)) != EXPECTED_DIAMOND_PRIOR_BOUNTY_OBLIGATIONS:
        errors.append(
            f"Diamond prior bounty obligations mismatch: expected {EXPECTED_DIAMOND_PRIOR_BOUNTY_OBLIGATIONS}, got {prior.get('diamond_prior_bounty_obligations')}"
        )
    if int(prior.get("diamond_prior_bounty_legs", -1)) != EXPECTED_DIAMOND_PRIOR_BOUNTY_LEGS:
        errors.append(
            f"Diamond prior bounty ledger legs mismatch: expected {EXPECTED_DIAMOND_PRIOR_BOUNTY_LEGS}, got {prior.get('diamond_prior_bounty_legs')}"
        )
    if _dec(prior.get("diamond_prior_bounty_sum")) != EXPECTED_DIAMOND_PRIOR_BOUNTY_SUM:
        errors.append(
            f"Diamond prior bounty sum mismatch: expected {EXPECTED_DIAMOND_PRIOR_BOUNTY_SUM}, got {prior.get('diamond_prior_bounty_sum')}"
        )
    if int(prior.get("diamond_unpaid_bounty_obligations", -1)) != 0:
        errors.append(
            f"Diamond unpaid bounty obligations must be 0, got {prior.get('diamond_unpaid_bounty_obligations')}"
        )
    if int(prior.get("chip_prior_payouts_count", -1)) != EXPECTED_CHIP_PRIOR_PAYOUTS_COUNT:
        errors.append(
            f"Chip prior payouts count mismatch: expected {EXPECTED_CHIP_PRIOR_PAYOUTS_COUNT}, got {prior.get('chip_prior_payouts_count')}"
        )
    if _dec(prior.get("chip_prior_payouts_sum")) != EXPECTED_CHIP_PRIOR_PAYOUTS_SUM:
        errors.append(
            f"Chip prior payouts sum mismatch: expected {EXPECTED_CHIP_PRIOR_PAYOUTS_SUM}, got {prior.get('chip_prior_payouts_sum')}"
        )
    if int(prior.get("prior_diamond_v2_cancellations", -1)) != EXPECTED_PRIOR_DIAMOND_V2_CANCELLATIONS:
        errors.append(
            f"Prior Diamond v2 cancellations mismatch: expected {EXPECTED_PRIOR_DIAMOND_V2_CANCELLATIONS}, got {prior.get('prior_diamond_v2_cancellations')}"
        )
    if _dec(prior.get("prior_diamond_overdue_refund_sum")) != EXPECTED_PRIOR_DIAMOND_OVERDUE_REFUND_SUM:
        errors.append(
            f"Prior Diamond overdue refund sum mismatch: expected {EXPECTED_PRIOR_DIAMOND_OVERDUE_REFUND_SUM}, got {prior.get('prior_diamond_overdue_refund_sum')}"
        )
    if prior.get("diamond_arena_closed") is not True:
        errors.append("ca_diamond_arena_owner_closure.closed must be True")

    excl = snapshot.get("excluded_event_16761305", {})
    if str(excl.get("tournament_id", "")) != EXCLUDED_MYSTERY_BOUNTY_ID:
        errors.append(f"excluded_event_16761305.tournament_id must be {EXCLUDED_MYSTERY_BOUNTY_ID}")
    if excl.get("in_139_scope") is not False:
        errors.append("excluded_event_16761305.in_139_scope must be False")
    if excl.get("abort_target_present") is not False:
        errors.append("excluded_event_16761305.abort_target_present must be False")
    if int(excl.get("earned_mystery_bounties_count", -1)) != 3 or _dec(excl.get("earned_mystery_bounties_sum")) != Decimal("253.10"):
        errors.append("excluded_event_16761305 earned mystery bounties (3 / 253.10 Chips) must remain preserved")

    return {
        "ok": len(errors) == 0,
        "mode": "preflight",
        "include_proby": include_proby,
        "event_count": len(events),
        "chip_summary": {
            "events": chip_count,
            "eligible_players": chip_players,
            "prize_balance": str(chip_prize),
            "bounty_balance": str(chip_bounty),
            "fee_balance": str(chip_fee),
        },
        "diamond_summary": {
            "events": diamond_count,
            "original89_events": diamond_orig89_count,
            "other26_25_events": diamond_other26_count,
            "eligible_players": diamond_players,
            "prize_balance": str(diamond_prize),
            "bounty_balance": str(diamond_bounty),
            "distributable_total": str(diamond_prize + diamond_bounty),
            "fee_balance": str(diamond_fee),
            "active_custody_rows": EXPECTED_DIAMOND_CUSTODY_ROWS,
        },
        "errors": errors,
    }


def verify_remaining_138_postsettle(snapshot: Mapping[str, Any]) -> dict[str, Any]:
    """Independently verify all 138 remaining (and 139 total) equal-share settlements."""
    errors: list[str] = []

    events = snapshot.get("events")
    if not isinstance(events, list):
        return {"ok": False, "mode": "postsettle", "errors": ["events must be a list"]}

    seen_ids: set[str] = set()
    for ev in events:
        tid = str(ev.get("tournament_id", ""))
        if tid == EXCLUDED_MYSTERY_BOUNTY_ID:
            errors.append(
                f"Event {EXCLUDED_MYSTERY_BOUNTY_ID} must never appear in settled 139 scope"
            )
        if tid in seen_ids:
            errors.append(f"Duplicate tournament_id in postsettle snapshot: {tid}")
        seen_ids.add(tid)

    include_proby = PROBY_TOURNAMENT_ID in seen_ids
    expected_map = CANONICAL_139_BY_ID if include_proby else CANONICAL_138_REMAINING_BY_ID
    expected_total_count = 139 if include_proby else 138

    if len(events) != expected_total_count:
        errors.append(f"Expected {expected_total_count} settled events, found {len(events)}")

    missing_ids = sorted(set(expected_map.keys()) - seen_ids)
    unexpected_ids = sorted(seen_ids - set(expected_map.keys()) - {EXCLUDED_MYSTERY_BOUNTY_ID})
    if missing_ids:
        errors.append(f"Missing settled tournament_ids ({len(missing_ids)}): {missing_ids[:5]}")
    if unexpected_ids:
        errors.append(f"Unexpected settled tournament_ids ({len(unexpected_ids)}): {unexpected_ids[:5]}")

    chip_settled_events = 0
    chip_settled_players = 0
    chip_prize_distributed = Decimal("0.00")
    chip_bounty_distributed = Decimal("0.00")
    chip_fee_settled = Decimal("0.00")

    diamond_settled_events = 0
    diamond_settled_players = 0
    diamond_prize_distributed = Decimal("0")
    diamond_bounty_distributed = Decimal("0")
    diamond_fee_settled = Decimal("0")
    diamond_house_mint_total = Decimal("0")
    diamond_player_burn_total = Decimal("0")

    for ev in events:
        tid = str(ev.get("tournament_id", ""))
        canonical = expected_map.get(tid)
        if canonical is None:
            continue

        asset = canonical["asset"]
        exp_op_id = canonical["operation_id"]
        exp_players = int(canonical["eligible_players"])
        exp_prize = _dec(canonical["prize_balance"])
        exp_bounty = _dec(canonical["bounty_balance"])
        exp_fee = _dec(canonical["fee_balance"])
        exp_total = exp_prize + exp_bounty

        if str(ev.get("operation_id", "")) != exp_op_id:
            errors.append(f"Event {tid} operation_id mismatch: expected {exp_op_id}, got {ev.get('operation_id')}")
        if str(ev.get("abort_state", "")) != "settled":
            errors.append(f"Event {tid} abort_state must be 'settled', got {ev.get('abort_state')}")
        if str(ev.get("status", "")) != "CANCELLED":
            errors.append(f"Event {tid} tournament status must be 'CANCELLED', got {ev.get('status')}")
        if int(ev.get("current_players", -1)) != 0:
            errors.append(f"Event {tid} current_players must be 0, got {ev.get('current_players')}")
        if not ev.get("settled_at") or ev.get("ended_at") != ev.get("settled_at"):
            errors.append(f"Event {tid} ended_at must equal settled_at ({ev.get('ended_at')} vs {ev.get('settled_at')})")

        # Runtime & table/seat/custody/escrow terminal checks
        if int(ev.get("active_seats", -1)) != 0:
            errors.append(f"Event {tid} active_seats must be 0, got {ev.get('active_seats')}")
        if int(ev.get("active_players", -1)) != 0:
            errors.append(f"Event {tid} active_players must be 0, got {ev.get('active_players')}")
        if int(ev.get("open_tables", -1)) != 0:
            errors.append(f"Event {tid} open_tables must be 0, got {ev.get('open_tables')}")
        if int(ev.get("remaining_leases", -1)) != 0:
            errors.append(f"Event {tid} remaining_leases must be 0, got {ev.get('remaining_leases')}")
        if int(ev.get("refund_tranches", -1)) != 0:
            errors.append(f"Event {tid} refund_tranches must be 0, got {ev.get('refund_tranches')}")

        escrow_after = ev.get("escrow_after", {})
        if (
            _dec(escrow_after.get("prize_balance", -1)) != Decimal("0")
            or _dec(escrow_after.get("bounty_balance", -1)) != Decimal("0")
            or _dec(escrow_after.get("fee_balance", -1)) != Decimal("0")
            or not escrow_after.get("closed_at")
            or str(escrow_after.get("close_note", "")) != "operator_abort_equal_share"
        ):
            errors.append(f"Event {tid} escrow_after is not zeroed and closed with operator_abort_equal_share")

        # Receipt v4 checks
        receipt = ev.get("receipt", {})
        if int(receipt.get("receipt_version", -1)) != 4:
            errors.append(f"Event {tid} receipt_version must be 4, got {receipt.get('receipt_version')}")
        if str(receipt.get("mode", "")) != "started_operator_equal_share":
            errors.append(f"Event {tid} receipt.mode must be 'started_operator_equal_share', got {receipt.get('mode')}")
        if str(receipt.get("operation_id", "")) != exp_op_id:
            errors.append(f"Event {tid} receipt.operation_id mismatch")
        if int(receipt.get("eligible_player_count", -1)) != exp_players:
            errors.append(f"Event {tid} receipt eligible_player_count mismatch: expected {exp_players}")
        pre_abort_roster = receipt.get("pre_abort_roster")
        if pre_abort_roster is not None and (not isinstance(pre_abort_roster, list) or len(pre_abort_roster) < exp_players):
            errors.append(f"Event {tid} receipt.pre_abort_roster must preserve at least {exp_players} rows")
        if int(ev.get("preactivation_mystery_cache_remaining", 0)) != 0:
            errors.append(f"Event {tid} has unretired preactivation_mystery_cache_remaining")

        fin = receipt.get("financial", {})
        if str(fin.get("asset", "")) != asset:
            errors.append(f"Event {tid} financial.asset mismatch: expected {asset}, got {fin.get('asset')}")
        if _dec(fin.get("prize_before")) != exp_prize or _dec(fin.get("prize_distributed")) != exp_prize or _dec(fin.get("prize_after", -1)) != Decimal("0"):
            errors.append(f"Event {tid} financial prize fields mismatch")
        if _dec(fin.get("bounty_before")) != exp_bounty or _dec(fin.get("bounty_distributed")) != exp_bounty or _dec(fin.get("bounty_after", -1)) != Decimal("0"):
            errors.append(f"Event {tid} financial bounty fields mismatch")
        if _dec(fin.get("fee_before")) != exp_fee or _dec(fin.get("fee_after", -1)) != Decimal("0") or _dec(fin.get("fees_reversed", -1)) != Decimal("0"):
            errors.append(f"Event {tid} financial fee fields mismatch")
        if _dec(fin.get("total_distributed")) != exp_total:
            errors.append(f"Event {tid} financial.total_distributed mismatch: expected {exp_total}, got {fin.get('total_distributed')}")
        if _dec(fin.get("total_rake_before")) != _dec(fin.get("total_rake_after", -1)):
            errors.append(f"Event {tid} total_rake_after must equal total_rake_before")

        shares = fin.get("shares")
        if not isinstance(shares, list) or len(shares) != exp_players:
            errors.append(f"Event {tid} financial.shares must be a list of length {exp_players}")
        else:
            computed_md5 = compute_pg_shares_md5(shares, asset)
            recorded_md5 = str(ev.get("allocation_hash") or receipt.get("allocation_hash") or "")
            if not recorded_md5:
                errors.append(f"Event {tid} missing recorded allocation_hash")
            elif computed_md5 != recorded_md5:
                errors.append(f"Event {tid} allocation_hash mismatch: computed {computed_md5} != recorded {recorded_md5}")
            sum_share_prize = sum((_dec(s.get("prize")) for s in shares), Decimal("0"))
            sum_share_bounty = sum((_dec(s.get("bounty")) for s in shares), Decimal("0"))
            sum_share_amount = sum((_dec(s.get("amount")) for s in shares), Decimal("0"))
            if sum_share_prize != exp_prize or sum_share_bounty != exp_bounty or sum_share_amount != exp_total:
                errors.append(f"Event {tid} shares sum mismatch vs escrow pre-image")

        # Ledger & credit receipt verification per asset
        ledger = ev.get("ledger_proof", {})
        if isinstance(shares, list) and len(shares) == exp_players:
            calc_pos_prize_legs = sum(1 for s in shares if _dec(s.get("prize")) > 0)
            calc_pos_bounty_legs = sum(1 for s in shares if _dec(s.get("bounty")) > 0)
        else:
            calc_pos_prize_legs = exp_players if exp_prize > 0 else 0
            calc_pos_bounty_legs = exp_players if exp_bounty > 0 else 0

        pos_prize_legs = int(ledger.get("positive_prize_legs", calc_pos_prize_legs))
        pos_bounty_legs = int(ledger.get("positive_bounty_legs", calc_pos_bounty_legs))
        if pos_prize_legs != calc_pos_prize_legs or pos_bounty_legs != calc_pos_bounty_legs:
            errors.append(
                f"Event {tid} positive_prize_legs/positive_bounty_legs ({pos_prize_legs}/{pos_bounty_legs}) != share-derived legs ({calc_pos_prize_legs}/{calc_pos_bounty_legs})"
            )
        expected_credit_legs = calc_pos_prize_legs + calc_pos_bounty_legs

        if int(ledger.get("wallet_credit_idempotency_rows", -1)) != expected_credit_legs:
            errors.append(
                f"Event {tid} wallet_credit_idempotency_rows ({ledger.get('wallet_credit_idempotency_rows')}) != expected_credit_legs ({expected_credit_legs})"
            )
        if int(ledger.get("equal_share_payout_rows", -1)) != calc_pos_prize_legs:
            errors.append(
                f"Event {tid} tournament_payouts rows ({ledger.get('equal_share_payout_rows')}) != positive_prize_legs ({calc_pos_prize_legs})"
            )
        if _dec(ledger.get("equal_share_payout_sum")) != exp_prize:
            errors.append(
                f"Event {tid} tournament_payouts sum ({ledger.get('equal_share_payout_sum')}) != exp_prize ({exp_prize})"
            )

        rake_row = ev.get("rake_settlement", {})
        if _dec(rake_row.get("amount")) != exp_fee:
            errors.append(f"Event {tid} rake_settlement.amount ({rake_row.get('amount')}) != exp_fee ({exp_fee})")
        if not rake_row.get("settled_at") or not rake_row.get("attributed_at") or rake_row.get("attribution_error") is not None:
            errors.append(f"Event {tid} rake_settlement missing settled_at/attributed_at or has attribution_error")

        if asset == "chips":
            if int(ledger.get("accounting_credit_receipts", -1)) != expected_credit_legs:
                errors.append(f"Chip event {tid} accounting_credit_receipts != {expected_credit_legs}")
            if int(ledger.get("chip_ledger_rows", -1)) != expected_credit_legs:
                errors.append(f"Chip event {tid} chip_ledger_rows != {expected_credit_legs}")
            if int(ledger.get("wallet_transaction_rows", -1)) != expected_credit_legs:
                errors.append(f"Chip event {tid} wallet_transaction_rows != {expected_credit_legs}")
            if _dec(ledger.get("chip_ledger_sum")) != exp_total or _dec(ledger.get("wallet_transaction_sum")) != exp_total:
                errors.append(f"Chip event {tid} chip_ledger/wallet_transaction sum != {exp_total}")
            expected_dest = f"union:{CHIP_UNION_ID}" if exp_fee > 0 else "none"
            if str(rake_row.get("destination", "")) != expected_dest:
                errors.append(f"Chip event {tid} rake destination mismatch: expected {expected_dest}, got {rake_row.get('destination')}")

            chip_settled_events += 1
            chip_settled_players += exp_players
            chip_prize_distributed += exp_prize
            chip_bounty_distributed += exp_bounty
            chip_fee_settled += exp_fee
        else:
            if int(ledger.get("diamond_ledger_pay_rows", -1)) != expected_credit_legs:
                errors.append(f"Diamond event {tid} diamond_ledger_pay_rows != {expected_credit_legs}")
            if int(ledger.get("diamond_arena_withdraw_rows", -1)) != expected_credit_legs:
                errors.append(f"Diamond event {tid} diamond_arena_withdraw_rows != {expected_credit_legs}")
            if _dec(ledger.get("diamond_ledger_pay_sum")) != exp_total or _dec(ledger.get("diamond_arena_withdraw_sum")) != exp_total:
                errors.append(f"Diamond event {tid} diamond_ledger_pay_sum / arena_withdraw_sum != {exp_total}")
            if _dec(ledger.get("diamond_release_movements_sum")) != exp_total:
                errors.append(f"Diamond event {tid} poker_diamond_movements release sum != {exp_total}")
            if int(ev.get("pending_custody_rows", -1)) != 0 or _dec(ev.get("remaining_custody_balance", -1)) != Decimal("0"):
                errors.append(f"Diamond event {tid} still holds unreleased custody")
            if int(ev.get("open_guarantee_earmark", -1)) != 0:
                errors.append(f"Diamond event {tid} open_guarantee_earmark must be 0")

            if tid in DIAMOND_FREEBUY_ZERO_FEE_IDS:
                if exp_fee != Decimal("0") or str(rake_row.get("destination", "")) != "none":
                    errors.append(f"Freebuy Diamond event {tid} must have fee=0 and destination='none'")
            else:
                if str(rake_row.get("destination", "")) != "diamond_house":
                    errors.append(f"Diamond event {tid} rake destination must be 'diamond_house', got {rake_row.get('destination')}")
                if _dec(ledger.get("diamond_fee_ledger_amount")) != exp_fee:
                    errors.append(f"Diamond event {tid} poker_diamond_tournament_ledger fee amount != {exp_fee}")
                if _dec(ledger.get("ca_mint_player_burn_sum")) != exp_fee:
                    errors.append(f"Diamond event {tid} ca_mint_ledger player burn sum != {exp_fee}")
                if _dec(ledger.get("ca_mint_house_mint_amount")) != exp_fee or str(ledger.get("ca_mint_house_holder_id", "")) != DIAMOND_HOUSE_HOLDER_ID:
                    errors.append(f"Diamond event {tid} ca_mint_ledger house mint ({DIAMOND_HOUSE_HOLDER_ID}) != {exp_fee}")
                diamond_house_mint_total += _dec(ledger.get("ca_mint_house_mint_amount"))
                diamond_player_burn_total += _dec(ledger.get("ca_mint_player_burn_sum"))

            diamond_settled_events += 1
            diamond_settled_players += exp_players
            diamond_prize_distributed += exp_prize
            diamond_bounty_distributed += exp_bounty
            diamond_fee_settled += exp_fee

        # Original-hand dispositions & final equal_ack runtime retirement
        disp = ev.get("hand_dispositions", {})
        if int(disp.get("reserved_permits_remaining", -1)) != 0:
            errors.append(f"Event {tid} still has reserved_permits_remaining={disp.get('reserved_permits_remaining')}")
        if int(disp.get("aborted_unsettled_permits", 0)) != int(disp.get("disposition_receipts", 0)):
            errors.append(f"Event {tid} aborted_unsettled_permits != disposition_receipts")

        retire = ev.get("runtime_retirement", {})
        if str(retire.get("outcome", "")) != "equal_share_runtime_retired" or retire.get("runtime_retired") is not True:
            errors.append(f"Event {tid} missing final native equal_ack (equal_share_runtime_retired)")

    exp_chip_events = EXPECTED_CHIP_ALL124_EVENTS if include_proby else EXPECTED_CHIP_REMAINING123_EVENTS
    exp_chip_players = EXPECTED_CHIP_ALL124_PLAYERS if include_proby else EXPECTED_CHIP_REMAINING123_PLAYERS
    exp_chip_prize = EXPECTED_CHIP_ALL124_PRIZE if include_proby else EXPECTED_CHIP_REMAINING123_PRIZE
    exp_chip_fee = EXPECTED_CHIP_ALL124_FEE if include_proby else EXPECTED_CHIP_REMAINING123_FEE

    if chip_settled_events != exp_chip_events or chip_settled_players != exp_chip_players:
        errors.append(f"Chip settled events/players mismatch: got {chip_settled_events}/{chip_settled_players}")
    if chip_prize_distributed != exp_chip_prize or chip_bounty_distributed != EXPECTED_CHIP_ALL124_BOUNTY or chip_fee_settled != exp_chip_fee:
        errors.append(f"Chip settled totals mismatch: prize={chip_prize_distributed} bounty={chip_bounty_distributed} fee={chip_fee_settled}")

    if diamond_settled_events != EXPECTED_DIAMOND_ALL15_EVENTS or diamond_settled_players != EXPECTED_DIAMOND_ALL15_PLAYERS:
        errors.append(f"Diamond settled events/players mismatch: got {diamond_settled_events}/{diamond_settled_players}")
    if (
        diamond_prize_distributed != EXPECTED_DIAMOND_ALL15_PRIZE
        or diamond_bounty_distributed != EXPECTED_DIAMOND_ALL15_BOUNTY
        or diamond_fee_settled != EXPECTED_DIAMOND_ALL15_FEE
        or diamond_house_mint_total != EXPECTED_DIAMOND_ALL15_FEE
        or diamond_player_burn_total != EXPECTED_DIAMOND_ALL15_FEE
    ):
        errors.append(
            f"Diamond settled totals mismatch: prize={diamond_prize_distributed} bounty={diamond_bounty_distributed} fee={diamond_fee_settled} house_mint={diamond_house_mint_total} player_burn={diamond_player_burn_total}"
        )

    custody_after = snapshot.get("diamond_custody_after", {})
    if (
        int(custody_after.get("released_custody_rows", -1)) != EXPECTED_DIAMOND_CUSTODY_ROWS
        or int(custody_after.get("unreleased_custody_rows", -1)) != 0
        or _dec(custody_after.get("remaining_custody_balance", -1)) != Decimal("0")
        or int(custody_after.get("open_guarantee_earmarks", -1)) != 0
        or int(custody_after.get("earmark_ledger_rows", -1)) != EXPECTED_DIAMOND_EARMARK_LEDGER_ROWS
    ):
        errors.append("diamond_custody_after failed 1,436 released / 0 remaining custody / 0 open earmark / 39 preserved earmark rows invariant")

    prior_after = snapshot.get("prior_awards_and_closures_after", {})
    if (
        int(prior_after.get("diamond_prior_prize_count", -1)) != EXPECTED_DIAMOND_PRIOR_PRIZE_COUNT
        or _dec(prior_after.get("diamond_prior_prize_sum")) != EXPECTED_DIAMOND_PRIOR_PRIZE_SUM
        or int(prior_after.get("diamond_prior_bounty_obligations", -1)) != EXPECTED_DIAMOND_PRIOR_BOUNTY_OBLIGATIONS
        or int(prior_after.get("diamond_prior_bounty_legs", -1)) != EXPECTED_DIAMOND_PRIOR_BOUNTY_LEGS
        or _dec(prior_after.get("diamond_prior_bounty_sum")) != EXPECTED_DIAMOND_PRIOR_BOUNTY_SUM
        or int(prior_after.get("diamond_unpaid_bounty_obligations", -1)) != 0
        or int(prior_after.get("chip_prior_payouts_count", -1)) != EXPECTED_CHIP_PRIOR_PAYOUTS_COUNT
        or _dec(prior_after.get("chip_prior_payouts_sum")) != EXPECTED_CHIP_PRIOR_PAYOUTS_SUM
        or int(prior_after.get("prior_diamond_v2_cancellations", -1)) != EXPECTED_PRIOR_DIAMOND_V2_CANCELLATIONS
        or _dec(prior_after.get("prior_diamond_overdue_refund_sum")) != EXPECTED_PRIOR_DIAMOND_OVERDUE_REFUND_SUM
        or prior_after.get("diamond_arena_closed") is not True
    ):
        errors.append("prior_awards_and_closures_after failed preservation check for prior awards, v2 cancellations, or Diamond Arena closure")

    excl_after = snapshot.get("excluded_event_16761305", {})
    if (
        str(excl_after.get("tournament_id", "")) != EXCLUDED_MYSTERY_BOUNTY_ID
        or excl_after.get("in_139_scope") is not False
        or excl_after.get("abort_target_present") is not False
        or excl_after.get("v4_receipt_present") is not False
        or int(excl_after.get("earned_mystery_bounties_count", -1)) != 3
        or _dec(excl_after.get("earned_mystery_bounties_sum")) != Decimal("253.10")
    ):
        errors.append("excluded_event_16761305 failed post-settlement exclusion and mystery bounty preservation check")

    return {
        "ok": len(errors) == 0,
        "mode": "postsettle",
        "include_proby": include_proby,
        "settled_event_count": len(events),
        "chip_reconciliation": {
            "settled_events": chip_settled_events,
            "settled_players": chip_settled_players,
            "prize_distributed": str(chip_prize_distributed),
            "bounty_distributed": str(chip_bounty_distributed),
            "fee_settled": str(chip_fee_settled),
        },
        "diamond_reconciliation": {
            "settled_events": diamond_settled_events,
            "settled_players": diamond_settled_players,
            "prize_distributed": str(diamond_prize_distributed),
            "bounty_distributed": str(diamond_bounty_distributed),
            "distributable_total": str(diamond_prize_distributed + diamond_bounty_distributed),
            "fee_settled_to_diamond_house": str(diamond_fee_settled),
            "ca_mint_player_burn_total": str(diamond_player_burn_total),
            "ca_mint_house_mint_total": str(diamond_house_mint_total),
            "released_custody_rows": EXPECTED_DIAMOND_CUSTODY_ROWS,
            "remaining_custody_balance": "0",
        },
        "errors": errors,
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("preflight", "postsettle"), required=True)
    parser.add_argument("--input", required=True, help="Path to JSON snapshot file (or '-' for stdin)")
    args = parser.parse_args(argv)

    if args.input == "-":
        payload = json.load(sys.stdin)
    else:
        payload = json.loads(Path(args.input).read_text(encoding="utf-8"))

    if args.mode == "preflight":
        result = verify_remaining_138_preflight(payload)
    else:
        result = verify_remaining_138_postsettle(payload)

    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
