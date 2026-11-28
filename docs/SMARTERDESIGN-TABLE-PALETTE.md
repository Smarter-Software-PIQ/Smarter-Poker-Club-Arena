# #SmarterDesign table palette

The colours of the poker table's #SmarterDesign skin (Dan, 2026-11-27), defined once as CSS
custom properties on `:root` in `src/styles/design-tokens.css`. The skin's surfaces portal to
`document.body` (the drawer, every console, chat, the purchase popups), so `:root` is the one
root they all share. That file is in the entry stylesheet (`index.html`) and is re-asserted by
`src/styles/table-design-tokens.css` for the table chunk.

World Hub mirrors these names and values exactly. Change a value here and in World Hub in the
same piece of work, or the two halves of the platform drift apart.

| Token              | Value     | Use                                           |
| ------------------ | --------- | --------------------------------------------- |
| `--sd-ice`         | `#86daff` | eyebrows, labels, emphasis                    |
| `--sd-ice-strong`  | `#74dfff` | "you", the strongest cyan accent              |
| `--sd-silver`      | `#bdd0e2` | subtitles, support copy                       |
| `--sd-silver-dim`  | `#9fbacc` | column keys, quiet meta (7.5:1 on `#12273b`)  |
| `--sd-white`       | `#f4f8ff` | titles and figures                            |
| `--sd-ink`         | `#f1f5fc` | body ink and chrome key lettering             |
| `--sd-cobalt-top`  | `#087cfa` | primary or selected key, gradient top stop    |
| `--sd-cobalt-mid`  | `#0044ac` | primary or selected key, middle stop (at 55%) |
| `--sd-cobalt-deep` | `#002b68` | primary or selected key, bottom stop          |
| `--sd-green`       | `#4dc660` | a real win or success, nothing else           |
| `--sd-red`         | `#ff8a93` | a real loss or error, nothing else            |

The primary key is `linear-gradient(var(--sd-cobalt-top), var(--sd-cobalt-mid) 55%,
var(--sd-cobalt-deep))`.

Not tokens (yet): the navy panel and key surfaces (`#030b14`, `#091727`, `#12273b`, `#07111c`),
the alpha washes written as `rgb(134 218 255 / 18%)` and the like, and the chrome art
(`--sd-case`, `--sd-stat`, `--sd-active` on `.sc.sc--sd.sc--sd`, which are image URLs, not
colours).

## The rules these encode

White titles, silver support ink, ice blue and cyan emphasis, cobalt for the selected or primary
key. Green and red only for a real win, loss, success or error. Never yellow, gold, amber,
orange, purple, violet, lavender, pink or magenta in UI ink, borders or fills. Title Case in the
copy, never `text-transform: uppercase`. No `:hover`.

## What enforces them

- `scripts/ci/check-table-skin-ink.mjs` reads every stylesheet under `src/components/table`,
  `src/components/console` and `src/components/handdetail` (CI "Invariant guards"): no
  uppercase transform, no `:hover`, no raw colour literal in a banned hue band outside the
  listed artwork stylesheets. Older literals are frozen by count per file and may only shrink.
- `tests/e2e/css/table-surfaces-wear-smarterdesign.spec.ts` mounts the real table surfaces
  offline in the skin and judges what the browser computes and paints (CSS Beat E2E, Chromium
  and WebKit): no banned hue in any ink, fill, border, outline or shadow, no computed uppercase,
  and WCAG AA contrast measured against the pixels behind each run of text.
