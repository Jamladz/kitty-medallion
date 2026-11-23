import React, { useEffect, useState } from 'react';
import { useAuth } from './AuthProvider';
import { hasValidReferrer } from '../lib/referrals';
import { REFERRAL_CONFIG } from '../lib/rewardsEngine';
import { triggerTelegramHaptic } from '../lib/telegram';
import { Gift, CheckCircle2, X, Wallet } from 'lucide-react';

const USDT_LOGO_URL = 'https://i.ibb.co/N2WMd6QC/Tether-USDT.png';
const KITTY_LOGO_URL = 'https://i.suar.me/PpEzN/l';

export const ReferralWelcomeSheet: React.FC = () => {
  const { user } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [claimedState, setClaimedState] = useState(false);

  const userId = user?.id ? String(user.id) : '';
  const storageKey = userId ? `kitty_usdt_welcome_sheet_claimed_${userId}` : '';

  const openSheet = () => {
    setMounted(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setVisible(true);
      });
    });
  };

  const closeSheet = () => {
    if (storageKey) {
      try {
        window.localStorage.setItem(storageKey, '1');
      } catch {}
    }
    setVisible(false);
    setTimeout(() => {
      setMounted(false);
      setClaimedState(false);
    }, 300);
  };

  useEffect(() => {
    const handleGiftUnlocked = () => {
      if (storageKey) {
        try {
          const alreadyClaimed = window.localStorage.getItem(storageKey);
          if (alreadyClaimed === '1') return;
        } catch {}
      }
      openSheet();
    };

    window.addEventListener('kitty:referral-gift-unlocked', handleGiftUnlocked);
    return () => {
      window.removeEventListener('kitty:referral-gift-unlocked', handleGiftUnlocked);
    };
  }, [storageKey]);

  useEffect(() => {
    if (!user || !userId) return;
    if (!hasValidReferrer(user, userId)) return;

    try {
      const alreadyClaimed = window.localStorage.getItem(storageKey);
      if (alreadyClaimed !== '1') {
        openSheet();
      }
    } catch {}
  }, [user, userId, storageKey]);

  const handleClaimGift = () => {
    triggerTelegramHaptic('success');
    setClaimedState(true);
    setTimeout(() => {
      closeSheet();
    }, 650);
  };

  if (!mounted) return null;

  const referrerId = String(user?.referredBy || user?.referrerId || '');
  const referrerShort = referrerId ? `#${referrerId.slice(-4)}` : 'Friend';

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col justify-end transition-opacity duration-300 ${
        visible ? 'bg-black/70 backdrop-blur-sm opacity-100' : 'bg-black/0 opacity-0 pointer-events-none'
      }`}
      onClick={closeSheet}
    >
      {/* 50% Viewport Height Bottom-Up Sheet */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative mx-auto flex h-[50dvh] min-h-[345px] max-h-[450px] w-full max-w-[460px] flex-col justify-between rounded-t-[32px] border-t border-emerald-500/30 bg-gradient-to-b from-[#151c19] via-[#131419] to-[#0b0b0e] px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom,1.25rem))] shadow-[0_-18px_50px_rgba(0,0,0,0.85)] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          visible ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        {/* Top Ambient Emerald Glow inside Sheet */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 rounded-t-[32px] bg-[radial-gradient(ellipse_75%_60%_at_50%_0%,rgba(16,185,129,0.20),transparent)]" />

        {/* Sheet Header: Drag Handle & Close Button */}
        <div className="relative z-10 flex items-center justify-between">
          <div className="w-11" />
          <div className="h-1.5 w-11 rounded-full bg-white/15" />
          <button
            type="button"
            onClick={closeSheet}
            aria-label="Close welcome gift"
            className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-400 hover:bg-white/[0.06] hover:text-white active:scale-95 transition-all"
          >
            <X size={18} />
          </button>
        </div>

        {/* Center Reward Showcase */}
        <div className="relative z-10 flex flex-col items-center text-center my-auto px-2">
          {/* Dual Token Emblem (USDT + KITTY) */}
          <div className="relative mb-3.5 flex h-16 w-16 sm:h-18 sm:w-18 items-center justify-center rounded-3xl border border-emerald-500/35 bg-emerald-500/15 shadow-[0_0_32px_rgba(16,185,129,0.28)]">
            <img
              src={USDT_LOGO_URL}
              alt="Tether USDT"
              referrerPolicy="no-referrer"
              className="h-11 w-11 sm:h-12 sm:w-12 rounded-full object-contain"
            />
            <div className="absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full border border-amber-400/50 bg-[#141419] p-0.5 shadow-md">
              <img
                src={KITTY_LOGO_URL}
                alt="KITTY"
                referrerPolicy="no-referrer"
                className="h-full w-full rounded-full object-contain"
              />
            </div>
          </div>

          {/* Kicker */}
          <div className="flex items-center space-x-1.5 text-xs font-semibold text-emerald-400">
            <Gift size={13} />
            <span>First-Time Referral Entry Gift</span>
          </div>

          {/* Primary 2.00 USDT Reward Headline */}
          <h2 className="mt-1 font-display text-3xl sm:text-4xl font-extrabold tracking-tight tabular-nums text-white">
            +{REFERRAL_CONFIG.WELCOME_BONUS_USDT.toFixed(2)} <span className="text-emerald-400">USDT</span>
          </h2>

          {/* Unboxed Metadata Row */}
          <p className="mt-1.5 text-xs font-medium text-zinc-300">
            <span>+{REFERRAL_CONFIG.WELCOME_BONUS} KITTY Bonus</span>
            <span className="mx-1.5 text-zinc-600" aria-hidden="true">·</span>
            <span>Invited by Miner {referrerShort}</span>
          </p>

          <p className="mt-2 max-w-[320px] text-[11px] sm:text-xs leading-relaxed text-zinc-400">
            Your first-time referral welcome gift of{' '}
            <strong className="text-white">{REFERRAL_CONFIG.WELCOME_BONUS_USDT.toFixed(2)} USDT</strong> has been credited directly to your wallet balance.
          </p>
        </div>

        {/* Bottom Primary CTA Button (Natural Thumb Zone) */}
        <div className="relative z-10 pt-2">
          <button
            type="button"
            onClick={handleClaimGift}
            disabled={claimedState}
            className={`flex min-h-[48px] w-full items-center justify-center space-x-2 rounded-2xl py-3.5 px-6 text-sm font-extrabold transition-all duration-150 whitespace-nowrap ${
              claimedState
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 active:scale-[0.98] text-zinc-950 shadow-lg shadow-emerald-500/25'
            }`}
          >
            {claimedState ? (
              <>
                <CheckCircle2 size={18} />
                <span>2.00 USDT Added to Wallet!</span>
              </>
            ) : (
              <>
                <Wallet size={17} />
                <span>Claim {REFERRAL_CONFIG.WELCOME_BONUS_USDT.toFixed(2)} USDT Gift</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
