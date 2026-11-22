import React, { useEffect, useState } from 'react';
import { useAuth } from '../components/AuthProvider';
import { api } from '../lib/api';
import {
  Copy,
  Check,
  Sparkles,
  Users,
  Zap,
  Share2,
} from 'lucide-react';

const LOGO_URL = 'https://i.suar.me/PpEzN/l';
const DEFAULT_BOT_USERNAME =
  (typeof import.meta !== 'undefined' &&
    (import.meta as any).env?.VITE_TELEGRAM_BOT_USERNAME) ||
  'KittyMedallion_bot';
const DEFAULT_SHORT_NAME =
  (typeof import.meta !== 'undefined' &&
    (import.meta as any).env?.VITE_TELEGRAM_APP_SHORT_NAME) ||
  '';

interface ReferredUser {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  miningSpeed: number;
  joinedAt: number;
}

const getInitials = (firstName?: string, lastName?: string, username?: string) => {
  const f = (firstName || '').trim();
  const l = (lastName || '').trim();
  if (f && l) return (f[0] + l[0]).toUpperCase();
  if (f) return f.slice(0, 2).toUpperCase();
  if (username) return username.slice(0, 2).toUpperCase();
  return 'FR';
};

export default function Referral() {
  const { user } = useAuth();
  const [copiedLink, setCopiedLink] = useState(false);
  const [botUsername, setBotUsername] = useState(DEFAULT_BOT_USERNAME);
  const [appShortName, setAppShortName] = useState(DEFAULT_SHORT_NAME);

  const [referrals, setReferrals] = useState<ReferredUser[]>([]);
  const [loadingReferrals, setLoadingReferrals] = useState(true);

  const userId = String(user?.id || '999999999');
  const referralCode = `ref_${userId}`;

  // Official Telegram Mini App Direct Link format (automatically passes start_param on launch)
  const referralLink = appShortName
    ? `https://t.me/${botUsername}/${appShortName}?startapp=${referralCode}`
    : `https://t.me/${botUsername}?startapp=${referralCode}`;

  useEffect(() => {
    api.getBotInfo().then((info) => {
      if (info?.botUsername) setBotUsername(info.botUsername);
      if (info?.appShortName) setAppShortName(info.appShortName);
    });
  }, []);

  const loadReferrals = async () => {
    setLoadingReferrals(true);
    try {
      const res = await api.getReferrals();
      if (res && Array.isArray(res.referrals)) {
        setReferrals(res.referrals);
      }
    } catch (e) {
      console.error('Failed to load referrals:', e);
    } finally {
      setLoadingReferrals(false);
    }
  };

  useEffect(() => {
    loadReferrals();
  }, [user?.id, user?.referralCount]);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(referralLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
    window.Telegram?.WebApp?.showAlert?.('Referral link copied to clipboard!');
  };

  const handleShareTelegram = () => {
    const text =
      'Join Kitty Medallion on Telegram! Start mining every 24h and claim +100 KITTY instant welcome bonus:';
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(
      referralLink
    )}&text=${encodeURIComponent(text)}`;

    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(shareUrl);
    } else {
      navigator.clipboard.writeText(referralLink);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const effectiveReferralCount = Math.max(
    user?.referralCount || 0,
    referrals.length
  );
  const totalKittyEarned = effectiveReferralCount * 100;
  const totalHashrateEarned = effectiveReferralCount * 50;

  return (
    <div className="flex flex-col px-5 pt-6 pb-10">
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight text-white">
          Invite Frens
        </h1>
        <p className="mt-1 text-xs text-zinc-400">
          Share your personal invite link. Referrals are tracked automatically the moment a friend launches the Mini App.
        </p>
      </div>

      {/* Referral KPI Summary Card */}
      <div className="mb-4 rounded-3xl bg-gradient-to-br from-amber-500/20 via-orange-500/10 to-[#141419] p-5 border border-amber-500/25 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-semibold text-amber-200/90">
            Verified Referral Network
          </span>
          <Sparkles size={16} className="text-amber-400" />
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          <div className="flex flex-col rounded-2xl bg-[#0b0b0e]/80 p-3.5 border border-white/[0.06]">
            <span className="text-[11px] text-zinc-400">Total Frens</span>
            <span className="mt-1.5 font-display text-xl font-extrabold tabular-nums text-white">
              {effectiveReferralCount.toLocaleString()}
            </span>
          </div>

          <div className="flex flex-col rounded-2xl bg-[#0b0b0e]/80 p-3.5 border border-white/[0.06]">
            <span className="text-[11px] text-zinc-400">KITTY Bonus</span>
            <div className="mt-1.5 flex items-center space-x-1">
              <img
                src={LOGO_URL}
                className="h-4 w-4 rounded-full object-contain"
                alt="KITTY"
                referrerPolicy="no-referrer"
              />
              <span className="font-display text-xl font-extrabold tabular-nums text-amber-400">
                +{totalKittyEarned.toLocaleString()}
              </span>
            </div>
          </div>

          <div className="flex flex-col rounded-2xl bg-[#0b0b0e]/80 p-3.5 border border-white/[0.06]">
            <span className="text-[11px] text-zinc-400">Speed Boost</span>
            <span className="mt-1.5 font-display text-xl font-extrabold tabular-nums text-emerald-400">
              +{totalHashrateEarned.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* Direct Automatic Invite Link Card */}
      <div className="mb-4 rounded-3xl bg-[#141419] p-4 border border-white/[0.06] space-y-3 shadow-xl">
        <div className="flex items-center justify-between rounded-2xl bg-[#0b0b0e] px-3.5 py-3 border border-white/[0.05]">
          <div className="min-w-0 pr-2">
            <span className="block text-[10px] font-medium text-zinc-500">
              Your Automatic Invite Link
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
          <span>Invite Friends on Telegram</span>
        </button>
      </div>

      {/* Reward Tier Benefits */}
      <div className="mb-4 rounded-3xl bg-[#141419] p-4 border border-white/[0.06] space-y-3">
        <h2 className="font-display text-xs font-bold text-zinc-300">
          Automatic Rewards Per Invited Friend
        </h2>

        <div className="flex items-center justify-between py-1 border-b border-white/[0.05] pb-3">
          <div className="flex items-center space-x-3">
            <img
              src={LOGO_URL}
              className="h-7 w-7 rounded-full object-contain"
              alt="KITTY"
              referrerPolicy="no-referrer"
            />
            <div>
              <span className="block text-xs font-semibold text-white">
                Instant Medallion Bonus
              </span>
              <span className="text-[11px] text-zinc-400">
                Credited automatically to you & your friend on join
              </span>
            </div>
          </div>
          <span className="font-mono text-xs font-bold tabular-nums text-amber-400">
            +100 KITTY
          </span>
        </div>

        <div className="flex items-center justify-between pt-0.5">
          <div className="flex items-center space-x-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Zap size={14} />
            </div>
            <div>
              <span className="block text-xs font-semibold text-white">
                Permanent 24h Yield Multiplier
              </span>
              <span className="text-[11px] text-zinc-400">
                Added permanently to your 24-hour mining speed
              </span>
            </div>
          </div>
          <span className="font-mono text-xs font-bold tabular-nums text-emerald-400">
            +50 / 24h
          </span>
        </div>
      </div>

      {/* Live Invited Friends Roster */}
      <div className="rounded-3xl bg-[#141419] p-4 border border-white/[0.06]">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Users size={15} className="text-amber-400" />
            <span className="font-display text-xs font-bold text-white">
              Invited Friends ({referrals.length})
            </span>
          </div>
          <span className="text-[11px] text-zinc-500">Auto-Synced</span>
        </div>

        {loadingReferrals ? (
          <div className="py-5 text-center text-xs text-zinc-500">
            Loading invited friends...
          </div>
        ) : referrals.length === 0 ? (
          <div className="rounded-2xl bg-[#0b0b0e]/70 p-4 text-center border border-white/[0.04]">
            <p className="text-xs font-medium text-zinc-300">
              No friends have joined through your link yet.
            </p>
            <p className="mt-1 text-[11px] text-zinc-500">
              Share your link above — as soon as a friend opens the app, your reward is added automatically!
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.05]">
            {referrals.map((fren) => (
              <div
                key={fren.id}
                className="flex items-center justify-between py-2.5 first:pt-1 last:pb-1"
              >
                <div className="flex items-center space-x-3 min-w-0 pr-2">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/30 font-display text-xs font-extrabold text-amber-300">
                    {getInitials(fren.firstName, fren.lastName, fren.username)}
                  </div>
                  <div className="min-w-0">
                    <span className="block text-xs font-bold text-white truncate">
                      {fren.firstName} {fren.lastName}
                    </span>
                    <span className="block text-[11px] text-zinc-400 truncate">
                      {fren.username ? `@${fren.username}` : `ID #${fren.id}`}
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
                    <span>+100</span>
                  </div>
                  <span className="block font-mono text-[10px] font-medium text-emerald-400">
                    +50 / 24h
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
