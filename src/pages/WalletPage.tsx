import React, { useState } from 'react';
import { useAuth } from '../components/AuthProvider';
import { api } from '../lib/api';
import { ArrowRightLeft, ArrowUpRight, DollarSign } from 'lucide-react';

const LOGO_URL = 'https://i.suar.me/PpEzN/l';
const RATE = 10000; // 10k kitty = 1 usdt

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
      window.Telegram?.WebApp?.showAlert(`Successfully swapped ${amt * RATE} KITTY for ${amt} USDT!`);
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

  return (
    <div className="flex flex-col p-6 h-full">
      <h1 className="mb-6 text-2xl font-bold text-white">Wallet</h1>

      <div className="mb-6 flex space-x-4 rounded-xl bg-[#1c1c1c] p-4 ring-1 ring-white/5">
        <div className="flex-1">
          <span className="text-xs text-gray-400">Kitty Balance</span>
          <div className="mt-1 flex items-center space-x-1 text-lg font-bold text-white">
            <img src={LOGO_URL} className="h-5 w-5 rounded-full" alt="KITTY" referrerPolicy="no-referrer" />
            <span>{Math.floor(user?.balanceKitty || 0).toLocaleString()}</span>
          </div>
        </div>
        <div className="w-[1px] bg-white/10" />
        <div className="flex-1 pl-4">
          <span className="text-xs text-gray-400">USDT Balance</span>
          <div className="mt-1 flex items-center space-x-1 text-lg font-bold text-green-400">
            <DollarSign size={18} />
            <span>{(user?.balanceUsdt || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
      </div>

      <div className="mb-6 flex rounded-xl bg-[#1c1c1c] p-1">
        <button
          onClick={() => setActiveTab('swap')}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
            activeTab === 'swap' ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-white'
          }`}
        >
          Swap
        </button>
        <button
          onClick={() => setActiveTab('withdraw')}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
            activeTab === 'withdraw' ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-white'
          }`}
        >
          Withdraw
        </button>
      </div>

      {activeTab === 'swap' && (
        <div className="flex flex-col flex-1">
          <p className="mb-4 text-sm text-gray-400">Convert your Kitty Medallions to USDT instantly.</p>
          
          <div className="rounded-2xl bg-[#1c1c1c] p-4 ring-1 ring-white/5">
            <div className="mb-2 flex justify-between text-xs text-gray-400">
              <span>You Pay</span>
              <span>Rate: {RATE} KITTY = 1 USDT</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-[#0f0f0f] px-4 py-3">
              <input
                type="text"
                disabled
                value={(parseFloat(swapAmountUsdt || '0') * RATE).toLocaleString()}
                className="w-full bg-transparent text-xl font-bold text-white outline-none"
              />
              <div className="flex items-center space-x-1 text-orange-400 font-bold">
                <img src={LOGO_URL} className="h-5 w-5 rounded-full" alt="KITTY" referrerPolicy="no-referrer" />
                <span>KITTY</span>
              </div>
            </div>

            <div className="my-4 flex justify-center text-gray-500">
              <ArrowRightLeft size={20} className="rotate-90" />
            </div>

            <div className="mb-2 flex justify-between text-xs text-gray-400">
              <span>You Receive</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-[#0f0f0f] px-4 py-3">
              <input
                type="number"
                value={swapAmountUsdt}
                onChange={(e) => setSwapAmountUsdt(e.target.value)}
                placeholder="0.00"
                min="0"
                className="w-full bg-transparent text-xl font-bold text-white outline-none"
              />
              <div className="flex items-center space-x-1 text-green-400 font-bold">
                <DollarSign size={20} />
                <span>USDT</span>
              </div>
            </div>
          </div>

          <button
            onClick={handleSwap}
            disabled={swapping || !swapAmountUsdt || parseFloat(swapAmountUsdt) * RATE > (user?.balanceKitty || 0)}
            className="mt-6 w-full rounded-xl bg-orange-500 py-4 font-bold text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
          >
            {swapping ? 'Processing...' : 'Confirm Swap'}
          </button>
        </div>
      )}

      {activeTab === 'withdraw' && (
        <div className="flex flex-col flex-1">
          <p className="mb-4 text-sm text-gray-400">Withdraw USDT directly to your TON wallet.</p>
          
          <div className="space-y-4">
            <div className="flex flex-col space-y-1.5">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Amount (USDT)</label>
              <input
                type="number"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="0.00"
                className="rounded-xl bg-[#1c1c1c] px-4 py-3 text-white outline-none ring-1 ring-white/5 focus:ring-orange-500"
              />
            </div>
            <div className="flex flex-col space-y-1.5">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">TON Wallet Address</label>
              <input
                type="text"
                value={withdrawAddress}
                onChange={(e) => setWithdrawAddress(e.target.value)}
                placeholder="UQ..."
                className="rounded-xl bg-[#1c1c1c] px-4 py-3 text-white outline-none ring-1 ring-white/5 focus:ring-orange-500 font-mono text-sm"
              />
            </div>
          </div>

          <button
            onClick={handleWithdraw}
            disabled={withdrawing || !withdrawAmount || !withdrawAddress || parseFloat(withdrawAmount) > (user?.balanceUsdt || 0)}
            className="mt-6 flex w-full items-center justify-center space-x-2 rounded-xl bg-white py-4 font-bold text-black transition-colors hover:bg-gray-200 disabled:opacity-50"
          >
            <span>Withdraw</span>
            <ArrowUpRight size={20} />
          </button>
        </div>
      )}
    </div>
  );
}
