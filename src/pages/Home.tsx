import React, { useEffect, useState } from 'react';
import { useAuth } from '../components/AuthProvider';
import { motion } from 'framer-motion';
import { api } from '../lib/api';
import { Gift, ShieldCheck } from 'lucide-react';

const LOGO_URL = 'https://i.suar.me/PpEzN/l';

export default function Home() {
  const { user, refreshMining } = useAuth();
  const [displayBalance, setDisplayBalance] = useState(user?.balanceKitty || 0);
  const [earlyCount, setEarlyCount] = useState(0);
  const [isEarlyClaimed, setIsEarlyClaimed] = useState(true);
  const [loadingClaim, setLoadingClaim] = useState(false);

  // Animate balance
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

  return (
    <div className="flex min-h-full flex-col items-center p-6 pb-24">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, type: 'spring' }}
        className="mt-8 mb-6 relative select-none"
      >
        <img
          src={LOGO_URL}
          alt="Kitty Medallion"
          referrerPolicy="no-referrer"
          className="h-40 w-40 object-contain drop-shadow-[0_12px_30px_rgba(249,115,22,0.35)]"
        />
      </motion.div>

      <div className="mb-8 text-center">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-widest text-gray-400">
          Kitty Balance
        </h2>
        <div className="flex items-center justify-center space-x-2">
          <span className="text-4xl font-extrabold tabular-nums tracking-tight text-white">
            {displayBalance.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
          </span>
          <img src={LOGO_URL} className="h-8 w-8 rounded-full" alt="KITTY" referrerPolicy="no-referrer" />
        </div>
      </div>

      <div className="w-full max-w-sm rounded-2xl bg-[#1c1c1c] p-4 shadow-lg ring-1 ring-white/5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <PickaxeIcon className="text-orange-500" />
            <span className="text-sm font-medium text-gray-300">Mining Speed</span>
          </div>
          <span className="text-lg font-bold text-orange-400">
            {user?.miningSpeed || 500} <span className="text-xs text-gray-500">/day</span>
          </span>
        </div>

        <div className="flex flex-col space-y-3">
          <div className="flex justify-between text-xs text-gray-400">
            <span>Base Rate</span>
            <span>500 KITTY/day</span>
          </div>
          <div className="flex justify-between text-xs text-gray-400">
            <span>Referral Bonus</span>
            <span className="text-green-400">+{((user?.miningSpeed || 500) - 500).toLocaleString()} KITTY/day</span>
          </div>
        </div>
      </div>

      {!isEarlyClaimed && earlyCount < 100 && (
        <div className="mt-6 w-full max-w-sm rounded-2xl bg-gradient-to-r from-orange-500/20 to-pink-500/20 p-4 ring-1 ring-orange-500/50">
          <div className="flex items-center space-x-3 mb-3">
            <div className="rounded-full bg-orange-500 p-2 text-white">
              <Gift size={20} />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">Early Supporter Gift</h3>
              <p className="text-xs text-orange-200">{100 - earlyCount} spots remaining</p>
            </div>
          </div>
          <button
            onClick={handleClaimEarly}
            disabled={loadingClaim}
            className="w-full rounded-xl bg-orange-500 py-3 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-50"
          >
            {loadingClaim ? 'Claiming...' : 'Claim 5,000 KITTY'}
          </button>
        </div>
      )}
      
      {isEarlyClaimed && earlyCount <= 100 && (
        <div className="mt-6 flex items-center space-x-2 rounded-full bg-green-500/10 px-4 py-2 text-xs font-medium text-green-400">
          <ShieldCheck size={16} />
          <span>Early Supporter Status Active</span>
        </div>
      )}
    </div>
  );
}

const PickaxeIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M14.531 12.469 11.5 15.5m-3-3L14.5 15.5m-6-6-3-3a1.06 1.06 0 0 1 1.5-1.5l3 3m5 5 5 5a1.06 1.06 0 0 1-1.5 1.5l-5-5"/>
    <path d="M16 14.5 14.5 16l-7-7L6 7.5l1.5-1.5 7 7Z"/>
  </svg>
);
