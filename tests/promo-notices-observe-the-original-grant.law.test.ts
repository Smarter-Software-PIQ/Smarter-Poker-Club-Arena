import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');
const sql = read(
  'supabase/migrations/20261116163759_promo_grant_notices_progress_pushes_and_digest_share_origina.sql'
);
describe('promo notices observe original financial authority', () => {
  it('observes accepted source fees without settling or acquiring member/grant locks', () => {
    const observer = sql
      .split('CREATE FUNCTION public.fn_ca_promo_fee_notice()')[1]
      .split('END $$;')[0];
    expect(observer).toContain('fn_ca_promo_play_through_state(NEW.club_id,NEW.player_id)');
    expect(observer).not.toMatch(
      /PERFORM\s+public\.fn_ca_promo_play_through_settle|FOR\s+(?:NO KEY\s+)?UPDATE|pg_advisory|UPDATE\s+public\./
    );
    expect(sql).toMatch(
      /ca_promo_fee_notice AFTER INSERT ON public\.rake_attributions\s+DEFERRABLE INITIALLY DEFERRED/
    );
    expect(sql).toMatch(
      /ca_promo_entry_notice AFTER INSERT ON public\.accounting_tournament_fee_sources\s+DEFERRABLE INITIALLY DEFERRED/
    );
  });
  it('only announces earned completion after the original final met closure', () => {
    expect(sql).toContain("NEW.close_reason='met'");
    expect(sql).toContain("'unlocked',OLD.remaining,NEW.fee_target,NEW.fee_target");
    expect(sql).toContain('PRIMARY KEY(grant_id,milestone)');
    expect(sql).toContain('promo_notice_milestone_is_immutable');
    expect(sql).toContain("milestone='near'");
    expect(sql).toContain("NEW.close_reason='override'");
    expect(sql).toContain("'manual_release',OLD.remaining,0,NEW.fee_target");
  });
  it('shows review holds separately and uses the existing authorized override', () => {
    expect(read('src/components/wallet/PromoPlayThroughProgress.tsx')).toContain(
      'Held For Source Review'
    );
    expect(read('src/services/PromoPlayThroughService.ts')).toContain(
      "rpc('fn_ca_promo_play_through_override'"
    );
    expect(read('src/pages/MemberManagementPage.tsx')).toContain(
      "['owner', 'co_owner', 'admin'].includes(myRole)"
    );
  });
  it('puts the same promo terms into the actual pre-play agreement and legal page', () => {
    expect(read('src/components/legal/TOSAcceptanceModal.tsx')).toContain(
      '<p>{PROMO_PLAY_THROUGH_TERMS}</p>'
    );
    expect(read('src/pages/legal/TermsOfServicePage.tsx')).toContain(
      '<p>{PROMO_PLAY_THROUGH_TERMS}</p>'
    );
  });
  it('runs native source/bridge proof and formats original funders in the real daily consumer', () => {
    expect(read('.github/workflows/promo-play-through.yml')).toContain(
      'python3 scripts/ci/test-promo-notices.py'
    );
    expect(read('.github/scripts/estate-digest.mjs')).toContain(
      "sb('/rest/v1/rpc/fn_ca_promo_daily_digest'"
    );
    expect(sql).toContain('ca_promo_integrity_source_grants');
    expect(sql).toContain('fn_ca_promo_custody_reconcile_rows()');
    expect(sql).toContain(
      'ca_promo_integrity_release_notice AFTER INSERT ON public.ca_promo_integrity_releases'
    );
    expect(read('src/hooks/usePromoPlayThrough.ts')).toContain("'NOTIFICATION_RECEIVED'");
    expect(read('src/stores/useHeaderDataStore.ts')).toContain(
      "masterBus.emit('NOTIFICATION_RECEIVED', { notification: row })"
    );
    expect(read('src/App.tsx')).toContain('<HeaderAppearanceSync');
    expect(read('src/services/PromoIntegrityService.ts')).toContain(
      "rpc('fn_ca_promo_integrity_release'"
    );
    expect(read('src/components/club/MemberIntegrityReview.tsx')).toContain('item.can_release');
  });
});
