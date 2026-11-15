import React, { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeftRight,
  Bell,
  Briefcase,
  CandlestickChart,
  CreditCard,
  Globe,
  Home,
  LayoutGrid,
  LogOut,
  Moon,
  ReceiptText,
  Settings,
  ShieldCheck,
  Sun,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react';
import { useAppState } from '../../context/AppStateContext';
import { LanguageModal } from '../ui/CommonPrimitives';

const DESKTOP_NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: Home },
  { to: '/markets', label: 'Markets', icon: CandlestickChart },
  { to: '/trade', label: 'Trading', icon: ArrowLeftRight },
  { to: '/wallet', label: 'Wallet', icon: Wallet },
  { to: '/portfolio', label: 'Portfolio', icon: Briefcase },
  { to: '/transactions', label: 'Transactions', icon: ReceiptText },
  { to: '/kyc', label: 'KYC Verification', icon: UserCheck },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/settings', label: 'Settings', icon: Settings },
];

const MOBILE_TABS = [
  { to: '/dashboard', label: 'Home', icon: Home },
  { to: '/markets', label: 'Markets', icon: CandlestickChart },
  { to: '/trade', label: 'Trade', icon: ArrowLeftRight },
  { to: '/portfolio', label: 'Portfolio', icon: Briefcase },
  { to: '/wallet', label: 'Assets', icon: CreditCard },
];

export const CustomerLayout: React.FC<{
  title: string;
  children: React.ReactNode;
}> = ({ title, children }) => {
  const {
    theme,
    toggleTheme,
    language,
    setLanguage,
    currentProfile,
    isAdmin,
    unreadNotificationsCount,
    logout,
  } = useAppState();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#F4F5F7] dark:bg-[#0B0C0E] text-[#111214] dark:text-[#F4F5F7] flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 border-r border-[#E2E4E9] dark:border-[#22242A] bg-white dark:bg-[#111215]">
        <div className="px-5 py-5 border-b border-[#E2E4E9] dark:border-[#22242A]">
          <p className="text-sm font-semibold tracking-tight text-[#111214] dark:text-[#F4F5F7]">
            Customer Workspace
          </p>
          <p className="mt-0.5 text-xs text-[#686D76] dark:text-[#7E828A]">
            Spot Exchange Account
          </p>
        </div>

        <nav aria-label="Customer navigation" className="flex-1 p-3 space-y-1 overflow-y-auto">
          {DESKTOP_NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-[#004AE2] text-white'
                      : 'text-[#4B5059] dark:text-[#9CA0A8] hover:bg-[#F4F5F7] dark:hover:bg-[#1A1C20] hover:text-[#111214] dark:hover:text-white'
                  }`
                }
              >
                <span className="flex items-center gap-3">
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </span>
                {item.to === '/notifications' && unreadNotificationsCount > 0 && (
                  <span className="font-mono-num text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-[#F0525E] text-white">
                    {unreadNotificationsCount}
                  </span>
                )}
              </NavLink>
            );
          })}

          {isAdmin && (
            <div className="pt-3 mt-3 border-t border-[#E2E4E9] dark:border-[#22242A]">
              <Link
                to="/admin"
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-[#004AE2] dark:text-[#60A5FA] hover:bg-[#004AE2]/10 whitespace-nowrap"
              >
                <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Admin Console</span>
              </Link>
            </div>
          )}
        </nav>

        <div className="p-3 border-t border-[#E2E4E9] dark:border-[#22242A] space-y-2">
          {currentProfile ? (
            <div className="px-3 py-2 rounded-xl bg-[#F4F5F7] dark:bg-[#141518]">
              <p className="text-xs font-semibold truncate">{currentProfile.fullName}</p>
              <p className="text-[11px] font-mono-num text-[#686D76] dark:text-[#7E828A]">
                ID: {currentProfile.publicUserId}
              </p>
            </div>
          ) : (
            <Link
              to="/login"
              className="block w-full text-center py-2.5 rounded-full bg-[#004AE2] text-white text-sm font-semibold"
            >
              Sign in
            </Link>
          )}
        </div>
      </aside>

      {/* Mobile Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-72 max-w-[85vw] bg-white dark:bg-[#141518] h-full flex flex-col border-r border-[#E2E4E9] dark:border-[#22242A]">
            <div className="flex items-center justify-between px-4 py-4 border-b border-[#E2E4E9] dark:border-[#22242A]">
              <span className="text-sm font-semibold">Navigation</span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation menu"
                className="p-2 rounded-lg text-[#686D76] hover:text-[#111214] dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {DESKTOP_NAV.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setDrawerOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center justify-between px-3 py-3 rounded-xl text-sm font-medium ${
                        isActive
                          ? 'bg-[#004AE2] text-white'
                          : 'text-[#4B5059] dark:text-[#9CA0A8] hover:bg-[#F4F5F7] dark:hover:bg-[#1C1E24]'
                      }`
                    }
                  >
                    <span className="flex items-center gap-3">
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </span>
                    {item.to === '/notifications' && unreadNotificationsCount > 0 && (
                      <span className="font-mono-num text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-[#F0525E] text-white">
                        {unreadNotificationsCount}
                      </span>
                    )}
                  </NavLink>
                );
              })}
              {isAdmin && (
                <Link
                  to="/admin"
                  onClick={() => setDrawerOpen(false)}
                  className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium text-[#004AE2] dark:text-[#60A5FA]"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>Admin Console</span>
                </Link>
              )}
            </nav>
            <div className="p-3 border-t border-[#E2E4E9] dark:border-[#22242A]">
              {currentProfile ? (
                <button
                  type="button"
                  onClick={() => {
                    logout();
                    setDrawerOpen(false);
                    navigate('/login');
                  }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-full bg-[#242528] text-white text-sm font-medium"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign out</span>
                </button>
              ) : (
                <Link
                  to="/login"
                  onClick={() => setDrawerOpen(false)}
                  className="block text-center w-full py-2.5 rounded-full bg-[#004AE2] text-white text-sm font-semibold"
                >
                  Sign in
                </Link>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col pb-20 lg:pb-6">
        <header className="sticky top-0 z-30 h-14 px-4 lg:px-6 flex items-center justify-between gap-4 bg-[#F4F5F7]/95 dark:bg-[#0B0C0E]/95 backdrop-blur-md border-b border-[#E2E4E9] dark:border-[#1E2026]">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              className="lg:hidden p-2 -ml-2 rounded-lg text-[#111214] dark:text-[#F4F5F7] min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <LayoutGrid className="w-5 h-5" />
            </button>
            <h1 className="text-base sm:text-lg font-semibold truncate">{title}</h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setLangOpen(true)}
              aria-label="Select language"
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#E8EAEE] dark:bg-[#242528] text-xs font-medium whitespace-nowrap shrink-0 min-h-[36px]"
            >
              <Globe className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{language}</span>
            </button>

            <Link
              to="/notifications"
              aria-label="Notifications"
              className="relative p-2 rounded-full hover:bg-[#E8EAEE] dark:hover:bg-[#242528] min-h-[40px] min-w-[40px] flex items-center justify-center"
            >
              <Bell className="w-5 h-5" />
              {unreadNotificationsCount > 0 && (
                <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-[#F0525E] text-white text-[10px] font-mono-num font-bold flex items-center justify-center">
                  {unreadNotificationsCount}
                </span>
              )}
            </Link>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="p-2 rounded-full hover:bg-[#E8EAEE] dark:hover:bg-[#242528] min-h-[40px] min-w-[40px] flex items-center justify-center"
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>

            <Link
              to={currentProfile ? '/settings' : '/login'}
              aria-label="Profile and settings"
              className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#E8EAEE] dark:bg-[#242528] text-xs font-medium whitespace-nowrap shrink-0 min-h-[36px]"
            >
              <span>{currentProfile ? currentProfile.fullName : 'Sign in'}</span>
            </Link>
          </div>
        </header>

        <main className="flex-1 w-full max-w-6xl mx-auto px-4 lg:px-6 py-5">{children}</main>
      </div>

      {/* Mobile Bottom 5-Tab Bar */}
      <nav
        aria-label="Mobile quick tabs"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-white/95 dark:bg-[#111215]/95 backdrop-blur-md border-t border-[#E2E4E9] dark:border-[#22242A] grid grid-cols-5 items-center"
      >
        {MOBILE_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive =
            location.pathname === tab.to ||
            (tab.to === '/markets' && location.pathname.startsWith('/markets'));
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={`flex flex-col items-center justify-center h-full gap-1 text-[11px] font-medium transition-colors ${
                isActive
                  ? 'text-[#004AE2] dark:text-white'
                  : 'text-[#686D76] dark:text-[#6E7178]'
              }`}
            >
              <Icon className="w-5 h-5" aria-hidden="true" />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </nav>

      <LanguageModal
        open={langOpen}
        selected={language}
        onSelect={setLanguage}
        onClose={() => setLangOpen(false)}
      />
    </div>
  );
};
