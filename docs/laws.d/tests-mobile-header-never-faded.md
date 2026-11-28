# tests/mobile-header-never-faded.law.test.ts

Club Arena `index.html` must declare `apple-mobile-web-app-status-bar-style` as opaque `black` (never `black-translucent`, which triggers iOS 26's Liquid Glass progressive top blur across the global header), `GlobalHeader.module.css` must shade `.frameFinish` with plain `rgba(0, 0, 0, 0.55)` and never `backdrop-filter` / `-webkit-backdrop-filter` / `filter` / `mask-image` on the header shell or artwork, and `src/styles/globals.css` must paint an explicit opaque dark background on `html` (Dan 2026-11-28).
