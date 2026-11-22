import React, { useEffect, useState } from 'react';
import { useAuth } from '../components/AuthProvider';
import { motion } from 'framer-motion';
import { api } from '../lib/api';
import { Gift, ShieldCheck, Zap, Users, Sparkles } from 'lucide-react';

const LOGO_URL = 'https://i.suar.me/PpEzN/l';
const USDT_LOGO_URL = 'https://i.ibb.co/N2WMd6QC/Tether-USDT.png';
const RATE = 10000;

export default function Home() {
  const { user, refreshMining } = useAuth();
  const [displayBalance, setDisplayBalance] = useState(user?.balanceKitty || 0);
  const [earlyCount, setEarlyCount] = useState(0);
  const [isEarlyClaimed, setIsEarlyClaimed] = useState(true);
  const [loadingClaim, setLoadingClaim] = useState(false);

  // Smooth live balance ticker
  useEffect(() => {
    let animationFrame: number;
    let lastUpdate = Date.now();
    const miningPerSec = (user?.miningSpeed || 500) / (24 * 60 * 60);

    const updateBalance = () => {
      const now = Date.now();
      const deltaMs = now - Math.max(lastUpdate, user?.lastMiningClaim || now);
      const earnedSinceClaim = (deltaMs / 1000) * miningPerSec;
      setDisplayBalance((user?.balanceKitty || 0) + earnedSinceClaim);
      animationFrame = requestAnimationFrame(updateBalance);
    };

    updateBalance();
    return () => cancelAnimationFrame(animationFrame);
  }, [user]);

  // Sync to server every minute
  useEffect(() => {
    const interval = setInterval(() => {
      refreshMining();
    }, 60000);
    return () => clearInterval(interval);
  }, [refreshMining]);

  useEffect(() => {
    const fetchEarlyStatus = async () => {
      try {
        const status = await api.getEarlyUserStatus();
        setEarlyCount(status.count);
        setIsEarlyClaimed(status.isClaimed);
      } catch (e) {}
    };
    fetchEarlyStatus();
  }, []);

  const handleClaimEarly = async () => {
    if (loadingClaim) return;
    setLoadingClaim(true);
    try {
      await api.claimEarlyUser();
      setIsEarlyClaimed(true);
    } catch (error: any) {
      if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.showAlert(error.message || 'Error claiming early reward');
      }
    }
    setLoadingClaim(false);
  };

  const miningSpeed = user?.miningSpeed || 500;
  const referralBonus = Math.max(0, miningSpeed - 500);
  const usdtEquivalent = displayBalance / RATE;

  return (
    <div className="flex min-h-full flex-col items-center px-5 pt-6 pb-8">
      {/* Top Compact Status Strip */}
      <div className="w-full flex items-center justify-between mb-6">
        <div className="flex items-center space-x-2">
          <img
            src={LOGO_URL}
            alt="Kitty Medallion"
            referrerPolicy="no-referrer"
            className="h-6 w-6 rounded-full object-contain"
          />
          <span className="font-display text-sm font-bold tracking-tight text-white">
            Kitty Medallion
          </span>
        </div>

        <div className="flex items-center space-x-1.5 text-xs font-medium text-zinc-400">
          <img
            src={USDT_LOGO_URL}
            alt="USDT"
            referrerPolicy="no-referrer"
            className="h-4 w-4 rounded-full object-contain"
          />
          <span className="font-mono tabular-nums text-emerald-400 font-semibold">
            ≈ {usdtEquivalent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="text-zinc-500">USDT</span>
        </div>
      </div>

      {/* Central Medallion Showcase with Pedestal Halo */}
      <div className="relative my-3 flex items-center justify-center">
        {/* Ambient golden back-glow */}
        <div className="pointer-events-none absolute h-48 w-48 rounded-full bg-gradient-to-tr from-amber-500/20 via-orange-500/15 to-transparent blur-2xl" />
        {/* Concentric subtle orbital ring */}
        <div className="pointer-events-none absolute h-44 w-44 rounded-full border border-amber-500/15" />
        <div className="pointer-events-none absolute h-52 w-52 rounded-full border border-white/[0.04]" />

        <motion.div
          initial={{ scale: 0.88, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.45, type: 'spring', stiffness: 200 }}
          whileTap={{ scale: 0.95 }}
          className="relative z-10 cursor-pointer select-none p-3"
        >
          <img
            src={LOGO_URL}
            alt="Kitty Medallion"
            referrerPolicy="no-referrer"
            className="h-36 w-36 object-contain drop-shadow-[0_16px_36px_rgba(245,158,11,0.38)]"
          />
        </motion.div>
      </div>

      {/* Live Mined Balance Readout */}
      <div className="mt-3 mb-7 text-center">
        <p className="mb-1.5 text-xs font-medium text-zinc-400">
          Total Mined Balance
        </p>
        <div className="flex items-center justify-center space-x-2.5">
          <img
            src={LOGO_URL}
            className="h-7 w-7 rounded-full object-contain"
            alt="KITTY"
            referrerPolicy="no-referrer"
          />
          <span className="font-display text-4xl font-extrabold tabular-nums tracking-tight text-white">
            {displayBalance.toLocaleString(undefined, {
              minimumFractionDigits: 4,
              maximumFractionDigits: 4,
            })}
          </span>
        </div>
      </div>

      {/* Mining Performance Card */}
      <div className="w-full rounded-3xl bg-[#141419] p-5 border border-white/[0.06] shadow-xl">
        <div className="flex items-center justify-between pb-4 border-b border-white/[0.06]">
          <div className="flex items-center space-x-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Zap size={19} />
            </div>
            <div>
              <span className="block text-sm font-bold text-white">Active Hashrate</span>
              <span className="text-xs text-zinc-400">Continuous cloud yield</span>
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center justify-end space-x-1">
              <img
                src={LOGO_URL}
                className="h-4 w-4 rounded-full object-contain"
                alt="KITTY"
                referrerPolicy="no-referrer"
              />
              <span className="font-mono text-lg font-bold tabular-nums text-amber-400">
                +{miningSpeed.toLocaleString()}
              </span>
            </div>
            <span className="text-[11px] font-medium text-zinc-500">KITTY / day</span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-[#0b0b0e]/70 p-3.5 border border-white/[0.04]">
            <span className="text-[11px] font-medium text-zinc-400">Base Output</span>
            <div className="mt-1 flex items-center space-x-1">
              <img
                src={LOGO_URL}
                className="h-3.5 w-3.5 rounded-full object-contain"
                alt="KITTY"
                referrerPolicy="no-referrer"
              />
              <span className="font-mono text-sm font-bold tabular-nums text-white">
                500
              </span>
              <span className="text-[11px] text-zinc-500">/day</span>
            </div>
          </div>

          <div className="rounded-2xl bg-[#0b0b0e]/70 p-3.5 border border-white/[0.04]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-zinc-400">Frens Boost</span>
              <Users size={12} className="text-emerald-400" />
            </div>
            <div className="mt-1 flex items-center space-x-1">
              <span className="font-mono text-sm font-bold tabular-nums text-emerald-400">
                +{referralBonus.toLocaleString()}
              </span>
              <span className="text-[11px] text-zinc-500">/day</span>
            </div>
          </div>
        </div>
      </div>

      {/* Early Supporter Claim Card */}
      {!isEarlyClaimed && earlyCount < 100 && (
        <div className="mt-5 w-full rounded-3xl bg-gradient-to-br from-amber-500/15 via-orange-500/10 to-[#141419] p-5 border border-amber-500/30 shadow-xl">
          <div className="flex items-center justify-between mb-3.5">
            <div className="flex items-center space-x-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500 text-zinc-950 shadow-md shadow-amber-500/20">
                <Gift size={20} />
              </div>
              <div>
                <h3 className="font-display font-bold text-white text-sm">
                  Early Pioneer Grant
                </h3>
                <p className="text-xs text-amber-200/80">
                  {100 - earlyCount} of 100 allocations left
                </p>
              </div>
            </div>
            <Sparkles size={18} className="text-amber-400" />
          </div>
          <button
            onClick={handleClaimEarly}
            disabled={loadingClaim}
            className="w-full rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 py-3.5 text-sm font-bold text-zinc-950 hover:from-amber-400 hover:to-orange-400 active:scale-[0.98] transition-all disabled:opacity-50 shadow-lg shadow-orange-500/20"
          >
            {loadingClaim ? 'Claiming Grant...' : 'Claim 5,000 KITTY'}
          </button>
        </div>
      )}

      {isEarlyClaimed && earlyCount <= 100 && (
        <div className="mt-5 flex items-center space-x-2 text-xs font-medium text-emerald-400/90">
          <ShieldCheck size={15} />
          <span>Early Pioneer Grant Activated</span>
        </div>
      )}
    </div>
  );
}
