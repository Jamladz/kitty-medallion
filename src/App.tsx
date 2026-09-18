import React from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { Pickaxe, CheckSquare, Users, Wallet, User as UserIcon } from 'lucide-react';
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
      <div className="flex h-screen w-full items-center justify-center bg-[#0f0f0f]">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"></div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center p-6 text-center bg-[#0f0f0f]">
        <div className="bg-[#161616] p-8 rounded-2xl border border-gray-800 max-w-sm w-full shadow-2xl">
          <div className="w-16 h-16 bg-red-950/30 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-900/50">
            <span className="text-3xl text-red-500">⚠</span>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Access Denied</h1>
          <p className="text-gray-400 text-sm mb-6">Please open this application inside Telegram or reload the application page.</p>
          
          <button 
            onClick={() => window.location.reload()}
            className="w-full bg-orange-500 hover:bg-orange-600 active:scale-[0.98] text-white font-semibold py-3 px-6 rounded-xl transition duration-150 mb-3 shadow-lg shadow-orange-500/20"
          >
            Refresh Page
          </button>

          {error && (
            <div className="mt-4 p-3 bg-red-950/20 rounded-lg border border-red-900/30">
              <p className="text-red-400 text-xs font-mono break-all">{error}</p>
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
    <div className="flex h-screen w-full flex-col bg-[#0f0f0f] text-white">
      <div className="flex-1 overflow-y-auto pb-28">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/referral" element={<Referral />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>

      <div className="fixed bottom-5 left-4 right-4 z-50">
        <div className="mx-auto flex max-w-sm items-center justify-between gap-3">
          {/* Main Rounded Navigation Bar */}
          <nav className="flex-1 h-[56px] flex items-center justify-around rounded-[22px] border border-gray-800 bg-[#161616]/95 px-2 shadow-[0_12px_40px_rgba(0,0,0,0.7)] backdrop-blur-md">
            <NavItem to="/" icon={<Pickaxe size={22} />} label="Mine" />
            <NavItem to="/tasks" icon={<CheckSquare size={22} />} label="Tasks" />
            <NavItem to="/referral" icon={<Users size={22} />} label="Frens" />
            <NavItem to="/wallet" icon={<Wallet size={22} />} label="Wallet" />
          </nav>

          {/* Floating Profile Initials Avatar - Perfect circle that loads Telegram photo or falls back to name initials */}
          <NavLink
            to="/profile"
            className={({ isActive }) =>
              `h-[56px] w-[56px] flex flex-shrink-0 flex-col items-center justify-center rounded-full border text-[12px] font-extrabold uppercase transition-all overflow-hidden shadow-[0_12px_40px_rgba(0,0,0,0.7)] backdrop-blur-md ${
                isActive
                  ? 'bg-gradient-to-br from-orange-500 to-orange-600 border-orange-400 text-white scale-105 shadow-lg shadow-orange-500/25'
                  : 'bg-[#161616]/95 border-gray-800 text-gray-400 hover:text-white hover:border-gray-700'
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
              <span className="text-sm font-extrabold tracking-wider leading-none">{initials}</span>
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
      `flex flex-col items-center justify-center space-y-1 transition-all ${
        isActive ? 'text-orange-500 scale-105' : 'text-gray-500 hover:text-gray-300'
      }`
    }
  >
    {icon}
    <span className="text-[10px] font-medium">{label}</span>
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
