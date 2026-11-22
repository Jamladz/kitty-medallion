import React, { useState } from 'react';
import { useAuth } from '../components/AuthProvider';
import { Copy, Check, Calendar, Zap, Users, Hash } from 'lucide-react';

export default function Profile() {
  const { user } = useAuth();
  const [copiedId, setCopiedId] = useState(false);
  const tgUser = typeof window !== 'undefined' ? window.Telegram?.WebApp?.initDataUnsafe?.user : undefined;

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

  const handleCopyId = () => {
    if (!user?.id) return;
    navigator.clipboard.writeText(String(user.id));
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  return (
    <div className="flex flex-col px-5 pt-6 pb-8 items-center">
      <div className="w-full mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-white">
          Profile
        </h1>
        <p className="mt-1 text-xs text-zinc-400">
          Your Telegram identity and cloud mining credentials.
        </p>
      </div>

      {/* Identity Showcase Card */}
      <div className="mb-5 flex w-full flex-col items-center rounded-3xl bg-[#141419] p-6 border border-white/[0.06] shadow-xl">
        <div className="relative">
          {tgUser?.photo_url ? (
            <img
              src={tgUser.photo_url}
              alt="Profile"
              referrerPolicy="no-referrer"
              className="h-24 w-24 rounded-full object-cover border-2 border-amber-500/40 shadow-lg"
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-zinc-950 font-display text-2xl font-extrabold tracking-wider shadow-lg shadow-orange-500/20">
              {initials}
            </div>
          )}
        </div>

        <h2 className="mt-4 font-display text-xl font-bold text-white">
          {user?.firstName} {user?.lastName}
        </h2>
        {user?.username && (
          <p className="mt-0.5 text-xs font-medium text-amber-400">
            @{user.username}
          </p>
        )}
      </div>

      {/* Account Telemetry Rows */}
      <div className="w-full rounded-3xl bg-[#141419] p-5 border border-white/[0.06] divide-y divide-white/[0.05] shadow-xl">
        <div className="flex justify-between items-center py-3.5 first:pt-1">
          <div className="flex items-center space-x-2.5 text-zinc-400">
            <Hash size={16} className="text-zinc-500" />
            <span className="text-xs font-medium">Telegram ID</span>
          </div>
          <button
            onClick={handleCopyId}
            className="flex items-center space-x-1.5 font-mono text-xs font-semibold tabular-nums text-white hover:text-amber-400 transition-colors"
          >
            <span>{user?.id}</span>
            {copiedId ? (
              <Check size={13} className="text-emerald-400" />
            ) : (
              <Copy size={13} className="text-zinc-500" />
            )}
          </button>
        </div>

        <div className="flex justify-between items-center py-3.5">
          <div className="flex items-center space-x-2.5 text-zinc-400">
            <Calendar size={16} className="text-zinc-500" />
            <span className="text-xs font-medium">Member Since</span>
          </div>
          <span className="font-mono text-xs font-semibold tabular-nums text-white">
            {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Active'}
          </span>
        </div>

        <div className="flex justify-between items-center py-3.5">
          <div className="flex items-center space-x-2.5 text-zinc-400">
            <Zap size={16} className="text-amber-400" />
            <span className="text-xs font-medium">Daily Hashrate</span>
          </div>
          <span className="font-mono text-xs font-bold tabular-nums text-emerald-400">
            {(user?.miningSpeed || 500).toLocaleString()} KITTY/day
          </span>
        </div>

        <div className="flex justify-between items-center py-3.5 last:pb-1">
          <div className="flex items-center space-x-2.5 text-zinc-400">
            <Users size={16} className="text-zinc-500" />
            <span className="text-xs font-medium">Invited Network</span>
          </div>
          <span className="font-mono text-xs font-bold tabular-nums text-white">
            {(user?.referralCount || 0).toLocaleString()} Frens
          </span>
        </div>
      </div>
    </div>
  );
}
