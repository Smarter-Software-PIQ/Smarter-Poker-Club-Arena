/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  REFERRAL DASHBOARD — Shows referral code, stats, milestones, and share button
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { useState, useEffect, useRef } from 'react';
import { copyText, shareLink } from '../../lib/share';
import { ShareLinkFallback } from '../common/ShareLinkFallback';
import { useIsMounted } from '../../hooks/useIsMounted';
import { useMasterBusSubscription } from '../../hooks/useMasterBusSubscription';
import {
  referralService,
  type ReferralStats,
  type ReferralMilestone,
} from '../../services/ReferralService';
import { useToast } from '../common/Toast';
import './ReferralDashboard.css';
import { reportError } from '../../utils/errorReporter';
import { publicOrigin } from '../../lib/appBase';

interface ReferralDashboardProps {
  userId: string;
}

export default function ReferralDashboard({ userId }: ReferralDashboardProps) {
  const [stats, setStats] = useState<ReferralStats>({
    code: '',
    totalReferrals: 0,
    totalDiamondsEarned: 0,
  });
  const [milestones, setMilestones] = useState<ReferralMilestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [shareFallbackUrl, setShareFallbackUrl] = useState('');
  const toast = useToast();
  const isMounted = useIsMounted();
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!userId) return;
    loadData();

    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, [userId]);

  useMasterBusSubscription('BALANCE_UPDATED', () => {
    if (isMounted.current) loadData();
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const s = await referralService.getStats(userId);
      const m = referralService.getMilestones(s.totalReferrals);
      if (isMounted.current) {
        setStats(s);
        setMilestones(m);
      }
      // Check for unclaimed milestones
      await referralService.checkMilestones(userId, s.totalReferrals);
    } catch (err) {
      reportError(err, 'ReferralDashboard.load_error');
    }
    if (isMounted.current) setLoading(false);
  };

  const handleCopy = async () => {
    if (!stats.code) return;
    try {
      if (!(await copyText(stats.code, 'ReferralDashboard.copy'))) throw new Error('copy refused');
      if (!isMounted.current) return;
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => {
        if (isMounted.current) setCopied(false);
      }, 2000);
    } catch (err) {
      reportError(err, 'ReferralDashboard.Error');
      if (isMounted.current) toast.error('Failed to copy');
    }
  };

  /**
   * THE REFERRAL LINK, WITH THE REFERRAL IN IT (2026-08-28).
   *
   * This used to hand `navigator.share` the bare homepage:
   *
   *     text: `... use my referral code ${code} ... https://smarter.poker`
   *     url:  'https://smarter.poker'
   *
   * The code lived ONLY in `text`. A share target is free to ignore `text` and
   * use `url` alone, and most of them do - every "share to app" sheet that
   * renders a link preview, and several that post the URL and drop the caption
   * entirely. So the commonest way to share a referral was also the way that
   * silently dropped it: the friend arrives at the homepage, signs up
   * unattributed, and the referrer is never credited for a referral they
   * actually made.
   *
   * The other two referral flows in this app already embed the code in the URL
   * (`PromotionsPage`, `InvitePage`, both `?ref=`), so this was the one that
   * leaked, not the pattern.
   *
   * `window.location.origin` rather than a hardcoded host: this SPA is served
   * from smarter.poker in production and from a preview host otherwise, and a
   * hardcoded link in a preview build sends testers to production.
   */
  const referralUrl = () => {
    // publicOrigin(): the current origin on the web (a preview build keeps
    // sending testers to itself), smarter.poker inside the native app.
    const origin = publicOrigin();
    const base = `${origin}/hub/club-arena/invite`;
    return stats.code ? `${base}?ref=${encodeURIComponent(stats.code)}` : base;
  };

  const handleShare = async () => {
    const url = referralUrl();
    setShareFallbackUrl('');
    /* Diamonds, and the number the server actually pays a new player. Dan
       2026-09-05: nothing on this platform earns chips. */
    const shareText = `Join me on Club Arena. Use my referral code ${stats.code} to start with bonus diamonds.`;
    // The code rides in the url, so a target that keeps only the url still
    // credits the referrer; the clipboard gets the pitch, then the link.
    const outcome = await shareLink({
      source: 'ReferralDashboard.share',
      title: 'Join Club Arena',
      text: shareText,
      url,
    });
    if (!isMounted.current) return;
    if (outcome === 'copied') toast.success('Invite Link Copied');
    // On the page, not in the toast: an error toast is sanitised and the URL
    // never reached the player (components/common/ShareLinkFallback.tsx).
    else if (outcome === 'failed') setShareFallbackUrl(url);
  };

  if (loading) {
    return (
      <div className="refd-container">
        <h3 className="refd-title">Referral Program</h3>
        <div className="refd-skeleton" />
      </div>
    );
  }

  return (
    <div className="refd-container">
      <h3 className="refd-title">Referral Program</h3>
      <p className="refd-subtitle">Invite Friends And Earn Diamonds Together</p>

      {/* Code Display */}
      <div className="refd-code-box">
        <span className="refd-code">{stats.code || '...'}</span>
        <button className="refd-copy-btn" onClick={handleCopy}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {/* Stats Row */}
      <div className="refd-stats">
        <div className="refd-stat">
          <span className="refd-stat-value">{stats.totalReferrals}</span>
          <span className="refd-stat-label">Referrals</span>
        </div>
        <div className="refd-stat">
          <span className="refd-stat-value">{stats.totalDiamondsEarned.toLocaleString()}</span>
          <span className="refd-stat-label">Diamonds Earned</span>
        </div>
      </div>

      {/* Milestones */}
      <div className="refd-milestones">
        {milestones.map((m) => (
          <div key={m.count} className={`refd-milestone ${m.unlocked ? 'refd-unlocked' : ''}`}>
            <span className="refd-ms-icon">{m.unlocked ? '✓' : '◈'}</span>
            <span className="refd-ms-label">{m.label}</span>
            <span className="refd-ms-reward">{m.reward.toLocaleString()} Diamonds</span>
          </div>
        ))}
      </div>

      {/* Share Button */}
      <button className="refd-share-btn" onClick={handleShare}>
        Invite Friends
      </button>
      {shareFallbackUrl && <ShareLinkFallback url={shareFallbackUrl} label="Invite Link" />}
    </div>
  );
}
