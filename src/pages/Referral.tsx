import React, { useEffect, useState } from 'react';
import { useAuth } from '../components/AuthProvider';
import { api } from '../lib/api';
import { ReferralMilestone, ReferralRecord } from '../types';
import {
  REFERRAL_CONFIG,
  REFERRAL_MILESTONES,
  evaluateMilestoneProgress,
  calculateTotalReferralStats,
} from '../lib/rewardsEngine';
import {
  OFFICIAL_BOT_USERNAME,
  buildReferralLink,
  buildTelegramShareUrl,
} from '../lib/telegram';
import { referralService } from '../lib/referrals';
import {
  Copy,
  Check,
  Sparkles,
  Users,
  Zap,
  Share2,
  Crown,
  Gift,
  CheckCircle2,
  Lock,
  RefreshCw,
} from 'lucide-react';

const LOGO_URL = 'https://i.ibb.co/3ykKfM0F/file-00000000e9e88246928f3f50b525d0a7.png';

const getInitials = (name?: string, username?: string) => {
  const clean = (name || '').trim();
  if (clean) {
    const parts = clean.split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return clean.slice(0, 2).toUpperCase();
  }
  if (username) return username.slice(0, 2).toUpperCase();
  return 'FR';
};

export default function Referral() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'milestones' | 'friends'>('milestones');
  const [copiedLink, setCopiedLink] = useState(false);

  const [referrals, setReferrals] = useState<ReferralRecord[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const userId = String(user?.id || '999999999');

  // Unique Invite Link by Telegram ID: https://t.me/kittymedallion_bot?startapp=ref_tg_<userId>
  const referralLink = buildReferralLink(userId, OFFICIAL_BOT_USERNAME, '');

  const loadFriendsList = async (force = false) => {
    setLoadingFriends(true);
    try {
      const myRefs = await referralService.getMyReferrals(userId, force);
      setReferrals(myRefs);
    } catch (e) {
      console.error('Error loading referrals list:', e);
    } finally {
      setLoadingFriends(false);
    }
  };

  useEffect(() => {
    loadFriendsList(true);
  }, [userId, activeTab]);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(referralLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
    window.Telegram?.WebApp?.showAlert?.('Referral link copied to clipboard!');
  };

  const handleShareTelegram = () => {
    const shareUrl = buildTelegramShareUrl(referralLink);
    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(shareUrl);
    } else {
      window.open(shareUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleClaimMilestone = async (milestone: ReferralMilestone) => {
    if (claimingId) return;
    setClaimingId(milestone.id);
    try {
      await referralService.claimMilestone(userId, milestone.id);
      window.Telegram?.WebApp?.showAlert?.(
        `Milestone Unlocked! +${milestone.rewardCoins.toLocaleString()} KITTY, +${milestone.speedBoost} Hash/24h & ${milestone.vipDays} VIP Days credited!`
      );
    } catch (err: any) {
      window.Telegram?.WebApp?.showAlert?.(
        err.message || 'Failed to claim milestone'
      );
    } finally {
      setClaimingId(null);
    }
  };

  const { referralsCount, earnedReferralCoins } = calculateTotalReferralStats(
    user?.referralsCount,
    user?.referralCount,
    referrals.length,
    user?.earnedReferralCoins
  );
  const claimedMilestones: string[] = Array.isArray(user?.claimedMilestones)
    ? user.claimedMilestones
    : [];

  const now = Date.now();
  const vipDaysRemaining =
    user?.vipExpiresAt && user.vipExpiresAt > now
      ? Math.ceil((user.vipExpiresAt - now) / (1000 * 60 * 60 * 24))
      : 0;

  return (
    <div className="flex flex-col px-4 sm:px-5 pt-4 sm:pt-6 pb-8">
      {/* Header & VIP Status */}
      <div className="mb-4 sm:mb-5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-white">
            Referral Hub
          </h1>
          <p className="mt-1 text-xs text-zinc-400">
            Earn +{REFERRAL_CONFIG.REFERRER_REWARD} KITTY per friend & unlock VIP Milestones.
          </p>
        </div>

        {vipDaysRemaining > 0 && (
          <div className="flex shrink-0 items-center space-x-1.5 rounded-2xl bg-amber-500/15 px-3 py-1.5 border border-amber-500/30 text-amber-300">
            <Crown size={14} className="text-amber-400" />
            <span className="font-mono text-xs font-bold tabular-nums">
              VIP · {vipDaysRemaining}d
            </span>
          </div>
        )}
      </div>

      {/* KPI Summary Banner */}
      <div className="mb-4 rounded-3xl bg-gradient-to-br from-amber-500/20 via-orange-500/10 to-[#141419] p-4 sm:p-5 border border-amber-500/25 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-amber-200/90">
            Your Referral Telemetry
          </span>
          <Sparkles size={15} className="text-amber-400" />
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
          <div className="flex min-w-0 flex-col rounded-2xl bg-[#0b0b0e]/80 p-2.5 sm:p-3.5 border border-white/[0.06]">
            <span className="text-[10px] sm:text-[11px] text-zinc-400 truncate">Referrals</span>
            <span className="mt-1 sm:mt-1.5 font-display text-base sm:text-xl font-extrabold tabular-nums text-white truncate">
              {referralsCount.toLocaleString()}
            </span>
          </div>

          <div className="flex min-w-0 flex-col rounded-2xl bg-[#0b0b0e]/80 p-2.5 sm:p-3.5 border border-white/[0.06]">
            <span className="text-[10px] sm:text-[11px] text-zinc-400 truncate">Earned KITTY</span>
            <div className="mt-1 sm:mt-1.5 flex items-center space-x-1 min-w-0">
              <img
                src={LOGO_URL}
                className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0 rounded-full object-contain"
                alt="KITTY"
                referrerPolicy="no-referrer"
              />
              <span className="font-display text-base sm:text-xl font-extrabold tabular-nums text-amber-400 truncate">
                +{earnedReferralCoins.toLocaleString()}
              </span>
            </div>
          </div>

          <div className="flex min-w-0 flex-col rounded-2xl bg-[#0b0b0e]/80 p-2.5 sm:p-3.5 border border-white/[0.06]">
            <span className="text-[10px] sm:text-[11px] text-zinc-400 truncate">Speed Boost</span>
            <span className="mt-1 sm:mt-1.5 font-display text-base sm:text-xl font-extrabold tabular-nums text-emerald-400 truncate">
              +{(referralsCount * REFERRAL_CONFIG.REFERRER_SPEED_BOOST).toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* Invite Link & Direct Telegram Share Button */}
      <div className="mb-5 rounded-3xl bg-[#141419] p-4 border border-white/[0.06] space-y-3 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] sm:text-xs text-zinc-400 px-1">
          <span>
            Inviter: <strong className="text-amber-400">+{REFERRAL_CONFIG.REFERRER_REWARD} KITTY</strong> &{' '}
            <strong className="text-emerald-400">+{REFERRAL_CONFIG.REFERRER_SPEED_BOOST}/24h</strong>
          </span>
          <span>·</span>
          <span>
            Friend Gift: <strong className="text-emerald-400">+{REFERRAL_CONFIG.WELCOME_BONUS_USDT} USDT</strong> &{' '}
            <strong className="text-white">+{REFERRAL_CONFIG.WELCOME_BONUS} KITTY</strong>
          </span>
        </div>

        <div className="flex items-center justify-between rounded-2xl bg-[#0b0b0e] px-3.5 py-2.5 border border-white/[0.05]">
          <div className="min-w-0 pr-2">
            <span className="block text-[10px] font-medium text-zinc-500">
              Unique Telegram ID Referral Link
            </span>
            <span className="block font-mono text-xs text-zinc-200 truncate mt-0.5">
              {referralLink}
            </span>
          </div>
          <button
            onClick={handleCopyLink}
            className="shrink-0 flex items-center space-x-1.5 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] active:scale-95 px-3 py-2 text-xs font-semibold text-white transition-all"
          >
            {copiedLink ? (
              <>
                <Check size={14} className="text-emerald-400" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy size={14} className="text-zinc-300" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>

        <button
          onClick={handleShareTelegram}
          className="flex w-full items-center justify-center space-x-2 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 active:scale-[0.98] py-3.5 text-sm font-bold text-zinc-950 transition-all shadow-lg shadow-orange-500/20"
        >
          <Share2 size={17} />
          <span>Share Invite on Telegram</span>
        </button>
      </div>

      {/* Referral Hub Navigation Tabs (2 Tabs: Milestones & My Frens) */}
      <div className="mb-4 flex rounded-2xl bg-[#141419] p-1 border border-white/[0.06]">
        <button
          onClick={() => setActiveTab('milestones')}
          className={`flex-1 flex items-center justify-center space-x-2 rounded-xl py-2.5 text-xs font-bold transition-all whitespace-nowrap ${
            activeTab === 'milestones'
              ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-zinc-950 shadow-sm'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Gift size={14} />
          <span>Milestones</span>
        </button>

        <button
          onClick={() => setActiveTab('friends')}
          className={`flex-1 flex items-center justify-center space-x-2 rounded-xl py-2.5 text-xs font-bold transition-all whitespace-nowrap ${
            activeTab === 'friends'
              ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-zinc-950 shadow-sm'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Users size={14} />
          <span>My Frens ({referralsCount})</span>
        </button>
      </div>

      {/* TAB 1: PROGRESSIVE MILESTONES */}
      {activeTab === 'milestones' && (
        <div className="flex flex-col space-y-3">
          {REFERRAL_MILESTONES.map((m) => {
            const { isClaimed, canClaim, progressPct } =
              evaluateMilestoneProgress(m, referralsCount, claimedMilestones);

            return (
              <div
                key={m.id}
                className={`rounded-3xl p-4 border transition-all ${
                  isClaimed
                    ? 'bg-[#141419]/60 border-emerald-500/20'
                    : canClaim
                    ? 'bg-gradient-to-br from-amber-500/15 via-[#141419] to-[#141419] border-amber-500/40 shadow-lg'
                    : 'bg-[#141419] border-white/[0.06]'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center space-x-3 min-w-0">
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border font-mono text-xs font-extrabold ${
                        isClaimed
                          ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                          : canClaim
                          ? 'bg-amber-500 text-zinc-950 border-amber-400'
                          : 'bg-[#0b0b0e] border-white/[0.06] text-zinc-400'
                      }`}
                    >
                      {m.targetCount}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="font-display text-sm font-bold text-white truncate">
                          {m.title}
                        </span>
                        <span className="text-xs text-zinc-500 font-mono tabular-nums">
                          ({Math.min(referralsCount, m.targetCount)}/{m.targetCount})
                        </span>
                      </div>

                      <div className="mt-1 flex items-center space-x-2 text-xs">
                        <span className="flex items-center font-mono font-bold tabular-nums text-amber-400">
                          <img
                            src={LOGO_URL}
                            className="mr-1 h-3.5 w-3.5 rounded-full object-contain"
                            alt="KITTY"
                            referrerPolicy="no-referrer"
                          />
                          +{m.rewardCoins.toLocaleString()}
                        </span>
                        <span className="text-zinc-600">·</span>
                        <span className="font-mono text-emerald-400 font-medium">
                          +{m.speedBoost}/24h
                        </span>
                        <span className="text-zinc-600">·</span>
                        <span className="text-amber-300 font-medium">
                          {m.vipDays}d VIP
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Claim Button */}
                  <button
                    onClick={() => handleClaimMilestone(m)}
                    disabled={!canClaim || claimingId === m.id}
                    className={`shrink-0 rounded-2xl px-3.5 py-2.5 text-xs font-bold transition-all flex items-center space-x-1.5 ${
                      isClaimed
                        ? 'bg-emerald-500/15 text-emerald-400 cursor-default'
                        : canClaim
                        ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-zinc-950 hover:from-amber-400 hover:to-orange-400 active:scale-95 shadow-md shadow-amber-500/20'
                        : 'bg-[#0b0b0e] text-zinc-500 border border-white/[0.05] cursor-not-allowed'
                    }`}
                  >
                    {isClaimed ? (
                      <>
                        <CheckCircle2 size={14} />
                        <span>Claimed</span>
                      </>
                    ) : claimingId === m.id ? (
                      <span>...</span>
                    ) : canClaim ? (
                      <>
                        <Zap size={13} />
                        <span>Claim</span>
                      </>
                    ) : (
                      <>
                        <Lock size={13} />
                        <span>Locked</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Progress Bar */}
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[#0b0b0e]">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      isClaimed
                        ? 'bg-emerald-500'
                        : canClaim
                        ? 'bg-amber-400'
                        : 'bg-amber-500/60'
                    }`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* TAB 2: REFERRED FRIENDS LIST (from "referrals" collection) */}
      {activeTab === 'friends' && (
        <div className="rounded-3xl bg-[#141419] p-4 border border-white/[0.06]">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-display text-xs font-bold text-white">
              Direct Referral Ledger ({referrals.length})
            </span>
            <button
              onClick={() => loadFriendsList(true)}
              disabled={loadingFriends}
              className="flex items-center space-x-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] active:scale-95 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-300 transition-all"
            >
              <RefreshCw
                size={12}
                className={loadingFriends ? 'animate-spin text-amber-400' : 'text-zinc-400'}
              />
              <span>Refresh</span>
            </button>
          </div>

          {loadingFriends ? (
            <div className="py-6 text-center text-xs text-zinc-500">
              Loading your referral ledger...
            </div>
          ) : referrals.length === 0 ? (
            <div className="rounded-2xl bg-[#0b0b0e]/70 p-5 text-center border border-white/[0.04]">
              <p className="text-xs font-semibold text-zinc-300">
                No friends referred yet.
              </p>
              <p className="mt-1 text-[11px] text-zinc-500">
                Share your invite link above — every friend earns you +{REFERRAL_CONFIG.REFERRER_REWARD} KITTY automatically!
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.05]">
              {referrals.map((rec) => (
                <div
                  key={rec.id}
                  className="flex items-center justify-between py-2.5 first:pt-1 last:pb-1"
                >
                  <div className="flex items-center space-x-3 min-w-0 pr-2">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/30 font-display text-xs font-extrabold text-amber-300">
                      {getInitials(rec.referredName, rec.referredUsername)}
                    </div>
                    <div className="min-w-0">
                      <span className="block text-xs font-bold text-white truncate">
                        {rec.referredName}
                      </span>
                      <span className="block text-[10px] text-zinc-500 font-mono">
                        {rec.referredUsername ? `@${rec.referredUsername} · ` : ''}
                        {new Date(rec.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="flex items-center justify-end space-x-1 font-mono text-xs font-bold tabular-nums text-amber-400">
                      <img
                        src={LOGO_URL}
                        className="h-3.5 w-3.5 rounded-full object-contain"
                        alt="KITTY"
                        referrerPolicy="no-referrer"
                      />
                      <span>+{(rec.rewardAmount || REFERRAL_CONFIG.REFERRER_REWARD).toLocaleString()}</span>
                    </div>
                    <span className="block font-mono text-[10px] font-medium text-emerald-400">
                      +{rec.speedBoost || REFERRAL_CONFIG.REFERRER_SPEED_BOOST} / 24h
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
