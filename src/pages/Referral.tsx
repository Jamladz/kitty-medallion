import React, { useState } from 'react';
import { useAuth } from '../components/AuthProvider';
import { Copy, Check, Sparkles, Users, Zap } from 'lucide-react';

const LOGO_URL = 'https://i.suar.me/PpEzN/l';

export default function Referral() {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);

  const botUsername = 'KittyMedallion_bot';
  const referralLink = `https://t.me/${botUsername}?startapp=ref_${user?.id}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    window.Telegram?.WebApp?.showAlert('Referral link copied to clipboard!');
  };

  const handleShare = () => {
    const text = 'Join Kitty Medallion and start mining with me!';
    window.Telegram?.WebApp?.openTelegramLink(
      `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(text)}`
    );
  };

  const referralCount = user?.referralCount || 0;
  const totalEarned = referralCount * 100;

  return (
    <div className="flex flex-col px-5 pt-6 pb-8">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-white">
          Invite Frens
        </h1>
        <p className="mt-1 text-xs text-zinc-400">
          Grow your mining network and earn permanent hashrate multipliers.
        </p>
      </div>

      {/* Referral KPI Summary Card */}
      <div className="mb-5 rounded-3xl bg-gradient-to-br from-amber-500/20 via-orange-500/10 to-[#141419] p-5 border border-amber-500/25 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-semibold text-amber-200/90">
            Network Performance
          </span>
          <Sparkles size={16} className="text-amber-400" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col rounded-2xl bg-[#0b0b0e]/75 p-4 border border-white/[0.06]">
            <span className="text-xs text-zinc-400">Invited Frens</span>
            <span className="mt-1.5 font-display text-2xl font-extrabold tabular-nums text-white">
              {referralCount.toLocaleString()}
            </span>
          </div>

          <div className="flex flex-col rounded-2xl bg-[#0b0b0e]/75 p-4 border border-white/[0.06]">
            <span className="text-xs text-zinc-400">Bonus Earned</span>
            <div className="mt-1.5 flex items-center space-x-1.5">
              <img
                src={LOGO_URL}
                className="h-5 w-5 rounded-full object-contain"
                alt="KITTY"
                referrerPolicy="no-referrer"
              />
              <span className="font-display text-2xl font-extrabold tabular-nums text-amber-400">
                +{totalEarned.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Reward Tier Benefits */}
      <div className="mb-6 rounded-3xl bg-[#141419] p-5 border border-white/[0.06] space-y-4">
        <h2 className="font-display text-sm font-bold text-white">
          Reward Per Invited Friend
        </h2>

        <div className="flex items-center justify-between py-1 border-b border-white/[0.05] pb-3.5">
          <div className="flex items-center space-x-3">
            <img
              src={LOGO_URL}
              className="h-8 w-8 rounded-full object-contain"
              alt="KITTY"
              referrerPolicy="no-referrer"
            />
            <div>
              <span className="block text-sm font-semibold text-white">
                Instant Medallion Drop
              </span>
              <span className="text-xs text-zinc-400">Credited immediately on join</span>
            </div>
          </div>
          <span className="font-mono text-sm font-bold tabular-nums text-amber-400">
            +100 KITTY
          </span>
        </div>

        <div className="flex items-center justify-between pt-0.5">
          <div className="flex items-center space-x-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Zap size={16} />
            </div>
            <div>
              <span className="block text-sm font-semibold text-white">
                Permanent Speed Boost
              </span>
              <span className="text-xs text-zinc-400">Added to daily cloud yield</span>
            </div>
          </div>
          <span className="font-mono text-sm font-bold tabular-nums text-emerald-400">
            +50 /day
          </span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col space-y-3 mt-auto">
        <button
          onClick={handleShare}
          className="flex w-full items-center justify-center space-x-2 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 active:scale-[0.98] py-4 text-sm font-bold text-zinc-950 transition-all shadow-lg shadow-orange-500/20"
        >
          <Users size={18} />
          <span>Invite Friends on Telegram</span>
        </button>

        <button
          onClick={handleCopy}
          className="flex w-full items-center justify-center space-x-2 rounded-2xl bg-[#141419] hover:bg-[#1c1c24] active:scale-[0.98] py-4 text-sm font-semibold text-white border border-white/[0.08] transition-all"
        >
          {copied ? <Check size={18} className="text-emerald-400" /> : <Copy size={18} className="text-zinc-400" />}
          <span>{copied ? 'Referral Link Copied' : 'Copy Invite Link'}</span>
        </button>
      </div>
    </div>
  );
}
