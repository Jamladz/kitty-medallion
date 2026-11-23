import React, { useEffect, useState } from 'react';
import { useAuth } from '../components/AuthProvider';
import { motion } from 'framer-motion';
import { api } from '../lib/api';
import { Gift, ShieldCheck, Zap, Users, Sparkles, Clock, CheckCircle2 } from 'lucide-react';

const LOGO_URL = 'https://i.suar.me/PpEzN/l';
const USDT_LOGO_URL = 'https://i.ibb.co/N2WMd6QC/Tether-USDT.png';
const RATE = 10000;
const CYCLE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 Hours

const formatDuration = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((v) => String(v).padStart(2, '0'))
    .join(':');
};

export default function Home() {
  const { user } = useAuth();
  const [now, setNow] = useState(Date.now());
  const [claimingCycle, setClaimingCycle] = useState(false);

  const [earlyCount, setEarlyCount] = useState(0);
  const [isEarlyClaimed, setIsEarlyClaimed] = useState(true);
  const [loadingClaim, setLoadingClaim] = useState(false);

  // Update 24-hour cycle progress smoothly
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => clearInterval(interval);
  }, []);

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

  const miningSpeed = user?.miningSpeed || 500;
  const referralBonus = Math.max(0, miningSpeed - 500);
  const walletBalance = user?.balanceKitty || 0;
  const lastClaim = user?.lastMiningClaim || now;

  const elapsedMs = Math.max(0, now - lastClaim);
  const progressRatio = Math.min(1, elapsedMs / CYCLE_DURATION_MS);
  const progressPercent = progressRatio * 100;
  const remainingMs = Math.max(0, CYCLE_DURATION_MS - elapsedMs);
  const isCycleReady = elapsedMs >= CYCLE_DURATION_MS;
  const sessionMined = progressRatio * miningSpeed;
  const usdtEquivalent = walletBalance / RATE;

  const handleClaimCycle = async () => {
    if (!isCycleReady || claimingCycle) return;
    setClaimingCycle(true);
    try {
      await api.claimMining();
      if (window.Telegram?.WebApp?.showAlert) {
        window.Telegram.WebApp.showAlert(
          `Successfully claimed +${miningSpeed.toLocaleString()} KITTY! A new 24-hour mining session has started.`
        );
      }
    } catch (error: any) {
      if (window.Telegram?.WebApp?.showAlert) {
        window.Telegram.WebApp.showAlert(error.message || 'Mining cycle not finished yet');
      }
    }
    setClaimingCycle(false);
  };

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

  // SVG Ring Math for 24h cycle halo
  const radius = 88;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - progressRatio * circumference;

  return (
    <div className="flex min-h-full flex-col items-center px-4 sm:px-5 pt-4 sm:pt-6 pb-6">
      {/* Top Compact Status Strip */}
      <div className="w-full flex items-center justify-between gap-2 mb-3 sm:mb-4">
        <div className="flex items-center space-x-2 min-w-0">
          <img
            src={LOGO_URL}
            alt="Kitty Medallion"
            referrerPolicy="no-referrer"
            className="h-6 w-6 shrink-0 rounded-full object-contain"
          />
          <span className="font-display text-sm font-bold tracking-tight text-white truncate">
            Kitty Medallion
          </span>
        </div>

        <div className="flex items-center space-x-1.5 text-xs font-medium text-zinc-400 shrink-0">
          <img
            src={USDT_LOGO_URL}
            alt="USDT"
            referrerPolicy="no-referrer"
            className="h-4 w-4 shrink-0 rounded-full object-contain"
          />
          <span className="font-mono tabular-nums text-emerald-400 font-semibold">
            ≈ {usdtEquivalent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="text-zinc-500">USDT</span>
        </div>
      </div>

      {/* Total Claimed Balance Readout */}
      <div className="mb-2 sm:mb-3 text-center w-full">
        <p className="mb-1 text-[11px] sm:text-xs font-medium text-zinc-400">
          Total Wallet Balance
        </p>
        <div className="flex items-center justify-center space-x-2">
          <img
            src={LOGO_URL}
            className="h-6 w-6 sm:h-7 sm:w-7 shrink-0 rounded-full object-contain"
            alt="KITTY"
            referrerPolicy="no-referrer"
          />
          <span className="font-display text-3xl sm:text-4xl font-extrabold tabular-nums tracking-tight text-white truncate">
            {Math.floor(walletBalance).toLocaleString()}
          </span>
        </div>
      </div>

      {/* Central Medallion with 24-Hour SVG Circular Progress Halo */}
      <div className="relative my-1.5 sm:my-2 flex items-center justify-center">
        <div
          className={`pointer-events-none absolute h-44 w-44 sm:h-48 sm:w-48 rounded-full blur-2xl transition-colors duration-500 ${
            isCycleReady
              ? 'bg-gradient-to-tr from-emerald-500/25 via-amber-500/20 to-transparent'
              : 'bg-gradient-to-tr from-amber-500/20 via-orange-500/15 to-transparent'
          }`}
        />

        {/* SVG Circular Progress Gauge */}
        <svg className="h-44 w-44 sm:h-52 sm:w-52 -rotate-90 transform" viewBox="0 0 200 200">
          <circle
            cx="100"
            cy="100"
            r={radius}
            fill="transparent"
            stroke="rgba(255, 255, 255, 0.06)"
            strokeWidth="6"
          />
          <circle
            cx="100"
            cy="100"
            r={radius}
            fill="transparent"
            stroke={isCycleReady ? '#10b981' : '#f59e0b'}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-300 ease-out"
          />
        </svg>

        <motion.div
          initial={{ scale: 0.88, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.45, type: 'spring', stiffness: 200 }}
          whileTap={{ scale: 0.95 }}
          onClick={isCycleReady ? handleClaimCycle : undefined}
          className="absolute z-10 cursor-pointer select-none p-2"
        >
          <img
            src={LOGO_URL}
            alt="Kitty Medallion"
            referrerPolicy="no-referrer"
            className="h-28 w-28 sm:h-32 sm:w-32 object-contain drop-shadow-[0_14px_32px_rgba(245,158,11,0.38)]"
          />
        </motion.div>
      </div>

      {/* 24-Hour Mining Session Card & Claim / Countdown Controller */}
      <div className="w-full rounded-3xl bg-[#141419] p-4 sm:p-5 border border-white/[0.06] shadow-xl mt-1.5 sm:mt-2">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="min-w-0">
            <span className="text-[11px] sm:text-xs font-medium text-zinc-400">
              24h Session Mined
            </span>
            <div className="mt-1 flex items-center space-x-1.5">
              <img
                src={LOGO_URL}
                className="h-4 w-4 sm:h-5 sm:w-5 shrink-0 rounded-full object-contain"
                alt="KITTY"
                referrerPolicy="no-referrer"
              />
              <span className="font-mono text-lg sm:text-xl font-bold tabular-nums text-white truncate">
                {sessionMined.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
              <span className="font-mono text-[11px] sm:text-xs text-zinc-500 tabular-nums shrink-0">
                / {miningSpeed.toLocaleString()}
              </span>
            </div>
          </div>

          <div className="text-right shrink-0">
            <span className="text-[11px] sm:text-xs font-medium text-zinc-400">
              {isCycleReady ? 'Cycle Status' : 'Next Claim In'}
            </span>
            <div className="mt-1 flex items-center justify-end space-x-1.5">
              {isCycleReady ? (
                <span className="flex items-center space-x-1 font-mono text-xs sm:text-sm font-bold text-emerald-400">
                  <CheckCircle2 size={14} />
                  <span>Ready</span>
                </span>
              ) : (
                <span className="flex items-center space-x-1 font-mono text-xs sm:text-sm font-bold tabular-nums text-amber-400">
                  <Clock size={13} className="text-amber-500" />
                  <span>{formatDuration(remainingMs)}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Linear 24-Hour Progress Bar */}
        <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-[#0b0b0e] border border-white/[0.04]">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              isCycleReady
                ? 'bg-gradient-to-r from-emerald-400 to-emerald-500'
                : 'bg-gradient-to-r from-amber-500 to-orange-500'
            }`}
            style={{ width: `${Math.max(2, progressPercent)}%` }}
          />
        </div>

        {/* Primary 24h Cycle Action Button */}
        <button
          onClick={handleClaimCycle}
          disabled={!isCycleReady || claimingCycle}
          className={`w-full rounded-2xl py-3.5 px-4 text-sm font-bold transition-all flex items-center justify-center space-x-2 ${
            isCycleReady
              ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-zinc-950 hover:from-emerald-400 hover:to-teal-400 active:scale-[0.98] shadow-lg shadow-emerald-500/20'
              : 'bg-[#0b0b0e] text-zinc-400 border border-white/[0.06] cursor-not-allowed'
          }`}
        >
          {claimingCycle ? (
            <span>Claiming Reward...</span>
          ) : isCycleReady ? (
            <>
              <img
                src={LOGO_URL}
                className="h-4 w-4 rounded-full object-contain"
                alt="KITTY"
                referrerPolicy="no-referrer"
              />
              <span>Claim {miningSpeed.toLocaleString()} KITTY & Start Next 24h</span>
            </>
          ) : (
            <>
              <Clock size={16} className="text-amber-500" />
              <span className="font-mono tabular-nums">
                Mining 24h Cycle · {progressPercent.toFixed(1)}%
              </span>
            </>
          )}
        </button>

        {/* Daily Speed Breakdown */}
        <div className="mt-4 pt-4 border-t border-white/[0.06] grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-[#0b0b0e]/70 p-3 border border-white/[0.04]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-zinc-400">Base Rate</span>
              <Zap size={12} className="text-amber-400" />
            </div>
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
              <span className="text-[11px] text-zinc-500">/ 24h</span>
            </div>
          </div>

          <div className="rounded-2xl bg-[#0b0b0e]/70 p-3 border border-white/[0.04]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-zinc-400">Frens Boost</span>
              <Users size={12} className="text-emerald-400" />
            </div>
            <div className="mt-1 flex items-center space-x-1">
              <span className="font-mono text-sm font-bold tabular-nums text-emerald-400">
                +{referralBonus.toLocaleString()}
              </span>
              <span className="text-[11px] text-zinc-500">/ 24h</span>
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
