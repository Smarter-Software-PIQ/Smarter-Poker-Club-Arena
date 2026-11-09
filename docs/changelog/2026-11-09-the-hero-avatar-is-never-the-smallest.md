# The hero's avatar is never the smallest one at the table

**2026-11-09.** Dan, with a PLO4 Lightning screenshot, item 4 of six:
"the 'hero' avatar is smaller then all the other avatars at the table, it
should always be the same size."

The other five items shipped in `490c72a31`
(`docs/changelog/2026-11-09-six-live-table-fixes.md`). This one was split out
because the obvious reading of it - drop `--seat-avatar-hero-ratio` from 1.3333
to 1 so the hero's slot matches a villain's - turned four separately measured
constants red at once (the hero card band, the bottom action reserve, the
6-max hero clearance and the 375px nine-seat ancestor translations). The slot
was not the problem.

## What the tokens say, and what the screen showed

`.seat.seat--hero` multiplies the slot by `--seat-avatar-hero-ratio` (1.3333,
Dan 2026-08-15: "HERO avatar should always be 33% bigger than the villains"),
so by declaration the hero's circle is the biggest at the table at every
breakpoint. Measured with the new
[`scripts/dev/measure-seat-avatar-art.mjs`](../../scripts/dev/measure-seat-avatar-art.mjs),
nine-max at 375px:

|                                  | declared circle | applied scale | rendered circle |
| -------------------------------- | --------------- | ------------- | --------------- |
| hero                             | 66.67px         | -             | 66.66px         |
| opponent, hero has character art | 37.66px         | 1.7709        | 66.68px         |
| opponent, hero has a photograph  | 37.66px         | 1.9871        | **74.80px**     |

The declared opponent slot is roughly half the hero's on a phone. What makes
an opponent pod the size a player actually sees is
`--sp-opponent-art-scale`, written by
`src/components/table/opponentAvatarLayout.ts`: it decodes every portrait,
measures its painted subject, and scales each opponent so that subject matches
the hero's. That is the right intent. The problem is the element it lands on.
`.seat__avatar` is the circle - its 2.5px ring, its gradient backing and the
portrait together - so a factor derived purely from painted subjects also
decides how large the opponent's visible circle is, which the rule's own
comment promises it does not ("These paint-only properties do not feed
avatar/card/panel dimensions").

With character art everywhere the two land within 0.02px of each other, which
is why no guard ever saw this: every e2e scene in the repo gives the hero
character art. A real human player has a **photograph** - opaque edge to edge,
so its painted subject _is_ its whole circle. The match target grows about
12%, every opponent circle inflates past the hero's on every phone width, and
the hero becomes the smallest avatar at the table. That is Dan's screenshot.

At desktop nine-max the same mechanism was worse in the other direction: with
character art the two capped top seats rendered a 106.1px circle against the
hero's 76.8px, 38% larger.

## The fix

One cap, at the root. The opponent subject match is now bounded by the hero's
own declared circle:

```ts
const ceiling = heroSlot > 0 && ownSlot > 0 ? heroSlot / ownSlot : Infinity;
const factor = Math.min(target / subject(image, own, false).height, ceiling);
```

`heroSlot` and `ownSlot` are read from computed `height`, which `scale:` does
not participate in, so there is no feedback loop. An opponent's rendered
circle may match the hero's and may be smaller; it may never be larger.

Where it binds, the opponent lands exactly on the hero's circle - the same
appearance a character-art table has always had. Where it does not bind
(desktop short rings, where the opponent circle is already smaller than the
hero's) nothing changes.

## Measured after the change

Same script, same widths, 320 / 375 / 393 / 430 / 480 / 600 / 768 / 1024 px
across 2-, 6- and 9-handed rings:

- hero with character art: the hero and every opponent render the identical
  circle at every width and ring, desktop nine-max included (was 76.8 against
  106.1);
- hero with a photograph: every opponent circle equals the hero's at every
  phone width (was 12.2% larger), and remains smaller than the hero's at 1024
  short rings, as it already was;
- the character-art factor moves by 0.0006 (66.68px to 66.66px), so the
  appearance in every existing render is unchanged.

## Pinned

- `tests/the-hero-avatar-is-never-the-smallest.law.test.ts` - the photograph
  case where the cap binds, and the character-art case it must not disturb.
- `docs/laws.d/the-hero-avatar-is-never-the-smallest.md`.
- `scripts/dev/measure-seat-avatar-art.mjs` reproduces every number above. It
  is read-only and renders the repo's own isolated rail fixture, which grew one
  opt-in knob, `data-hero-avatar`, so a measurement can put a photograph hero
  beside character-art opponents - the combination a human player sees and the
  one no scene had ever rendered.
