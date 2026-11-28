# The prerendered landing wears the console skin the app wears

#12299 put one `ConsoleSkinProvider value="smarterdesign"` at the root of
`App.tsx`, so every `SpadeConsole` the running app draws is the #SmarterDesign
case. `src/prerender/entry-server.tsx` renders the public pages without `App`,
so the context fell back to its `painted` default and the landing's twelve
consoles were written into `index.html` in the painted dress. Every signed-out
visitor and every crawler read the painted landing first, then saw it swap to
the other dress when the bundle booted, which is exactly the shift
`releasePrerenderedLanding` in `main.tsx` exists to prevent ("two identical
layouts, no shift").

- `entry-server.tsx` wraps `renderPublicPage` in the same provider.
- `tests/the-prerendered-landing-wears-the-apps-console-skin.law.test.tsx`
  renders `/` through the real entry and requires every console in the markup
  to carry `sc--sd` and `data-console-skin="smarterdesign"`. It fails on main.
