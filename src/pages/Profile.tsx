import React from 'react';
import { useAuth } from '../components/AuthProvider';
import { User as UserIcon } from 'lucide-react';

export default function Profile() {
  const { user } = useAuth();
  const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;

  return (
    <div className="flex flex-col p-6 items-center">
      <h1 className="mb-8 w-full text-left text-2xl font-bold text-white">Profile</h1>

      <div className="mb-6 flex flex-col items-center">
        {tgUser?.photo_url ? (
          <img src={tgUser.photo_url} alt="Profile" className="h-24 w-24 rounded-full border-4 border-[#1c1c1c]" />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[#1c1c1c] text-gray-500">
            <UserIcon size={40} />
          </div>
        )}
        <h2 className="mt-4 text-xl font-bold text-white">
          {user?.firstName} {user?.lastName}
        </h2>
        {user?.username && <p className="text-orange-400">@{user.username}</p>}
      </div>

      <div className="w-full rounded-2xl bg-[#1c1c1c] p-4 ring-1 ring-white/5 space-y-4">
        <div className="flex justify-between items-center py-2 border-b border-white/5">
          <span className="text-gray-400 text-sm">User ID</span>
          <span className="font-mono text-sm text-white">{user?.id}</span>
        </div>
        <div className="flex justify-between items-center py-2 border-b border-white/5">
          <span className="text-gray-400 text-sm">Joined</span>
          <span className="text-sm text-white">
            {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}
          </span>
        </div>
        <div className="flex justify-between items-center py-2 border-b border-white/5">
          <span className="text-gray-400 text-sm">Mining Speed</span>
          <span className="text-sm text-green-400 font-semibold">{user?.miningSpeed} KITTY/day</span>
        </div>
        <div className="flex justify-between items-center py-2">
          <span className="text-gray-400 text-sm">Total Referrals</span>
          <span className="text-sm text-white font-semibold">{user?.referralCount}</span>
        </div>
      </div>
    </div>
  );
}
