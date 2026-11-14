/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HU BIG BLIND DEFENDS TO ITS PRICE (2026-11-07, flag huBbDefendsToPrice,
 * default OFF)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * MEASURED (real HorseLogic.decide, live cash Hybrid persona, 80bb, 4,000
 * samples per class): heads-up, the small blind opens 71.3% to ~2.5-3bb, and
 * the big blind facing it flats 34.0%, 3-bets 8.6% and FOLDS 57.4% - T6s,
 * 96s, Q9o and K5o all fold. Two-handed tables never reach the V72 per-seat
 * defence (it needs three or more dealt in), so the V11 heads-up bars decide:
 * a flat call bar of t(0.30) less the 0.06 big-blind discount (~0.27 on the
 * holdemPreflopScore ladder for the grinder's tightness, ~43% of hands) and
 * the V34 floor of 0.30. Neither reads the price or the opener's width, and
 * a human who opens every button wins the blinds most of the time.
 *
 * THE CORRECTION. The big blind continues with every hand whose all-in
 * equity against the opener's range, discounted for playing the hand out of
 * position, covers the pot odds:
 *
 *     equity(class vs top W% of the HU open order) * REALIZATION >= odds
 *     odds = call / (pot + call)   (rake-aware, preflopCallOdds)
 *
 * W is the opener's MEASURED width: the opponent read's raise-first-in /
 * PFR posterior (HorseOpponentExploit.openerRangeWidth) when it is engaged,
 * otherwise the heads-up small blind's reference open (V70 OPEN_TARGET_HU,
 * 72% cash - what the horses measurably open). The equity table below is
 * Monte Carlo (scripts/generate-hu-bb-defence-equity.ts, fixed seed), the
 * order of the opener's range is the V70 heads-up open order.
 *
 * Widen-only: it turns a FOLD of the existing heads-up defence into a CALL.
 * Value 3-bets, bluff 3-bets and every call the old bars made are unchanged.
 * Scope: no-limit hold'em cash, exactly two dealt in, hero the big blind
 * facing the only raise (no limp, no caller), open <= 6bb, 20-150bb
 * effective. Short deck, Omaha, pot and fixed limit, tournaments, straddles
 * and all-in-or-fold tables keep today's answer.
 */

/** Opener widths (percent of 1,326) the equity table is written at. */
export const HU_BB_EQUITY_WIDTHS = [20, 30, 40, 50, 60, 70, 80, 90, 100] as const;

/**
 * Share of its all-in equity the out-of-position big blind realises heads-up
 * at 20-150bb. Published solver realisation for the big blind against a
 * late-position open sits around 0.75-0.85 for the defended range; 0.8 is the
 * centre of that band.
 */
export const HU_BB_REALIZATION = 0.8;

/** Effective stack band (big blinds) the correction applies in. */
export const HU_BB_MIN_STACK_BB = 20;
export const HU_BB_MAX_STACK_BB = 150;
/** Largest open (raised-to, big blinds) the correction answers. */
export const HU_BB_MAX_OPEN_BB = 6;

/**
 * All-in equity (per mille) of each class against the top W% of the heads-up
 * small blind's open order, W = HU_BB_EQUITY_WIDTHS. Generated, not edited:
 * scripts/generate-hu-bb-defence-equity.ts 40000.
 */
export const HU_BB_EQUITY: Readonly<Record<string, readonly number[]>> = {
  AA: [840, 838, 841, 843, 846, 845, 853, 851, 852],
  AKs: [623, 638, 655, 660, 668, 668, 669, 672, 668],
  AQs: [595, 611, 630, 641, 646, 652, 654, 660, 660],
  AJs: [560, 596, 615, 627, 631, 636, 646, 650, 655],
  ATs: [533, 569, 596, 607, 618, 631, 636, 642, 645],
  A9s: [485, 536, 563, 586, 593, 604, 615, 624, 627],
  A8s: [472, 515, 548, 568, 586, 595, 607, 616, 619],
  A7s: [462, 495, 529, 549, 571, 582, 595, 602, 614],
  A6s: [450, 477, 514, 535, 552, 570, 583, 591, 598],
  A5s: [454, 483, 512, 531, 553, 568, 577, 588, 603],
  A4s: [444, 479, 501, 521, 548, 554, 570, 581, 587],
  A3s: [444, 471, 490, 518, 535, 552, 561, 568, 583],
  A2s: [442, 462, 486, 509, 531, 545, 549, 561, 577],
  AKo: [606, 620, 634, 641, 649, 644, 652, 653, 657],
  KK: [761, 774, 775, 786, 798, 801, 813, 817, 827],
  KQs: [507, 532, 545, 574, 596, 610, 622, 628, 634],
  KJs: [476, 516, 530, 560, 583, 593, 607, 619, 629],
  KTs: [446, 497, 512, 548, 574, 583, 598, 606, 620],
  K9s: [415, 465, 486, 518, 546, 566, 575, 590, 596],
  K8s: [399, 452, 469, 501, 525, 547, 555, 572, 585],
  K7s: [400, 437, 465, 485, 515, 540, 551, 565, 577],
  K6s: [396, 435, 461, 477, 500, 522, 538, 554, 568],
  K5s: [386, 424, 446, 466, 486, 515, 527, 541, 554],
  K4s: [381, 419, 437, 464, 478, 500, 520, 540, 551],
  K3s: [383, 412, 437, 451, 466, 486, 513, 523, 539],
  K2s: [379, 403, 426, 451, 465, 485, 504, 510, 533],
  AQo: [570, 598, 612, 621, 630, 637, 638, 638, 643],
  KQo: [478, 510, 520, 551, 571, 587, 599, 609, 616],
  QQ: [707, 726, 737, 751, 756, 769, 782, 789, 801],
  QJs: [439, 478, 495, 528, 537, 553, 576, 587, 602],
  QTs: [413, 455, 485, 515, 520, 550, 569, 585, 595],
  Q9s: [392, 432, 462, 490, 504, 527, 545, 563, 578],
  Q8s: [378, 415, 451, 460, 485, 508, 525, 544, 561],
  Q7s: [363, 401, 431, 445, 462, 493, 509, 526, 539],
  Q6s: [369, 395, 420, 443, 458, 481, 496, 521, 539],
  Q5s: [358, 398, 421, 435, 447, 472, 494, 511, 525],
  Q4s: [351, 384, 409, 431, 440, 459, 479, 502, 518],
  Q3s: [347, 379, 403, 428, 429, 455, 469, 496, 515],
  Q2s: [346, 375, 398, 416, 427, 450, 465, 481, 503],
  AJo: [538, 566, 598, 606, 616, 617, 625, 632, 638],
  KJo: [450, 486, 505, 535, 558, 572, 583, 598, 607],
  QJo: [407, 446, 475, 499, 514, 533, 557, 572, 586],
  JJ: [655, 681, 700, 715, 729, 738, 751, 760, 776],
  JTs: [387, 438, 466, 491, 505, 523, 537, 565, 571],
  J9s: [380, 420, 450, 465, 485, 503, 521, 538, 558],
  J8s: [370, 404, 425, 445, 465, 483, 503, 522, 543],
  J7s: [356, 386, 417, 427, 443, 468, 480, 504, 523],
  J6s: [343, 375, 401, 414, 427, 443, 463, 485, 504],
  J5s: [340, 372, 392, 410, 429, 441, 458, 479, 500],
  J4s: [335, 368, 387, 402, 416, 436, 448, 470, 493],
  J3s: [330, 358, 382, 398, 411, 429, 438, 466, 476],
  J2s: [323, 351, 374, 391, 403, 418, 434, 452, 474],
  ATo: [506, 546, 577, 591, 597, 610, 611, 624, 626],
  KTo: [419, 469, 482, 520, 541, 558, 574, 583, 597],
  QTo: [383, 427, 457, 484, 494, 523, 544, 559, 573],
  JTo: [356, 404, 439, 462, 478, 495, 517, 537, 549],
  TT: [597, 646, 666, 684, 704, 711, 725, 740, 752],
  T9s: [378, 413, 433, 450, 470, 487, 504, 520, 536],
  T8s: [363, 395, 421, 435, 450, 469, 481, 504, 524],
  T7s: [354, 381, 403, 414, 438, 452, 460, 483, 512],
  T6s: [335, 370, 390, 401, 420, 436, 445, 472, 493],
  T5s: [324, 359, 373, 388, 406, 417, 428, 456, 472],
  T4s: [315, 357, 370, 387, 399, 412, 423, 445, 465],
  T3s: [316, 350, 366, 377, 391, 409, 414, 438, 463],
  T2s: [309, 343, 353, 373, 386, 400, 405, 427, 453],
  A9o: [453, 504, 539, 565, 572, 583, 596, 599, 606],
  K9o: [386, 436, 459, 494, 523, 541, 552, 572, 582],
  Q9o: [354, 402, 431, 463, 476, 505, 521, 538, 553],
  J9o: [346, 385, 415, 438, 455, 473, 497, 511, 533],
  T9o: [342, 380, 409, 420, 437, 461, 468, 494, 515],
  '99': [550, 600, 630, 650, 667, 686, 693, 710, 722],
  '98s': [382, 400, 417, 421, 440, 458, 473, 489, 510],
  '97s': [369, 389, 408, 410, 427, 442, 455, 474, 491],
  '96s': [359, 377, 391, 398, 415, 430, 438, 458, 472],
  '95s': [343, 364, 373, 387, 397, 408, 419, 438, 455],
  '94s': [325, 348, 358, 368, 376, 393, 407, 423, 441],
  '93s': [322, 348, 358, 363, 378, 393, 399, 415, 437],
  '92s': [321, 339, 343, 357, 372, 384, 393, 409, 425],
  A8o: [441, 479, 518, 546, 561, 574, 575, 592, 598],
  K8o: [374, 415, 442, 469, 496, 517, 534, 546, 554],
  Q8o: [344, 382, 416, 439, 455, 481, 501, 518, 538],
  J8o: [336, 366, 403, 413, 433, 451, 474, 493, 512],
  T8o: [330, 362, 391, 393, 423, 442, 450, 481, 497],
  '98o': [347, 368, 388, 393, 411, 433, 441, 465, 481],
  '88': [526, 569, 600, 615, 637, 652, 663, 678, 689],
  '87s': [372, 392, 410, 412, 422, 433, 449, 463, 482],
  '86s': [363, 381, 392, 400, 406, 422, 429, 448, 457],
  '85s': [351, 368, 375, 383, 395, 408, 419, 431, 444],
  '84s': [330, 354, 369, 368, 377, 397, 396, 412, 425],
  '83s': [319, 339, 346, 352, 359, 377, 382, 395, 411],
  '82s': [319, 331, 346, 348, 362, 375, 382, 394, 405],
  A7o: [431, 467, 501, 523, 546, 560, 573, 582, 585],
  K7o: [370, 407, 431, 455, 483, 506, 526, 536, 553],
  Q7o: [331, 360, 399, 412, 432, 462, 484, 498, 516],
  J7o: [317, 349, 383, 393, 412, 432, 456, 476, 494],
  T7o: [317, 349, 372, 384, 403, 420, 432, 459, 478],
  '97o': [335, 353, 369, 379, 398, 410, 419, 440, 462],
  '87o': [344, 357, 376, 375, 390, 407, 421, 435, 452],
  '77': [509, 546, 572, 587, 600, 618, 635, 650, 662],
  '76s': [369, 390, 397, 403, 409, 420, 429, 443, 452],
  '75s': [357, 369, 383, 389, 393, 405, 413, 423, 438],
  '74s': [344, 355, 364, 375, 381, 388, 395, 405, 420],
  '73s': [329, 339, 350, 350, 365, 373, 379, 390, 401],
  '72s': [309, 325, 331, 340, 347, 354, 366, 370, 382],
  A6o: [419, 458, 486, 506, 528, 541, 558, 566, 580],
  K6o: [364, 402, 423, 443, 470, 495, 515, 530, 541],
  Q6o: [330, 362, 391, 416, 424, 451, 475, 498, 511],
  J6o: [302, 337, 366, 380, 396, 407, 439, 458, 477],
  T6o: [302, 340, 354, 367, 384, 398, 414, 435, 462],
  '96o': [320, 338, 355, 367, 382, 398, 404, 422, 448],
  '86o': [326, 349, 359, 361, 372, 389, 398, 416, 428],
  '76o': [332, 349, 365, 368, 380, 392, 396, 409, 420],
  '66': [483, 524, 556, 554, 576, 590, 598, 615, 634],
  '65s': [359, 371, 384, 391, 399, 405, 415, 419, 432],
  '64s': [348, 362, 378, 377, 382, 394, 393, 401, 409],
  '63s': [335, 352, 357, 357, 366, 373, 378, 382, 395],
  '62s': [313, 329, 341, 349, 350, 356, 359, 370, 375],
  A5o: [422, 455, 484, 507, 525, 540, 553, 564, 574],
  K5o: [356, 395, 415, 443, 458, 483, 504, 519, 532],
  Q5o: [321, 357, 383, 411, 414, 439, 461, 484, 501],
  J5o: [305, 333, 358, 376, 396, 409, 426, 451, 475],
  T5o: [283, 326, 340, 356, 372, 385, 397, 425, 440],
  '95o': [305, 326, 344, 348, 361, 376, 388, 409, 424],
  '85o': [317, 336, 345, 347, 356, 372, 386, 400, 416],
  '75o': [321, 339, 352, 355, 357, 376, 378, 393, 404],
  '65o': [331, 347, 359, 356, 366, 374, 374, 387, 401],
  '55': [459, 500, 527, 531, 549, 562, 575, 585, 603],
  '54s': [357, 373, 381, 388, 386, 393, 402, 403, 411],
  '53s': [346, 358, 364, 371, 377, 380, 387, 386, 395],
  '52s': [327, 348, 346, 356, 357, 359, 369, 373, 376],
  A4o: [419, 448, 471, 498, 521, 533, 542, 559, 571],
  K4o: [351, 383, 403, 432, 446, 474, 493, 508, 520],
  Q4o: [316, 353, 377, 396, 408, 431, 450, 472, 489],
  J4o: [297, 327, 351, 368, 386, 402, 416, 439, 466],
  T4o: [286, 318, 336, 351, 368, 383, 386, 413, 434],
  '94o': [285, 315, 323, 328, 342, 359, 367, 386, 406],
  '84o': [295, 315, 328, 328, 338, 358, 362, 376, 391],
  '74o': [311, 322, 327, 339, 343, 355, 360, 371, 385],
  '64o': [312, 334, 338, 346, 346, 354, 355, 368, 382],
  '54o': [324, 340, 350, 348, 357, 357, 365, 367, 385],
  '44': [444, 485, 505, 511, 525, 535, 546, 552, 573],
  '43s': [335, 354, 356, 366, 366, 372, 380, 381, 386],
  '42s': [322, 334, 340, 345, 356, 358, 359, 365, 374],
  A3o: [408, 438, 466, 489, 509, 524, 534, 544, 556],
  K3o: [345, 379, 399, 421, 442, 460, 482, 501, 511],
  Q3o: [312, 343, 364, 390, 401, 423, 443, 460, 481],
  J3o: [292, 324, 347, 367, 377, 397, 408, 429, 451],
  T3o: [278, 314, 331, 344, 358, 375, 381, 406, 426],
  '93o': [285, 307, 320, 324, 339, 360, 364, 381, 400],
  '83o': [279, 301, 310, 312, 324, 338, 343, 360, 377],
  '73o': [288, 304, 318, 318, 326, 336, 344, 353, 360],
  '63o': [301, 308, 321, 330, 333, 338, 340, 354, 362],
  '53o': [309, 325, 332, 336, 342, 345, 350, 351, 361],
  '43o': [298, 315, 322, 328, 333, 338, 338, 342, 351],
  '33': [427, 466, 483, 496, 501, 508, 520, 518, 542],
  '32s': [314, 325, 335, 345, 350, 351, 354, 361, 363],
  A2o: [406, 431, 457, 483, 501, 515, 528, 537, 552],
  K2o: [342, 373, 390, 416, 437, 456, 475, 489, 500],
  Q2o: [311, 344, 364, 379, 392, 415, 434, 454, 477],
  J2o: [287, 316, 337, 354, 372, 386, 403, 418, 440],
  T2o: [274, 309, 328, 333, 350, 368, 375, 394, 420],
  '92o': [283, 304, 312, 324, 336, 350, 357, 371, 393],
  '82o': [280, 299, 308, 312, 322, 332, 341, 359, 368],
  '72o': [276, 288, 302, 311, 307, 317, 330, 336, 349],
  '62o': [286, 299, 308, 313, 316, 323, 321, 329, 340],
  '52o': [294, 306, 309, 321, 321, 326, 327, 335, 343],
  '42o': [286, 301, 304, 317, 318, 318, 322, 327, 328],
  '32o': [281, 292, 296, 304, 310, 314, 317, 317, 322],
  '22': [420, 441, 463, 472, 482, 484, 494, 497, 504],
};

/** Equity (0..1) of a class against an opener raising the top `widthPct`%. */
export function huBbEquityVsOpener(cls: string, widthPct: number): number | null {
  const row = HU_BB_EQUITY[cls];
  if (!row) return null;
  const ws = HU_BB_EQUITY_WIDTHS;
  const w = Math.max(ws[0], Math.min(ws[ws.length - 1], widthPct));
  for (let i = 1; i < ws.length; i++) {
    if (w <= ws[i]) {
      const f = (w - ws[i - 1]) / (ws[i] - ws[i - 1]);
      return (row[i - 1] + (row[i] - row[i - 1]) * f) / 1000;
    }
  }
  return row[row.length - 1] / 1000;
}

/**
 * ════════════════════════════════════════════════════════════════════════
 * THE OPENER AND THE LIMPER DEFEND TO THEIR PRICE (2026-11-14, HU-NLH-010 and
 * HU-NLH-011; flags huOpenerDefendsToPrice and huLimpDefendsToPrice, both
 * default OFF)
 * ════════════════════════════════════════════════════════════════════════
 *
 * MEASURED (heads-up audit, real HorseLogic.decide). The heads-up button that
 * opened folds 81-92% of its opens to a 3-bet whose break-even is 62.5-67%
 * (22-66, A2s-A9s, AJo fold in 20 of 20 seeds), because two-handed tables
 * never reach the V73 per-seat read and the general bar continues about the
 * top tenth of all hands. The small blind that limped folds 99-100% of its
 * limps to any raise, a min-raise laying 3:1 included.
 *
 * THE CORRECTION is the big blind's, on the other side of the same pot: a
 * fold becomes a call when the class's all-in equity against the raiser's
 * range, discounted for realisation, covers the rake-aware pot odds. The
 * raiser's range is not the opener's, so two things are stated here:
 *
 *  - The table (HU_BB_EQUITY) is written against the top W% of the heads-up
 *    open order, W from 20 to 100. It is read as a LINEAR raising range of
 *    that width. A real 3-betting or limp-raising range of the same width
 *    holds more bluffs than a linear one, so the read errs toward folding.
 *  - With no read on the raiser the width is the narrowest column the table
 *    carries, 20% (HU_DEFENCE_REFERENCE_WIDTH_PCT). The horses' own big
 *    blind raises 17-19% of limps and 3-bets about 9% of opens, so against
 *    an unread horse the opener's reference is wider than the truth; the
 *    table has no narrower column, and the declared evaluation against the
 *    mirror measures what that costs. For the opener an engaged read replaces
 *    it: the share of single raises this player re-raises, which is the
 *    range the call is priced against. For the limper no read measures a
 *    raise over a limp (the raise-first-in and preflop-raise shares count
 *    every open, and a player who opens every button need not raise every
 *    limp), so the reference is never widened. Either way a read NARROWER
 *    than 20% has no column: the rule stands aside and today's fold stays.
 *
 * Realisation: the heads-up small blind is the button and acts last on every
 * later street. The opener's continuing hands are the top 70% it opened and
 * are taken to realise 0.85 of their equity in the re-raised pot; the limp
 * band is the weakest hands the seat plays at all and keeps the big blind's
 * 0.8. Both are assumptions set below one on purpose, not measurements.
 *
 * Widen-only, call-only: neither rule raises, sizes, or removes a call. Scope
 * is the big blind rule's: no-limit hold'em cash, exactly two dealt in,
 * 20-150bb effective, the raiser not all in; never Omaha, short deck, pot or
 * fixed limit, tournaments, straddles or all-in-or-fold tables.
 */
export const HU_DEFENCE_REFERENCE_WIDTH_PCT = 20;
/** Share of its all-in equity the opener realises after calling a 3-bet. */
export const HU_OPENER_REALIZATION = 0.85;
/** Share of its all-in equity a limped hand realises after calling a raise. */
export const HU_LIMP_REALIZATION = 0.8;
/** Largest raise over the limp (raised-to, big blinds) the limper answers. */
export const HU_LIMP_MAX_RAISE_BB = 6;

/**
 * The raiser's width (percent) the price is read against. No read: the
 * reference. A read narrower than the table's narrowest column: null, the
 * rule cannot price the call. A wider read: the read's share when it measures
 * the raise being faced (`readMeasuresTheRaise`, the opener's case), else the
 * reference still.
 */
export function huDefenceWidthPct(
  readShare: number | null,
  readMeasuresTheRaise: boolean
): number | null {
  if (readShare === null) return HU_DEFENCE_REFERENCE_WIDTH_PCT;
  if (!Number.isFinite(readShare)) return null;
  const pct = readShare * 100;
  if (pct < HU_BB_EQUITY_WIDTHS[0]) return null;
  return readMeasuresTheRaise ? Math.min(100, pct) : HU_DEFENCE_REFERENCE_WIDTH_PCT;
}

/** The equity the opener needs against this price once realisation is paid. */
export function huOpenerRequiredEquity(odds: number): number {
  return odds / HU_OPENER_REALIZATION;
}

/** The equity a limped hand needs against this price once realisation is paid. */
export function huLimpRequiredEquity(odds: number): number {
  return odds / HU_LIMP_REALIZATION;
}

/** The equity a class needs against this price once realisation is paid. */
export function huBbRequiredEquity(odds: number): number {
  return odds / HU_BB_REALIZATION;
}

/** Share (percent of 1,326) of classes that continue at this price and width. */
export function huBbDefendShare(
  odds: number,
  widthPct: number,
  combos: (cls: string) => number
): number {
  const need = huBbRequiredEquity(odds);
  let c = 0;
  for (const cls of Object.keys(HU_BB_EQUITY)) {
    if ((huBbEquityVsOpener(cls, widthPct) ?? 0) >= need) c += combos(cls);
  }
  return (100 * c) / 1326;
}
