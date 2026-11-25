import { clubDataReportPath } from '../utils/clubDataReportPath';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { resolveUnionUUID } from '../utils/unionIdResolver';

/** Retired union Report bookmarks resolve to the existing guarded club report. */
export default function UnionReportRedirect() {
  const { unionId = '', clubId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    if (clubId) {
      navigate(clubDataReportPath(clubId, query, location.hash), { replace: true });
      return;
    }
    let current = true;
    setFailed(false);
    const depart = () => {
      current = false;
    };
    window.addEventListener('beforeunload', depart);
    void (async () => {
      const id = await resolveUnionUUID(unionId);
      if (!id) throw new Error('Union not found');
      // Read the actual house club; a member club must never be a fallback.
      const { data, error } = await supabase
        .from('clubs')
        .select('id, slug')
        .eq('is_union', true)
        .or(`id.eq.${id},union_id.eq.${id}`)
        .maybeSingle();
      if (error || !data?.id) throw error || new Error('Union report not found');
      if (!current) return;
      navigate(clubDataReportPath(data.slug || data.id, query, location.hash), { replace: true });
    })().catch(() => {
      if (current) setFailed(true);
    });
    return () => {
      current = false;
      window.removeEventListener('beforeunload', depart);
    };
  }, [unionId, clubId, location.pathname, location.search, location.hash, navigate]);
  return (
    <p role={failed ? 'alert' : 'status'}>
      {failed
        ? 'Union Report Could Not Be Opened. Please Reload To Retry.'
        : 'Opening Union Report…'}
    </p>
  );
}
