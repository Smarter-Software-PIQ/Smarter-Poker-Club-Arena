/*
 * equity169.c - all-in preflop equity of every 169-class hold'em hand
 * against every other, for the V71 Nash push/fold table (2026-10-31).
 *
 *   gcc -O3 -march=native -o /tmp/equity169 equity169.c
 *   /tmp/equity169 <samples-per-class-pair> > equity169.tsv
 *
 * For each ordered class pair (a, b), every card-compatible combo pair is
 * equally likely; boards are sampled uniformly from the 48 remaining cards.
 * Output rows: a  b  equity_of_a  compatible_combo_pairs. Deterministic
 * (fixed xorshift seed per pair), so the table regenerates byte for byte.
 */
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>

static const char RANKS[] = "AKQJT98765432"; /* index 0 = ace */

typedef struct { int c1, c2; } Combo;
static Combo combos[169][12];
static int ncombo[169];
static char label[169][4];

/* card = rank(0..12, 12 = ace) * 4 + suit */
static inline int rank_of(int c) { return c >> 2; }
static inline int suit_of(int c) { return c & 3; }

static uint64_t rng;
static inline uint64_t xs(void) { rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17; return rng; }

static inline int hibit(unsigned m) { return 31 - __builtin_clz(m); }

static inline int straight_high(unsigned m13) {
  /* m13: bit r = rank r present (0 = deuce .. 12 = ace). Returns high rank or -1. */
  unsigned m = (m13 << 1) | ((m13 >> 12) & 1); /* bit 0 = ace low */
  unsigned s = m & (m >> 1) & (m >> 2) & (m >> 3) & (m >> 4);
  if (!s) return -1;
  return hibit(s) + 3; /* bit k of s means ranks k..k+4 in the shifted space -> high = k+4-1 */
}

static inline unsigned topn(unsigned m, int n) {
  unsigned out = 0;
  for (int i = 0; i < n && m; i++) { int h = hibit(m); out = (out << 4) | (unsigned)h; m &= ~(1u << h); }
  return out;
}

static unsigned eval7(const int *cards) {
  unsigned suitm[4] = {0, 0, 0, 0};
  int cnt[13] = {0};
  unsigned all = 0;
  for (int i = 0; i < 7; i++) {
    int r = rank_of(cards[i]), s = suit_of(cards[i]);
    suitm[s] |= 1u << r; cnt[r]++; all |= 1u << r;
  }
  int fs = -1;
  for (int s = 0; s < 4; s++) if (__builtin_popcount(suitm[s]) >= 5) fs = s;
  if (fs >= 0) {
    int sh = straight_high(suitm[fs]);
    if (sh >= 0) return (8u << 24) | (unsigned)sh;
  }
  int quad = -1, trips[2] = {-1, -1}, nt = 0, pairs[3] = {-1, -1, -1}, np = 0;
  for (int r = 12; r >= 0; r--) {
    if (cnt[r] == 4) quad = r;
    else if (cnt[r] == 3) { if (nt < 2) trips[nt++] = r; }
    else if (cnt[r] == 2) { if (np < 3) pairs[np++] = r; }
  }
  if (quad >= 0) return (7u << 24) | ((unsigned)quad << 4) | (unsigned)hibit(all & ~(1u << quad));
  if (nt >= 1 && (nt >= 2 || np >= 1)) {
    int p = nt >= 2 ? trips[1] : pairs[0];
    if (nt >= 2 && np >= 1 && pairs[0] > p) p = pairs[0];
    return (6u << 24) | ((unsigned)trips[0] << 4) | (unsigned)p;
  }
  if (fs >= 0) return (5u << 24) | topn(suitm[fs], 5);
  int sh = straight_high(all);
  if (sh >= 0) return (4u << 24) | (unsigned)sh;
  if (nt >= 1) return (3u << 24) | ((unsigned)trips[0] << 8) | topn(all & ~(1u << trips[0]), 2);
  if (np >= 2)
    return (2u << 24) | ((unsigned)pairs[0] << 8) | ((unsigned)pairs[1] << 4) |
           (unsigned)hibit(all & ~(1u << pairs[0]) & ~(1u << pairs[1]));
  if (np == 1) return (1u << 24) | ((unsigned)pairs[0] << 12) | topn(all & ~(1u << pairs[0]), 3);
  return topn(all, 5);
}

static void build_classes(void) {
  int k = 0;
  for (int i = 0; i < 13; i++)
    for (int j = 0; j < 13; j++) {
      int ri = 12 - i, rj = 12 - j; /* engine rank: ace = 12 */
      int n = 0;
      if (i == j) {
        sprintf(label[k], "%c%c", RANKS[i], RANKS[j]);
        for (int s1 = 0; s1 < 4; s1++)
          for (int s2 = s1 + 1; s2 < 4; s2++) combos[k][n++] = (Combo){ri * 4 + s1, ri * 4 + s2};
      } else if (j > i) {
        sprintf(label[k], "%c%cs", RANKS[i], RANKS[j]);
        for (int s = 0; s < 4; s++) combos[k][n++] = (Combo){ri * 4 + s, rj * 4 + s};
      } else {
        sprintf(label[k], "%c%co", RANKS[j], RANKS[i]);
        for (int s1 = 0; s1 < 4; s1++)
          for (int s2 = 0; s2 < 4; s2++)
            if (s1 != s2) combos[k][n++] = (Combo){rj * 4 + s1, ri * 4 + s2};
      }
      ncombo[k++] = n;
    }
}

int main(int argc, char **argv) {
  long samples = argc > 1 ? atol(argv[1]) : 40000;
  build_classes();
  for (int a = 0; a < 169; a++) {
    for (int b = 0; b < 169; b++) {
      Combo pa[144], pb[144];
      int np = 0;
      for (int x = 0; x < ncombo[a]; x++)
        for (int y = 0; y < ncombo[b]; y++) {
          Combo A = combos[a][x], B = combos[b][y];
          if (A.c1 == B.c1 || A.c1 == B.c2 || A.c2 == B.c1 || A.c2 == B.c2) continue;
          pa[np] = A; pb[np] = B; np++;
        }
      if (np == 0) { printf("%s\t%s\tnan\t0\n", label[a], label[b]); continue; }
      if (b < a) continue; /* filled from the symmetric pass below */
      rng = 0x9E3779B97F4A7C15ull ^ ((uint64_t)a * 1000003ull + (uint64_t)b * 7919ull);
      double win = 0;
      long per = samples / np + 1;
      long total = 0;
      for (int p = 0; p < np; p++) {
        uint64_t used = (1ull << pa[p].c1) | (1ull << pa[p].c2) | (1ull << pb[p].c1) | (1ull << pb[p].c2);
        for (long t = 0; t < per; t++) {
          int board[5]; uint64_t u = used; int nb = 0;
          while (nb < 5) { int c = (int)(xs() % 52); if (u & (1ull << c)) continue; u |= 1ull << c; board[nb++] = c; }
          int h1[7] = {pa[p].c1, pa[p].c2, board[0], board[1], board[2], board[3], board[4]};
          int h2[7] = {pb[p].c1, pb[p].c2, board[0], board[1], board[2], board[3], board[4]};
          unsigned e1 = eval7(h1), e2 = eval7(h2);
          win += e1 > e2 ? 1.0 : e1 == e2 ? 0.5 : 0.0;
          total++;
        }
      }
      printf("%s\t%s\t%.5f\t%d\n", label[a], label[b], win / total, np);
      if (b != a) printf("%s\t%s\t%.5f\t%d\n", label[b], label[a], 1.0 - win / total, np);
      fflush(stdout);
    }
  }
  return 0;
}
