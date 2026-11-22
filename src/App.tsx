import React from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { Pickaxe, CheckSquare, Users, Wallet } from 'lucide-react';
import { AuthProvider, useAuth } from './components/AuthProvider';
import Home from './pages/Home';
import Tasks from './pages/Tasks';
import Referral from './pages/Referral';
import WalletPage from './pages/WalletPage';
import Profile from './pages/Profile';

const AppContent = () => {
  const { user, loading, error } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#0b0b0e]">
        <div className="relative flex items-center justify-center">
          <div className="h-12 w-12 animate-spin rounded-full border-[3px] border-amber-500/20 border-t-amber-500"></div>
          <div className="absolute h-5 w-5 rounded-full bg-amber-500/20 blur-sm"></div>
        </div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center p-6 text-center bg-[#0b0b0e]">
        <div className="bg-[#141419] p-8 rounded-3xl border border-white/[0.06] max-w-sm w-full shadow-2xl">
          <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-red-500/20">
            <span className="text-2xl text-red-400">⚠</span>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2 tracking-tight">Access Denied</h1>
          <p className="text-zinc-400 text-sm mb-6 leading-relaxed">
            Please open this application inside Telegram or reload the application page.
          </p>
          
          <button 
            onClick={() => window.location.reload()}
            className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 active:scale-[0.98] text-zinc-950 font-bold py-3.5 px-6 rounded-2xl transition duration-150 mb-3 shadow-lg shadow-orange-500/20"
          >
            Refresh Page
          </button>

          {error && (
            <div className="mt-4 p-3.5 bg-red-950/30 rounded-xl border border-red-500/20">
              <p className="text-red-300 text-xs font-mono break-all">{error}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  const photoUrl = React.useMemo(() => {
    const tgUser = typeof window !== 'undefined' && window.Telegram?.WebApp?.initDataUnsafe?.user;
    return tgUser?.photo_url || null;
  }, []);

  const initials = React.useMemo(() => {
    const tgUser = typeof window !== 'undefined' && window.Telegram?.WebApp?.initDataUnsafe?.user;
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
  }, [user]);

  return (
    <div className="relative flex h-screen w-full flex-col bg-[#0b0b0e] text-white overflow-hidden">
      {/* Subtle Top Radial Ambient Glow */}
      <div className="pointer-events-none fixed inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_80%_50%_at_50%_-15%,rgba(249,115,22,0.14),transparent)] z-0" />

      <div className="relative z-10 flex-1 overflow-y-auto pb-28">
        <div className="mx-auto w-full max-w-md">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/referral" element={<Referral />} />
            <Route path="/wallet" element={<WalletPage />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>

      {/* Bottom Floating Navigation & Circular Telegram Profile Button */}
      <div className="fixed bottom-5 left-4 right-4 z-50">
        <div className="mx-auto flex max-w-sm items-center justify-between gap-3">
          {/* Main Rounded Navigation Bar */}
          <nav className="flex-1 h-[58px] flex items-center justify-around rounded-[24px] border border-white/[0.08] bg-[#141419]/90 px-2 shadow-[0_16px_40px_rgba(0,0,0,0.75)] backdrop-blur-xl">
            <NavItem to="/" icon={<Pickaxe size={20} strokeWidth={2.2} />} label="Mine" />
            <NavItem to="/tasks" icon={<CheckSquare size={20} strokeWidth={2.2} />} label="Tasks" />
            <NavItem to="/referral" icon={<Users size={20} strokeWidth={2.2} />} label="Frens" />
            <NavItem to="/wallet" icon={<Wallet size={20} strokeWidth={2.2} />} label="Wallet" />
          </nav>

          {/* Floating Circular Profile Avatar (Telegram Photo or 2-Letter Initials) */}
          <NavLink
            to="/profile"
            aria-label="Profile"
            className={({ isActive }) =>
              `h-[58px] w-[58px] flex flex-shrink-0 items-center justify-center rounded-full border text-sm font-extrabold uppercase transition-all duration-200 overflow-hidden shadow-[0_16px_40px_rgba(0,0,0,0.75)] backdrop-blur-xl ${
                isActive
                  ? 'bg-gradient-to-br from-amber-500 to-orange-600 border-amber-400/80 text-white scale-105 shadow-lg shadow-orange-500/30'
                  : 'bg-[#141419]/90 border-white/[0.08] text-zinc-200 hover:text-white hover:border-white/20'
              }`
            }
          >
            {photoUrl ? (
              <img
                src={photoUrl}
                alt="Profile"
                referrerPolicy="no-referrer"
                className="h-full w-full rounded-full object-cover"
              />
            ) : (
              <span className="font-display text-sm font-extrabold tracking-wider leading-none">
                {initials}
              </span>
            )}
          </NavLink>
        </div>
      </div>
    </div>
  );
};

const NavItem = ({ 
  to, 
  icon, 
  label 
}: { 
  to: string; 
  icon: React.ReactNode; 
  label: string; 
}) => (
  <NavLink
    to={to}
    className={({ isActive }) =>
      `relative flex min-h-[44px] min-w-[54px] flex-col items-center justify-center space-y-1 rounded-2xl px-2.5 py-1.5 transition-all duration-200 ${
        isActive
          ? 'text-amber-400 bg-amber-500/10'
          : 'text-zinc-500 hover:text-zinc-300'
      }`
    }
  >
    {icon}
    <span className="text-[10px] font-semibold tracking-tight whitespace-nowrap">{label}</span>
  </NavLink>
);

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </BrowserRouter>
  );
}
