import { Navigate, useLocation, useParams } from 'react-router-dom';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const CashierPage = lazyWithRetry(() => import('../../pages/CashierPage'));

export default function CashierEntrance() {
  const { clubId } = useParams();
  const { search, hash } = useLocation();
  const query = new URLSearchParams(search);
  const club = clubId || query.get('club');
  if (!club) return <CashierPage />;
  query.delete('club');
  query.delete('walletTools');
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
