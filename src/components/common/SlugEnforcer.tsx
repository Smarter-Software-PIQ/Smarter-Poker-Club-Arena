import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

/**
 * Canonical URLs. A club is /clubs/<slug>, a union is /unions/<slug>; any
 * /clubs/<uuid>, /club/<uuid> or /unions/<uuid> that reaches the router is
 * rewritten in place (replace, not push, so Back never lands on the id form).
 *
 * 2026-09-04: unions gained `unions.slug` (Dan: "the Midway Union slug is not
 * present and should be"). Until then this only knew how to move a union's
 * club row from /clubs/ to /unions/ and left the UUID in the address bar.
 *
 * 2026-11-14: a club's FORMER slug is rewritten to its current one the same
 * way, keeping the nested path, query and fragment, so a shared
 * /clubs/club-jaqk/data?dataStart=... link lands on
 * /clubs/the-felt-society/data?dataStart=... and corrects itself. The page
 * under it already resolves the old slug (clubIdResolver), so this changes
 * only the address bar, never which club or what the viewer may see.
 */
export default function SlugEnforcer() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    // Intercept paths that match /clubs/<uuid> or /club/<uuid> or /unions/<uuid>
    const match = location.pathname.match(
      /^\/(clubs|club|unions)\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:\/|$)/
    );
    if (!match) return;
    const type = match[1];
    const uuid = match[2];
    let current = true;
    // The old document remains mounted while its next document is loading.
    // Its delayed lookup must not redirect that pending navigation.
    const onDeparture = () => {
      current = false;
    };
    window.addEventListener('beforeunload', onDeparture);

    Promise.all([
      supabase.from('clubs').select('slug, union_id, is_union').eq('id', uuid).maybeSingle(),
      supabase.from('unions').select('id, slug').eq('id', uuid).maybeSingle(),
    ]).then(([clubRes, unionRes]) => {
      // A late lookup belongs to the route that requested it. It must not
      // replace a newer path, query, fragment or an unmounted router.
      if (!current) return;
      let newPath = location.pathname;
      let redirected = false;
      const onUnionRoute = type === 'unions';
      if (unionRes.data?.slug) {
        // Lazy: this component is in the entry chunk, the resolver is not.
        const { id, slug } = unionRes.data;
        void import('../../utils/unionIdResolver').then((m) => m.rememberUnionSlug(slug, id));
      }

      if (onUnionRoute) {
        // /unions/<uuid> -> /unions/<slug>
        if (unionRes.data?.slug) {
          newPath = newPath.replace(uuid, unionRes.data.slug);
          redirected = true;
        }
      } else if (
        clubRes.data?.is_union &&
        (/^\/clubs?\/[^/]+\/data\/advanced\/?$/.test(location.pathname) ||
          (/^\/clubs?\/[^/]+\/data\/?$/.test(location.pathname) &&
            new URLSearchParams(location.search).get('report') === 'open'))
      ) {
        // The house club's Report is served by the guarded Club Data route.
        // Keep its scope on the house club when canonicalizing an inline report.
        newPath = newPath.replace(/^\/club\//, '/clubs/');
        if (clubRes.data.slug) newPath = newPath.replace(uuid, clubRes.data.slug);
        redirected = true;
      } else if (clubRes.data?.is_union) {
        // A union's house club row: the app serves it from the union routes.
        // The union's id usually equals the row's id, but read it, don't assume.
        const unionId = clubRes.data.union_id || uuid;
        const unionSlug = unionRes.data && unionRes.data.id === unionId ? unionRes.data.slug : null;
        newPath = newPath.replace(/^\/clubs?\//, '/unions/');
        newPath = newPath.replace(uuid, unionSlug || unionId);
        newPath = newPath.replace(/\/financials$/, '/settlement');
        redirected = true;
      } else if (clubRes.data?.slug) {
        newPath = newPath.replace(uuid, clubRes.data.slug);
        newPath = newPath.replace(/^\/club\//, '/clubs/');
        redirected = true;
      } else if (unionRes.data?.id) {
        // /clubs/<union uuid> with no club row: it is a union.
        newPath = newPath.replace(/^\/clubs?\//, '/unions/');
        if (unionRes.data.slug) newPath = newPath.replace(uuid, unionRes.data.slug);
        newPath = newPath.replace(/\/financials$/, '/settlement');
        redirected = true;
      }

      if (redirected && newPath !== location.pathname) {
        navigate(newPath + location.search + location.hash, { replace: true });
      }
    });
    return () => {
      current = false;
      window.removeEventListener('beforeunload', onDeparture);
    };
  }, [location.pathname, location.search, location.hash, navigate]);

  useEffect(() => {
    const match = location.pathname.match(/^\/clubs\/([^/]+)(\/.*)?$/);
    if (!match) return;
    let segment: string;
    try {
      segment = decodeURIComponent(match[1]);
    } catch {
      return;
    }
    // Ids are the effect above; a six-digit code never changes; a static
    // route under /clubs/ (clubs/create) is not a club.
    if (UUID_SEGMENT.test(segment) || /^\d+$/.test(segment) || STATIC_CLUB_ROUTES.has(segment))
      return;
    let current = true;
    const onDeparture = () => {
      current = false;
    };
    window.addEventListener('beforeunload', onDeparture);
    // Lazy, like unionIdResolver above: this component is in the entry chunk.
    void import('../../utils/clubIdResolver')
      .then((resolver) => resolver.currentSlugForFormerClubSlug(segment))
      .then((currentSlug) => {
        if (!current || !currentSlug) return;
        navigate(
          `/clubs/${encodeURIComponent(currentSlug)}${match[2] ?? ''}${location.search}${location.hash}`,
          { replace: true }
        );
      })
      .catch(() => {
        /* No rewrite: the page under it still resolves the old slug. */
      });
    return () => {
      current = false;
      window.removeEventListener('beforeunload', onDeparture);
    };
  }, [location.pathname, location.search, location.hash, navigate]);

  return null;
}

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Static routes App.tsx declares under /clubs/ ahead of /clubs/:clubId. */
const STATIC_CLUB_ROUTES = new Set(['create']);
