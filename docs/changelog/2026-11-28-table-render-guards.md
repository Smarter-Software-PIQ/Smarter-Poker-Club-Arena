# 2026-11-28: the table's #SmarterDesign is guarded on what the browser paints

## Why

Source-text tests missed three real regressions on the table in one week: gold that lived only
in a skin-scoped rule (so the component's own stylesheet held no gold), uppercase that arrived
from a shared console class, and near-invisible `#4a5462` ink on navy (a legal colour, so no
banned-colour grep could see it). Each passed every test that read the component's CSS file.

## What changed

1. **Rendered ink guard.** `tests/e2e/css/table-surfaces-wear-smarterdesign.spec.ts` mounts
   the real components offline (esbuild bundle of
   `tests/e2e/support/tableSurfaces/tableSurfacesFixture.tsx`, Supabase and the signed-in user
   swapped for offline stand-ins, every non-fixture request aborted) inside
   `ConsoleSkinProvider value="smarterdesign"`, with the app's own stylesheets in cascade order.
   It opens the drawer, Hand History (a row expanded), Hand Detail (detail tab), Leaderboard,
   Session Stats, Game Rules, Table Studio, Invite Online Friends, Leave Table, table chat,
   Buy-In, Insurance and Add-On/Rebuy at 393x852 and 1280x800 and judges computed styles:
   no banned hue (20-70 and 260-345 degrees above a saturation floor) in ink, fills, gradient
   stops, borders, outlines, shadows or pseudo-elements; no computed `text-transform:
uppercase`; AA contrast (4.5:1, or 3:1 at 18px+ or bold 14px+) measured against the pixels
   behind each run of text in a capture taken with every glyph made transparent. Each surface
   has a floor of text elements and contrast checks, so an empty mount fails. A self-test
   plants a gold head, an uppercase key and `#4a5462` body ink and requires all three to be
   reported. Artwork exemptions are one short list in `inkAudit.ts`, a reason per entry.
   Animations are stopped before reading, so keyframe frames are exempt by construction.
   Wired into CSS Beat E2E (Chromium) and the `webkit-footer` project (WebKit, Safari proxy).
2. **Stylesheet lint.** `scripts/ci/check-table-skin-ink.mjs` (CI "Invariant guards"): no
   `text-transform: uppercase`, no `:hover`, and no raw banned-hue colour literal (hex, rgb,
   hsl, named) in table, console and hand-detail stylesheets, artwork files exempt from the hue
   rule only. Older offenders are frozen by count per file and may only shrink.
3. **One palette.** `--sd-ice`, `--sd-ice-strong`, `--sd-silver`, `--sd-silver-dim`,
   `--sd-white`, `--sd-ink`, `--sd-cobalt-top/-mid/-deep`, `--sd-green`, `--sd-red` on `:root`
   in `src/styles/design-tokens.css`; 190 literals in the #SmarterDesign sections of 19 table
   stylesheets now read them. Proven render-identical: all 26 surface screenshots compared
   byte for byte before and after; the only differing pixels were live content (equity
   percentages, countdowns, the session clock). Names and values for World Hub:
   `docs/SMARTERDESIGN-TABLE-PALETTE.md`.

## Defects the guard found on its first run, fixed at the source

- Hand number serial (`.hdv__meta-sn`, Hand History and Hand Detail): `rgba(255,255,255,0.4)`,
  3.5:1 on the meta strip. Now silver support ink under the skin.
- Invite Online Friends separator (`.friend-invite-picker__sep`): `#526277`, 3.0:1. Now silver
  support ink.

## Not covered

States the fixture does not open (a mention-highlighted chat line, error
toasts) are judged only by the stylesheet lint. The WebKit run was not executed locally (no
WebKit build in the container); CI runs it.
