import { arenaDisplayText } from '../lib/arenaDisplay/text';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  titleCase — house capitalisation for user-facing text
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Dan 2026-08-20: "Capitalize the first letter of every word inside the entire
 * club arena, and forbid the use of em bars anywhere."
 *
 * WHAT "EM BARS" MEANS, BECAUSE IT HAS ALREADY BEEN MISREAD TWICE
 *
 * Dan's phrase "em bars" means EM DASHES: the punctuation mark, U+2014.
 * This is a rule about COPY -- the characters inside text a player reads.
 * It is NOT a rule about artwork, icons, or anything shaped like a line,
 * and it does NOT ban the hamburger menu.
 *
 * Read the other way it has now cost the hamburger menu twice in two days:
 * #2321 replaced it with a gear on every trigger, deleted the approved
 * rasters, and added a law forbidding its return; #2429 did it again with a
 * six-tile grid after #2401 reverted the first one. Each time Dan opened the
 * app and found a different icon where his menu button used to be.
 *
 * If you are about to ban "bars" anywhere near an ICON, you have misread this
 * sentence. The hamburger is the menu. See
 * tests/approvedHamburgerGearGuard.law.test.ts.
 *
 * TWO RULES, ONE HELPER
 *
 *   1. Every word starts with a capital.       "hands played" -> "Hands Played"
 *   2. No em dashes anywhere in UI copy.       "3rd — of 128"  -> "3rd - Of 128"
 *
 * WHY A FUNCTION RATHER THAN `text-transform: capitalize`
 *
 * CSS capitalize is a lie on this product's vocabulary. It uppercases the first
 * letter of every word and touches nothing else, so "nlh" becomes "Nlh" and
 * "plo4" becomes "Plo4" — the exact defect formatGameTitle exists to fix. It
 * also cannot be read back: a screen reader, an aria-label and a copied string
 * all still carry the original casing, so the visible text and the accessible
 * text disagree. Doing it in JS means one answer everywhere.
 *
 * ACRONYMS SURVIVE. The variant tokens (NLH, PLO4, SNG, MTT, PKO...) and the
 * product's own initialisms (BBJ, VIP, ID, XMTT) are shouted, not Title Cased,
 * because that is what they are.
 *
 * ON EM DASHES: the character is stripped from OUTPUT here, and
 * scripts/ci/check-ui-text.mjs blocks new ones from entering JSX text and UI
 * string literals in the first place. Source COMMENTS are exempt — this file
 * and its neighbours are full of them, they never reach a player, and a
 * repo-wide comment rewrite is a large diff with no user-visible effect.
 */

/** Initialisms that must stay fully uppercase. Superset of formatGameTitle's. */
const ACRONYMS = new Set([
  // Game variants
  'nlh',
  'nlhe',
  'plo',
  'plo4',
  'plo5',
  'plo6',
  'plo8',
  'flh',
  'flo',
  'nl',
  'pl',
  'fl',
  // Formats
  'sng',
  'mtt',
  'xmtt',
  'pko',
  'ko',
  'gtd',
  'hu',
  'wsop',
  // Product
  'bbj',
  'vip',
  'id',
  'ok',
  'pnl',
  'rtp',
  'eco',
  'utg',
  'sb',
  'bb',
  'ante',
]);

/**
 * Replace em and en dashes with plain punctuation.
 *
 * An em dash between clauses becomes a hyphen with its spacing kept, so
 * "Held In Trust - 400 To Clubs" still reads as an aside. A NUMERIC en dash
 * ("1-9", a range) becomes a bare hyphen with no spaces.
 */
/**
 * NOTE THE ESCAPES. These patterns are written — / – rather than as
 * literal characters on purpose: scripts/ci/check-ui-text.mjs --fix rewrites
 * every non-comment dash in src/ to a hyphen, and on its first run it happily
 * rewrote THIS function's own character class into `[--]` — a valid but
 * meaningless range that silently stopped matching anything. The one file
 * allowed to talk about the character must not contain it.
 */
const EM_DASH_RUN = /\s*[—–]\s*/g;
const OTHER_DASHES = /[‒―−]/g;

export function stripEmDashes(input: string): string {
  return String(input ?? '')
    .replace(EM_DASH_RUN, (m) => (/^\S/.test(m) && /\S$/.test(m) ? '-' : ' - '))
    .replace(OTHER_DASHES, '-');
}

/**
 * Title Case a user-facing string.
 *
 * Preserves any word that is ALREADY all-caps (so "BBJ" and a deliberately
 * shouted "LIVE" survive), uppercases known acronyms, and capitalises every
 * prose word. Hyphenated and slashed compounds are cased on both sides:
 * "add-ons" -> "Add-Ons". Machine-readable examples remain unchanged.
 */
export function titleCase(input: string | null | undefined): string {
  if (!input) return '';
  const cleaned = stripEmDashes(arenaDisplayText(String(input)));
  const trimmed = cleaned.trim();

  if (
    /^\S+:\/\/\S+$/.test(trimmed) ||
    /^\S+@\S+\.\S+$/.test(trimmed) ||
    /^\/\S+$/.test(trimmed) ||
    /^[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+$/.test(trimmed)
  ) {
    return cleaned;
  }

  // Split on whitespace but KEEP it, so the original spacing survives verbatim.
  const parts = cleaned.split(/(\s+)/);

  return parts
    .map((part) => {
      if (/^\s+$/.test(part) || part === '') return part;

      /* Case each side of a hyphen/slash compound independently.
         The leading character class INCLUDES digits on purpose. Matching only
         on [A-Za-z] made the match start at the 'r' of "3rd", which then got
         capitalised to "3Rd" — and ordinals are the tournament card's entire
         hero line ("3rd Of 128"). A token that begins with a digit is an
         ordinal, a stake or a seat count ("6max", "2x"); its letters are a
         suffix and are never title-cased. */
      return part.replace(/[A-Za-z0-9][A-Za-z0-9'’]*/g, (word, offset, whole) => {
        if (/^[0-9]/.test(word)) return word;
        const lower = word.toLowerCase();
        if (whole[offset - 1] === '(' && (lower === 's' || lower === 'es')) return lower;
        if (ACRONYMS.has(lower)) return lower.toUpperCase();
        // Already shouting (LIVE, GTD, a name in caps) - leave it alone.
        if (word.length > 1 && word === word.toUpperCase()) return word;
        return word.charAt(0).toUpperCase() + word.slice(1);
      });
    })
    .join('');
}

/**
 * Alias. The Players tab and the three pages behind it (Member Management,
 * Player Statistics, Promo Vault) were written against `toTitleCase`, which is
 * the name the same transform carries inside utils/popupStyle.ts. Exporting it
 * here rather than renaming call sites keeps one implementation -- the
 * acronym-aware one above, which is the reason NLH does not render as "Nlh".
 */
export const toTitleCase = titleCase;

/**
 * Postgres hands roles and statuses over as snake_case enums: 'super_agent',
 * 'sub_agent', 'vip_card'. An underscore is not a word boundary a reader sees,
 * so it becomes a space before the casing runs: 'super_agent' -> 'Super Agent'.
 *
 * Acronyms still survive the trip, which is the whole point of routing through
 * titleCase rather than doing this inline: 'mtt_fee' -> 'MTT Fee'.
 */
export function enumToTitleCase(value: string | null | undefined): string {
  if (!value) return '';
  return titleCase(String(value).replace(/_/g, ' '));
}

/**
 * Short English words (and common first names) that a name typed in capitals
 * may contain. A 2-3 letter token in an ALL-CAPS name that is NOT here is read
 * as an initialism and kept upper case ("MSP POKER" -> "MSP Poker"); one that
 * is here is a word and Title Cased ("THE ACE CLUB" -> "The Ace Club").
 * Extend it when a real name proves a word missing; it only ever decides
 * between "Abc" and "ABC" for a name its owner typed in capitals.
 */
const SHORT_WORDS = new Set(
  // two letters
  (
    'a am an as at be by do go he hi if in is it me my no of oh ok on or ox so to up us we ' +
    // three letters
    'ace act add age ago aid aim air all and ant any ape arc are ark arm art ash ask ate awe axe ' +
    'bad bag ban bar bat bay bed bee beg bet bid big bin bit boa bow box boy bud bug bun bus but buy ' +
    'cab can cap car cat cob cod cop cow cry cub cue cup cut dad dam day den dew did die dig dim dip ' +
    'doc doe dog dot dry dub due dug duo dye ear eat ebb egg ego elf elk elm emu end era eve ewe eye ' +
    'fad fan far fat fax fed fee few fig fin fir fit fix flu fly foe fog for fox fry fun fur gag gal ' +
    'gap gas gel gem get gig gin god got gum gun gut guy gym had ham has hat hay hen her hew hey hid ' +
    'him hip his hit hog hop hot how hub hue hug hum hut ice icy ill imp ink inn ion ire irk its ivy ' +
    'jab jam jar jaw jet jig job jog jot joy jug keg key kid kin kit lab lad lag lap law lay led leg ' +
    'let lid lie lip lit log lot low mad man map mat maw may men met mid mix mob mod mom mop mow mud ' +
    'mug nab nag nap net new nil nip nit nod nor not now nun nut oak oar oat odd ode off oil old one ' +
    'opt orb ore our out owe owl own pad pal pan par pat paw pay pea peg pen pep per pet pew pie pig ' +
    'pin pit ply pod pop pot pro pry pub pug pun pup put rag ram ran rap rat raw ray red rib rid rig ' +
    'rim rip rob rod roe rot row rub rug rum run rut rye sad sag sap sat saw say sea see set sew she ' +
    'shy sin sip sir sis sit six ski sky sly sob sod son sow soy spa spy sty sub sue sum sun sup tab ' +
    'tag tan tap tar tax tea tee ten the thy tic tie tin tip toe ton too top tot tow toy try tub tug ' +
    'two urn use van vat vet via vie vow wad wag war was wax way web wed wee wet who why wig win wit ' +
    'woe wok won woo wow yak yam yap yaw yes yet yew you zap zen zip zoo ' +
    // first names a club is often named after
    'al ed jo abe amy ann art ava ben bob dan deb don eli eva gus ian ida jay jim joe jon kat ken kim ' +
    'lee leo liz lou max meg mia ned pam pat peg ray rex rob ron roy sal sam sue ted tim tom val vic ' +
    'zoe'
  ).split(/\s+/)
);

/**
 * In an ALL-CAPS name, is this token an initialism the owner meant?
 * Letters only, then either: no vowel (a e i o u y) and 2-5 letters
 * ("MSP", "BCLC", "WPT"), or 2-3 letters and not a short English word or a
 * common first name ("NYC", "GTO", "AA"). Everything else is a word.
 */
function isTypedInitialism(token: string): boolean {
  if (!/^[A-Z]+$/.test(token)) return false;
  const lower = token.toLowerCase();
  if (token.length >= 2 && token.length <= 5 && !/[aeiouy]/.test(lower)) return true;
  return token.length >= 2 && token.length <= 3 && !SHORT_WORDS.has(lower);
}

/**
 * Title Case a NAME somebody typed (a club, a union, a custom table name).
 *
 * A name typed in mixed case ("The Felt Society", "iPoker Nights") is how its
 * owner spells it, and it prints exactly as typed. Only a name typed in one
 * case, "KINGS CLUB" or "kings club", is put into Title Case, with the known
 * acronyms (PLO, NLH, VIP ...) kept upper case. This replaces the CSS
 * uppercase transform the table masthead used to carry (2026-11-28).
 *
 * ACRONYMS THE LIST DOES NOT KNOW (2026-11-28). A name typed in capitals keeps
 * its initialisms: "MSP POKER" -> "MSP Poker", not "Msp Poker". A token stays
 * upper case when it is letters only and either has no vowel (a e i o u y) and
 * 2-5 letters, or has 2-3 letters and is not a short English word or common
 * first name (SHORT_WORDS). A token with an apostrophe ("DAN'S") is a word. A
 * name typed all lower case carries no such signal, so "msp poker" still reads
 * "Msp Poker"; nothing here guesses at a mixed-case name.
 */
export function titleCaseName(name: string | null | undefined): string {
  if (!name) return '';
  const typed = String(name);
  if (/[a-z]/.test(typed) && /[A-Z]/.test(typed)) return stripEmDashes(typed);
  if (!/[A-Z]/.test(typed)) return titleCase(typed);
  /* All capitals: lower every word except a kept initialism, which titleCase
     then leaves alone because it is already shouting. */
  const marked = typed.replace(/[A-Za-z][A-Za-z'’]*/g, (w) =>
    isTypedInitialism(w) ? w : w.toLowerCase()
  );
  return titleCase(marked);
}

export default titleCase;
