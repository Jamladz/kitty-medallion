import React from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { Pickaxe, CheckSquare, Users, Wallet } from 'lucide-react';
import { AuthProvider, useAuth } from './components/AuthProvider';
import { ReferralWelcomeSheet } from './components/ReferralWelcomeSheet';
import Home from './pages/Home';
import Tasks from './pages/Tasks';
import Referral from './pages/Referral';
import WalletPage from './pages/WalletPage';
import Profile from './pages/Profile';

const APP_LOGO_URL = 'https://i.suar.me/PpEzN/l';
const USDT_LOGO_URL = 'https://i.ibb.co/N2WMd6QC/Tether-USDT.png';

const AppContent = () => {
  const { user, loading, error } = useAuth();
  const navigate = useNavigate();

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

  if (loading) {
    return (
      <div className="flex h-[var(--app-height,100dvh)] w-full items-center justify-center bg-[#0b0b0e]">
        <div className="relative flex items-center justify-center">
          <div className="h-12 w-12 animate-spin rounded-full border-[3px] border-amber-500/20 border-t-amber-500"></div>
          <div className="absolute h-5 w-5 rounded-full bg-amber-500/20 blur-sm"></div>
        </div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="flex h-[var(--app-height,100dvh)] w-full flex-col items-center justify-center p-5 text-center bg-[#0b0b0e]">
        <div className="bg-[#141419] p-6 sm:p-8 rounded-3xl border border-white/[0.06] max-w-sm w-full shadow-2xl">
          <div className="w-14 h-14 sm:w-16 sm:h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-red-500/20">
            <span className="text-2xl text-red-400">⚠</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white mb-2 tracking-tight">Access Denied</h1>
          <p className="text-zinc-400 text-xs sm:text-sm mb-5 leading-relaxed">
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

  const balanceUsdt = Number(user?.balanceUsdt) || 0;

  return (
    <div className="relative flex h-[var(--app-height,100dvh)] w-full flex-col bg-[#0b0b0e] text-white overflow-hidden">
      {/* Subtle Top Radial Ambient Glow */}
      <div className="pointer-events-none fixed inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_80%_50%_at_50%_-15%,rgba(249,115,22,0.14),transparent)] z-0" />

      {/* Persistent Global Top Header across all pages (App Name & USDT Balance) */}
      <header className="relative z-30 shrink-0 border-b border-white/[0.06] bg-[#0b0b0e]/85 backdrop-blur-xl pt-[max(0.625rem,var(--safe-top,0.625rem))] pb-2.5 px-4 sm:px-5">
        <div className="mx-auto flex w-full max-w-[460px] items-center justify-between gap-2">
          <div
            onClick={() => navigate('/')}
            className="flex items-center space-x-2 min-w-0 cursor-pointer select-none"
          >
            <img
              src={APP_LOGO_URL}
              alt="Kitty Medallion"
              referrerPolicy="no-referrer"
              className="h-6 w-6 sm:h-7 sm:w-7 shrink-0 rounded-full object-contain"
            />
            <span className="font-display text-sm sm:text-base font-bold tracking-tight text-white truncate">
              Kitty Medallion
            </span>
          </div>

          <button
            type="button"
            onClick={() => navigate('/wallet')}
            className="flex items-center space-x-1.5 rounded-xl bg-[#141419] hover:bg-[#1a1a22] active:scale-95 px-2.5 py-1.5 border border-white/[0.07] text-xs font-medium transition-all shrink-0"
          >
            <img
              src={USDT_LOGO_URL}
              alt="USDT"
              referrerPolicy="no-referrer"
              className="h-4 w-4 shrink-0 rounded-full object-contain"
            />
            <span className="font-mono tabular-nums text-emerald-400 font-bold">
              {balanceUsdt.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <span className="text-zinc-400 font-semibold text-[11px]">USDT</span>
          </button>
        </div>
      </header>

      {/* Main Scrollable Viewport Container */}
      <main className="relative z-10 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain pb-[calc(5.75rem+var(--safe-bottom,0px))]">
        <div className="mx-auto w-full max-w-[460px]">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/referral" element={<Referral />} />
            <Route path="/wallet" element={<WalletPage />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>

      {/* 50% Bottom-Up Welcome Gift Sheet (+2.00 USDT First-Time Referral Entry Gift) */}
      <ReferralWelcomeSheet />

      {/* Bottom Floating Navigation & Circular Telegram Profile Button */}
      <div className="fixed inset-x-0 bottom-[max(0.875rem,var(--safe-bottom,0.875rem))] z-50 px-3.5 sm:px-5 pointer-events-none">
        <div className="mx-auto flex w-full max-w-[420px] items-center justify-between gap-2 sm:gap-3 pointer-events-auto">
          {/* Main Rounded Navigation Bar */}
          <nav className="flex-1 min-w-0 h-[56px] sm:h-[60px] flex items-center justify-between rounded-[24px] border border-white/[0.08] bg-[#141419]/92 px-1.5 sm:px-2 shadow-[0_16px_40px_rgba(0,0,0,0.8)] backdrop-blur-xl">
            <NavItem to="/" icon={<Pickaxe size={19} strokeWidth={2.2} />} label="Mine" />
            <NavItem to="/tasks" icon={<CheckSquare size={19} strokeWidth={2.2} />} label="Tasks" />
            <NavItem to="/referral" icon={<Users size={19} strokeWidth={2.2} />} label="Frens" />
            <NavItem to="/wallet" icon={<Wallet size={19} strokeWidth={2.2} />} label="Wallet" />
          </nav>

          {/* Floating Circular Profile Avatar (Telegram Photo or 2-Letter Initials) */}
          <NavLink
            to="/profile"
            aria-label="Profile"
            className={({ isActive }) =>
              `h-[56px] w-[56px] sm:h-[60px] sm:w-[60px] flex shrink-0 items-center justify-center rounded-full border text-sm font-extrabold uppercase transition-all duration-200 overflow-hidden shadow-[0_16px_40px_rgba(0,0,0,0.8)] backdrop-blur-xl ${
                isActive
                  ? 'bg-gradient-to-br from-amber-500 to-orange-600 border-amber-400/80 text-white scale-105 shadow-lg shadow-orange-500/30'
                  : 'bg-[#141419]/92 border-white/[0.08] text-zinc-200 hover:text-white hover:border-white/20 active:scale-95'
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
              <span className="font-display text-xs sm:text-sm font-extrabold tracking-wider leading-none">
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
      `relative flex-1 min-w-0 flex min-h-[44px] flex-col items-center justify-center space-y-0.5 sm:space-y-1 rounded-2xl px-1.5 sm:px-2.5 py-1 transition-all duration-200 active:scale-95 ${
        isActive
          ? 'text-amber-400 bg-amber-500/12'
          : 'text-zinc-500 hover:text-zinc-300'
      }`
    }
  >
    {icon}
    <span className="text-[10px] font-semibold tracking-tight truncate max-w-full">{label}</span>
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
