/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Service Worker — Asset Cache + MasterBus Background Notifications
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Two responsibilities:
 * 1. CACHE-FIRST for hashed JS/CSS chunks — eliminates re-download on re-entry
 * 2. Background notifications via MasterBus postMessage
 *
 * Cache strategy:
 * - JS/CSS files with content hashes (e.g., HomePage-abc123.js) → Cache-first
 *   These files are immutable (hash changes on content change), so cache-first
 *   is safe and gives instant loads on re-entry from the World Hub.
 * - Images → Stale-while-revalidate (show cached, update in background)
 * - HTML/API → Network-first (always fresh)
 */

 
const sw = self;

// DEPLOY VERSION — updated by CI/build to bust the service worker cache.
// When this changes, the browser detects a new SW → install → activate → clears old caches.
// Format: ISO timestamp of last deploy. Update via: sed -i "s/DEPLOY_TS.*/DEPLOY_TS = '$(date -u +%Y%m%d%H%M%S)';/" public/sw-bus.js
const DEPLOY_TS = '20260822000000';
// PERF PASS 2026-08-22: two caches instead of one.
// - CHUNK_CACHE is versioned by deploy: hashed JS/CSS filenames change every
//   build, so old entries are dead weight the moment a new SW activates.
// - MEDIA_CACHE is deliberately NOT versioned: cards, tiles, icons, logos and
//   videos keep the same URLs across deploys. Nuking them on every deploy
//   (the old behavior) forced players to re-download ~60 MB of media that had
//   not changed. Media staleness is handled by stale-while-revalidate below.
const CACHE_NAME = `club-arena-${DEPLOY_TS}`;
const MEDIA_CACHE = 'club-arena-media-v1';
// How stale a cached media entry may be before it is REALLY revalidated.
// See the media branch of the fetch handler for why this number has to exist.
const MEDIA_REVALIDATE_AFTER_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Age of a cached response, from the origin's own Date header.
 *
 * Returns Infinity when there is no usable Date, which makes an unknown age
 * behave as "revalidate now". That is the safe direction: the failure this
 * whole mechanism exists to prevent is serving something old forever, so an
 * entry we cannot date should be checked, not trusted.
 */
function cachedAgeMs(response) {
  const raw = response && response.headers.get('date');
  const parsed = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(parsed) ? Date.now() - parsed : Infinity;
}
const MAX_CACHE_ENTRIES = 400; // Evict oldest chunk entries beyond this (a full
// deploy emits ~330 hashed chunks, so 300 could evict live code mid-session)
const MAX_MEDIA_ENTRIES = 600; // Cards (104/deck-style) + tiles + icons + logos fit comfortably

// App-shell assets to warm at install time. EMPTY in source — the build
// (scripts/optimize-dist-media.mjs) injects the entry chunk, modulepreloaded
// vendors and entry CSS for the exact bundle being deployed, and stamps
// DEPLOY_TS above with the build time. With this, a returning player gets the
// whole shell from cache even if HTTP cache was evicted, and the new SW
// pre-fetches the new hashed chunks the moment a deploy lands.
const PRECACHE_URLS = [];

// The canonical cache key for the SPA shell document. Every /hub/club-arena/*
// navigation serves the same index.html (SPA fallback rewrite), so all of
// them share one cached entry.
const SHELL_KEY = '/hub/club-arena';

// The shell entries are inserted FIRST, at install, so a naive oldest-first
// eviction deletes exactly the files the app cannot boot without. Anything in
// this set is exempt from trimming for the life of the versioned cache.
const PROTECTED_PATHS = new Set([SHELL_KEY, '/hub/club-arena/offline.html', ...PRECACHE_URLS]);

// Documents under /hub/club-arena/ that are NOT the SPA shell. The standalone
// Diamond bonus test entry (dist/diamond-test.html; its own hashed chunks sit
// in /assets/ as diamond-test.*) is a different page: served from SHELL_KEY it would boot the
// arena in place of the test page, and stored under SHELL_KEY it would boot the
// test page in place of the arena for every navigation until the next
// revalidation. These bypass shellFromCache and always go to the network.
const STANDALONE_DOCUMENTS = new Set(['/hub/club-arena/diamond-test.html']);

/**
 * Trim cache to maxEntries — prevents unbounded growth across deploys.
 * Each deploy creates new hashed filenames; old ones stay cached forever without this.
 *
 * 2026-08-24: this used to evict oldest-first with no exemptions. The shell,
 * the entry chunk and the vendor chunks are written at install and are
 * therefore the OLDEST entries in the cache, so the first trim past the cap
 * threw away precisely the boot set the precache exists to hold — and the
 * cache-first shell below would then serve an HTML file whose scripts were
 * gone. Protected paths are skipped, and the cap is measured against the
 * evictable remainder.
 */
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  const evictable = keys.filter((req) => {
    try {
      return !PROTECTED_PATHS.has(new URL(req.url).pathname);
    } catch {
      return true;
    }
  });
  // Delete oldest evictable entries (first in = oldest), 50 extra for headroom
  const deleteCount = Math.min(evictable.length, keys.length - maxEntries + 50);
  for (let i = 0; i < deleteCount; i++) {
    await cache.delete(evictable[i]);
  }
}

/**
 * Read current HTML before committing a navigation. The old 300ms cache race
 * booted stale HTML on normal mobile connections, then the page update gate
 * rebooted the rendered app. A real entry now awaits the network; cache is an
 * offline/failed-read fallback, never a speculative first paint.
 * Immutable chunks retain their cache-first path below.
 */
const SHELL_NETWORK_TIMEOUT_MS = 8000;
const CACHE_LOOKUP_TIMEOUT_MS = 300;

// Cache storage is optional. Bound open + match together with the existing
// freshness allowance so unavailable storage cannot hold a real request forever.
async function lookupCachedResponse(cacheName, request) {
  // Retain this one read's answer even when its admission budget expires.
  // A slow cache may finish while the genuine network request is in flight.
  const result = {};
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(async () => {
        result.cache = await caches.open(cacheName);
        result.cached = await result.cache.match(request);
        return result;
      }).catch(() => result),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(result), CACHE_LOOKUP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function keepOptionalCacheWork(event, work) {
  // A rejected write/trim must not reject an already successful real fetch.
  event.waitUntil(Promise.resolve().then(work).catch(() => {}));
}

function cacheAssetResponse(event, cache, response, cacheName, maxEntries) {
  if (!cache || !response.ok) return;
  const copy = response.clone();
  keepOptionalCacheWork(event, async () => {
    await cache.put(event.request, copy);
    await trimCache(cacheName, maxEntries);
  });
}

async function shellFromCache(event) {
  const lookup = await lookupCachedResponse(CACHE_NAME, SHELL_KEY);
  const { cache, cached } = lookup;

  let timer;
  const network = fetch(event.request, { cache: 'no-cache' })
    .then((response) => {
      if (response?.ok && cache) {
        const stored = response.clone();
        keepOptionalCacheWork(event, () => cache.put(SHELL_KEY, stored));
      }
      return response;
    })
    .catch(() => null);
  let fresh;
  try {
    fresh = await Promise.race([
      network,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), SHELL_NETWORK_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  // Finish this same request/cache write if the offline fallback won. No
  // broadcast can reboot the document that has already been handed back.
  event.waitUntil(network);
  if (fresh?.ok) return fresh;
  if (cached) return cached;

  // Do not discard a genuine shell that the original cache read delivered
  // after admission timed out. No second read, request, or extra delay.
  if (lookup.cached) return lookup.cached;
  const { cached: offline } = await lookupCachedResponse(CACHE_NAME, '/hub/club-arena/offline.html');
  if (lookup.cached) return lookup.cached;
  if (offline) return offline;
  return fresh || Response.error();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ASSET CACHING — Cache-first for immutable hashed chunks
// ═══════════════════════════════════════════════════════════════════════════════

sw.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only cache same-origin requests
  if (url.origin !== sw.location.origin) return;

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip API, auth, and realtime requests
  if (url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/auth/') ||
      url.pathname.includes('supabase') ||
      url.pathname.includes('realtime')) return;

  // Media files are cacheable regardless of which directory serves them.
  // PERF PASS 2026-08-22: the old navigation guard below excluded EVERYTHING
  // under /hub/club-arena/ except /assets/ — which meant cards/, images/,
  // game-card-icons/, club-logos/ and videos/ (the ~60 MB that actually makes
  // the table and lobby feel slow) were never cached by this SW at all.
  const isMedia = /\.(png|jpg|jpeg|webp|avif|svg|gif|ico|mp4|webm|woff2?)$/i.test(url.pathname);

  // Navigations into Club Arena: current HTML first, cache only on failure.
  // The shell HTML is precached at install time TOGETHER with the chunks it
  // references (same versioned cache), so what we serve is always internally
  // consistent even when an offline entry needs the saved shell.
  const isClubArenaNav =
    (event.request.mode === 'navigate' || event.request.destination === 'document') &&
    (url.pathname === '/hub/club-arena' || url.pathname.startsWith('/hub/club-arena/')) &&
    !STANDALONE_DOCUMENTS.has(url.pathname);
  if (isClubArenaNav) {
    event.respondWith(shellFromCache(event));
    return;
  }

  // CRITICAL: other HTML/documents are never intercepted — always fresh.
  if (!isMedia &&
      (event.request.mode === 'navigate' ||
      event.request.destination === 'document' ||
      url.pathname.endsWith('.html') ||
      url.pathname.endsWith('/') ||
      url.pathname === '/hub/club-arena' ||
      (url.pathname.startsWith('/hub/club-arena/') &&
        !url.pathname.includes('/assets/') &&
        !url.pathname.includes('/fonts/')))) {
    // Let the browser handle navigation requests normally (network-first)
    return;
  }

  // WHAT COUNTS AS AN IMMUTABLE ASSET — path, not filename shape.
  //
  // 2026-08-23: this was /[-.][a-zA-Z0-9_]{4,}\.(js|css)$/ and it matched NONE
  // of the files this build produces. vite.config.ts emits
  // `assets/[name]-[hash]-v6.js`, so every chunk ends `-v6.js`; the regex
  // needed four or more characters between the last separator and the
  // extension and `v6` is two. Measured against the live bundle:
  //
  //   index-jBJgC_ty-v6.js        false
  //   vendor-react-BPB2zS-3-v6.js false
  //   index-C3-fYKPl-v6.css       false
  //   TablePage-Iv6ZwCFl-v6.js    false
  //
  // So the cache-first branch below was dead for every real asset. The
  // versioned cache was filled at install by PRECACHE_URLS and then never
  // read: chunks went to the network on every load, the offline app shell
  // booted to a shell whose scripts could not load, and the 503
  // chunk-load-failed recovery path never ran. The `-v6` suffix has been
  // there since long before the precache was added, so this never worked.
  //
  // Matching on the DIRECTORY is precise and cannot drift with the filename
  // template: /assets/ and /fonts/ are exactly the two directories the
  // precache scanner collects from (scripts/optimize-dist-media.mjs), and
  // both are content-hashed and served immutable. sw-bus.js itself sits at
  // the club-arena root, so it is not matched here and keeps revalidating.
  const isHashedAsset =
    (url.pathname.startsWith('/hub/club-arena/assets/') ||
      url.pathname.startsWith('/hub/club-arena/fonts/')) &&
    /\.(js|css)$/.test(url.pathname);
  const isImage = isMedia;

  if (isHashedAsset) {
    // Cache-first: hashed assets are immutable — serve from cache if available
    // With network fallback: if cached response is somehow corrupt/stale, try network
    event.respondWith(
      lookupCachedResponse(CACHE_NAME, event.request).then(({ cache, cached }) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            cacheAssetResponse(event, cache, response, CACHE_NAME, MAX_CACHE_ENTRIES);
          }
          return response;
        }).catch(() => {
          // Network failed and no cache — return a proper error so the app
          // can trigger its chunk-reload recovery logic instead of hanging
          return new Response('/* chunk load failed */', {
            status: 503,
            headers: { 'Content-Type': 'application/javascript' },
          });
        });
      })
    );
  } else if (isImage) {
    // ─────────────────────────────────────────────────────────────────────
    // STALE-WHILE-REVALIDATE, AND THIS TIME THE REVALIDATE HALF RUNS
    // ─────────────────────────────────────────────────────────────────────
    // The previous version called plain `fetch(event.request)` here and the
    // comment above it claimed the revalidation was "answered by the
    // browser's HTTP cache — no network cost". That was true, and it was the
    // bug. A default fetch for a response still inside its freshness window
    // never reaches the server, and these paths are served
    // `Cache-Control: public, max-age=2592000`. So the background half was a
    // no-op for THIRTY DAYS, and MEDIA_CACHE is not versioned, so a file
    // replaced at the same path was invisible to every returning player,
    // indefinitely.
    //
    // Measured on production 2026-08-28: the satellite icon had been
    // replaced twice and shipped correctly both times. A `fetch` from inside
    // the page with `cache: 'reload'` still returned the ORIGINAL 19,441-byte
    // artwork, because `cache: 'reload'` bypasses the HTTP cache but not this
    // service worker. curl, which has neither, got the new bytes. Two clients
    // on one machine seeing different images is what sent us looking here.
    //
    // THE FIX IS TWO PARTS, AND BOTH ARE LOAD-BEARING:
    //
    // 1. `cache: 'no-cache'` on the background request. That forces a
    //    CONDITIONAL request — the browser sends If-None-Match with the
    //    stored ETag — so the server actually gets asked. Unchanged media
    //    answers 304 with no body, which is a few hundred bytes, not the
    //    image. This is the line that makes the word "revalidate" true.
    //
    // 2. A 6-hour floor before we bother. Without it, part 1 would put a
    //    conditional request on the wire for EVERY image on EVERY page view —
    //    roughly 120 of them on a table, on a phone, on cellular — to
    //    discover that ~all of them are unchanged. Below the floor we return
    //    the cached copy and touch the network zero times, exactly as before.
    //
    // So a media file replaced at a stable path now reaches everyone within
    // one revalidation window instead of never. That is a repair, not a
    // licence: version the FILENAME when you replace artwork you need people
    // to see immediately (`satellite-winner-v3.png`, `btn-hamburger-v4.png`),
    // because a new URL is correct on the very first paint and this is only
    // correct on the next one.
    //
    // `event.waitUntil` keeps the worker alive for the background half. We
    // have already handed the page a response by then, and without it the
    // browser is free to kill the worker mid-write and the cache never
    // updates — which would leave this looking fixed while behaving exactly
    // as it did before.
    event.respondWith(
      lookupCachedResponse(MEDIA_CACHE, event.request).then(({ cache, cached }) => {
        if (cached && cachedAgeMs(cached) < MEDIA_REVALIDATE_AFTER_MS) {
          return cached;
        }

        const revalidate = fetch(
          new Request(event.request, { cache: 'no-cache' })
        ).then((response) => {
          if (response.ok) {
            cacheAssetResponse(event, cache, response, MEDIA_CACHE, MAX_MEDIA_ENTRIES);
          }
          return response;
        }).catch(() => {
          // Offline: the cached copy, however old, beats a broken image.
          if (cached) return cached;
          // No cache and no network: a real network error, never an empty
          // 200. A 0-byte "image/png" paints nothing, fires no error and
          // can never be retried, which is how the table felt and room art
          // went missing together on a dropped first fetch (Dan
          // 2026-10-15). An error lets the page's own loader retry it.
          return Response.error();
        });

        if (cached) {
          event.waitUntil(revalidate);
          return cached;
        }
        return revalidate;
      })
    );
  }
  // All other requests (API, etc.) fall through to normal network fetch
});
// ═══════════════════════════════════════════════════════════════════════════════
//  MASTER BUS NOTIFICATIONS — Background push for critical events
// ═══════════════════════════════════════════════════════════════════════════════

// This worker is standalone; normalize notification display without changing event identity.
const arenaDisplayText = text => String(text ?? '').replace(/[$＄﹩\u{1F4B2}\u{1F4B0}\u{1F4B5}]/gu, '');

// BALANCE_UPDATED is internal refresh plumbing and is NEVER shown (Dan,
// 2026-10-21). A tab still running an older bundle may keep posting it until
// it reloads, so the worker refuses it here as well as the page not sending it.
const NEVER_NOTIFY = new Set(['BALANCE_UPDATED']);

const EVENT_LABELS = {
    CLUB_JOINED: '♠️ Club Joined',
    CLUB_LEFT: '🚪 Left Club',
    TABLE_SEATED: '🎯 Seated at Table',
    TABLE_LEFT: '👋 Left Table',
};

sw.addEventListener('message', (event) => {
    if (event.data?.type !== 'BUS_EVENT') return;

    const { type: eventType, payload } = event.data.event || {};
    if (!eventType || NEVER_NOTIFY.has(eventType)) return;
    const title = EVENT_LABELS[eventType] || `🚌 ${eventType}`;

    // Only show notification if page is not visible
    // (clients.matchAll checks if any tab is focused)
    sw.clients.matchAll({ type: 'window', includeUncontrolled: false }).then(clients => {
        const anyFocused = clients.some(c => c.visibilityState === 'visible');
        if (anyFocused) return; // Don't notify if user is looking at the app

        let body = '';
        if (eventType === 'CLUB_JOINED' || eventType === 'CLUB_LEFT') {
            const rawName = payload?.clubName || payload?.clubId || '';
            body = rawName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        } else if (eventType === 'TABLE_SEATED' || eventType === 'TABLE_LEFT') {
            body = `Table: ${payload?.tableId || ''}`;
        }

        sw.registration.showNotification(arenaDisplayText(title), {
            body: arenaDisplayText(body),
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            tag: `bus-${eventType}`,
            renotify: true,
            silent: false,
        });
    });
});

// Notification click → focus the app tab
sw.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        sw.clients.matchAll({ type: 'window' }).then(clients => {
            if (clients.length > 0) {
                clients[0].focus();
            } else {
                sw.clients.openWindow('/');
            }
        })
    );
});

// Install: precache the app shell — the HTML document AND the chunk/CSS list
// the build injected for this exact deploy — into the versioned cache. Fetch
// failures (offline install, mid-deploy 404) are swallowed — the runtime paths
// cover anything missed.
//
// A NEW WORKER NEVER ACTIVATES ITSELF UNDER AN OPEN TAB (2026-10-07). Install
// used to end in skipWaiting(), so the new worker took over within about
// 400ms of a page booting after a deploy, whatever that page was doing. When
// that activation landed while the page was being navigated away, Chromium
// never committed the navigation: no request left the tab, the page stopped
// answering, and the navigation sat there until it timed out. That is
// Post-Deploy E2E run 37620236888 (12:27Z, the first navigation after the
// publish of 68b28e5b: 60s, twice) and run 37579424861 (06:10Z, the publish
// of 32baeb2c: 60s, recovered on retry). On two local builds it reproduced in
// about half of attempts with the self-activation and in none of 8 without
// it. So the worker now waits:
//   - with no open tab it activates on its own, as every waiting worker does;
//   - an open tab hands over on purpose: the shell update gate posts
//     SKIP_WAITING and reloads only after the new worker has taken control,
//     so activation can never overlap a navigation the page did not start.
sw.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            const jobs = PRECACHE_URLS.map((url) =>
                fetch(url).then((res) => {
                    if (res.ok) return cache.put(url, res);
                }).catch(() => {})
            );
            // The shell document, stored under its canonical key so every
            // /hub/club-arena/* navigation can fall back to it. cache:
            // 'no-cache' forces revalidation so the snapshot matches the
            // deploy that shipped this SW version.
            jobs.push(
                fetch('/hub/club-arena', { cache: 'no-cache' }).then((res) => {
                    if (res.ok) return cache.put(SHELL_KEY, res);
                }).catch(() => {})
            );
            jobs.push(
                fetch('/hub/club-arena/offline.html').then((res) => {
                    if (res.ok) return cache.put('/hub/club-arena/offline.html', res);
                }).catch(() => {})
            );
            return Promise.allSettled(jobs);
        })
    );
});

// The one way an open tab lets a waiting worker take over: on request, from
// the page that is about to reload onto it (useShellUpdateGate).
sw.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') event.waitUntil(sw.skipWaiting());
});

// Activate: claim clients + clean up old caches
sw.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            sw.clients.claim(),
            // Clean up any old cache versions
            caches.keys().then((keys) =>
                Promise.all(
                    keys
                        .filter((key) => key !== CACHE_NAME && key !== MEDIA_CACHE)
                        .map((key) => caches.delete(key))
                )
            ),
        ])
    );
});
