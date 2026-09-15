import React from 'react';
import { useAuth } from '../components/AuthProvider';
import { Copy, Gift, Users } from 'lucide-react';

const LOGO_URL = 'https://i.suar.me/PpEzN/l';

export default function Referral() {
  const { user } = useAuth();
  
  // Create a real Telegram Bot start URL with startapp parameter
  const botUsername = 'KittyMedallion_bot'; // Replace with actual bot username when deployed
  const referralLink = `https://t.me/${botUsername}?startapp=ref_${user?.id}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(referralLink);
    window.Telegram?.WebApp?.showAlert('Referral link copied to clipboard!');
  };

  const handleShare = () => {
    const text = 'Join Kitty Medallion and start mining with me! 🐱🪙';
    window.Telegram?.WebApp?.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(text)}`);
  };

  return (
    <div className="flex flex-col p-6">
      <h1 className="mb-2 text-2xl font-bold text-white">Referrals</h1>
      <p className="mb-6 text-sm text-gray-400">Invite friends to earn massive rewards and mining boosts.</p>

      <div className="mb-6 rounded-3xl bg-gradient-to-br from-orange-500 to-pink-500 p-6 text-white shadow-xl">
        <h2 className="text-xl font-bold mb-4">Your Referral Stats</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col rounded-2xl bg-white/10 p-4 backdrop-blur-md">
            <span className="text-sm text-orange-100">Total Referrals</span>
            <span className="text-3xl font-extrabold">{user?.referralCount || 0}</span>
          </div>
          <div className="flex flex-col rounded-2xl bg-white/10 p-4 backdrop-blur-md">
            <span className="text-sm text-orange-100">Total Earned</span>
            <span className="text-2xl font-extrabold flex items-center">
              +{(user?.referralCount || 0) * 100}
              <img src={LOGO_URL} className="ml-1 h-5 w-5 rounded-full" alt="KITTY" referrerPolicy="no-referrer" />
            </span>
          </div>
        </div>
      </div>

      <div className="mb-8 rounded-2xl bg-[#1c1c1c] p-5 ring-1 ring-white/5">
        <div className="mb-4 flex items-center space-x-3 text-orange-400">
          <Gift size={24} />
          <span className="font-bold text-white">Referral Bonus</span>
        </div>
        <ul className="space-y-3 text-sm text-gray-300">
          <li className="flex items-center space-x-2">
            <div className="h-1.5 w-1.5 rounded-full bg-orange-500" />
            <span><strong className="text-white">100 KITTY</strong> instant reward per friend</span>
          </li>
          <li className="flex items-center space-x-2">
            <div className="h-1.5 w-1.5 rounded-full bg-orange-500" />
            <span><strong className="text-white">+50 Hash/day</strong> permanent mining boost</span>
          </li>
        </ul>
      </div>

      <div className="flex flex-col space-y-3 mt-auto">
        <button
          onClick={handleShare}
          className="flex w-full items-center justify-center space-x-2 rounded-xl bg-white py-4 font-bold text-black hover:bg-gray-200"
        >
          <Users size={20} />
          <span>Invite Friends</span>
        </button>
        <button
          onClick={handleCopy}
          className="flex w-full items-center justify-center space-x-2 rounded-xl bg-[#2a2a2a] py-4 font-bold text-white hover:bg-[#3a3a3a]"
        >
          <Copy size={20} />
          <span>Copy Link</span>
        </button>
      </div>
    </div>
  );
}
