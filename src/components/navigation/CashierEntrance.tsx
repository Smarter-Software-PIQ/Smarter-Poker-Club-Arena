import { Navigate, useLocation, useParams } from 'react-router-dom';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const CashierPage = lazyWithRetry(() => import('../../pages/CashierPage'));

export default function CashierEntrance({ legacy = false }: { legacy?: boolean }) {
  const { clubId } = useParams();
  const { search, hash } = useLocation();
  const query = new URLSearchParams(search);
  const club = clubId || query.get('club');
  if (!club) return <CashierPage />;
  query.delete('club');
  if (legacy || query.has('table')) query.set('walletTools', 'open');
  return (
    <Navigate
      replace
      to={{
        pathname: `/clubs/${encodeURIComponent(club)}/cashier`,
        search: query.toString(),
        hash,
      }}
    />
  );
}
