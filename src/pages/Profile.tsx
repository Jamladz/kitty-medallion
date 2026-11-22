import React, { useEffect, useState } from 'react';
import { useAuth } from '../components/AuthProvider';
import { api } from '../lib/api';
import {
  Copy,
  Check,
  Calendar,
  Zap,
  Users,
  Hash,
  Award,
  Clock,
  Share2,
  ArrowUpRight,
  ChevronRight,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const LOGO_URL = 'https://i.suar.me/PpEzN/l';
const USDT_LOGO_URL = 'https://i.ibb.co/N2WMd6QC/Tether-USDT.png';
const RATE = 10000;
const CYCLE_DURATION_MS = 24 * 60 * 60 * 1000;

interface MinerTier {
  name: string;
  minBalance: number;
  nextBalance: number | null;
  accentText: string;
}

const getMinerTier = (balance: number): MinerTier => {
  if (balance >= 100000) {
    return {
      name: 'Diamond Sovereign',
      minBalance: 100000,
      nextBalance: null,
      accentText: 'text-amber-300',
    };
  }
  if (balance >= 25000) {
    return {
      name: 'Gold Vanguard',
      minBalance: 25000,
      nextBalance: 100000,
      accentText: 'text-amber-400',
    };
  }
  if (balance >= 5000) {
    return {
      name: 'Silver Operative',
      minBalance: 5000,
      nextBalance: 25000,
      accentText: 'text-zinc-200',
    };
  }
  return {
    name: 'Bronze Pioneer',
    minBalance: 0,
    nextBalance: 5000,
    accentText: 'text-amber-500',
  };
};

export default function Profile() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [copiedId, setCopiedId] = useState(false);
  const [copiedRef, setCopiedRef] = useState(false);
  const [completedTasksCount, setCompletedTasksCount] = useState<number | null>(null);
  const [totalTasksCount, setTotalTasksCount] = useState<number | null>(null);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(true);

  const tgUser =
    typeof window !== 'undefined'
      ? window.Telegram?.WebApp?.initDataUnsafe?.user
      : undefined;

  const initials = React.useMemo(() => {
    const fName = user?.firstName || tgUser?.first_name || '';
    const lName = user?.lastName || tgUser?.last_name || '';

    if (fName && lName) {
      return (fName[0] + lName[0]).toUpperCase().slice(0, 2);
    } else if (fName) {
      return fName.slice(0, 2).toUpperCase();
    } else if (user?.username) {
      return user.username.slice(0, 2).toUpperCase();
    }
    return 'ME';
  }, [user, tgUser]);

  useEffect(() => {
    let mounted = true;
    const loadAccountStats = async () => {
      try {
        const [tasksRes, withdrawalsRes] = await Promise.all([
          api.getTasks().catch(() => ({ tasks: [] })),
          api.getWithdrawals().catch(() => ({ withdrawals: [] })),
        ]);
        if (!mounted) return;
        const allTasks = tasksRes?.tasks || [];
        setTotalTasksCount(allTasks.length);
        setCompletedTasksCount(allTasks.filter((t: any) => t.isCompleted).length);
        setWithdrawals((withdrawalsRes?.withdrawals || []).slice(0, 3));
      } catch (e) {
        console.error(e);
      } finally {
        if (mounted) setLoadingActivity(false);
      }
    };
    loadAccountStats();
    return () => {
      mounted = false;
    };
  }, []);

  const balanceKitty = user?.balanceKitty || 0;
  const balanceUsdt = user?.balanceUsdt || 0;
  const miningSpeed = user?.miningSpeed || 500;
  const referralCount = user?.referralCount || 0;
  const estimatedNetWorthUsdt = balanceUsdt + balanceKitty / RATE;

  const tier = getMinerTier(balanceKitty);
  const tierProgress = tier.nextBalance
    ? Math.min(
        100,
        Math.max(
          4,
          ((balanceKitty - tier.minBalance) / (tier.nextBalance - tier.minBalance)) * 100
        )
      )
    : 100;

  const now = Date.now();
  const lastClaim = user?.lastMiningClaim || now;
  const cycleProgress = Math.min(
    100,
    Math.max(0, ((now - lastClaim) / CYCLE_DURATION_MS) * 100)
  );
  const isCycleReady = now - lastClaim >= CYCLE_DURATION_MS;

  const botUsername =
    (typeof import.meta !== 'undefined' &&
      (import.meta as any).env?.VITE_TELEGRAM_BOT_USERNAME) ||
    'KittyMedallion_bot';
  const referralLink = `https://t.me/${botUsername}?startapp=ref_${user?.id}`;

  const handleCopyId = () => {
    if (!user?.id) return;
    navigator.clipboard.writeText(String(user.id));
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleCopyReferral = () => {
    navigator.clipboard.writeText(referralLink);
    setCopiedRef(true);
    setTimeout(() => setCopiedRef(false), 2000);
  };

  const formatJoinDate = (ts?: number) => {
    if (!ts) return 'Active Member';
    try {
      return new Date(ts).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return 'Active Member';
    }
  };

  return (
    <div className="flex flex-col px-5 pt-6 pb-10">
      {/* Page Title & Quick ID Copy */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">
            Profile
          </h1>
          <p className="mt-0.5 text-xs text-zinc-400">
            Personal Passport & Portfolio Overview
          </p>
        </div>

        <button
          onClick={handleCopyId}
          className="flex items-center space-x-1.5 rounded-2xl bg-[#141419] px-3 py-2 border border-white/[0.06] text-xs font-mono text-zinc-300 hover:text-white hover:border-white/15 active:scale-95 transition-all"
        >
          <Hash size={13} className="text-amber-400" />
          <span className="tabular-nums">{user?.id}</span>
          {copiedId ? (
            <Check size={13} className="text-emerald-400 ml-1" />
          ) : (
            <Copy size={13} className="text-zinc-500 ml-1" />
          )}
        </button>
      </div>

      {/* Hero Identity & Tier Progress Card */}
      <div className="relative mb-4 overflow-hidden rounded-3xl bg-[#141419] p-5 border border-white/[0.06] shadow-xl">
        {/* Ambient radial highlight */}
        <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-amber-500/10 blur-2xl" />

        <div className="relative z-10 flex items-center space-x-4">
          {/* Circular Avatar with Telegram Photo or 2-Letter Initials */}
          <div className="relative flex-shrink-0">
            {tgUser?.photo_url ? (
              <img
                src={tgUser.photo_url}
                alt="Profile"
                referrerPolicy="no-referrer"
                className="h-18 w-18 rounded-full object-cover border-2 border-amber-500/50 shadow-lg"
              />
            ) : (
              <div className="flex h-18 w-18 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-zinc-950 font-display text-xl font-extrabold tracking-wider shadow-lg shadow-orange-500/20">
                {initials}
              </div>
            )}
          </div>

          <div className="flex flex-1 flex-col min-w-0">
            <h2 className="font-display text-lg font-bold text-white truncate">
              {user?.firstName} {user?.lastName}
            </h2>

            <div className="mt-0.5 flex items-center space-x-2 text-xs text-zinc-400 truncate">
              {user?.username ? (
                <span className="font-medium text-amber-400 truncate">
                  @{user.username}
                </span>
              ) : (
                <span>Telegram Verified</span>
              )}
              <span className="text-zinc-600" aria-hidden="true">
                ·
              </span>
              <span className="truncate">Joined {formatJoinDate(user?.createdAt)}</span>
            </div>

            <div className="mt-2 flex items-center space-x-1.5 text-xs">
              <Award size={14} className="text-amber-400 shrink-0" />
              <span className={`font-semibold ${tier.accentText}`}>
                {tier.name}
              </span>
            </div>
          </div>
        </div>

        {/* Tier Rank Progress Bar */}
        <div className="relative z-10 mt-5 pt-4 border-t border-white/[0.06]">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-zinc-400 font-medium">Miner Rank Progression</span>
            {tier.nextBalance ? (
              <span className="font-mono text-[11px] font-semibold tabular-nums text-zinc-300">
                {Math.floor(balanceKitty).toLocaleString()} /{' '}
                {tier.nextBalance.toLocaleString()} KITTY
              </span>
            ) : (
              <span className="font-mono text-[11px] font-semibold text-amber-400">
                Max Rank Reached
              </span>
            )}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[#0b0b0e] border border-white/[0.04]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-300"
              style={{ width: `${tierProgress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Slender Asset Summary (Consistent with Wallet Page Style) */}
      <div className="mb-4 flex flex-col space-y-2">
        <div className="flex items-center justify-between px-1 mb-0.5">
          <span className="text-xs font-semibold text-zinc-400">
            Portfolio Holdings
          </span>
          <span className="font-mono text-xs font-semibold tabular-nums text-emerald-400">
            Net Worth ≈ $
            {estimatedNetWorthUsdt.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>

        {/* Slender Kitty Balance Row */}
        <div
          onClick={() => navigate('/wallet')}
          className="flex items-center justify-between rounded-2xl bg-[#141419] py-2.5 px-4 border border-white/[0.06] hover:border-white/15 cursor-pointer transition-all"
        >
          <div className="flex flex-col">
            <span className="font-display font-bold text-white text-sm leading-tight">
              Kitty Medallion
            </span>
            <span className="text-[10px] font-medium text-zinc-500 mt-0.5">
              KITTY
            </span>
          </div>
          <div className="flex items-center space-x-1.5">
            <img
              src={LOGO_URL}
              className="h-5 w-5 rounded-full object-contain"
              alt="KITTY"
              referrerPolicy="no-referrer"
            />
            <span className="font-mono font-bold text-white text-base tabular-nums leading-none">
              {Math.floor(balanceKitty).toLocaleString()}
            </span>
          </div>
        </div>

        {/* Slender Tether USDT Row */}
        <div
          onClick={() => navigate('/wallet')}
          className="flex items-center justify-between rounded-2xl bg-[#141419] py-2.5 px-4 border border-white/[0.06] hover:border-white/15 cursor-pointer transition-all"
        >
          <div className="flex flex-col">
            <span className="font-display font-bold text-white text-sm leading-tight">
              Tether USD
            </span>
            <span className="text-[10px] font-medium text-zinc-500 mt-0.5">
              USDT
            </span>
          </div>
          <div className="flex items-center space-x-1.5">
            <img
              src={USDT_LOGO_URL}
              className="h-5 w-5 rounded-full object-contain"
              alt="USDT"
              referrerPolicy="no-referrer"
            />
            <span className="font-mono font-bold text-emerald-400 text-base tabular-nums leading-none">
              {balanceUsdt.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
        </div>
      </div>

      {/* 2x2 Performance Bento Grid */}
      <div className="mb-4 grid grid-cols-2 gap-2.5">
        <div className="rounded-2xl bg-[#141419] p-3.5 border border-white/[0.06]">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>24h Yield Rate</span>
            <Zap size={14} className="text-amber-400" />
          </div>
          <div className="mt-2 flex items-center space-x-1.5">
            <img
              src={LOGO_URL}
              className="h-4 w-4 rounded-full object-contain"
              alt="KITTY"
              referrerPolicy="no-referrer"
            />
            <span className="font-mono text-base font-bold tabular-nums text-white">
              +{miningSpeed.toLocaleString()}
            </span>
          </div>
          <span className="mt-1 block text-[11px] text-zinc-500">
            KITTY per 24h cycle
          </span>
        </div>

        <div
          onClick={() => navigate('/')}
          className="rounded-2xl bg-[#141419] p-3.5 border border-white/[0.06] hover:border-white/15 cursor-pointer transition-all"
        >
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Current 24h Cycle</span>
            <Clock size={14} className={isCycleReady ? 'text-emerald-400' : 'text-amber-400'} />
          </div>
          <div className="mt-2 flex items-center space-x-1.5">
            <span
              className={`font-mono text-base font-bold tabular-nums ${
                isCycleReady ? 'text-emerald-400' : 'text-white'
              }`}
            >
              {isCycleReady ? 'Ready to Claim' : `${cycleProgress.toFixed(1)}%`}
            </span>
          </div>
          <span className="mt-1 block text-[11px] text-zinc-500">
            {isCycleReady ? 'Tap to collect reward' : 'Session in progress'}
          </span>
        </div>

        <div
          onClick={() => navigate('/referral')}
          className="rounded-2xl bg-[#141419] p-3.5 border border-white/[0.06] hover:border-white/15 cursor-pointer transition-all"
        >
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Invited Network</span>
            <Users size={14} className="text-emerald-400" />
          </div>
          <div className="mt-2">
            <span className="font-mono text-base font-bold tabular-nums text-white">
              {referralCount.toLocaleString()} Frens
            </span>
          </div>
          <span className="mt-1 block text-[11px] text-emerald-400/90 font-mono tabular-nums">
            +{(referralCount * 50).toLocaleString()} Hash/24h boost
          </span>
        </div>

        <div
          onClick={() => navigate('/tasks')}
          className="rounded-2xl bg-[#141419] p-3.5 border border-white/[0.06] hover:border-white/15 cursor-pointer transition-all"
        >
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Missions Done</span>
            <Calendar size={14} className="text-amber-400" />
          </div>
          <div className="mt-2">
            <span className="font-mono text-base font-bold tabular-nums text-white">
              {completedTasksCount !== null && totalTasksCount !== null
                ? `${completedTasksCount} / ${totalTasksCount}`
                : '—'}
            </span>
          </div>
          <span className="mt-1 block text-[11px] text-zinc-500">
            Completed quests
          </span>
        </div>
      </div>

      {/* Quick Invite Share Box */}
      <div className="mb-4 rounded-3xl bg-[#141419] p-4 border border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center space-x-3 min-w-0 pr-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Share2 size={18} />
          </div>
          <div className="min-w-0">
            <span className="block text-xs font-bold text-white">
              Personal Invite Link
            </span>
            <span className="block text-[11px] font-mono text-zinc-400 truncate">
              t.me/{botUsername}?startapp=ref_{user?.id}
            </span>
          </div>
        </div>

        <button
          onClick={handleCopyReferral}
          className="shrink-0 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] active:scale-95 px-3 py-2 text-xs font-semibold text-white transition-all flex items-center space-x-1.5"
        >
          {copiedRef ? (
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

      {/* Recent Withdrawal Requests Ledger */}
      <div className="rounded-3xl bg-[#141419] p-4 border border-white/[0.06]">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-bold text-white">
            Recent TON Withdrawals
          </span>
          <button
            onClick={() => navigate('/wallet')}
            className="flex items-center space-x-0.5 text-[11px] font-semibold text-amber-400 hover:text-amber-300"
          >
            <span>Open Wallet</span>
            <ChevronRight size={13} />
          </button>
        </div>

        {loadingActivity ? (
          <div className="py-4 text-center text-xs text-zinc-500">
            Loading withdrawal history...
          </div>
        ) : withdrawals.length === 0 ? (
          <div className="flex items-center justify-between rounded-2xl bg-[#0b0b0e]/70 px-3.5 py-3 border border-white/[0.04]">
            <span className="text-xs text-zinc-400">
              No withdrawal requests submitted yet.
            </span>
            <ArrowUpRight size={15} className="text-zinc-600" />
          </div>
        ) : (
          <div className="divide-y divide-white/[0.05]">
            {withdrawals.map((w) => (
              <div
                key={w.id}
                className="flex items-center justify-between py-2.5 first:pt-1 last:pb-1"
              >
                <div className="min-w-0 pr-3">
                  <div className="flex items-center space-x-1.5">
                    <img
                      src={USDT_LOGO_URL}
                      className="h-4 w-4 rounded-full object-contain"
                      alt="USDT"
                      referrerPolicy="no-referrer"
                    />
                    <span className="font-mono text-xs font-bold tabular-nums text-white">
                      {Number(w.amount || 0).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      USDT
                    </span>
                  </div>
                  <span className="mt-0.5 block font-mono text-[10px] text-zinc-500 truncate">
                    To: {w.address}
                  </span>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-xs font-semibold text-amber-400">
                    {w.status || 'Pending'}
                  </span>
                  {w.timestamp && (
                    <span className="block text-[10px] text-zinc-500 font-mono">
                      {new Date(w.timestamp).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
