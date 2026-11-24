import React, { useState } from 'react';
import { useAuth } from '../components/AuthProvider';
import { api } from '../lib/api';
import { ArrowDownUp, ArrowUpRight } from 'lucide-react';

const LOGO_URL = 'https://i.ibb.co/3ykKfM0F/file-00000000e9e88246928f3f50b525d0a7.png';
const RATE = 10000; // 10k kitty = 1 usdt
const USDT_LOGO_URL = 'https://i.ibb.co/N2WMd6QC/Tether-USDT.png';

export default function WalletPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'swap' | 'withdraw'>('swap');

  const [swapAmountUsdt, setSwapAmountUsdt] = useState('1');
  const [swapping, setSwapping] = useState(false);

  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);

  const handleSwap = async () => {
    const amt = parseFloat(swapAmountUsdt);
    if (isNaN(amt) || amt <= 0) return;

    setSwapping(true);
    try {
      await api.swap(amt);
      window.Telegram?.WebApp?.showAlert(
        `Successfully swapped ${(amt * RATE).toLocaleString()} KITTY for ${amt} USDT!`
      );
    } catch (e: any) {
      window.Telegram?.WebApp?.showAlert(e.message || 'Swap failed');
    }
    setSwapping(false);
  };

  const handleWithdraw = async () => {
    const amt = parseFloat(withdrawAmount);
    if (isNaN(amt) || amt <= 0 || !withdrawAddress) return;

    setWithdrawing(true);
    try {
      await api.withdraw(amt, withdrawAddress);
      window.Telegram?.WebApp?.showAlert('Withdrawal request submitted!');
      setWithdrawAmount('');
      setWithdrawAddress('');
    } catch (e: any) {
      window.Telegram?.WebApp?.showAlert(e.message || 'Withdrawal failed');
    }
    setWithdrawing(false);
  };

  const balanceKitty = user?.balanceKitty || 0;
  const balanceUsdt = user?.balanceUsdt || 0;
  const maxSwappableUsdt = Math.floor((balanceKitty / RATE) * 100) / 100;

  return (
    <div className="flex min-h-full flex-col px-4 sm:px-5 pt-4 sm:pt-6 pb-8">
      <div className="mb-4 sm:mb-5">
        <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-white">
          Wallet
        </h1>
        <p className="mt-1 text-xs text-zinc-400">
          Manage your balances, convert KITTY to USDT, or withdraw to TON.
        </p>
      </div>

      {/* Slender Stacked Asset Cards with frameless inline logos before numbers */}
      <div className="mb-5 flex flex-col space-y-2.5">
        {/* Kitty Medallion Slender Asset Row */}
        <div className="flex items-center justify-between gap-2 rounded-2xl bg-[#141419] py-3 px-4 border border-white/[0.06] shadow-md">
          <div className="flex flex-col min-w-0">
            <span className="font-display font-bold text-white text-sm leading-tight truncate">
              Kitty Medallion
            </span>
            <span className="text-[11px] font-medium text-zinc-500 mt-0.5">
              KITTY
            </span>
          </div>
          <div className="flex flex-col items-end shrink-0">
            <div className="flex items-center space-x-1.5">
              <img
                src={LOGO_URL}
                className="h-5 w-5 shrink-0 rounded-full object-contain"
                alt="KITTY"
                referrerPolicy="no-referrer"
              />
              <span className="font-mono font-bold text-white text-base tabular-nums leading-none">
                {Math.floor(balanceKitty).toLocaleString()}
              </span>
            </div>
            <span className="text-[11px] text-zinc-400 mt-1 font-mono tabular-nums">
              ≈ {(balanceKitty / RATE).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              USDT
            </span>
          </div>
        </div>

        {/* Tether USDT Slender Asset Row */}
        <div className="flex items-center justify-between gap-2 rounded-2xl bg-[#141419] py-3 px-4 border border-white/[0.06] shadow-md">
          <div className="flex flex-col min-w-0">
            <span className="font-display font-bold text-white text-sm leading-tight truncate">
              Tether USD
            </span>
            <span className="text-[11px] font-medium text-zinc-500 mt-0.5">
              USDT
            </span>
          </div>
          <div className="flex flex-col items-end shrink-0">
            <div className="flex items-center space-x-1.5">
              <img
                src={USDT_LOGO_URL}
                className="h-5 w-5 shrink-0 rounded-full object-contain"
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
            <span className="text-[11px] text-zinc-500 mt-1 font-medium">
              $1.00 Pegged
            </span>
          </div>
        </div>
      </div>

      {/* Segmented Action Switcher */}
      <div className="mb-5 flex rounded-2xl bg-[#141419] p-1 border border-white/[0.06]">
        <button
          onClick={() => setActiveTab('swap')}
          className={`flex-1 rounded-xl py-2.5 text-xs font-bold transition-all ${
            activeTab === 'swap'
              ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-zinc-950 shadow-sm'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          Swap to USDT
        </button>
        <button
          onClick={() => setActiveTab('withdraw')}
          className={`flex-1 rounded-xl py-2.5 text-xs font-bold transition-all ${
            activeTab === 'withdraw'
              ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-zinc-950 shadow-sm'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          Withdraw
        </button>
      </div>

      {activeTab === 'swap' && (
        <div className="flex flex-col flex-1">
          <div className="rounded-3xl bg-[#141419] p-4 border border-white/[0.06] shadow-xl">
            {/* You Pay Box */}
            <div className="rounded-2xl bg-[#0b0b0e] p-3.5 border border-white/[0.04]">
              <div className="mb-2 flex items-center justify-between text-xs text-zinc-400">
                <span>You Pay</span>
                <span className="font-mono text-[11px] text-zinc-500">
                  10,000 KITTY = 1 USDT
                </span>
              </div>
              <div className="flex items-center justify-between">
                <input
                  type="text"
                  disabled
                  value={(parseFloat(swapAmountUsdt || '0') * RATE).toLocaleString()}
                  className="w-full bg-transparent font-mono text-xl font-bold tabular-nums text-white outline-none"
                />
                <div className="flex items-center space-x-1.5 text-amber-400 font-bold text-sm shrink-0">
                  <img
                    src={LOGO_URL}
                    className="h-5 w-5 rounded-full object-contain"
                    alt="KITTY"
                    referrerPolicy="no-referrer"
                  />
                  <span>KITTY</span>
                </div>
              </div>
            </div>

            {/* Divider Icon */}
            <div className="relative my-2 flex justify-center">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#1c1c24] border border-white/[0.08] text-zinc-400">
                <ArrowDownUp size={15} />
              </div>
            </div>

            {/* You Receive Box */}
            <div className="rounded-2xl bg-[#0b0b0e] p-3.5 border border-white/[0.04]">
              <div className="mb-2 flex items-center justify-between text-xs text-zinc-400">
                <span>You Receive</span>
                {maxSwappableUsdt > 0 && (
                  <button
                    type="button"
                    onClick={() => setSwapAmountUsdt(String(maxSwappableUsdt))}
                    className="text-[11px] font-semibold text-amber-400 hover:text-amber-300"
                  >
                    Max: {maxSwappableUsdt} USDT
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between">
                <input
                  type="number"
                  value={swapAmountUsdt}
                  onChange={(e) => setSwapAmountUsdt(e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="0.1"
                  className="w-full bg-transparent font-mono text-xl font-bold tabular-nums text-white outline-none"
                />
                <div className="flex items-center space-x-1.5 text-emerald-400 font-bold text-sm shrink-0">
                  <img
                    src={USDT_LOGO_URL}
                    className="h-5 w-5 rounded-full object-contain"
                    alt="USDT"
                    referrerPolicy="no-referrer"
                  />
                  <span>USDT</span>
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={handleSwap}
            disabled={
              swapping ||
              !swapAmountUsdt ||
              parseFloat(swapAmountUsdt) <= 0 ||
              parseFloat(swapAmountUsdt) * RATE > balanceKitty
            }
            className="mt-5 w-full rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 py-4 text-sm font-bold text-zinc-950 transition-all hover:from-amber-400 hover:to-orange-400 active:scale-[0.98] disabled:opacity-40 shadow-lg shadow-orange-500/20"
          >
            {swapping ? 'Executing Swap...' : 'Confirm Instant Swap'}
          </button>
        </div>
      )}

      {activeTab === 'withdraw' && (
        <div className="flex flex-col flex-1">
          <div className="rounded-3xl bg-[#141419] p-4 border border-white/[0.06] space-y-4 shadow-xl">
            <div className="flex flex-col space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-zinc-400">
                  Amount (USDT)
                </label>
                {balanceUsdt > 0 && (
                  <button
                    type="button"
                    onClick={() => setWithdrawAmount(String(balanceUsdt))}
                    className="text-[11px] font-semibold text-amber-400 hover:text-amber-300"
                  >
                    Available: {balanceUsdt.toFixed(2)}
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-[#0b0b0e] px-3.5 py-3 border border-white/[0.05] focus-within:border-amber-500/50">
                <input
                  type="number"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-transparent font-mono text-base font-bold text-white outline-none"
                />
                <div className="flex items-center space-x-1.5 text-emerald-400 font-bold text-xs shrink-0">
                  <img
                    src={USDT_LOGO_URL}
                    className="h-4 w-4 rounded-full object-contain"
                    alt="USDT"
                    referrerPolicy="no-referrer"
                  />
                  <span>USDT</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col space-y-1.5">
              <label className="text-xs font-medium text-zinc-400">
                TON Network Wallet Address
              </label>
              <input
                type="text"
                value={withdrawAddress}
                onChange={(e) => setWithdrawAddress(e.target.value)}
                placeholder="UQ..."
                className="rounded-2xl bg-[#0b0b0e] px-3.5 py-3 text-white outline-none border border-white/[0.05] focus:border-amber-500/50 font-mono text-xs"
              />
            </div>
          </div>

          <button
            onClick={handleWithdraw}
            disabled={
              withdrawing ||
              !withdrawAmount ||
              !withdrawAddress ||
              parseFloat(withdrawAmount) <= 0 ||
              parseFloat(withdrawAmount) > balanceUsdt
            }
            className="mt-5 flex w-full items-center justify-center space-x-2 rounded-2xl bg-white py-4 text-sm font-bold text-zinc-950 transition-all hover:bg-zinc-200 active:scale-[0.98] disabled:opacity-40"
          >
            <span>Request Withdrawal</span>
            <ArrowUpRight size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
