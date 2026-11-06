/**
 * GENERATED FILE - do not edit by hand.
 * Regenerate with:  python3 scripts/measure-bust-art.py
 *
 * Per-character size correction for free-floating bust avatars.
 *
 * Every asset is a 125x170 canvas but the character inside it is not drawn to
 * a common scale - measured across the shipped library the subject occupies
 * anywhere from 69% to 89% of canvas height. `object-fit: contain` fits
 * the CANVAS, so an artist's headroom renders as empty pixels and the character
 * reads small through no fault of the CSS.
 *
 * This map corrects for exactly that, and nothing else:
 *
 *     gain = 88.8% (library median) / this character's subject share
 *
 * A character drawn at the median gets 1.0 and is untouched. It is a
 * MULTIPLIER on the global `--sp-bust-scale`, so breakpoints, the top-rail
 * cap and the hover state keep owning everything else.
 *
 * Hand-typing these was the 2026-08-23 bug: `viking: 2` was written from a
 * four-character sample, but the viking is the 6th largest asset of 100 and
 * rendered at 2.9x, spilling off its seat onto the felt. Measurement replaced
 * the guess.
 */
export const BUST_ART_GAIN: Readonly<Record<string, number>> = {
  alien: 1.0,
  alien_overlord: 1.0,
  android: 1.0,
  angel: 1.049,
  arctic_explorer: 1.041,
  artist: 1.102,
  astronaut: 1.102,
  aztec: 1.0,
  aztec_warrior: 1.0,
  badger: 1.0,
  basketball: 1.135,
  bear: 1.238,
  bounty_hunter: 1.007,
  boxer: 1.094,
  bull: 1.0,
  business: 1.0,
  business_cat: 1.0,
  casino_dealer: 1.0,
  chef: 1.0,
  country: 1.258,
  cowboy: 1.0,
  cyber_assassin: 1.0,
  cyber_punk: 1.0,
  cyborg: 1.0,
  dancer: 1.0,
  detective: 1.0,
  director: 1.0,
  dj: 1.0,
  dragon: 1.0,
  eagle: 1.0,
  elite_cyborg: 1.0,
  fire_demon: 1.0,
  football: 1.0,
  fox: 1.0,
  galactic_emperor: 1.0,
  geisha: 1.0,
  geisha_master: 1.0,
  gladiator: 1.0,
  gorilla: 1.127,
  grumpy_cat: 1.0,
  hacker: 1.0,
  hollywood: 1.0,
  ice_queen: 1.0,
  jazz: 1.0,
  knight: 1.0,
  liberty: 1.0,
  lion: 1.0,
  luchador: 1.198,
  mad_scientist: 1.0,
  mecha_pilot: 1.0,
  mobster: 1.0,
  monarch: 1.079,
  mummy: 1.0,
  musician: 1.0,
  neon_ninja: 1.0,
  ninja: 1.0,
  owl: 1.071,
  panther: 1.0,
  penguin: 1.0,
  phantom: 1.0,
  pharaoh: 1.0,
  phoenix: 1.0,
  physicist: 1.071,
  pirate: 1.0,
  plague_doctor: 1.0,
  politician: 1.0,
  pug: 1.0,
  rapper: 1.02,
  rock_legend: 1.0,
  rockstar: 1.0,
  royal_guard: 1.007,
  samurai: 1.0,
  samurai_cyborg: 1.0,
  secret_agent: 1.0,
  shark: 1.171,
  shiba: 1.0,
  silent_actor: 1.0,
  soccer: 1.0,
  sorceress: 1.0,
  space_commander: 1.0,
  space_pioneer: 1.0,
  space_pirate: 1.0,
  space_ranger: 1.086,
  spartan: 1.0,
  steampunk_inventor: 1.0,
  street_racer: 1.0,
  teacher: 1.0,
  tech_mogul: 1.0,
  tiger_boss: 1.0,
  unicorn: 1.0,
  vampire: 1.0,
  vampire_hunter: 1.0,
  vigilante: 1.171,
  viking: 1.049,
  viking_warrior: 1.049,
  voodoo_priest: 1.0,
  wizard: 1.0,
  wolf: 1.049,
  wrestler: 1.28,
  yakuza: 1.0,
};

/**
 * Size correction for the bust art at `avatarUrl`, or 1 when the URL is not a
 * known library bust (uploaded photos, generated SVG monograms, new art that
 * has not been measured yet). 1 means 'render at the global scale', which is
 * the correct and safe default for anything unmeasured.
 */
export function bustArtGain(avatarUrl: string | null | undefined): number {
  if (!avatarUrl) return 1;
  const m = /\/avatars\/table\/(?:free|vip)_([\w-]+?)(?:@2x)?\.webp/.exec(avatarUrl);
  return (m && BUST_ART_GAIN[m[1]]) || 1;
}
