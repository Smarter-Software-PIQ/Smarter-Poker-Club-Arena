import '../../pages/MemberManagementPage.css';
import { useMemberPromoPlayThrough } from '../../hooks/useMemberPromoPlayThrough';
import { PromoPlayThroughFigure } from '../wallet/PromoPlayThroughProgress';
import { hasActivePromoPlayThrough } from '../../utils/promoPlayThroughVisibility';
export function MemberPromoPlayThrough({
  clubId,
  userId,
  revision,
}: {
  clubId: string;
  userId: string;
  revision: number;
}) {
  const { members, reload } = useMemberPromoPlayThrough(clubId, [userId], revision);
  const summary = members?.[userId];
  if (summary && !hasActivePromoPlayThrough(summary)) return null;
  return (
    <section className="mm-card mm-stats" aria-label="Promo Play Through">
      <h2 className="mm-card__title">Promo Play Through</h2>
      {members === undefined ? (
        <p role="status">Reading Promo Progress...</p>
      ) : summary ? (
        <PromoPlayThroughFigure summary={summary} />
      ) : (
        <p role="status">
          Promo Progress Is Unavailable.{' '}
          <button type="button" onClick={reload}>
            Retry
          </button>
        </p>
      )}
    </section>
  );
}
